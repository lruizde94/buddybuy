const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Cargar variables de entorno desde .env
function loadEnvFile() {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        envContent.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const [key, ...valueParts] = trimmed.split('=');
                const value = valueParts.join('=').trim();
                if (key && value && !process.env[key.trim()]) {
                    process.env[key.trim()] = value;
                }
            }
        });
        console.log('📄 Variables de entorno cargadas desde .env');
    }
}
loadEnvFile();

// PDF parsing library
let PDFParse;
try {
    const pdfModule = require('pdf-parse');
    PDFParse = pdfModule.PDFParse;
    console.log('📄 PDF parser cargado correctamente');
} catch (e) {
    console.log('⚠️ pdf-parse no instalado. Ejecuta: npm install pdf-parse');
}

// Helper function to parse PDF
async function parsePDF(buffer) {
    const parser = new PDFParse({
        data: buffer,
        verbosity: 0
    });
    const result = await parser.getText();
    return result.text;
}

const PORT = process.env.PORT || 3000;
const MERCADONA_API = 'tienda.mercadona.es';

// API Keys y credenciales (desde variables de entorno)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';

// Archivos de datos locales
const DATA_DIR = path.join(__dirname, 'data');
const PRODUCTOS_FILE = path.join(DATA_DIR, 'productos.json');
const CATEGORIAS_FILE = path.join(DATA_DIR, 'categorias.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// Cache de datos en memoria
let productosCache = null;
let categoriasCache = null;
let usersCache = {};
let sessionsCache = {};

// Cargar datos locales al iniciar
function loadLocalData() {
    try {
        if (fs.existsSync(PRODUCTOS_FILE)) {
            const data = JSON.parse(fs.readFileSync(PRODUCTOS_FILE, 'utf-8'));
            productosCache = data;
            console.log(`📦 Cargados ${data.total_productos} productos desde caché local`);
        }
        if (fs.existsSync(CATEGORIAS_FILE)) {
            categoriasCache = JSON.parse(fs.readFileSync(CATEGORIAS_FILE, 'utf-8'));
            console.log(`📂 Cargadas ${categoriasCache.length} categorías desde caché local`);
        }
        if (fs.existsSync(USERS_FILE)) {
            usersCache = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
            console.log(`👥 Cargados ${Object.keys(usersCache).length} usuarios`);
        }
        if (fs.existsSync(SESSIONS_FILE)) {
            sessionsCache = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
            console.log(`🔐 Cargadas ${Object.keys(sessionsCache).length} sesiones`);
        }
    } catch (error) {
        console.log('⚠️ No se encontraron datos locales. Ejecuta: node sync-productos.js');
    }
}

// Guardar sesiones en archivo
function saveSessions() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessionsCache, null, 2));
    } catch (error) {
        console.error('Error guardando sesiones:', error);
    }
}

// Crear nueva sesión
function createSession(userId, userInfo) {
    const sessionId = crypto.randomBytes(32).toString('hex');
    sessionsCache[sessionId] = {
        userId,
        userInfo,
        createdAt: Date.now(),
        expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 días
    };
    saveSessions();
    return sessionId;
}

// Validar sesión
function validateSession(sessionId) {
    if (!sessionId || !sessionsCache[sessionId]) return null;
    const session = sessionsCache[sessionId];
    if (Date.now() > session.expiresAt) {
        delete sessionsCache[sessionId];
        saveSessions();
        return null;
    }
    return session;
}

// Destruir sesión
function destroySession(sessionId) {
    if (sessionsCache[sessionId]) {
        delete sessionsCache[sessionId];
        saveSessions();
        return true;
    }
    return false;
}

// Obtener session ID de las cookies
function getSessionFromCookies(cookieHeader) {
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        acc[key] = value;
        return acc;
    }, {});
    return cookies['session_id'];
}

