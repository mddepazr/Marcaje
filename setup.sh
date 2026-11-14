#!/usr/bin/env bash
set -e

echo "Configurando entorno de desarrollo..."
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))")
  sed -i "s/genera_una_clave_secreta_larga_aqui/$SECRET/" .env
  echo ".env creado con SECRET_KEY generada automáticamente."
else
  echo ".env ya existe, conservando configuración."
fi

echo "Estructura lista. Ejecuta 'docker compose up --build' cuando agreguemos los Dockerfiles."
