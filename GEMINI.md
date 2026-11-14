# Reglas y Arquitectura del Proyecto: Sistema de Marcaje con Detección de EPP

## Stack Tecnológico
- **Backend:** Python 3.12 + FastAPI + SQLAlchemy 2.0 + Alembic + PostgreSQL.
- **Visión Artificial:** Ultralytics (YOLO) aislado en `backend/app/services/vision/`.
- **Frontend:** React + Vite + TypeScript + Tailwind CSS (UI aislada en `frontend/src/components/ui/`).
- **Infraestructura:** Docker y Docker Compose con puertos aislados desde `.env`.

## Reglas de Seguridad Obligatorias
1. **Cero secretos en Frontend:** Nunca exponer API keys, credenciales ni tokens de servicios externos en variables `VITE_*` ni en el código del navegador.
2. **Autenticación:** Usar JWT almacenado exclusivamente en cookies `HttpOnly`, `Secure` (en prod) y `SameSite=Lax`. Nunca usar `localStorage` para tokens.
3. **Contraseñas:** Hashear siempre con `Argon2id` (`pwdlib[argon2]`). Prohibido guardar texto plano, MD5 o SHA256 simple.
4. **Base de Datos:** Usar exclusivamente ORM o consultas parametrizadas. Nunca exponer PostgreSQL directamente a internet en producción.
5. **Arquitectura desacoplada:** Mantener la lógica de visión artificial en `services/vision/` bajo una interfaz limpia para poder cambiar modelos o integrar componentes externos sin tocar rutas ni BD.
