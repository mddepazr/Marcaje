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
    # Clases "distractoras": no son EPP, pero compiten con las clases de EPP en el
    # modelo de vocabulario abierto. Así, unos ojos sin lentes se etiquetan como
    # "eyes" en lugar de "glasses", y una gorra como "baseball cap" en lugar de casco.
    "human face",
    "eyes",
    "baseball cap",
]

SPOOF_LABELS = {"cell phone", "laptop", "monitor"}
HELMET_LABELS = {"helmet", "hardhat", "hard hat", "safety helmet", "casco"}
GLASSES_LABELS = {"glasses", "safety glasses", "goggles", "lentes", "gafas"}
MASK_LABELS = {"mask", "face mask", "surgical mask", "mascarilla", "cubrebocas"}
VEST_LABELS = {"vest", "safety vest", "high visibility vest", "chaleco", "waistcoat"}
FACE_LABELS = {"human face", "face"}

PPE_KEYS = ("helmet", "glasses", "mask", "vest")

# Confianza mínima por tipo de EPP. Antes se aceptaban lentes desde 0.12 en el
# recorte de la cabeza, lo que hacía que unos ojos normales contaran como "lentes".
MIN_CONF_FULL = {"helmet": 0.25, "glasses": 0.35, "mask": 0.30, "vest": 0.16}
MIN_CONF_HEAD_CROP = {"helmet": 0.22, "glasses": 0.30, "mask": 0.25}
# Por encima de esta confianza los lentes se aceptan aunque la prueba del puente
# nasal no encuentre la montura (p. ej. lentes de seguridad sin puente visible).
GLASSES_STRONG_CONF = 0.50


def _ppe_key(label: str) -> str | None:
    if label in HELMET_LABELS:
        return "helmet"
    if label in GLASSES_LABELS:
        return "glasses"
    if label in MASK_LABELS:
        return "mask"
    if label in VEST_LABELS:
        return "vest"
    return None


