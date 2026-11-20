import gc
import io
import json
from pathlib import Path
import threading
import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps

BAKED_ONNX = Path("/opt/ml_cache/baked_epp.onnx")
CLASSES_JSON = Path("/opt/ml_cache/classes.json")

DEFAULT_CLASSES = [
    "person",
    "hard hat",
    "safety helmet",
    "safety glasses",
    "glasses",
    "face mask",
    "surgical mask",
    "safety vest",
    "vest",
    "cell phone",
    "laptop",
    "monitor",
]

SPOOF_LABELS = {"cell phone", "laptop", "monitor"}
HELMET_LABELS = {"helmet", "hardhat", "hard hat", "safety helmet", "casco"}
GLASSES_LABELS = {"glasses", "safety glasses", "goggles", "lentes", "gafas"}
MASK_LABELS = {"mask", "face mask", "surgical mask", "mascarilla", "cubrebocas"}
VEST_LABELS = {"vest", "safety vest", "high visibility vest", "chaleco", "waistcoat"}


def enhance_contrast(pil_image: Image.Image, force: bool = False, brightness_threshold: float = 95.0) -> Image.Image:
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
    """Inferencia ONNX Runtime pura sin PyTorch (<130 MB RAM total en Render)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        if CLASSES_JSON.exists():
            self.classes = json.loads(CLASSES_JSON.read_text(encoding="utf-8"))
        else:
            self.classes = DEFAULT_CLASSES

        sess_opts = ort.SessionOptions()
        sess_opts.intra_op_num_threads = 1
        sess_opts.inter_op_num_threads = 1
        sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        self.session = ort.InferenceSession(
            str(BAKED_ONNX),
            sess_options=sess_opts,
            providers=["CPUExecutionProvider"],
        )
        self.input_name = self.session.get_inputs()[0].name

    def _predict_onnx(self, pil_img: Image.Image, conf_threshold: float) -> list[dict]:
        orig_w, orig_h = pil_img.size
        scale = min(416.0 / orig_w, 416.0 / orig_h)
        new_w = max(1, int(round(orig_w * scale)))
        new_h = max(1, int(round(orig_h * scale)))

        resized = pil_img.resize((new_w, new_h), Image.Resampling.BILINEAR)
        canvas = Image.new("RGB", (416, 416), (114, 114, 114))
        pad_x = (416 - new_w) // 2
        pad_y = (416 - new_h) // 2
        canvas.paste(resized, (pad_x, pad_y))

        arr = np.asarray(canvas, dtype=np.float32) / 255.0
        blob = np.transpose(arr, (2, 0, 1))[None, ...]

        preds = self.session.run(None, {self.input_name: blob})[0]
        if preds.ndim == 3:
            preds = preds[0]
        if preds.shape[0] < preds.shape[1]:
            preds = preds.T

        boxes_xywh = preds[:, :4]
        class_scores = preds[:, 4:]
        class_ids = np.argmax(class_scores, axis=1)
        confidences = class_scores[np.arange(len(class_scores)), class_ids]

        mask = confidences >= conf_threshold
        boxes_xywh = boxes_xywh[mask]
        class_ids = class_ids[mask]
        confidences = confidences[mask]

        if len(confidences) == 0:
            return []

        x1 = boxes_xywh[:, 0] - boxes_xywh[:, 2] / 2.0
        y1 = boxes_xywh[:, 1] - boxes_xywh[:, 3] / 2.0
        w = boxes_xywh[:, 2]
        h = boxes_xywh[:, 3]
        nms_boxes = np.stack([x1, y1, w, h], axis=1).tolist()

        indices = cv2.dnn.NMSBoxes(nms_boxes, confidences.tolist(), conf_threshold, 0.45)
        if len(indices) == 0:
            return []

        detections = []
        for idx in np.array(indices).flatten():
            bx1 = max(0.0, (x1[idx] - pad_x) / scale)
            by1 = max(0.0, (y1[idx] - pad_y) / scale)
            bx2 = min(float(orig_w), (x1[idx] + w[idx] - pad_x) / scale)
            by2 = min(float(orig_h), (y1[idx] + h[idx] - pad_y) / scale)
            cid = int(class_ids[idx])
            label = self.classes[cid] if cid < len(self.classes) else f"class_{cid}"
            detections.append(
                {
                    "label": label.lower().strip(),
                    "confidence": round(float(confidences[idx]), 4),
                    "bbox": [round(bx1, 2), round(by1, 2), round(bx2, 2), round(by2, 2)],
                }
            )
        return detections

    def analyze_image(self, image_bytes: bytes, conf_threshold: float = 0.20) -> dict:
        image = Image.open(io.BytesIO(image_bytes))
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((640, 640))
        image = enhance_contrast(image, force=False)
        img_w, img_h = image.size

        with self._lock:
            raw_dets = self._predict_onnx(image, conf_threshold)

            detections = []
            person_boxes: list[list[float]] = []

            person_detected = False
            spoof_device_detected = False
            has_helmet = False
            has_glasses = False
            has_mask = False
            has_vest = False
            max_conf = 0.0

            for det in raw_dets:
                label = det["label"]
                conf = det["confidence"]
                bbox = det["bbox"]
                detections.append(det)
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
                elif label in VEST_LABELS:
                    has_vest = True

            for px1, py1, px2, py2 in person_boxes:
                box_h = py2 - py1
                crop_x1 = max(0, int(px1))
                crop_y1 = max(0, int(py1))
                crop_x2 = min(img_w, int(px2))
                crop_y2 = min(img_h, int(py1 + box_h * 0.78))

                if crop_x2 - crop_x1 > 40 and crop_y2 - crop_y1 > 40:
                    head_crop = enhance_contrast(image.crop((crop_x1, crop_y1, crop_x2, crop_y2)), force=True)
                    crop_dets = self._predict_onnx(head_crop, 0.12)

                    for c_det in crop_dets:
                        h_label = c_det["label"]
                        h_conf = c_det["confidence"]
                        hx1, hy1, hx2, hy2 = c_det["bbox"]
                        full_bbox = [
                            round(hx1 + crop_x1, 2),
                            round(hy1 + crop_y1, 2),
                            round(hx2 + crop_x1, 2),
                            round(hy2 + crop_y1, 2),
                        ]

                        if h_label in HELMET_LABELS and h_conf >= 0.16:
                            has_helmet = True
                            detections.append({"label": h_label, "confidence": h_conf, "bbox": full_bbox})
                        elif h_label in GLASSES_LABELS and h_conf >= 0.12:
                            has_glasses = True
                            detections.append({"label": h_label, "confidence": h_conf, "bbox": full_bbox})
                        elif h_label in MASK_LABELS and h_conf >= 0.16:
                            has_mask = True
                            detections.append({"label": h_label, "confidence": h_conf, "bbox": full_bbox})
                        elif h_label in VEST_LABELS and h_conf >= 0.16:
                            has_vest = True
                            detections.append({"label": h_label, "confidence": h_conf, "bbox": full_bbox})

        gc.collect()
        is_compliant = person_detected and not spoof_device_detected and (
            has_helmet or has_glasses or has_mask or has_vest
        )

        return {
            "person_detected": person_detected,
            "spoof_device_detected": spoof_device_detected,
            "has_helmet": has_helmet,
            "has_glasses": has_glasses,
            "has_mask": has_mask,
            "has_vest": has_vest,
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
