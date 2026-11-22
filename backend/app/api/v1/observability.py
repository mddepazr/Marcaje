from fastapi import APIRouter

from app.core.exceptions import BadRequestError, NotFoundError
from app.core.logging_config import get_logger, request_id_ctx
from app.core.metrics import metrics
from app.db.models import WorkZone
from app.db.session import SessionLocal

router = APIRouter(prefix="/observabilidad", tags=["Observabilidad y Errores"])
logger = get_logger("observabilidad")


@router.get("/zonas/{zone_id}")
def consultar_zona_controlada(zone_id: str):
    """Demuestra errores controlados 400 (parámetro inválido), 404 (no existe) y 200 (éxito)."""
    if not zone_id.isdigit() or int(zone_id) <= 0:
        raise BadRequestError(
            message=f"El parámetro zone_id '{zone_id}' debe ser un entero positivo.",
            details={"zone_id_recibido": zone_id},
        )

    numeric_id = int(zone_id)
    with SessionLocal() as db:
        zone = db.query(WorkZone).filter(WorkZone.id == numeric_id).first()
        if not zone:
            raise NotFoundError(
                message=f"No existe ninguna zona operativa con id {numeric_id}.",
                details={"zone_id": numeric_id},
            )

        logger.info(
            "zona_consultada_ok",
            extra={
                "evento": "zona_consultada_ok",
                "zoneId": zone.id,
                "zoneName": zone.name,
            },
        )
        return {
            "requestId": request_id_ctx.get(),
            "zona": {
                "id": zone.id,
                "nombre": zone.name,
                "descripcion": zone.description,
                "requiere_casco": zone.require_helmet,
                "requiere_lentes": zone.require_glasses,
                "requiere_mascarilla": zone.require_mask,
                "requiere_chaleco": zone.require_vest,
                "activa": zone.is_active,
            },
        }


@router.get("/simular-error-500")
def simular_error_interno():
    """Simula un fallo externo/interno inesperado para demostrar captura global 500 sin filtrar detalles."""
    raise RuntimeError("Fallo simulado: timeout de conexión contra el servicio externo de validación biométrica")


@router.get("/metricas")
def obtener_metricas():
    """Expone métricas básicas de observabilidad (latencia y tasa de error)."""
    snapshot = metrics.snapshot()
    if snapshot["alerta_error_rate_alto"]:
        logger.warning(
            "alerta_tasa_errores_alta",
            extra={"evento": "alerta_tasa_errores_alta", **snapshot},
        )
    else:
        logger.info("metricas_consultadas", extra={"evento": "metricas_consultadas"})
    return {
        "requestId": request_id_ctx.get(),
        "metricas": snapshot,
    }