// Guardar usuarios en archivo
function saveUsers() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(USERS_FILE, JSON.stringify(usersCache, null, 2));
    } catch (error) {
        console.error('Error guardando usuarios:', error);
    }
}

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Use WHATWG URL API instead of deprecated url.parse()
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const query = Object.fromEntries(url.searchParams);

    // ===== OAuth 2.0 Endpoints =====
    
    // Iniciar flujo OAuth con Google
    if (pathname === '/auth/google' && req.method === 'GET') {
        const state = crypto.randomBytes(16).toString('hex');
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${GOOGLE_CLIENT_ID}` +
            `&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}` +
            `&response_type=code` +
            `&scope=${encodeURIComponent('openid email profile')}` +
            `&state=${state}` +
            `&access_type=offline`;
        
        res.writeHead(302, { 
            'Location': authUrl,
            'Set-Cookie': `oauth_state=${state}; HttpOnly; Path=/; Max-Age=600`
        });
        res.end();
        return;
    }
    
    // Callback de Google OAuth
    if (pathname === '/auth/google/callback' && req.method === 'GET') {
        const { code, state, error } = query;
        
        if (error) {
            res.writeHead(302, { 'Location': '/?error=auth_denied' });
            res.end();
            return;
        }
        
        if (!code) {
            res.writeHead(302, { 'Location': '/?error=no_code' });
            res.end();
            return;
        }
        
        // Intercambiar código por tokens
        const tokenData = new URLSearchParams({
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: GOOGLE_REDIRECT_URI,
            grant_type: 'authorization_code'
        });
        
        const https = require('https');
        const tokenReq = https.request({
            hostname: 'oauth2.googleapis.com',
            path: '/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(tokenData.toString())
            }
        }, (tokenRes) => {
            let data = '';
            tokenRes.on('data', chunk => data += chunk);
            tokenRes.on('end', () => {
                try {
                    const tokens = JSON.parse(data);
                    
                    if (tokens.error) {
                        console.error('Error obteniendo tokens:', tokens);
                        res.writeHead(302, { 'Location': '/?error=token_error' });
                        res.end();
                        return;
                    }
                    
                    // Obtener información del usuario
                    const userInfoReq = https.request({
                        hostname: 'www.googleapis.com',
                        path: '/oauth2/v2/userinfo',
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${tokens.access_token}`
                        }
                    }, (userInfoRes) => {
                        let userData = '';
                        userInfoRes.on('data', chunk => userData += chunk);
                        userInfoRes.on('end', () => {
                            try {
                                const userInfo = JSON.parse(userData);
                                const googleId = `google_${userInfo.id}`;
                                
                                // Crear o actualizar usuario
                                if (!usersCache[googleId]) {
                                    usersCache[googleId] = {
                                        createdAt: new Date().toISOString(),
                                        favoriteProducts: [],
                                        shoppingLists: [],
                                        oauthProvider: 'google',
                                        email: userInfo.email,
                                        name: userInfo.name,
                                        picture: userInfo.picture
                                    };
                                    saveUsers();
                                    console.log(`👤 Nuevo usuario OAuth: ${userInfo.email}`);
                                } else {
                                    // Actualizar info
                                    usersCache[googleId].email = userInfo.email;
                                    usersCache[googleId].name = userInfo.name;
                                    usersCache[googleId].picture = userInfo.picture;
                                    usersCache[googleId].lastLogin = new Date().toISOString();
                                    saveUsers();
                                }
                                
                                // Crear sesión
                                const sessionId = createSession(googleId, {
                                    email: userInfo.email,
                                    name: userInfo.name,
                                    picture: userInfo.picture
                                });
                                
                                res.writeHead(302, { 
                                    'Location': '/',
                                    'Set-Cookie': `session_id=${sessionId}; HttpOnly; Path=/; Max-Age=${7 * 24 * 60 * 60}`
                                });
                                res.end();
                            } catch (e) {
                                console.error('Error parseando info de usuario:', e);
                                res.writeHead(302, { 'Location': '/?error=user_info_error' });
                                res.end();
                            }
                        });
                    });
                    userInfoReq.on('error', (e) => {
                        console.error('Error obteniendo info de usuario:', e);
                        res.writeHead(302, { 'Location': '/?error=user_info_error' });
                        res.end();
                    });
                    userInfoReq.end();
                } catch (e) {
                    console.error('Error parseando tokens:', e);
                    res.writeHead(302, { 'Location': '/?error=parse_error' });
                    res.end();
                }
            });
        });
        tokenReq.on('error', (e) => {
            console.error('Error en petición de tokens:', e);
            res.writeHead(302, { 'Location': '/?error=network_error' });
            res.end();
        });
        tokenReq.write(tokenData.toString());
        tokenReq.end();
        return;
    }
    
    // Estado de autenticación
    if (pathname === '/api/auth/status' && req.method === 'GET') {
        const sessionId = getSessionFromCookies(req.headers.cookie);
        const session = validateSession(sessionId);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (session) {
            res.end(JSON.stringify({
                authenticated: true,
                userId: session.userId,
                userInfo: session.userInfo
            }));
        } else {
            res.end(JSON.stringify({ authenticated: false }));
        }
        return;
    }
    
    // Logout OAuth
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
        const sessionId = getSessionFromCookies(req.headers.cookie);
        destroySession(sessionId);
        
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Set-Cookie': 'session_id=; HttpOnly; Path=/; Max-Age=0'
        });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // ===== User API Endpoints =====
    
    // Login/Register user (GET users, POST to login/create)
    if (req.url === '/api/users' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ users: Object.keys(usersCache) }));
        return;
    }
    
    if (req.url === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username } = JSON.parse(body);
                if (!username || username.trim().length < 2) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Nombre de usuario inválido' }));
                    return;
                }
                
                const cleanUsername = username.trim().toLowerCase();
                
                // Create user if doesn't exist
                if (!usersCache[cleanUsername]) {
                    usersCache[cleanUsername] = {
                        createdAt: new Date().toISOString(),
                        favoriteProducts: [],
                        shoppingLists: []
                    };
                    saveUsers();
                    console.log(`👤 Nuevo usuario creado: ${cleanUsername}`);
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    username: cleanUsername,
                    user: usersCache[cleanUsername]
                }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Error procesando solicitud' }));
            }
        });
        return;
    }
    
    // Get user favorites
    if (req.url.startsWith('/api/user/favorites') && req.method === 'GET') {
        const username = req.headers['x-user'];
        if (!username || !usersCache[username]) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Usuario no autenticado' }));
            return;
        }
        
        const favoriteIds = usersCache[username].favoriteProducts || [];
        // Convertir IDs a string para comparar correctamente
        const favoriteIdsStr = favoriteIds.map(id => String(id));
        const favoriteProducts = productosCache?.productos
            .filter(p => favoriteIdsStr.includes(String(p.id)))
            .map(p => ({
                id: p.id,
                display_name: p.nombre,
                packaging: p.packaging,
                thumbnail: p.imagen,
                share_url: p.url,
                categoryL2: p.categoria_L2,
                categoryL3: p.categoria_L3,
                price_instructions: {
                    unit_price: p.precio,
                    previous_unit_price: p.precio_anterior,
                    bulk_price: p.precio_bulk,
                    unit_size: p.unit_size,
                    size_format: p.size_format,
                    selling_method: p.selling_method || 1,
                    iva: p.iva,
                    is_new: p.es_nuevo,
                    price_decreased: p.tiene_descuento,
                    is_pack: p.es_pack
                }
            })) || [];
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ favorites: favoriteProducts }));
        return;
    }
    
    // Add/Remove favorite product
    if (req.url === '/api/user/favorites' && req.method === 'POST') {
        const username = req.headers['x-user'];
        if (!username || !usersCache[username]) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Usuario no autenticado' }));
            return;
        }
        
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { productId, action } = JSON.parse(body);
                
                if (!usersCache[username].favoriteProducts) {
                    usersCache[username].favoriteProducts = [];
                }
                
                const favorites = usersCache[username].favoriteProducts;
                
                if (action === 'add' && !favorites.includes(productId)) {
                    favorites.push(productId);
                    saveUsers();
                } else if (action === 'remove') {
                    usersCache[username].favoriteProducts = favorites.filter(id => id !== productId);
                    saveUsers();
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    favorites: usersCache[username].favoriteProducts 
                }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Error procesando solicitud' }));
            }
        });
        return;
    }

    // ===== Shopping List API (per user) =====
    
    // Get user's shopping list
    if (req.url === '/api/user/shopping-list' && req.method === 'GET') {
        const username = req.headers['x-user'];
        if (!username || !usersCache[username]) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Usuario no autenticado' }));
            return;
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            shoppingList: usersCache[username].shoppingList || [],
            sharedLists: usersCache[username].sharedLists || []
        }));
        return;
    }
    
    // Save user's shopping list
    if (req.url === '/api/user/shopping-list' && req.method === 'POST') {
        const username = req.headers['x-user'];
        if (!username || !usersCache[username]) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Usuario no autenticado' }));
            return;
        }
        
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { shoppingList } = JSON.parse(body);
                usersCache[username].shoppingList = shoppingList;
                saveUsers();
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Error procesando solicitud' }));
            }
        });
        return;
    }
    
    // Share shopping list with another user
    if (req.url === '/api/user/share-list' && req.method === 'POST') {
        const username = req.headers['x-user'];
        if (!username || !usersCache[username]) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Usuario no autenticado' }));
            return;
        }
        
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { targetUser } = JSON.parse(body);
                
                if (!usersCache[targetUser]) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Usuario no encontrado' }));
                    return;
                }
                
                const myList = usersCache[username].shoppingList || [];
                if (myList.length === 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Tu lista está vacía' }));
                    return;
                }
                
                // Add to target user's shared lists
                if (!usersCache[targetUser].sharedLists) {
                    usersCache[targetUser].sharedLists = [];
                }
                
                usersCache[targetUser].sharedLists.push({
                    from: username,
                    date: new Date().toISOString(),
                    items: [...myList]
                });
                
                saveUsers();
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: `Lista compartida con ${targetUser}` }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Error procesando solicitud' }));
            }
        });
        return;
    }
    
    // Merge shared list into user's main list
    if (req.url === '/api/user/merge-shared-list' && req.method === 'POST') {
        const username = req.headers['x-user'];
        if (!username || !usersCache[username]) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Usuario no autenticado' }));
            return;
        }
        
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { listIndex } = JSON.parse(body);
                const sharedLists = usersCache[username].sharedLists || [];
                
                if (listIndex < 0 || listIndex >= sharedLists.length) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Lista no encontrada' }));
                    return;
                }
                
                const sharedList = sharedLists[listIndex];
                
                // Merge items into main list
                if (!usersCache[username].shoppingList) {
                    usersCache[username].shoppingList = [];
                }
                
                for (const item of sharedList.items) {
                    const existing = usersCache[username].shoppingList.find(i => i.id === item.id);
                    if (existing) {
                        existing.quantity += item.quantity;
                    } else {
                        usersCache[username].shoppingList.push({ ...item });
                    }
                }
                
                // Remove from shared lists
                usersCache[username].sharedLists.splice(listIndex, 1);
                saveUsers();
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    shoppingList: usersCache[username].shoppingList,
                    sharedLists: usersCache[username].sharedLists
                }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Error procesando solicitud' }));
            }
        });
        return;
    }
    
    // Dismiss shared list without merging
    if (req.url === '/api/user/dismiss-shared-list' && req.method === 'POST') {
        const username = req.headers['x-user'];
        if (!username || !usersCache[username]) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Usuario no autenticado' }));
            return;
        }
        
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { listIndex } = JSON.parse(body);
                const sharedLists = usersCache[username].sharedLists || [];
                
                if (listIndex >= 0 && listIndex < sharedLists.length) {
                    usersCache[username].sharedLists.splice(listIndex, 1);
                    saveUsers();
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true,
                    sharedLists: usersCache[username].sharedLists
                }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Error procesando solicitud' }));
            }
        });
        return;
    }

    // Find products from ticket text
    if (req.url === '/api/find-ticket-products' && req.method === 'POST') {
        // Handle multipart form data with PDF file
        const boundary = req.headers['content-type'].split('boundary=')[1];
        let body = Buffer.alloc(0);
        
        req.on('data', chunk => {
            body = Buffer.concat([body, chunk]);
        });
        
        req.on('end', async () => {
            try {
                // Parse multipart form data
                const bodyStr = body.toString('binary');
                const parts = bodyStr.split('--' + boundary);
                let fileBuffer = null;
                
                for (const part of parts) {
                    if (part.includes('filename=')) {
                        const contentMatch = part.match(/\r\n\r\n([\s\S]*)\r\n$/);
                        if (contentMatch) {
                            fileBuffer = Buffer.from(contentMatch[1], 'binary');
                        }
                    }
                }
                
                if (!fileBuffer || !productosCache) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'No hay archivo o datos' }));
                    return;
                }
                
                // Parse PDF using existing function
                const ticketText = await parsePDF(fileBuffer);
                console.log('📄 PDF del ticket procesado para buscar productos');
                
                // Extract ingredient names from ticket
                const ingredients = extractIngredientsFromTicket(ticketText);
                console.log('🔍 Ingredientes extraídos del ticket:', ingredients.join(', '));
                
                // Find matching products - buscar coincidencias más exactas
                const foundProducts = [];
                const matchedIngredients = new Set();
                
                for (const ingredient of ingredients) {
                    const ingredientLower = ingredient.toLowerCase();
                    // Obtener palabras significativas (4+ letras, sin números)
                    const searchTerms = ingredientLower
                        .split(/\s+/)
                        .filter(t => t.length >= 4 && !/^\d+$/.test(t));
                    
                    if (searchTerms.length === 0) continue;
                    
                    for (const producto of productosCache.productos) {
                        const nombreLower = producto.nombre.toLowerCase();
                        
                        // Buscar coincidencia: al menos 2 términos coinciden, o 1 término largo
                        let matchCount = 0;
                        let hasLongMatch = false;
                        
                        for (const term of searchTerms) {
                            if (nombreLower.includes(term)) {
                                matchCount++;
                                if (term.length >= 6) hasLongMatch = true;
                            }
                        }
                        
                        // Coincide si: tiene término largo, o 2+ términos, o el ingrediente está contenido en el nombre
                        const matches = hasLongMatch || matchCount >= 2 || 
                            nombreLower.includes(ingredientLower) || 
                            ingredientLower.includes(nombreLower.split(' ').slice(0, 3).join(' '));
                        
                        if (matches && !foundProducts.some(p => p.id === producto.id)) {
                            foundProducts.push({
                                id: producto.id,
                                display_name: producto.nombre,
                                packaging: producto.packaging,
                                thumbnail: producto.imagen,
                                categoryL2: producto.categoria_L2,
                                categoryL3: producto.categoria_L3,
                                matchedIngredient: ingredient,
                                unit_price: producto.precio
                            });
                            matchedIngredients.add(ingredient);
                            
                            // Máximo 2 productos por ingrediente del ticket
                            if (foundProducts.filter(p => p.matchedIngredient === ingredient).length >= 2) {
                                break;
                            }
                        }
                    }
                }
                
                console.log(`✅ Encontrados ${foundProducts.length} productos que coinciden con ${matchedIngredients.size} ingredientes del ticket`);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    products: foundProducts.slice(0, 50),
                    ingredients: ingredients,
                    matchedCount: matchedIngredients.size
                }));
            } catch (e) {
                console.error('Error finding products:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Error procesando ticket' }));
            }
        });
        return;
    }

    // Generate from already parsed text endpoint
    if (req.url === '/generar-desde-texto' && req.method === 'POST') {
        handleGenerateFromText(req, res);
        return;
    }

    // Ticket processing endpoint
    if (req.url === '/procesar-ticket' && req.method === 'POST') {
        handleTicketUpload(req, res);
        return;
    }

    // Menu generation endpoint
    if (req.url === '/generar-menu' && req.method === 'POST') {
        handleMenuRequest(req, res);
        return;
    }

    // API local - Búsqueda de productos
    if (req.url.startsWith('/api/search?') && productosCache) {
        const urlParams = new URLSearchParams(req.url.split('?')[1]);
        const query = urlParams.get('query')?.toLowerCase() || '';
        
        if (query.length < 2) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ results: [] }));
            return;
        }
        
        const results = productosCache.productos
            .filter(p => p.nombre.toLowerCase().includes(query))
            .slice(0, 20)
            .map(p => ({
                id: p.id,
                display_name: p.nombre,
                packaging: p.packaging,
                thumbnail: p.imagen,
                share_url: p.url,
                categoryL2: p.categoria_L2,
                categoryL3: p.categoria_L3,
                price_instructions: {
                    unit_price: p.precio,
                    previous_unit_price: p.precio_anterior,
                    bulk_price: p.precio_bulk,
                    unit_size: p.unit_size,
                    size_format: p.size_format,
                    selling_method: p.selling_method || 1,
                    iva: p.iva,
                    is_new: p.es_nuevo,
                    price_decreased: p.tiene_descuento,
                    is_pack: p.es_pack
                }
            }));
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
        return;
    }

    // API local - Categorías
    if (req.url === '/api/categories/' || req.url === '/api/categories') {
        if (categoriasCache) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            // Formatear como espera el frontend
            const formattedCategories = categoriasCache.map(cat => ({
                id: cat.id,
                name: cat.name,
                categories: cat.subcategories.map(sub => ({
                    id: sub.id,
                    name: sub.name
                }))
            }));
            res.end(JSON.stringify({ results: formattedCategories }));
            return;
        }
    }

    // API local - Productos por subcategoría
    const categoryMatch = req.url.match(/^\/api\/categories\/(\d+)$/);
    if (categoryMatch && productosCache) {
        const subcategoryId = categoryMatch[1];
        
        // Buscar la subcategoría
        let subcategoryName = null;
        for (const cat of categoriasCache || []) {
            const sub = cat.subcategories.find(s => s.id == subcategoryId);
            if (sub) {
                subcategoryName = sub.name;
                break;
            }
        }

        if (subcategoryName) {
            // Filtrar productos de esta subcategoría
            const productos = productosCache.productos.filter(p => p.categoria_L2 === subcategoryName);
            
            // Agrupar por L3
            const categoriesL3 = {};
            for (const p of productos) {
                if (!categoriesL3[p.categoria_L3]) {
                    categoriesL3[p.categoria_L3] = [];
                }
                categoriesL3[p.categoria_L3].push({
                    id: p.id,
                    display_name: p.nombre,
                    packaging: p.packaging,
                    thumbnail: p.imagen,
                    share_url: p.url,
                    price_instructions: {
                        unit_price: p.precio,
                        previous_unit_price: p.precio_anterior,
                        bulk_price: p.precio_bulk,
                        unit_size: p.unit_size,
                        size_format: p.size_format,
                        iva: p.iva,
                        is_new: p.es_nuevo,
                        price_decreased: p.tiene_descuento,
                        is_pack: p.es_pack
                    }
                });
            }

            const result = {
                categories: Object.entries(categoriesL3).map(([name, products]) => ({
                    name,
                    products
                }))
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;
        }
    }

    // Si no hay datos locales, hacer proxy a Mercadona
    if (req.url.startsWith('/api/')) {
        const apiPath = req.url;
        
        const options = {
            hostname: MERCADONA_API,
            port: 443,
            path: apiPath,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'es-ES,es;q=0.9',
                'Cookie': 'user_location=28001'
            }
        };

        const proxyReq = https.request(options, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (error) => {
            console.error('Proxy error:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Proxy error' }));
        });

        proxyReq.end();
        return;
    }

    // Serve static files
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, filePath);

    const extname = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// Handle ticket upload and processing
