#!/bin/bash
# Script para desplegar el repositorio MercadonaProductos en Ubuntu (Azure)
# Reemplaza <TU_USUARIO_GITHUB> y <TU_REPOSITORIO> si es necesario

set -e

# Variables
REPO_URL="https://github.com/lruizde94/buddybuy.git"
REPO_DIR="MercadonaProductos"

# Instala dependencias básicas
sudo apt-get update
sudo apt-get install -y git curl python3 python3-pip

# Instala Node.js y npm si no existen
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# Clona el repositorio
if [ ! -d "$REPO_DIR" ]; then
  git clone "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"

# Instala dependencias Node.js (backend)
if [ -f package.json ]; then
  npm install
fi

# Instala dependencias Python (backend)
if [ -f requirements.txt ]; then
  pip3 install -r requirements.txt
fi

# Instala dependencias React (frontend)
if [ -d react-app ]; then
  cd react-app
  npm install
  cd ..
fi

# Arranca backend Node.js (en segundo plano)
if [ -f server.js ]; then
  nohup node server.js > server_node.log 2>&1 &
fi

# Arranca backend Python (en segundo plano)
if [ -f server.py ]; then
  nohup python3 server.py > server_py.log 2>&1 &
fi

# Arranca frontend React (en segundo plano)
if [ -d react-app ]; then
  cd react-app
  nohup npm run dev > react.log 2>&1 &
  cd ..
fi

echo "Despliegue completado. Revisa los logs para detalles."
