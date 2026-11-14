import io
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageOps
from ultralytics import YOLO, YOLOWorld

CUSTOM_WEIGHTS = Path("/app/models/epp.pt")
WORLD_WEIGHTS = "/opt/ml_cache/yolov8s-worldv2.pt"

TARGET_CLASSES = [
    "person",
    "hard hat",
    "safety helmet",
    "safety glasses",
    "protective goggles",
    "face mask",
    "surgical mask",
    "cell phone",
    "smartphone",
    "tablet",
    "laptop",
    "tv",
    "monitor",
]

SPOOF_LABELS = {"cell phone", "smartphone", "tablet", "laptop", "tv", "monitor"}


def enhance_low_light(pil_image: Image.Image, brightness_threshold: float = 85.0) -> Image.Image:
    """Mejora el contraste local (CLAHE) si la imagen está oscura."""
    rgb = np.array(pil_image)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)

    if float(np.mean(l_channel)) < brightness_threshold:
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        l_channel = clahe.apply(l_channel)
        merged = cv2.merge((l_channel, a_channel, b_channel))
        enhanced_rgb = cv2.cvtColor(merged, cv2.COLOR_LAB2RGB)
        return Image.fromarray(enhanced_rgb)

    return pil_image


class PPEDetectorService:
    """Servicio desacoplado de detección de persona, EPP y objetos de fraude."""

    def __init__(self) -> None:
        if CUSTOM_WEIGHTS.exists():
            self.model = YOLO(str(CUSTOM_WEIGHTS))
            self.using_custom_ppe = True
        else:
            weights_path = WORLD_WEIGHTS if Path(WORLD_WEIGHTS).exists() else "yolov8s-worldv2.pt"
            self.model = YOLOWorld(weights_path)
            self.model.set_classes(TARGET_CLASSES)
            self.using_custom_ppe = False

    def analyze_image(self, image_bytes: bytes, conf_threshold: float = 0.22) -> dict:
        image = Image.open(io.BytesIO(image_bytes))
        image = ImageOps.exif_transpose(image).convert("RGB")
        image = enhance_low_light(image)

        results = self.model.predict(source=image, conf=conf_threshold, verbose=False)
        detections = []

        person_detected = False
        spoof_device_detected = False
        has_helmet = False
        has_glasses = False
        has_mask = False
        max_conf = 0.0

        for result in results:
            names = result.names
            for box in result.boxes:
                cls_id = int(box.cls[0])
                label = str(names[cls_id]).lower().strip()
                conf = round(float(box.conf[0]), 4)
                bbox = [round(float(x), 2) for x in box.xyxy[0].tolist()]

                detections.append({"label": label, "confidence": conf, "bbox": bbox})
                max_conf = max(max_conf, conf)

                if label in SPOOF_LABELS and conf >= 0.42:
                    spoof_device_detected = True
                elif label in {"person", "persona"}:
                    person_detected = True
                elif label in {"helmet", "hardhat", "hard hat", "safety helmet", "casco"}:
                    has_helmet = True
                elif label in {"glasses", "goggles", "protective goggles", "safety-glasses", "safety glasses", "eyeglasses", "lentes", "gafas"}:
                    has_glasses = True
                elif label in {"mask", "face-mask", "face mask", "surgical mask", "mascarilla", "cubrebocas"}:
                    has_mask = True

        is_compliant = person_detected and not spoof_device_detected and (has_helmet or has_glasses or has_mask)

        return {
            "person_detected": person_detected,
            "spoof_device_detected": spoof_device_detected,
            "has_helmet": has_helmet,
            "has_glasses": has_glasses,
            "has_mask": has_mask,
            "is_compliant": is_compliant,
            "confidence": max_conf,
            "detections_raw": detections,
        }


_detector_instance: PPEDetectorService | None = None


def get_detector() -> PPEDetectorService:
    global _detector_instance
    if _detector_instance is None:
        _detector_instance = PPEDetectorService()
    return _detector_instance
