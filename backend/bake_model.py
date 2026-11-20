import os
import shutil
import numpy as np
from ultralytics import YOLO, YOLOWorld

CLASSES = [
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

m = YOLOWorld("yolov8s-worldv2.pt")
m.set_classes(CLASSES)

try:
    out = m.export(format="onnx", imgsz=416)
    shutil.move(str(out), "/opt/ml_cache/baked_epp.onnx")
    onnx_model = YOLO("/opt/ml_cache/baked_epp.onnx", task="detect")
    onnx_model.predict(source=np.zeros((416, 416, 3), dtype=np.uint8), imgsz=416, verbose=False)
    print("ONNX_READY")
except Exception as exc:
    print("FALLBACK_PT:", exc)
    if os.path.exists("/opt/ml_cache/baked_epp.onnx"):
        os.remove("/opt/ml_cache/baked_epp.onnx")
    m.save("/opt/ml_cache/baked_epp.pt")
