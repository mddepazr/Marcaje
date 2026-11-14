# Sistema de Marcaje Inteligente con Detección de EPP

Plataforma web full-stack para control de asistencia con verificación biométrica anti-fraude (prueba de vida) y detección automática de Equipo de Protección Personal (casco, lentes y mascarilla) mediante visión artificial.

## Stack Tecnológico
- Frontend: React + TypeScript + Vite + Tailwind CSS
- Backend: Python 3.12 + FastAPI + SQLAlchemy
- Visión Artificial: Ultralytics YOLO-World + OpenCV
- Base de Datos: PostgreSQL 16
- Infraestructura: Docker & Docker Compose

## Instalación Rápida
1. Clonar el repositorio y entrar a la carpeta epp-marcaje.
2. Ejecutar: chmod +x setup.sh && ./setup.sh
3. Levantar contenedores: docker compose up --build -d
4. Abrir Frontend en http://localhost:5175 y API Docs en http://localhost:8005/docs
