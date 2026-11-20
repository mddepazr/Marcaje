import gc
import io
from pathlib import Path
import threading
import cv2
import numpy as np
from PIL import Image, ImageOps
import torch
from ultralytics import YOLO, YOLOWorld

torch.set_num_threads(1)

CUSTOM_WEIGHTS = Path("/app/models/epp.pt")
BAKED_ONNX = Path("/opt/ml_cache/baked_epp.onnx")
BAKED_PT = Path("/opt/ml_cache/baked_epp.pt")

TARGET_CLASSES = [
    "person",
    "hard hat",
    "safety helmet",
    "safety glasses",
    "glasses",
    "face mask",
    "surgical mask",
    "cell phone",
    "laptop",
    "monitor",
]

SPOOF_LABELS = {"cell phone", "laptop", "monitor"}
HELMET_LABELS = {"helmet", "hardhat", "hard hat", "safety helmet", "casco"}
GLASSES_LABELS = {"glasses", "safety glasses", "goggles", "lentes", "gafas"}
MASK_LABELS = {"mask", "face mask", "surgical mask", "mascarilla", "cubrebocas"}


def enhance_contrast(pil_image: Image.Image, force: bool = False, brightness_threshold: float = 85.0) -> Image.Image:
    rgb = np.array(pil_image)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)

    if force or float(np.mean(l_channel)) < brightness_threshold:
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        l_channel = clahe.apply(l_channel)
        merged = cv2.merge((l_channel, a_channel, b_channel))
        enhanced_rgb = cv2.cvtColor(merged, cv2.COLOR_LAB2RGB)
        return Image.fromarray(enhanced_rgb)

    return pil_image


class PPEDetectorService:
    """Servicio de detección en 2 etapas optimizado en ONNX con cola segura para baja RAM."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        if CUSTOM_WEIGHTS.exists():
            self.model = YOLO(str(CUSTOM_WEIGHTS))
            self.using_custom_ppe = True
        elif BAKED_ONNX.exists():
            self.model = YOLO(str(BAKED_ONNX), task="detect")
            self.using_custom_ppe = False
        elif BAKED_PT.exists():
            self.model = YOLOWorld(str(BAKED_PT))
            self.using_custom_ppe = False
        else:
            self.model = YOLOWorld("yolov8s-worldv2.pt")
            self.model.set_classes(TARGET_CLASSES)
            self.using_custom_ppe = False

    def analyze_image(self, image_bytes: bytes, conf_threshold: float = 0.20) -> dict:
        image = Image.open(io.BytesIO(image_bytes))
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((720, 720))
        image = enhance_contrast(image, force=False)
        img_w, img_h = image.size

        with self._lock, torch.inference_mode():
            results = self.model.predict(source=image, conf=conf_threshold, imgsz=416, verbose=False)

            detections = []
            person_boxes: list[list[float]] = []

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

                    if label in SPOOF_LABELS and conf >= 0.45:
                        spoof_device_detected = True
                    elif label in {"person", "persona"}:
                        person_detected = True
                        person_boxes.append(bbox)
                    elif label in HELMET_LABELS:
                        has_helmet = True
                    elif label in GLASSES_LABELS:
                        has_glasses = True
                    elif label in MASK_LABELS:
                        has_mask = True

            for px1, py1, px2, py2 in person_boxes:
                box_h = py2 - py1
                crop_x1 = max(0, int(px1))
                crop_y1 = max(0, int(py1))
                crop_x2 = min(img_w, int(px2))
                crop_y2 = min(img_h, int(py1 + box_h * 0.72))

                if crop_x2 - crop_x1 > 40 and crop_y2 - crop_y1 > 40:
                    head_crop = enhance_contrast(image.crop((crop_x1, crop_y1, crop_x2, crop_y2)), force=True)
                    head_results = self.model.predict(source=head_crop, conf=0.10, imgsz=416, verbose=False)

                    for h_res in head_results:
                        h_names = h_res.names
                        for h_box in h_res.boxes:
                            h_label = str(h_names[int(h_box.cls[0])]).lower().strip()
                            h_conf = round(float(h_box.conf[0]), 4)
                            hx1, hy1, hx2, hy2 = h_box.xyxy[0].tolist()
                            full_bbox = [
                                round(hx1 + crop_x1, 2),
                                round(hy1 + crop_y1, 2),
                                round(hx2 + crop_x1, 2),
                                round(hy2 + crop_y1, 2),
                            ]

                            if h_label in HELMET_LABELS and h_conf >= 0.16:
                                has_helmet = True
                                detections.append({"label": h_label, "confidence": h_conf, "bbox": full_bbox})
                            elif h_label in GLASSES_LABELS and h_conf >= 0.10:
                                has_glasses = True
                                detections.append({"label": h_label, "confidence": h_conf, "bbox": full_bbox})
                            elif h_label in MASK_LABELS and h_conf >= 0.16:
                                has_mask = True
                                detections.append({"label": h_label, "confidence": h_conf, "bbox": full_bbox})

        gc.collect()
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
