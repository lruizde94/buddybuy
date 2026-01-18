# 🛒 BuddyBuy - Explorador de Productos Mercadona

Una aplicación web responsive para explorar los productos de Mercadona utilizando su API pública. Incluye un asistente IA para ayudarte con tus compras.

## ✨ Características

- 🔍 **Búsqueda de productos** - Busca entre miles de productos de Mercadona
- 📂 **Navegación por categorías** - Explora productos organizados por categorías
- 📋 **Lista de la compra** - Crea y gestiona tu lista de compras
- 🛒 **Modo compra** - Marca productos mientras compras en la tienda
- 🤖 **Asistente IA** - Pregunta sobre productos, recetas y recomendaciones
- 📤 **Compartir lista** - Comparte tu lista por WhatsApp o genera un PDF
- 🔐 **Login con Google** - Sincroniza tu lista entre dispositivos
- 📱 **Diseño responsive** - Optimizado para móviles y tablets

## 🚀 Instalación Rápida

### Requisitos

- Node.js 18+ (recomendado Node.js 20 LTS)
- npm o yarn

### Instalación en Linux/Raspberry Pi

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/buddybuy.git
cd buddybuy

# Ejecutar script de instalación
chmod +x install.sh
./install.sh

# Configurar credenciales
cp .env.example .env
nano .env

# Iniciar la aplicación
npm start
```

### Instalación en Windows

```powershell
# Clonar el repositorio
git clone https://github.com/tu-usuario/buddybuy.git
cd buddybuy

# Instalar dependencias
npm install

# Copiar archivo de configuración
copy .env.example .env

# Editar .env con tus credenciales
notepad .env

# Sincronizar productos
node sync-productos.js

# Iniciar la aplicación
npm start
```

## ⚙️ Configuración

Edita el archivo `.env` con tus credenciales:

```env
# Puerto del servidor (por defecto 3000)
PORT=3000

# OpenAI API Key (para el asistente IA)
# Obtén tu API key en: https://platform.openai.com/api-keys
OPENAI_API_KEY=tu_api_key_aqui

# Google OAuth 2.0 (para login con Google)
# Configura en: https://console.cloud.google.com/apis/credentials
GOOGLE_CLIENT_ID=tu_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=tu_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
```

### Configurar Google OAuth

1. Ve a [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Crea un nuevo proyecto o selecciona uno existente
3. Habilita la API de Google+ 
4. Crea credenciales OAuth 2.0 (Aplicación Web)
5. Añade `http://localhost:3000/auth/google/callback` como URI de redirección
6. Copia el Client ID y Client Secret a tu archivo `.env`

## 🍓 Instalación en Raspberry Pi

### Instalación Automática

```bash
# Clonar e instalar
git clone https://github.com/tu-usuario/buddybuy.git
cd buddybuy
chmod +x install.sh install-service.sh
./install.sh

# Configurar como servicio del sistema (inicio automático)
sudo ./install-service.sh
```

### Comandos del Servicio

```bash
# Ver estado
sudo systemctl status buddybuy

# Reiniciar
sudo systemctl restart buddybuy

# Ver logs
sudo journalctl -u buddybuy -f

# Detener
sudo systemctl stop buddybuy

# Desinstalar servicio
sudo ./uninstall-service.sh
```

### Acceso desde la Red Local

La aplicación escucha en todas las interfaces de red (`0.0.0.0`), por lo que puedes acceder desde cualquier dispositivo en tu red local:

```
http://IP_DE_TU_RASPBERRY:3000
```

Para encontrar la IP de tu Raspberry:
```bash
hostname -I
```

> ⚠️ **Nota**: El login con Google solo funciona desde `localhost` por restricciones de seguridad de OAuth.

## 📁 Estructura del Proyecto

```
buddybuy/
├── server.js          # Servidor Node.js principal
├── index.html         # Página principal
├── app.js             # JavaScript del frontend
├── styles.css         # Estilos CSS
├── sync-productos.js  # Script para sincronizar productos
├── install.sh         # Script de instalación Linux
├── install-service.sh # Instalador de servicio systemd
├── uninstall-service.sh # Desinstalador de servicio
├── .env.example       # Plantilla de variables de entorno
├── package.json       # Dependencias npm
└── data/
    ├── productos.json   # Cache de productos
    ├── categorias.json  # Cache de categorías
    ├── users.json       # Datos de usuarios (no en git)
    └── sessions.json    # Sesiones activas (no en git)
```

## 🔄 Sincronización de Productos

Para actualizar la base de datos de productos desde Mercadona:

```bash
node sync-productos.js
```

Este script descarga todos los productos y categorías de la API de Mercadona y los guarda localmente.

## 🛠️ Desarrollo

```bash
# Iniciar en modo desarrollo
npm start

# Ver logs detallados
DEBUG=* npm start
```

## 📝 Licencia

ISC License

## 🤝 Contribuir

Las contribuciones son bienvenidas. Por favor, abre un issue o pull request.

---

Desarrollado con ❤️ para hacer más fácil la compra en Mercadona
