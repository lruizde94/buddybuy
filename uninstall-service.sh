#!/bin/bash

# ============================================
# BuddyBuy - Desinstalación del Servicio
# ============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}❌ Este script debe ejecutarse como root (sudo)${NC}"
    exit 1
fi

echo "🛒 BuddyBuy - Desinstalación del Servicio"
echo "=========================================="
echo ""

# Detener servicio
echo "🛑 Deteniendo servicio..."
systemctl stop buddybuy 2>/dev/null || true

# Deshabilitar servicio
echo "🔧 Deshabilitando inicio automático..."
systemctl disable buddybuy 2>/dev/null || true

# Eliminar archivo de servicio
SERVICE_FILE="/etc/systemd/system/buddybuy.service"
if [ -f "$SERVICE_FILE" ]; then
    echo "🗑️  Eliminando archivo de servicio..."
    rm $SERVICE_FILE
fi

# Recargar systemd
echo "🔄 Recargando systemd..."
systemctl daemon-reload

echo ""
echo -e "${GREEN}✅ Servicio desinstalado correctamente${NC}"
echo ""
echo "Los archivos de la aplicación no se han eliminado."
echo "Para eliminarlos, borra manualmente el directorio."
echo ""
