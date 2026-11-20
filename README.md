# Control de Marcaje EPP · Terminal Biométrica

Sistema web full-stack para el control de asistencia y verificación obligatoria de **Equipo de Protección Personal (EPP)** mediante reconocimiento facial biométrico con prueba de vida (*liveness*) y visión por computadora.

## Características Principales

- **Identificación Biométrica con Prueba de Vida:** Detección facial en tiempo real con verificación de parpadeo (*Eye Aspect Ratio*) y registro de descriptores faciales desde cámara en vivo o fotografía.
- **Flujo Inteligente en 1 o 2 Fases:**
  - **1 Paso Simultáneo:** Para áreas donde el rostro permanece visible (ej. casco y chaleco).
  - **2 Fases Anti-Suplantación:** Para áreas que exigen mascarilla o lentes de seguridad; primero valida la identidad con el rostro descubierto y luego realiza seguimiento continuo de cuadro mientras el colaborador se coloca el EPP.
- **Detección Automatizada de EPP:** Evaluación de **casco**, **lentes de seguridad**, **mascarilla** y **chaleco reflectivo** según las reglas configuradas por área operativa.
- **Panel de Administración y Auditoría:**
  - Indicadores globales de cumplimiento y tasa de aprobación.
  - Bitácora filtrable con evidencia fotográfica por marcaje y exportación a **CSV**.
  - Gestión dinámica de áreas operativas, reglas de EPP, puestos de trabajo y perfiles biométricos.
- **Interfaz Adaptable (Astryx Design System):** Diseño responsivo para quiosco y escritorio con selector de apariencia (**Claro**, **Oscuro** y **Sistema**).

## Arquitectura y Stack Tecnológico

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, `@astryxdesign/core` y Lucide Icons.
- **Backend:** Python, FastAPI, SQLite / PostgreSQL, autenticación segura y almacenamiento de evidencia.
- **Pruebas y Calidad:** Vitest, Testing Library y pipeline de integración continua con **GitHub Actions**.

## Estructura del Proyecto

```text
epp-marcaje/
├── backend/                 # API REST, modelos de datos, zonas EPP y auditoría
├── frontend/                # Terminal biométrica y panel administrativo (React + TS)
│   ├── src/
│   │   ├── components/ui/   # ThemeSwitcher, Toast, ConfirmModal
│   │   ├── context/         # ThemeContext (Light / Dark / System)
│   │   ├── features/        # CameraScanner y AdminDashboard
│   │   └── lib/             # Cliente API y utilidades de biometría facial
└── .github/workflows/       # Flujos de CI/CD automatizados
```

## Instalación y Ejecución Local

### 1. Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```

### 3. Compilación y Pruebas
```bash
cd frontend
npm run build
npm test -- --run
```

## Autor

Desarrollado por **Marcos de Páz** — Ingeniería en Sistemas y Ciencias de la Computación.
