# Etapa 1: Exportar modelo a ONNX (aquí se usa PyTorch solo para compilar)
FROM python:3.12-slim AS builder

WORKDIR /build
ENV XDG_CACHE_HOME=/opt/ml_cache \
    TORCH_HOME=/opt/ml_cache \
    YOLO_CONFIG_DIR=/opt/ml_cache/ultralytics

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/ml_cache

COPY bake_model.py .
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir ultralytics onnx onnxruntime opencv-python-headless && \
    python bake_model.py

# Etapa 2: Imagen final ultra ligera (~120 MB RAM, SIN PyTorch ni Ultralytics)
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/ml_cache /app/uploads

RUN pip install --no-cache-dir \
    fastapi \
    "uvicorn[standard]" \
    sqlalchemy \
    "psycopg[binary]" \
    "pydantic[email]" \
    pydantic-settings \
    pyjwt \
    "pwdlib[argon2]" \
    python-multipart \
    pillow \
    numpy \
    opencv-python-headless \
    onnxruntime

COPY --from=builder /opt/ml_cache/baked_epp.onnx /opt/ml_cache/baked_epp.onnx
COPY --from=builder /opt/ml_cache/classes.json /opt/ml_cache/classes.json
COPY . .

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