def _center(b: list[float]) -> tuple[float, float]:
    return (b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0


def is_plausible_location(key: str, det_box: list[float], face: list[float] | None) -> bool:
    """Comprueba que el EPP detectado esté donde debe estar respecto al rostro.

    - Lentes: sobre la franja de los ojos.
    - Mascarilla: sobre la mitad inferior de la cara.
    - Casco: encima de la cabeza.
    - Chaleco: debajo de la cara (torso).
    Sin rostro conocido no se puede validar, así que se acepta.
    """
    if face is None:
        return True
    fx1, fy1, fx2, fy2 = face
    fw = max(1.0, fx2 - fx1)
    fh = max(1.0, fy2 - fy1)
    cx, cy = _center(det_box)
    dw = det_box[2] - det_box[0]
    dh = det_box[3] - det_box[1]

    if key == "glasses":
        return (
            fx1 - 0.10 * fw <= cx <= fx2 + 0.10 * fw
            and fy1 - 0.05 * fh <= cy <= fy1 + 0.65 * fh
            and 0.30 * fw <= dw <= 1.50 * fw
            and dh <= 0.70 * fh
        )
    if key == "mask":
        return (
            fx1 <= cx <= fx2
            and fy1 + 0.40 * fh <= cy <= fy2 + 0.30 * fh
            and dw >= 0.35 * fw
        )
    if key == "helmet":
        return (
            fx1 - 0.30 * fw <= cx <= fx2 + 0.30 * fw
            and det_box[1] < fy1 + 0.10 * fh
            and det_box[3] <= fy1 + 0.70 * fh
            and 0.60 * fw <= dw <= 3.00 * fw
        )
    if key == "vest":
        return det_box[3] > fy2 and cy > fy1 + 0.65 * fh and dw >= 0.55 * fw
    return True


def detect_high_vis_vest_hsv(pil_image: Image.Image, face: list[float] | None) -> dict | None:
    """Respaldo por color reflectivo (naranja o amarillo neón) debajo del rostro."""
    if face is None:
        return None
    img_w, img_h = pil_image.size
    fx1, fy1, fx2, fy2 = face
    fw = max(1.0, fx2 - fx1)
    fh = max(1.0, fy2 - fy1)

    rx1 = max(0, int(fx1 - 0.95 * fw))
    rx2 = min(img_w, int(fx2 + 0.95 * fw))
    ry1 = max(0, int(fy2 - 0.05 * fh))
    ry2 = min(img_h, int(fy2 + 1.35 * fh))
    if rx2 - rx1 < 40 or ry2 - ry1 < 18:
        return None

    rgb = np.asarray(pil_image.crop((rx1, ry1, rx2, ry2)))
    if rgb.ndim != 3 or rgb.shape[2] < 3:
        return None
    hsv = cv2.cvtColor(rgb[:, :, :3], cv2.COLOR_RGB2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]

    # Naranja neón industrial y amarillo-lima neón (alta saturación para descartar piel y ropa común)
    orange_mask = (h >= 3) & (h <= 22) & (s >= 155) & (v >= 135)
    lime_mask = (h >= 23) & (h <= 50) & (s >= 135) & (v >= 135)

    best_ratio = max(float(np.mean(orange_mask)), float(np.mean(lime_mask)))
    if best_ratio < 0.11:
        return None

    conf = round(min(0.88, 0.55 + best_ratio * 0.9), 4)
    return {
        "label": "safety vest",
        "confidence": conf,
        "bbox": [float(rx1), float(ry1), float(rx2), float(ry2)],
    }


def glasses_bridge_present(gray: np.ndarray, bridge: list[float]) -> bool | None:
    """Busca el puente de la montura entre los ojos.

    Unos lentes dejan una línea horizontal marcada que cruza la nariz entre los
    ojos; la piel de la nariz tiene un sombreado suave. Devuelve None si la zona
    es demasiado pequeña para decidir.
    """
    h_img, w_img = gray.shape[:2]
    x1 = max(0, int(bridge[0]))
    y1 = max(0, int(bridge[1]))
    x2 = min(w_img, int(bridge[2]))
    y2 = min(h_img, int(bridge[3]))
    if x2 - x1 < 8 or y2 - y1 < 8:
        return None

    roi = cv2.GaussianBlur(gray[y1:y2, x1:x2], (3, 3), 0).astype(np.float32)
    sobel_y = np.abs(cv2.Sobel(roi, cv2.CV_32F, 0, 1, ksize=3))
    row_strength = sobel_y.mean(axis=1)
    peak_row = int(np.argmax(row_strength))
    peak = float(row_strength[peak_row])
    baseline = float(np.median(row_strength)) + 1e-3
    if peak < 10.0:
        return False

    # ¿La línea cruza casi todo el ancho entre los ojos?
    band = sobel_y[max(0, peak_row - 1) : peak_row + 2].max(axis=0)
    span = float(np.mean(band > 0.5 * band.max()))
    return peak / baseline >= 2.2 and span >= 0.55


_haar_face = None


def _haar_face_detector():
    global _haar_face
    if _haar_face is None:
        try:
            path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
            cascade = cv2.CascadeClassifier(str(path))
            _haar_face = cascade if not cascade.empty() else False
        except Exception:
            _haar_face = False
    return _haar_face or None


def _detect_face_haar(image: Image.Image) -> list[float] | None:
    cascade = _haar_face_detector()
    if cascade is None:
        return None
    gray = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(60, 60))
    if len(faces) == 0:
        return None
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    return [float(x), float(y), float(x + w), float(y + h)]


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

        # NMS por clase: una caja grande de "human face" no debe borrar la caja
        # de "face mask" o "glasses" que está dentro de ella.
        kept: list[int] = []
        for cid in np.unique(class_ids):
            cls_idx = np.where(class_ids == cid)[0]
            cls_keep = cv2.dnn.NMSBoxes(
                [nms_boxes[i] for i in cls_idx],
                confidences[cls_idx].tolist(),
                conf_threshold,
                0.45,
            )
            kept.extend(int(cls_idx[k]) for k in np.array(cls_keep).flatten())
        indices = kept
        if len(indices) == 0:
            return []

        detections = []
        for idx in np.array(indices).flatten():
            bx1 = float(max(0.0, (x1[idx] - pad_x) / scale))
            by1 = float(max(0.0, (y1[idx] - pad_y) / scale))
            bx2 = float(min(float(orig_w), (x1[idx] + w[idx] - pad_x) / scale))
            by2 = float(min(float(orig_h), (y1[idx] + h[idx] - pad_y) / scale))
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

    @staticmethod
    def _load_image(image_bytes: bytes) -> tuple[Image.Image, float]:
        """Abre la imagen, la reduce a 640 px y devuelve el factor de escala aplicado."""
        image = Image.open(io.BytesIO(image_bytes))
        image = ImageOps.exif_transpose(image).convert("RGB")
        orig_w = image.size[0]
        image.thumbnail((640, 640))
        scale = image.size[0] / float(orig_w) if orig_w else 1.0
        return image, scale

    def analyze_image(
        self,
        image_bytes: bytes,
        conf_threshold: float = 0.20,
        face_box: tuple[float, float, float, float] | None = None,
        bridge_box: tuple[float, float, float, float] | None = None,
    ) -> dict:
        """Analiza un fotograma.

        face_box / bridge_box vienen en (x, y, ancho, alto) en píxeles del
        fotograma original (los envía el quiosco, que ya conoce dónde está la cara).
        """
        image, scale = self._load_image(image_bytes)
        gray_original = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
        image = enhance_contrast(image, force=False)
        img_w, img_h = image.size

        def _to_xyxy(b: tuple[float, float, float, float] | None) -> list[float] | None:
            if b is None:
                return None
            x, y, w, h = b
            return [x * scale, y * scale, (x + w) * scale, (y + h) * scale]

        face = _to_xyxy(face_box)
        bridge = _to_xyxy(bridge_box)
        min_conf = {k: max(conf_threshold, v) for k, v in MIN_CONF_FULL.items()}
        crop_conf = {k: max(conf_threshold * 0.9, v) for k, v in MIN_CONF_HEAD_CROP.items()}
        candidate_floor = min(conf_threshold, *MIN_CONF_FULL.values(), *MIN_CONF_HEAD_CROP.values())

        with self._lock:
            raw_dets = self._predict_onnx(image, candidate_floor)

            person_boxes: list[list[float]] = []
            face_candidates: list[dict] = []
            person_detected = False
            spoof_device_detected = False
            max_conf = 0.0
            # Mejor detección aceptada por tipo de EPP
            best: dict[str, dict | None] = {k: None for k in PPE_KEYS}
            pending: list[tuple[str, dict]] = []

            for det in raw_dets:
                label = det["label"]
                conf = det["confidence"]
                if label in SPOOF_LABELS and conf >= 0.45:
                    spoof_device_detected = True
                elif label in {"person", "persona"} and conf >= conf_threshold:
                    person_detected = True
                    person_boxes.append(det["bbox"])
                    max_conf = max(max_conf, conf)
                elif label in FACE_LABELS and conf >= 0.30:
                    face_candidates.append(det)
                else:
                    key = _ppe_key(label)
                    if key and conf >= min_conf[key]:
                        pending.append((key, det))

            # Si el quiosco no mandó la cara, usar la del modelo o la de OpenCV.
            if face is None and face_candidates:
                face = max(face_candidates, key=lambda d: d["confidence"])["bbox"]
            if face is None:
                face = _detect_face_haar(image)
            if face is not None:
                person_detected = True

            def _accept(key: str, det: dict) -> None:
                if not is_plausible_location(key, det["bbox"], face):
                    return
                current = best[key]
                if current is None or det["confidence"] > current["confidence"]:
                    best[key] = det

            for key, det in pending:
                _accept(key, det)

            # Segunda pasada ampliando la cabeza (mejor para objetos pequeños como lentes).
            if face is not None:
                fx1, fy1, fx2, fy2 = face
                fw, fh = fx2 - fx1, fy2 - fy1
                crop_box = (
                    max(0, int(fx1 - 0.6 * fw)),
                    max(0, int(fy1 - 0.9 * fh)),
                    min(img_w, int(fx2 + 0.6 * fw)),
                    min(img_h, int(fy2 + 0.5 * fh)),
                )
            elif person_boxes:
                px1, py1, px2, py2 = max(person_boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
                crop_box = (
                    max(0, int(px1)),
                    max(0, int(py1)),
                    min(img_w, int(px2)),
                    min(img_h, int(py1 + (py2 - py1) * 0.6)),
                )
            else:
                crop_box = None

            if crop_box and crop_box[2] - crop_box[0] > 40 and crop_box[3] - crop_box[1] > 40:
                cx1, cy1 = crop_box[0], crop_box[1]
                head_crop = image.crop(crop_box)
                for c_det in self._predict_onnx(head_crop, min(crop_conf.values())):
                    key = _ppe_key(c_det["label"])
                    if key not in crop_conf or c_det["confidence"] < crop_conf[key]:
                        continue
                    hx1, hy1, hx2, hy2 = c_det["bbox"]
                    _accept(
                        key,
                        {
                            "label": c_det["label"],
                            "confidence": c_det["confidence"],
                            "bbox": [
                                round(hx1 + cx1, 2),
                                round(hy1 + cy1, 2),
                                round(hx2 + cx1, 2),
                                round(hy2 + cy1, 2),
                            ],
                        },
                    )

        # Confirmación extra para lentes poco seguros: buscar el puente de la montura.
        glasses = best["glasses"]
        if glasses is not None and bridge is not None and glasses["confidence"] < GLASSES_STRONG_CONF:
            if glasses_bridge_present(gray_original, bridge) is False:
                best["glasses"] = None

        # Respaldo de alta visibilidad para chaleco en tomas cercanas.
        if best["vest"] is None and face is not None:
            hsv_vest = detect_high_vis_vest_hsv(image, face)
            if hsv_vest is not None:
                best["vest"] = hsv_vest

        detections = [d for d in best.values() if d is not None]
        for d in detections:
            max_conf = max(max_conf, d["confidence"])

        gc.collect()
        has = {k: best[k] is not None for k in PPE_KEYS}
        return {
            "person_detected": person_detected,
            "spoof_device_detected": spoof_device_detected,
            "has_helmet": has["helmet"],
            "has_glasses": has["glasses"],
            "has_mask": has["mask"],
            "has_vest": has["vest"],
            "is_compliant": person_detected and not spoof_device_detected and any(has.values()),
            "confidence": round(max_conf, 4),
            "detections_raw": detections,
        }

    def analyze_frames(
        self,
        frames: list[bytes],
        conf_threshold: float = 0.20,
        face_box: tuple[float, float, float, float] | None = None,
        bridge_box: tuple[float, float, float, float] | None = None,
    ) -> dict:
        """Analiza varios fotogramas y decide cada EPP por mayoría.

        Un falso positivo aislado (p. ej. "lentes" en un solo fotograma) ya no
        basta: el EPP debe verse en la mayoría de los fotogramas.
        Devuelve también el índice del fotograma usado como evidencia.
        """
        if not frames:
            raise ValueError("Se requiere al menos un fotograma.")

        results = [
            self.analyze_image(f, conf_threshold=conf_threshold, face_box=face_box, bridge_box=bridge_box)
            for f in frames
        ]
        needed = len(results) // 2 + 1

        merged: dict = {
            "spoof_device_detected": sum(r["spoof_device_detected"] for r in results) >= needed,
            "person_detected": sum(r["person_detected"] for r in results) >= needed,
        }
        for key in PPE_KEYS:
            merged[f"has_{key}"] = sum(r[f"has_{key}"] for r in results) >= needed

        def _agreement(r: dict) -> int:
            return sum(r[f"has_{k}"] == merged[f"has_{k}"] for k in PPE_KEYS)

        # Evidencia: el fotograma que más coincide con la decisión final (el central si empatan).
        middle = len(results) // 2
        order = [middle] + [i for i in range(len(results)) if i != middle]
        best_idx = max(order, key=lambda i: _agreement(results[i]))
        evidence = results[best_idx]

        merged["is_compliant"] = (
            merged["person_detected"]
            and not merged["spoof_device_detected"]
            and any(merged[f"has_{k}"] for k in PPE_KEYS)
        )
        merged["confidence"] = evidence["confidence"]
        merged["detections_raw"] = [
            d for d in evidence["detections_raw"] if merged.get(f"has_{_ppe_key(d['label'])}", False)
        ]
        merged["evidence_index"] = best_idx
        return merged


_detector_instance: PPEDetectorService | None = None


def get_detector() -> PPEDetectorService:
    global _detector_instance
    if _detector_instance is None:
        _detector_instance = PPEDetectorService()
    return _detector_instance