function handleTicketUpload(req, res) {
    if (!PDFParse) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'PDF parser not installed' }));
        return;
    }

    let body = [];
    
    req.on('data', chunk => {
        body.push(chunk);
    });

    req.on('end', async () => {
        try {
            const buffer = Buffer.concat(body);
            
            // Parse multipart form data manually
            const boundary = req.headers['content-type'].split('boundary=')[1];
            const parts = parseMultipart(buffer, boundary);
            
            let pdfBuffer = null;
            let option = 'recipes';
            
            for (const part of parts) {
                if (part.name === 'ticket' && part.data) {
                    pdfBuffer = part.data;
                } else if (part.name === 'option') {
                    option = part.data.toString().trim();
                }
            }
            
            if (!pdfBuffer) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'No PDF file provided' }));
                return;
            }
            
            // Parse PDF using helper function
            const ticketText = await parsePDF(pdfBuffer);
            
            console.log('📄 Ticket procesado, texto extraído:', ticketText.substring(0, 200) + '...');
            
            // Generate prompt based on option, passing ticketText to include in response
            if (option === 'weekly') {
                generateWeeklyMenu(ticketText, res, true);
            } else {
                generateRecipesFromTicket(ticketText, res, true);
            }
            
        } catch (e) {
            console.error('Ticket processing error:', e);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Error processing PDF' }));
        }
    });
}

