FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    XDG_CACHE_HOME=/opt/ml_cache \
    TORCH_HOME=/opt/ml_cache \
    YOLO_CONFIG_DIR=/opt/ml_cache/ultralytics

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/ml_cache /app/uploads

COPY requirements.txt bake_model.py ./
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt onnx onnxruntime && \
    python bake_model.py && \
    rm -f yolov8s-worldv2.pt yolov8s-worldv2.onnx

COPY . .

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
