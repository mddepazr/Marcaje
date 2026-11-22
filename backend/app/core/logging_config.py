from contextvars import ContextVar
from datetime import datetime, timezone
import json
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="sin-request-id")

SENSITIVE_KEYS = {
    "password",
    "hashed_password",
    "token",
    "access_token",
    "authorization",
    "cookie",
    "secret",
}

STANDARD_LOG_FIELDS = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "message", "asctime", "taskName",
}


def sanitize_data(data: Any) -> Any:
    if isinstance(data, dict):
        return {
            k: ("***REDACTADO***" if str(k).lower() in SENSITIVE_KEYS else sanitize_data(v))
            for k, v in data.items()
        }
    if isinstance(data, list):
        return [sanitize_data(item) for item in data]
    return data


class StructuredJSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        level = "WARN" if record.levelname == "WARNING" else record.levelname
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "nivel": level,
            "evento": getattr(record, "evento", record.getMessage()),
            "requestId": getattr(record, "requestId", request_id_ctx.get()),
            "modulo": record.name,
        }

        for key, value in record.__dict__.items():
            if key not in STANDARD_LOG_FIELDS and key not in {"evento", "requestId"}:
                payload[key] = sanitize_data(value)

        if record.exc_info:
            payload["stack"] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=False)


def configure_logging() -> logging.Logger:
    logger = logging.getLogger("epp_marcaje")
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)
    logger.propagate = False
    formatter = StructuredJSONFormatter()

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)

    log_dir = Path(__file__).resolve().parents[2] / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    file_handler = RotatingFileHandler(
        log_dir / "app.log",
        maxBytes=2_000_000,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


def get_logger(module_name: str = "epp_marcaje") -> logging.Logger:
    configure_logging()
    if module_name.startswith("epp_marcaje"):
        return logging.getLogger(module_name)
    return logging.getLogger(f"epp_marcaje.{module_name}")