// Handle generate from already parsed text
function handleGenerateFromText(req, res) {
    let body = '';
    
    req.on('data', chunk => {
        body += chunk.toString();
    });
    
    req.on('end', () => {
        try {
            const { ticketText, option } = JSON.parse(body);
            
            if (!ticketText) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'No ticket text provided' }));
                return;
            }
            
            console.log('🔄 Generando alternativa desde texto guardado...');
            
            if (option === 'weekly') {
                generateWeeklyMenu(ticketText, res, true);
            } else {
                generateRecipesFromTicket(ticketText, res, true);
            }
            
        } catch (e) {
            console.error('Generate from text error:', e);
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid request' }));
        }
    });
}

// Parse multipart form data
function parseMultipart(buffer, boundary) {
    const parts = [];
    const boundaryBuffer = Buffer.from('--' + boundary);
    const endBoundary = Buffer.from('--' + boundary + '--');
    
    let start = buffer.indexOf(boundaryBuffer) + boundaryBuffer.length;
    
    while (start < buffer.length) {
        // Find next boundary
        let end = buffer.indexOf(boundaryBuffer, start);
        if (end === -1) break;
        
        const partData = buffer.slice(start, end);
        
        // Parse headers
        const headerEnd = partData.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
            const headerStr = partData.slice(0, headerEnd).toString();
            const data = partData.slice(headerEnd + 4, partData.length - 2); // Remove trailing \r\n
            
            const nameMatch = headerStr.match(/name="([^"]+)"/);
            const filenameMatch = headerStr.match(/filename="([^"]+)"/);
            
            if (nameMatch) {
                parts.push({
                    name: nameMatch[1],
                    filename: filenameMatch ? filenameMatch[1] : null,
                    data: data
                });
            }
        }
        
        start = end + boundaryBuffer.length;
    }
    
    return parts;
}

