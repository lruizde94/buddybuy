#!/bin/bash

# ============================================
# BuddyBuy - Instalación como Servicio systemd
# Para Raspberry Pi y sistemas Linux
# ============================================

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Verificar si se ejecuta como root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}❌ Este script debe ejecutarse como root (sudo)${NC}"
    exit 1
fi

# Obtener el usuario que ejecutó sudo
ACTUAL_USER=${SUDO_USER:-$USER}
INSTALL_DIR=$(pwd)

echo "🛒 BuddyBuy - Instalación como Servicio"
echo "========================================"
echo ""
echo "Usuario: $ACTUAL_USER"
echo "Directorio: $INSTALL_DIR"
echo ""

# Verificar que estamos en el directorio correcto
if [ ! -f "server.js" ]; then
    echo -e "${RED}❌ Error: No se encontró server.js${NC}"
    echo "Ejecuta este script desde el directorio de BuddyBuy"
    exit 1
fi

# Obtener ruta de Node.js
NODE_PATH=$(which node)
echo "Node.js: $NODE_PATH"

# Crear archivo de servicio systemd
SERVICE_FILE="/etc/systemd/system/buddybuy.service"

echo ""
echo "📝 Creando servicio systemd..."

cat > $SERVICE_FILE << EOF
[Unit]
Description=BuddyBuy - Explorador de Productos Mercadona
Documentation=https://github.com/tu-usuario/buddybuy
After=network.target

[Service]
Type=simple
User=$ACTUAL_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_PATH server.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=buddybuy
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

echo -e "${GREEN}✅ Servicio creado en $SERVICE_FILE${NC}"

# Recargar systemd
echo ""
echo "🔄 Recargando systemd..."
systemctl daemon-reload

# Habilitar servicio para inicio automático
echo "🔧 Habilitando inicio automático..."
systemctl enable buddybuy

# Iniciar servicio
echo "🚀 Iniciando servicio..."
systemctl start buddybuy

# Mostrar estado
echo ""
echo "📊 Estado del servicio:"
systemctl status buddybuy --no-pager

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}✅ Servicio instalado correctamente${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "Comandos útiles:"
echo "  sudo systemctl status buddybuy   # Ver estado"
echo "  sudo systemctl restart buddybuy  # Reiniciar"
echo "  sudo systemctl stop buddybuy     # Detener"
echo "  sudo journalctl -u buddybuy -f   # Ver logs"
echo ""
echo "La aplicación estará disponible en:"

# Mostrar IP local
IP_LOCAL=$(hostname -I | awk '{print $1}')
echo "  http://localhost:3000"
echo "  http://$IP_LOCAL:3000"
echo ""
