FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    XDG_CACHE_HOME=/opt/ml_cache \
    TORCH_HOME=/opt/ml_cache \
    YOLO_CONFIG_DIR=/opt/ml_cache/ultralytics

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/ml_cache

COPY requirements.txt .
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# Pre-descarga y valida los pesos de YOLO-World + CLIP al construir la imagen
RUN python -c "from ultralytics import YOLOWorld; m = YOLOWorld('yolov8s-worldv2.pt'); m.set_classes(['person', 'hard hat', 'safety helmet', 'safety glasses', 'protective goggles', 'face mask', 'surgical mask', 'cell phone', 'smartphone', 'tablet', 'laptop', 'tv', 'monitor'])"

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
