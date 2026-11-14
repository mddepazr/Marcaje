import io
import cv2
import numpy as np
from PIL import Image, ImageOps


def _to_cv2(image_bytes: bytes) -> np.ndarray:
    pil_img = Image.open(io.BytesIO(image_bytes))
    pil_img = ImageOps.exif_transpose(pil_img).convert("RGB")
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)


def check_frame_authenticity(frame_bgr: np.ndarray) -> tuple[bool, str]:
    """Analiza textura y reflejos especulares para detectar pantallas o fotos impresas."""
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)

    # 1. Varianza del Laplaciano: fotos borrosas o re-fotografiadas pierden micro-textura
    laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if laplacian_var < 25.0:
        return False, "Imagen demasiado borrosa o sin textura natural (posible foto impresa o pantalla)."

    # 2. Detección de brillo especular artificial típico de pantallas LCD/OLED
    _, s_channel, v_channel = cv2.split(hsv)
    glare_pixels = np.logical_and(v_channel > 248, s_channel < 25)
    glare_ratio = float(np.mean(glare_pixels))
    if glare_ratio > 0.18:
        return False, "Reflejo de pantalla detectado. Usa la cámara directamente sin dispositivos."

    return True, "OK"


def verify_liveness_sequence(frames_bytes: list[bytes]) -> tuple[bool, str]:
    """Verifica prueba de vida usando una ráfaga de 3 fotogramas consecutivos."""
    if len(frames_bytes) < 2:
        return False, "Se requieren múltiples fotogramas en vivo para validar prueba de vida."

    cv_frames = [_to_cv2(b) for b in frames_bytes]

    # Validar autenticidad visual en el fotograma central
    is_authentic, reason = check_frame_authenticity(cv_frames[len(cv_frames) // 2])
    if not is_authentic:
        return False, reason

    # Comparar movimiento natural entre fotogramas consecutivos
    diffs = []
    base_h, base_w = 240, 320
    resized = [cv2.resize(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), (base_w, base_h)) for f in cv_frames]

    for i in range(len(resized) - 1):
        diff = cv2.absdiff(resized[i], resized[i + 1])
        # Porcentaje de píxeles con cambio real (> 12 niveles de intensidad)
        motion_ratio = float(np.mean(diff > 12))
        diffs.append(motion_ratio)

    avg_motion = sum(diffs) / len(diffs)

    # Si el movimiento es casi 0, es una imagen estática / foto impresa pegada frente a la cámara
    if avg_motion < 0.004:
        return False, "No se detectó movimiento natural (posible fotografía estática). Muévete ligeramente frente a la cámara."

    # Si cambia más del 65% de la escena de golpe, alguien está cambiando de pantalla o tapando la lente
    if avg_motion > 0.65:
        return False, "Cambio brusco de escena detectado. Mantente frente a la cámara durante el escaneo."

    return True, "Persona real verificada"