// Extraer ingredientes del texto del ticket (procesamiento local)
function extractIngredientsFromTicket(ticketText) {
    // Limpiar y procesar el texto del ticket
    const lines = ticketText.split('\n');
    const ingredients = [];
    
    // Palabras y patrones a ignorar (no son productos)
    const ignorePatterns = [
        // Datos de tienda y transacción
        /^(total|subtotal|iva|dto|descuento|tarjeta|efectivo|cambio|ticket|factura|mercadona)/i,
        /^(nif|cif|direccion|telefono|hora|fecha|op:|gracias|cliente|simplificada)/i,
        /^(rollo|bolsa|descripcion|importe|p\.\s*unit)/i,
        
        // Direcciones y ubicaciones
        /^(c\.?º?|calle|avda\.?|avenida|plaza|paseo|camino|pol[íi]gono)/i,
        /moralzarzal|madrid|barcelona|valencia|sevilla|bilbao|zaragoza/i,
        /s\/n|c\.p\.?|código postal|\d{5}\s*(madrid|barcelona)/i,
        
        // Teléfonos
        /tel[ée]fono|tfno\.?|telf\.?/i,
        /^\d{9}$/,
        /^9\d{8}$/,
        /^6\d{8}$/,
        
        // Datos de pago y tarjeta
        /tarj\.?\s*bancaria|mastercard|visa|maestro|amex/i,
        /\*{4}\s*\*{4}\s*\*{4}/,
        /n\.?c:?\s*\d+|aut:?\s*\d+|aid:?\s*[a-f0-9]+|arc:?\s*\d+/i,
        
        // Textos legales y mensajes
        /se admiten devoluciones/i,
        /conserve este ticket/i,
        /gracias por su compra/i,
        /factura simplificada/i,
        
        // Números y códigos
        /^[\d\s€,.\-:\/]+$/,
        /^\d{2}\/\d{2}\/\d{4}/,
        /^[A-Z]-?\d{8}/,
        /^\d{6,}/,
        
        // Líneas con formato de encabezado
        /^descripci[oó]n.*importe/i,
        /^p\.?\s*unit/i
    ];
    
    // Palabras clave que indican que NO es un producto
    const excludeWords = [
        'telefono', 'teléfono', 'direccion', 'dirección', 'calle', 'avenida',
        'bancaria', 'mastercard', 'visa', 'devoluciones', 'ticket', 'factura',
        'importe', 'total', 'subtotal', 'cambio', 'efectivo', 'iva',
        'linares', 'moralzarzal', 'madrid', 'barcelona' // Añadir más ciudades si es necesario
    ];
    
    for (const line of lines) {
        const cleanLine = line.trim();
        
        // Ignorar líneas vacías o muy cortas
        if (!cleanLine || cleanLine.length < 4) continue;
        
        // Ignorar líneas que coinciden con patrones de exclusión
        let shouldIgnore = false;
        for (const pattern of ignorePatterns) {
            if (pattern.test(cleanLine)) {
                shouldIgnore = true;
                break;
            }
        }
        if (shouldIgnore) continue;
        
        // Ignorar si contiene palabras excluidas
        const lowerLine = cleanLine.toLowerCase();
        for (const word of excludeWords) {
            if (lowerLine.includes(word)) {
                shouldIgnore = true;
                break;
            }
        }
        if (shouldIgnore) continue;
        
        // Extraer nombre del producto (quitar precios, cantidades, etc.)
        let productName = cleanLine
            .replace(/[\d]+[,.][\d]+\s*€?/g, '') // Quitar precios
            .replace(/^\d+\s*[xX]?\s*/g, '') // Quitar cantidades iniciales "1 x"
            .replace(/\s+\d+\s*(g|kg|ml|l|ud|uds|gr)\.?\s*$/gi, '') // Quitar pesos finales
            .replace(/\s*\.\.\.\s*$/, '') // Quitar puntos suspensivos
            .replace(/\*+/g, '') // Quitar asteriscos
            .replace(/\s+/g, ' ') // Normalizar espacios
            .trim();
        
        // Validar que parece un producto válido
        if (productName.length >= 4 && 
            productName.length <= 50 && 
            !ingredients.includes(productName) &&
            /[a-záéíóúñ]/i.test(productName) && // Debe contener letras
            !/^\d+$/.test(productName) && // No puede ser solo números
            !productName.includes('****') && // No datos de tarjeta
            productName.split(' ').length <= 6) { // Máximo 6 palabras
            ingredients.push(productName);
        }
    }
    
    return ingredients.slice(0, 30); // Máximo 30 ingredientes
}

