import json
import shutil
import numpy as np
import onnxruntime as ort
from ultralytics import YOLOWorld

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

try:
    m = YOLOWorld("yolov8n-worldv2.pt")
except Exception:
    m = YOLOWorld("yolov8s-worldv2.pt")

m.set_classes(CLASSES)
out = m.export(format="onnx", imgsz=416)
shutil.move(str(out), "/opt/ml_cache/baked_epp.onnx")

with open("/opt/ml_cache/classes.json", "w", encoding="utf-8") as f:
    json.dump(CLASSES, f)

# Verificar que onnxruntime puro lo carga y ejecuta sin PyTorch
sess = ort.InferenceSession("/opt/ml_cache/baked_epp.onnx", providers=["CPUExecutionProvider"])
dummy = np.zeros((1, 3, 416, 416), dtype=np.float32)
res = sess.run(None, {sess.get_inputs()[0].name: dummy})
print("ONNX_PURE_READY:", res[0].shape)
