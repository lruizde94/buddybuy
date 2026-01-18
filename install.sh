#!/bin/bash

# ============================================
# BuddyBuy - Script de Instalación
# Para Raspberry Pi y sistemas Linux
# ============================================

set -e

echo "🛒 BuddyBuy - Instalación para Linux/Raspberry Pi"
echo "=================================================="
echo ""

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verificar si se ejecuta como root
if [ "$EUID" -eq 0 ]; then 
    echo -e "${YELLOW}⚠️  No ejecutes este script como root. Usa tu usuario normal.${NC}"
    exit 1
fi

# Verificar Node.js
echo "📦 Verificando Node.js..."
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Node.js no encontrado. Instalando...${NC}"
    
    # Detectar arquitectura
    ARCH=$(uname -m)
    if [ "$ARCH" = "armv7l" ] || [ "$ARCH" = "aarch64" ]; then
        echo "Detectada arquitectura ARM (Raspberry Pi)"
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        echo "Detectada arquitectura x86/x64"
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
else
    NODE_VERSION=$(node -v)
    echo -e "${GREEN}✅ Node.js encontrado: $NODE_VERSION${NC}"
fi

# Verificar npm
echo ""
echo "📦 Verificando npm..."
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm no encontrado. Instala Node.js correctamente.${NC}"
    exit 1
else
    NPM_VERSION=$(npm -v)
    echo -e "${GREEN}✅ npm encontrado: $NPM_VERSION${NC}"
fi

# Instalar dependencias
echo ""
echo "📦 Instalando dependencias..."
npm install

# Crear directorio de datos si no existe
echo ""
echo "📁 Configurando directorio de datos..."
mkdir -p data

# Crear archivos de datos vacíos si no existen
if [ ! -f data/users.json ]; then
    echo "{}" > data/users.json
    echo "  - Creado data/users.json"
fi

if [ ! -f data/sessions.json ]; then
    echo "{}" > data/sessions.json
    echo "  - Creado data/sessions.json"
fi

# Verificar archivo .env
echo ""
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  Archivo .env no encontrado.${NC}"
    echo "Creando .env desde .env.example..."
    cp .env.example .env
    echo -e "${YELLOW}📝 IMPORTANTE: Edita el archivo .env con tus credenciales:${NC}"
    echo "   nano .env"
else
    echo -e "${GREEN}✅ Archivo .env encontrado${NC}"
fi

# Sincronizar productos de Mercadona
echo ""
echo "🔄 Sincronizando productos de Mercadona..."
if [ -f sync-productos.js ]; then
    node sync-productos.js || echo -e "${YELLOW}⚠️  Error al sincronizar. Puedes ejecutarlo después con: node sync-productos.js${NC}"
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}✅ Instalación completada${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "Para iniciar el servidor:"
echo "  npm start"
echo ""
echo "Para instalar como servicio del sistema:"
echo "  sudo ./install-service.sh"
echo ""
echo "La aplicación estará disponible en:"
echo "  http://localhost:3000"
echo ""