// Generate recipes from ticket
function generateRecipesFromTicket(ticketText, res, includeTicketText = false) {
    // Extraer ingredientes localmente (si es una lista ya procesada, usarla directamente)
    const isAlreadyIngredientsList = !ticketText.includes('MERCADONA') && !ticketText.includes('€');
    const ingredients = isAlreadyIngredientsList ? ticketText.split(', ') : extractIngredientsFromTicket(ticketText);
    const ingredientsList = ingredients.join(', ');
    
    console.log('🥗 Ingredientes extraídos:', ingredientsList);
    
    if (ingredients.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            ingredients: 'No se encontraron ingredientes',
            recipes: [],
            ticketText: includeTicketText ? ingredientsList : undefined
        }));
        return;
    }
    
    const prompt = `Eres un chef experto. Con los siguientes ingredientes: ${ingredientsList}

Dame exactamente 5 recetas populares y fáciles de preparar que utilicen estos ingredientes.

IMPORTANTE: Cada receta DEBE tener al menos 4 ingredientes de la lista proporcionada.

Responde ÚNICAMENTE con un JSON válido con esta estructura exacta (sin texto adicional, solo el JSON):
{
    "ingredients": "${ingredientsList}",
    "recipes": [
        {
            "name": "Nombre de la receta",
            "time": "tiempo de preparación (ej: 30 min)",
            "difficulty": "Fácil/Media/Difícil",
            "servings": "número de personas (ej: 4 personas)",
            "ingredients": ["ingrediente 1 con cantidad", "ingrediente 2 con cantidad", "ingrediente 3", "ingrediente 4"],
            "steps": ["Paso 1 de la preparación", "Paso 2 de la preparación"]
        }
    ]
}`;

    // Solo pasamos los ingredientes, no el PDF completo
    callOpenAI(prompt, res, includeTicketText ? ingredientsList : null);
}

