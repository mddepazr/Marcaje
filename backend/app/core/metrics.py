from threading import Lock


class MetricsCollector:
    def __init__(self) -> None:
        self._lock = Lock()
        self.total_requests = 0
        self.errors_4xx = 0
        self.errors_5xx = 0
        self.total_duration_ms = 0.0

    def record(self, status_code: int, duration_ms: float) -> None:
        with self._lock:
            self.total_requests += 1
            self.total_duration_ms += duration_ms
            if 400 <= status_code < 500:
                self.errors_4xx += 1
            elif status_code >= 500:
                self.errors_5xx += 1

    def snapshot(self) -> dict:
        with self._lock:
            total = self.total_requests
            total_errors = self.errors_4xx + self.errors_5xx
            error_rate = round((total_errors / total) * 100, 2) if total > 0 else 0.0
            avg_latency = round(self.total_duration_ms / total, 2) if total > 0 else 0.0
            return {
                "total_solicitudes": total,
                "errores_4xx": self.errors_4xx,
                "errores_5xx": self.errors_5xx,
                "tasa_error_pct": error_rate,
                "latencia_promedio_ms": avg_latency,
                "alerta_error_rate_alto": error_rate > 5.0 and total >= 5,
            }


metrics = MetricsCollector()