// Generate weekly menu from ticket
function generateWeeklyMenu(ticketText, res, includeTicketText = false) {
    // Extraer ingredientes localmente (si es una lista ya procesada, usarla directamente)
    const isAlreadyIngredientsList = !ticketText.includes('MERCADONA') && !ticketText.includes('€');
    const ingredients = isAlreadyIngredientsList ? ticketText.split(', ') : extractIngredientsFromTicket(ticketText);
    const ingredientsList = ingredients.join(', ');
    
    console.log('🥗 Ingredientes extraídos:', ingredientsList);
    
    if (ingredients.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            ingredients: 'No se encontraron ingredientes',
            weeklyMenu: [],
            ticketText: includeTicketText ? ingredientsList : undefined
        }));
        return;
    }
    
    const prompt = `Eres un chef experto. Con los siguientes ingredientes: ${ingredientsList}

Crea un menú semanal completo (7 días) con desayuno, comida y cena.

IMPORTANTE: Cada comida debe utilizar al menos 2-3 ingredientes de la lista proporcionada.

Responde ÚNICAMENTE con un JSON válido con esta estructura exacta (sin texto adicional, solo el JSON):
{
    "ingredients": "${ingredientsList}",
    "weeklyMenu": [
        {
            "day": "Lunes",
            "breakfast": "Descripción del desayuno",
            "lunch": "Descripción de la comida",
            "dinner": "Descripción de la cena"
        }
    ]
}

Incluye los 7 días de la semana (Lunes a Domingo). Las comidas deben ser variadas y utilizar los ingredientes proporcionados.`;

    // Solo pasamos los ingredientes, no el PDF completo
    callOpenAI(prompt, res, includeTicketText ? ingredientsList : null);
}

// Handle menu generation requests
function handleMenuRequest(req, res) {
    let body = '';
    
    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', () => {
        try {
            const { ingredients } = JSON.parse(body);
            
            if (!ingredients) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'No ingredients provided' }));
                return;
            }

            const prompt = `Eres un chef experto. Con los siguientes ingredientes: ${ingredients}

Dame exactamente 5 recetas populares y fáciles de preparar que utilicen estos ingredientes. 

Responde ÚNICAMENTE con un JSON válido con esta estructura exacta (sin texto adicional, solo el JSON):
{
    "recipes": [
        {
            "name": "Nombre de la receta",
            "time": "tiempo de preparación (ej: 30 min)",
            "difficulty": "Fácil/Media/Difícil",
            "servings": "número de personas (ej: 4 personas)",
            "ingredients": ["ingrediente 1 con cantidad", "ingrediente 2 con cantidad"],
            "steps": ["Paso 1 de la preparación", "Paso 2 de la preparación"]
        }
    ]
}

Asegúrate de que:
1. Cada receta tenga un nombre descriptivo
2. Los ingredientes incluyan cantidades aproximadas
3. Los pasos sean claros y concisos
4. Las recetas sean variadas (diferentes tipos de platos)
5. Incluye tiempo de preparación, dificultad y porciones`;

            callOpenAI(prompt, res);

        } catch (e) {
            console.error('Request error:', e);
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid request' }));
        }
    });
}

// Llamada a OpenAI API
function callOpenAI(prompt, res, ticketText = null) {
    const openaiData = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
            role: 'user',
            content: prompt
        }],
        max_tokens: 2048
    });

    const options = {
        hostname: 'api.openai.com',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Length': Buffer.byteLength(openaiData)
        }
    };

    const openaiReq = https.request(options, (openaiRes) => {
        let data = '';
        
        openaiRes.on('data', chunk => {
            data += chunk;
        });

        openaiRes.on('end', () => {
            try {
                const response = JSON.parse(data);
                
                if (response.error) {
                    console.error('OpenAI error:', response.error);
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: response.error.message }));
                    return;
                }

                let text = response.choices?.[0]?.message?.content || '';
                console.log('📝 Respuesta OpenAI:', text.substring(0, 200) + '...');
                
                // Limpiar bloques de código markdown si existen
                text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
                
                // Extract JSON from the response
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const result = JSON.parse(jsonMatch[0]);
                    // Añadir ticketText si se proporcionó
                    if (ticketText) {
                        result.ticketText = ticketText;
                    }
                    console.log('✅ Respuesta final al frontend:', JSON.stringify(result).substring(0, 500) + '...');
                    console.log('📋 Número de recetas:', result.recipes?.length || 'N/A (menú semanal)');
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } else {
                    console.error('❌ No se pudo extraer JSON de la respuesta');
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: 'Could not parse response from AI' }));
                }
            } catch (e) {
                console.error('Parse error:', e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Error parsing AI response' }));
            }
        });
    });

    openaiReq.on('error', (error) => {
        console.error('OpenAI API error:', error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Error connecting to OpenAI API' }));
    });

    openaiReq.write(openaiData);
    openaiReq.end();
}

// Obtener IP local de la red
function getLocalIP() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// Cargar datos locales antes de iniciar el servidor
loadLocalData();

const HOST = '0.0.0.0'; // Escuchar en todas las interfaces de red
const localIP = getLocalIP();

server.listen(PORT, HOST, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🛒 BuddyBuy - Servidor Local                            ║
║                                                           ║
║   📍 Local:    http://localhost:${PORT}                      ║
║   📡 Red LAN:  http://${localIP}:${PORT}                    ║
║                                                           ║
║   Presiona Ctrl+C para detener el servidor                ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
    
    console.log('🤖 Usando OpenAI API (GPT-4o-mini)');
    
    if (!productosCache) {
        console.log('\n⚠️  No hay datos locales. Ejecuta: node sync-productos.js\n');
    }
});
