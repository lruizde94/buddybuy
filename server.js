const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
// OpenAI helper removed (OCR feature disabled)

// Cargar variables de entorno desde .env
function loadEnvFile() {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        envContent.split('\n').forEach(line => {
            const trimmed = line.trim();
            // ignore comments and code-fence markers (e.g., ```dotenv) so malformed .env blocks are skipped
            if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('```')) {
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
let PDFParseModule = null;
let PDFParseFn = null;
try {
    const pdfModule = require('pdf-parse');
    PDFParseModule = pdfModule;

    // Try to detect the exported API shape
    if (typeof pdfModule === 'function') {
        PDFParseFn = pdfModule;
    } else if (pdfModule && typeof pdfModule.default === 'function') {
        PDFParseFn = pdfModule.default;
    } else if (pdfModule && typeof pdfModule.PDFParse === 'function') {
        // older/alternate exports
        PDFParseFn = function (buffer) {
            // pdfModule.PDFParse used as constructor in some builds
            const parser = new pdfModule.PDFParse({ data: buffer });
            return parser.getText ? parser.getText() : Promise.resolve(parser);
        };
    } else if (pdfModule && typeof pdfModule.PDFParser === 'function') {
        PDFParseFn = function (buffer) {
            const parser = new pdfModule.PDFParser({ data: buffer });
            return parser.getText ? parser.getText() : Promise.resolve(parser);
        };
    }

    if (PDFParseFn) {
        console.log('📄 PDF parser cargado correctamente (forma detectada)');
    } else {
        console.log('⚠️ pdf-parse cargado pero no se reconoció su API. Algunas funciones de PDF pueden fallar.');
    }
} catch (e) {
    console.log('⚠️ pdf-parse no instalado. Ejecuta: npm install pdf-parse');
}

// Helper function to parse PDF
async function parsePDF(buffer) {
    if (!PDFParseFn) {
        throw new Error('pdf-parse module not available or has unexpected export shape');
    }

    // Try calling detected function and normalize result
    try {
        const result = await PDFParseFn(buffer);
        if (!result) return '';
        if (typeof result === 'string') return result;
        if (result.text) return result.text;
        // Some parser variants return an object with other properties
        // Try to stringify useful text fields
        return (result.text || result.numpages || JSON.stringify(result)).toString();
    } catch (e) {
        // If the detected wrapper failed, try alternative approaches
        try {
            // If module exposes PDFParse as constructor
            const pdfModule = PDFParseModule;
            if (pdfModule && typeof pdfModule.PDFParse === 'function') {
                const parser = new pdfModule.PDFParse({ data: buffer });
                if (parser.getText) {
                    const r = await parser.getText();
                    return r.text || r;
                }
            }
        } catch (e2) {
            // fall through
        }
        throw e;
    }
}

// Normalize text for search: remove diacritics and lowercase
function normalizeSearch(str) {
    if (!str) return '';
    try {
        return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    } catch (e) {
        return str.replace(/[áàäâÁÀÄÂ]/g,'a')
                  .replace(/[éèëêÉÈËÊ]/g,'e')
                  .replace(/[íìïîÍÌÏÎ]/g,'i')
                  .replace(/[óòöôÓÒÖÔ]/g,'o')
                  .replace(/[úùüûÚÙÜÛ]/g,'u')
                  .replace(/[ñÑ]/g,'n')
                  .toLowerCase();
    }
}

const PORT = process.env.PORT || 3000;
const MERCADONA_API = 'tienda.mercadona.es';

// API Keys y credenciales (desde variables de entorno)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';
// Habilitar o deshabilitar usuarios de prueba (login local)
function parseBoolEnv(val, defaultVal = false) {
    if (typeof val === 'undefined' || val === null) return defaultVal;
    const s = String(val).trim().toLowerCase();
    if (s === '') return defaultVal;
    return ['1', 'true', 'yes', 'y', 'on'].includes(s);
}
// Runtime configuration persisted to data/config.json (allows toggling without env restarts)
const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');
let runtimeConfig = null;

function loadRuntimeConfig() {
    try {
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        if (fs.existsSync(CONFIG_FILE)) {
            runtimeConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) || {};
        } else {
            runtimeConfig = { allowTestUsers: parseBoolEnv(process.env.ALLOW_TEST_USERS, true) };
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(runtimeConfig, null, 2), 'utf-8');
        }
    } catch (e) {
        console.error('Error loading runtime config:', e);
        runtimeConfig = { allowTestUsers: parseBoolEnv(process.env.ALLOW_TEST_USERS, true) };
    }
    console.log(`🔧 Runtime config loaded: allowTestUsers=${!!runtimeConfig.allowTestUsers}`);
}

function saveRuntimeConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(runtimeConfig, null, 2), 'utf-8');
    } catch (e) {
        console.error('Error saving runtime config:', e);
    }
}

function getAllowTestUsers() {
    return !!(runtimeConfig && runtimeConfig.allowTestUsers);
}

loadRuntimeConfig();

// Archivos de datos locales
const DATA_DIR = path.join(__dirname, 'data');
const PRODUCTOS_FILE = path.join(DATA_DIR, 'productos.json');
const CATEGORIAS_FILE = path.join(DATA_DIR, 'categorias.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const ASSOCIATIONS_FILE = path.join(DATA_DIR, 'product_associations.json');
const PRICE_HISTORY_FILE = path.join(DATA_DIR, 'price_history.json');
const SHARED_RECIPES_FILE = path.join(DATA_DIR, 'shared_recipes.json');
const SHARED_LISTS_FILE = path.join(DATA_DIR, 'shared_lists.json');

// Cache de datos en memoria
let productosCache = null;
let categoriasCache = null;
let usersCache = {};
let sessionsCache = {};
let associationsCache = {}; // { "normalized_ticket_item": { productId: "id", originalName: "name" } }
let priceHistory = {}; // { productId: [ { date: 'YYYY-MM-DD', price: 1.23 }, ... ] }
let sharedRecipes = {}; // { token: { recipe, createdAt, expiresAt } }
let sharedLists = {}; // { token: { listItems, createdAt, expiresAt } }
// Search index and query cache for faster lookups
let searchIndex = null; // { tokenMap: Map(token -> Set(productIndex)), products: Array(products), normNames: Array }
const queryCache = new Map(); // simple LRU-like cache
// Simple server-side rate limiter store
const serverRateLimits = {};

// Helper: authenticate request via session cookie or X-Session header. Returns username or null.
function getAuthenticatedUsername(req) {
    // Prefer session cookie
    const sessionId = getSessionFromCookies(req.headers.cookie) || req.headers['x-session'];
    const session = validateSession(sessionId);
    if (session && session.userId) return session.userId;

    // If client provides X-User, require that a valid session exists matching that user
    const headerUser = req.headers['x-user'];
    if (headerUser && session && session.userId === headerUser) return headerUser;
    return null;
}

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
        if (fs.existsSync(ASSOCIATIONS_FILE)) {
            associationsCache = JSON.parse(fs.readFileSync(ASSOCIATIONS_FILE, 'utf-8'));
            console.log(`🔗 Cargadas ${Object.keys(associationsCache).length} asociaciones de productos`);
        }
        if (fs.existsSync(PRICE_HISTORY_FILE)) {
            try {
                priceHistory = JSON.parse(fs.readFileSync(PRICE_HISTORY_FILE, 'utf-8')) || {};
                console.log(`💾 Cargado historial de precios para ${Object.keys(priceHistory).length} productos`);
            } catch (e) {
                priceHistory = {};
            }
        }
        if (fs.existsSync(SHARED_RECIPES_FILE)) {
            try {
                sharedRecipes = JSON.parse(fs.readFileSync(SHARED_RECIPES_FILE, 'utf-8')) || {};
                console.log(`🔗 Cargados ${Object.keys(sharedRecipes).length} enlaces compartidos`);
            } catch (e) {
                sharedRecipes = {};
            }
        }
        // Build search index after loading products
        buildSearchIndex();
    } catch (error) {
        console.log('⚠️ No se encontraron datos locales. Ejecuta: node sync-productos.js');
    }
}

// Build a simple inverted index for products to speed up search
function buildSearchIndex() {
    if (!productosCache || !Array.isArray(productosCache.productos)) return;
    searchIndex = {
        tokenMap: new Map(),
        products: productosCache.productos,
        normNames: []
    };

    const addToken = (token, idx) => {
        if (!token || token.length < 2) return; // skip tiny tokens
        let s = searchIndex.tokenMap.get(token);
        if (!s) {
            s = new Set();
            searchIndex.tokenMap.set(token, s);
        }
        s.add(idx);
    };

    for (let i = 0; i < searchIndex.products.length; i++) {
        const p = searchIndex.products[i];
        const name = normalizeSearch(p.nombre || '');
        searchIndex.normNames[i] = name;
        // tokenization: words and also contiguous substrings of words (prefixes)
        const words = name.split(/[^a-z0-9]+/).filter(Boolean);
        for (const w of words) {
            addToken(w, i);
            // add prefixes (for prefix search), min length 2
            for (let L = 2; L <= Math.min(8, w.length); L++) {
                addToken(w.substring(0, L), i);
            }
        }
    }

    console.log(`🔎 Search index creado: ${searchIndex.products.length} productos, ${searchIndex.tokenMap.size} tokens`);
}

function cachedQueryGet(key) {
    if (queryCache.has(key)) {
        const v = queryCache.get(key);
        // refresh position to make it more-recent
        queryCache.delete(key);
        queryCache.set(key, v);
        return v;
    }
    return null;
}

function cachedQuerySet(key, value) {
    queryCache.set(key, value);
    // limit size to 300 entries
    if (queryCache.size > 300) {
        const firstKey = queryCache.keys().next().value;
        queryCache.delete(firstKey);
    }
}

// Search using the inverted index: token lookup + scoring
function searchProductsIndexed(qnorm, limit = 20) {
    if (!searchIndex) return [];
    const cached = cachedQueryGet(qnorm);
    if (cached) return cached;

    const tokens = qnorm.split(/[^a-z0-9]+/).filter(Boolean);
    if (tokens.length === 0) {
        cachedQuerySet(qnorm, []);
        return [];
    }

    // For each token get candidate sets and union them, then score by matches
    const candidateScores = new Map(); // idx -> score
    for (const t of tokens) {
        // try exact token then fallback to shorter prefix
        let set = searchIndex.tokenMap.get(t);
        if (!set) {
            // try prefixes length down to 2
            for (let L = Math.min(t.length, 8); L >= 2 && !set; L--) {
                set = searchIndex.tokenMap.get(t.substring(0, L));
            }
        }
        if (!set) continue;
        for (const idx of set) {
            const prev = candidateScores.get(idx) || 0;
            candidateScores.set(idx, prev + 1);
        }
    }

    // Convert to array and sort by score + position of token in name
    const candidates = Array.from(candidateScores.entries()).map(([idx, score]) => {
        const p = searchIndex.products[idx];
        const name = searchIndex.normNames[idx];
        // boost if startsWith
        let boost = 0;
        if (name.startsWith(qnorm)) boost += 3;
        return { p, score, boost };
    });

    candidates.sort((a, b) => (b.score + b.boost) - (a.score + a.boost));
    const results = candidates.slice(0, limit).map(c => c.p);
    cachedQuerySet(qnorm, results);
    return results;
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

// Guardar asociaciones en archivo
function saveAssociations() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(ASSOCIATIONS_FILE, JSON.stringify(associationsCache, null, 2));
    } catch (error) {
        console.error('Error guardando asociaciones:', error);
    }
}

// Guardar historial de precios en archivo
function savePriceHistory() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(PRICE_HISTORY_FILE, JSON.stringify(priceHistory, null, 2));
    } catch (error) {
        console.error('Error guardando price history:', error);
    }
}

function saveSharedRecipes() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(SHARED_RECIPES_FILE, JSON.stringify(sharedRecipes, null, 2));
    } catch (error) {
        console.error('Error guardando shared recipes:', error);
    }
}

function saveSharedLists() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(SHARED_LISTS_FILE, JSON.stringify(sharedLists, null, 2));
    } catch (error) {
        console.error('Error guardando shared lists:', error);
    }
}

// Registrar snapshot diario de precios (uno por día)
function recordPriceSnapshot() {
    if (!productosCache || !productosCache.productos) return;
    const today = new Date().toISOString().split('T')[0];
    const maxEntries = 365;

    for (const p of productosCache.productos) {
        const id = String(p.id);
        const price = p.precio || null;
        if (price === null || price === undefined) continue;
        if (!priceHistory[id]) priceHistory[id] = [];
        const arr = priceHistory[id];
        const last = arr.length ? arr[arr.length - 1] : null;
        if (last && last.date === today) continue; // already recorded today
        arr.push({ date: today, price: price });
        // Trim history
        if (arr.length > maxEntries) arr.splice(0, arr.length - maxEntries);
    }

    savePriceHistory();
    console.log(`💾 Price snapshot recorded for ${Object.keys(productosCache.productos || {}).length} products on ${today}`);
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
    console.log(`📨 Request: ${req.method} ${req.url}`);
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User');

    if (req.method === 'OPTIONS') {
        console.log('📨 OPTIONS request handled');
        res.writeHead(200);
        res.end();
        return;
    }

    // Use WHATWG URL API instead of deprecated url.parse()
    let url, pathname, query;
    try {
        url = new URL(req.url, `http://${req.headers.host}`);
        pathname = url.pathname;
        query = Object.fromEntries(url.searchParams);
        console.log(`📨 Parsed URL: ${pathname}`);
    } catch (e) {
        console.error('❌ Error parsing URL:', e);
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid URL' }));
        return;
    }

    // ----- Basic rate limiter per IP (simple in-memory)
    try {
        const clientIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
        serverRateLimits[clientIp] = serverRateLimits[clientIp] || { count: 0, windowStart: Date.now() };
        const rl = serverRateLimits[clientIp];
        const WINDOW_MS = 60 * 1000; // 1 minute
        const MAX_REQ = parseInt(process.env.RATE_LIMIT || '120', 10);
        if (Date.now() - rl.windowStart > WINDOW_MS) {
            rl.count = 0; rl.windowStart = Date.now();
        }
        rl.count++;
        if (rl.count > MAX_REQ) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
            return;
        }
    } catch (e) {}

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
    // Config endpoint (expose feature toggles to frontend)
    if (req.url === '/api/config' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ allowTestUsers: getAllowTestUsers() }));
        return;
    }

    // Admin endpoint to inspect/update runtime config
    if (pathname === '/api/admin/config') {
        // Protection: require ADMIN_TOKEN header if configured, otherwise only allow localhost
        const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
        const remote = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';
        const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);

        if (req.method === 'GET') {
            // Return current runtime config
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ config: runtimeConfig || { allowTestUsers: getAllowTestUsers() } }));
            return;
        }

        if (req.method === 'POST') {
            // Authenticate
            if (ADMIN_TOKEN) {
                const token = req.headers['x-admin-token'] || '';
                if (token !== ADMIN_TOKEN) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid admin token' }));
                    return;
                }
            } else if (!isLocal) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Admin config endpoint is restricted to localhost' }));
                return;
            }

            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    if (typeof payload.allowTestUsers !== 'undefined') {
                        runtimeConfig = runtimeConfig || {};
                        runtimeConfig.allowTestUsers = !!payload.allowTestUsers;
                        saveRuntimeConfig();
                        console.log(`🔧 Admin updated allowTestUsers=${runtimeConfig.allowTestUsers}`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, config: runtimeConfig }));
                        return;
                    }
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'No valid fields provided' }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON' }));
                }
            });
            return;
        }
    }
    
    // Login/Register user (GET users, POST to login/create)
    if (req.url === '/api/users' && req.method === 'GET') {
        // Restrict listing users to admin only to avoid exposing user list
        const adminToken = process.env.ADMIN_TOKEN || '';
        const provided = req.headers['x-admin-token'] || '';
        const remote = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';
        const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
        if (!adminToken || provided !== adminToken) {
            if (!isLocal) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Forbidden' }));
                return;
            }
        }

        // If test users disabled, only return OAuth users (start with 'google_')
        let users = Object.keys(usersCache);
        if (!getAllowTestUsers()) {
            users = users.filter(u => u.startsWith('google_'));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ users }));
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

                // If test users are disabled, block local/test user creation (non-OAuth)
                if (!getAllowTestUsers() && !cleanUsername.startsWith('google_')) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Test users are disabled on this installation' }));
                    return;
                }

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
        const username = getAuthenticatedUsername(req);
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
        const username = getAuthenticatedUsername(req);
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
        const username = getAuthenticatedUsername(req);
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
        const username = getAuthenticatedUsername(req);
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
        const username = getAuthenticatedUsername(req);
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
        const username = getAuthenticatedUsername(req);
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
        const username = getAuthenticatedUsername(req);
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

    // ===== User Tickets API =====
    
    // Get user tickets
    if (req.url === '/api/user/tickets' && req.method === 'GET') {
        const username = getAuthenticatedUsername(req);
        if (!username || !usersCache[username]) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Usuario no autenticado' }));
            return;
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            tickets: usersCache[username].tickets || []
        }));
        return;
    }
    
    // Save ticket to user history
    if (req.url === '/api/user/tickets' && req.method === 'POST') {
        const username = getAuthenticatedUsername(req);
        if (!username || !usersCache[username]) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Usuario no autenticado' }));
            return;
        }
        
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { ticket } = JSON.parse(body);
                
                if (!usersCache[username].tickets) {
                    usersCache[username].tickets = [];
                }
                
                // Generate unique hash from ticket content to avoid duplicates
                const ticketHash = crypto.createHash('md5')
                    .update(ticket.date + ticket.total + JSON.stringify(ticket.products.map(p => p.name).sort()))
                    .digest('hex');
                
                // Check for duplicates
                const isDuplicate = usersCache[username].tickets.some(t => t.hash === ticketHash);
                
                if (!isDuplicate) {
                    usersCache[username].tickets.push({
                        ...ticket,
                        hash: ticketHash,
                        savedAt: new Date().toISOString()
                    });
                    saveUsers();
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Ticket guardado' }));
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Ticket ya existe', duplicate: true }));
                }
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Error procesando solicitud' }));
            }
        });
        return;
    }
    
    // Delete a ticket from user history
    if (req.url === '/api/user/tickets' && req.method === 'DELETE') {
        const username = getAuthenticatedUsername(req);
        if (!username || !usersCache[username]) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Usuario no autenticado' }));
            return;
        }
        
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { ticketHash } = JSON.parse(body);
                
                if (usersCache[username].tickets) {
                    usersCache[username].tickets = usersCache[username].tickets.filter(t => t.hash !== ticketHash);
                    saveUsers();
                }

                // Recompute frequent products for response (appear in >=3 tickets)
                const tickets = usersCache[username].tickets || [];
                const freq = {};
                for (const t of tickets) {
                    const seen = new Set();
                    if (!Array.isArray(t.products)) continue;
                    for (const p of t.products) {
                        const id = String(p.id || p.productId || p.id_product || p.name);
                        if (seen.has(id)) continue;
                        seen.add(id);
                        freq[id] = freq[id] ? freq[id] + 1 : 1;
                    }
                }
                const frequentIds = Object.entries(freq).filter(([id, count]) => count >= 3).map(([id]) => id);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, tickets, frequentIds }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Error procesando solicitud' }));
            }
        });
        return;
    }
    
    // Save product associations for future automatic matching
    if (req.url === '/api/save-product-associations' && req.method === 'POST') {
        // Limit request body size and validate payload
        let size = 0;
        let body = '';
        req.on('data', chunk => {
            size += chunk.length;
            if (size > 200000) return req.destroy();
            body += chunk;
        });
        req.on('end', () => {
            try {
                const parsed = JSON.parse(body || '{}');
                const associations = Array.isArray(parsed.associations) ? parsed.associations : [];

                // associations should be array of { ticketItem: "name", productId: "id" | null }
                let savedCount = 0;
                for (const assoc of associations) {
                    if (!assoc || !assoc.ticketItem) continue;
                    const normalizedKey = String(assoc.ticketItem).toLowerCase().trim();
                    const productId = assoc.productId;

                    if (productId == null) {
                        // explicit deletion
                        if (associationsCache[normalizedKey]) {
                            delete associationsCache[normalizedKey];
                            savedCount++;
                        }
                        continue;
                    }

                    // validate product exists
                    const producto = productosCache.productos.find(p => String(p.id) === String(productId));
                    if (producto) {
                        associationsCache[normalizedKey] = {
                            productId: String(productId),
                            originalName: producto.nombre,
                            savedAt: Date.now(),
                            source: 'user'
                        };
                        savedCount++;
                    }
                }

                if (savedCount > 0) {
                    saveAssociations();
                    console.log(`💾 Guardadas/actualizadas ${savedCount} asociaciones de productos`);
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ saved: savedCount }));
            } catch (e) {
                console.error('Error saving associations:', e && (e.stack || e));
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Error procesando asociaciones' }));
            }
        });
        return;
    }
    
    // Get user stats (aggregated ticket data)
    if (req.url.startsWith('/api/user/stats') && req.method === 'GET') {
        const username = getAuthenticatedUsername(req);
        if (!username || !usersCache[username]) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Usuario no autenticado' }));
            return;
        }
        
        const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
        const startDate = urlParams.get('startDate');
        const endDate = urlParams.get('endDate');
        
        let tickets = usersCache[username].tickets || [];
        
        // Filter by date range if provided
        if (startDate || endDate) {
            tickets = tickets.filter(ticket => {
                const ticketDate = new Date(ticket.date);
                if (startDate && ticketDate < new Date(startDate)) return false;
                if (endDate && ticketDate > new Date(endDate)) return false;
                return true;
            });
        }
        
        // Calculate stats
        const stats = {
            totalTickets: tickets.length,
            totalSpent: 0,
            categoryBreakdown: {},
            categoryProducts: {}, // Products grouped by category
            monthlySpending: {},
            productFrequency: {}
        };
        
        for (const ticket of tickets) {
            stats.totalSpent += ticket.total || 0;
            
            // Monthly spending
            const monthKey = ticket.date ? ticket.date.substring(0, 7) : 'desconocido';
            stats.monthlySpending[monthKey] = (stats.monthlySpending[monthKey] || 0) + (ticket.total || 0);
            
            // Category breakdown and product frequency
            for (const product of (ticket.products || [])) {
                const category = product.category || 'Sin categoría';
                stats.categoryBreakdown[category] = (stats.categoryBreakdown[category] || 0) + (product.price || 0);
                
                // Track products per category
                if (!stats.categoryProducts[category]) {
                    stats.categoryProducts[category] = {};
                }
                const productName = product.name || 'Desconocido';
                if (!stats.categoryProducts[category][productName]) {
                    stats.categoryProducts[category][productName] = { count: 0, totalSpent: 0 };
                }
                stats.categoryProducts[category][productName].count++;
                stats.categoryProducts[category][productName].totalSpent += (product.price || 0);
                
                if (!stats.productFrequency[productName]) {
                    stats.productFrequency[productName] = { count: 0, totalSpent: 0 };
                }
                stats.productFrequency[productName].count++;
                stats.productFrequency[productName].totalSpent += (product.price || 0);
            }
        }
        
        // Convert categoryProducts to sorted arrays
        for (const category in stats.categoryProducts) {
            const products = Object.entries(stats.categoryProducts[category])
                .map(([name, data]) => ({ name, ...data }))
                .sort((a, b) => b.totalSpent - a.totalSpent);
            stats.categoryProducts[category] = products;
        }
        
        // Sort product frequency by count
        const sortedProducts = Object.entries(stats.productFrequency)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 20);
        stats.topProducts = sortedProducts.map(([name, data]) => ({ name, ...data }));
        delete stats.productFrequency;
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats));
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

                const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
                if (fileBuffer.length > MAX_BYTES) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'El archivo supera el límite de 5 MB' }));
                    return;
                }

                // Check PDF magic header
                try {
                    const header = fileBuffer.slice(0, 4).toString();
                    if (header !== '%PDF') {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'El archivo no es un PDF válido' }));
                        return;
                    }
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'No se pudo validar el archivo' }));
                    return;
                }
                
                // Parse PDF using existing function
                const ticketText = await parsePDF(fileBuffer);
                console.log('📄 PDF del ticket procesado para buscar productos');
                
                // Extract ingredient names from ticket
                const ingredients = extractIngredientsFromTicket(ticketText);
                console.log('🔍 Ingredientes extraídos del ticket:', ingredients.map(i => `${i.name}${i.price ? ` (${i.price}€)` : ''}`).join(', '));
                
                // Find matching products - usar asociaciones aprendidas primero
                const foundProducts = [];
                const matchedIngredients = new Set();
                
                for (const ingredient of ingredients) {
                    const ingredientNormalized = ingredient.name.toLowerCase().trim();
                    
                    // Primero buscar en asociaciones guardadas
                    if (associationsCache[ingredientNormalized]) {
                        const assoc = associationsCache[ingredientNormalized];
                        const producto = productosCache.productos.find(p => p.id === assoc.productId);
                        // Verificar que el producto existe y es de categoría alimentaria
                        const nonFoodCategories = [
                            'Bebé',
                            'Cuidado del cabello',
                            'Cuidado facial y corporal', 
                            'Fitoterapia y parafarmacia',
                            'Limpieza y hogar',
                            'Maquillaje',
                            'Mascotas'
                        ];

                        if (producto && !nonFoodCategories.includes(producto.categoria_L1) && !foundProducts.some(p => p.id === producto.id)) {
                            const primary = {
                                id: producto.id,
                                display_name: producto.nombre,
                                packaging: producto.packaging,
                                thumbnail: producto.imagen,
                                categoryL2: producto.categoria_L2,
                                categoryL3: producto.categoria_L3,
                                matchedIngredient: ingredient.name,
                                unit_price: producto.precio,
                                fromAssociation: true // marcar que viene de asociación guardada
                            };

                            // Si tenemos precio en el ticket y difiere significativamente, NO sobreescribir
                            // la asociación: marcamos el desajuste pero mantenemos la asociación como prioritaria.
                            const ticketPrice = ingredient.price;
                            if (ticketPrice && producto.precio) {
                                const priceDiffRatio = Math.abs(ticketPrice - producto.precio) / Math.max(ticketPrice, producto.precio);
                                if (priceDiffRatio > 0.10) { // umbral 10%
                                    primary.priceMismatch = true;
                                    console.log(`⚠️ Precio no coincide para asociación (ticket: ${ticketPrice} vs producto: ${producto.precio}), manteniendo asociación`);
                                }
                            }

                            foundProducts.push(primary);
                            matchedIngredients.add(ingredient.name);
                            console.log(`🔗 Asociación encontrada para "${ingredient.name}": ${producto.nombre}`);
                            if (primary.priceMismatch) console.log(`⚠️ Precio no coincide (ticket: ${ticketPrice} vs producto: ${producto.precio}), sugerencias añadidas`);
                            continue; // pasar al siguiente ingrediente
                        }
                    }
                    
                    // Si no hay asociación, usar búsqueda automática
                    const ingredientLower = ingredient.name.toLowerCase();
                    const ticketPrice = ingredient.price;
                    
                    // Obtener palabras significativas (4+ letras, sin números)
                    const searchTerms = ingredientLower
                        .split(/\s+/)
                        .filter(t => t.length >= 4 && !/^\d+$/.test(t));
                    
                    if (searchTerms.length === 0) continue;
                    
                    let bestMatch = null;
                    let bestScore = 0;
                    let bestNameScore = 0;
                    
                    // Categorías que NO son de comida (productos no alimentarios)
                    const nonFoodCategories = [
                        'Bebé',
                        'Cuidado del cabello',
                        'Cuidado facial y corporal', 
                        'Fitoterapia y parafarmacia',
                        'Limpieza y hogar',
                        'Maquillaje',
                        'Mascotas'
                    ];
                    
                    for (const producto of productosCache.productos) {
                        // Excluir productos de categorías no alimentarias
                        if (nonFoodCategories.includes(producto.categoria_L1)) {
                            continue;
                        }
                        
                        const nombreLower = producto.nombre.toLowerCase();
                        const productPrice = producto.precio;
                        
                        // Calcular score de coincidencia de nombre
                        let nameScore = 0;
                        let matchCount = 0;
                        let hasLongMatch = false;
                        
                        for (const term of searchTerms) {
                            if (nombreLower.includes(term)) {
                                matchCount++;
                                nameScore += term.length >= 6 ? 3 : 1; // Más peso a términos largos
                                if (term.length >= 6) hasLongMatch = true;
                            }
                        }
                        
                        // Bonus por coincidencias exactas
                        if (nombreLower.includes(ingredientLower)) nameScore += 5;
                        if (ingredientLower.includes(nombreLower.split(' ').slice(0, 3).join(' '))) nameScore += 3;
                        
                        // Calcular score de precio (si tenemos precio del ticket)
                        let priceScore = 0;
                        if (ticketPrice && productPrice) {
                            const priceDiff = Math.abs(ticketPrice - productPrice);
                            const priceRatio = priceDiff / Math.max(ticketPrice, productPrice);
                            
                            if (priceRatio < 0.05) { // Diferencia menor al 5%
                                priceScore = 5;
                            } else if (priceRatio < 0.10) { // Diferencia menor al 10%
                                priceScore = 3;
                            } else if (priceRatio < 0.20) { // Diferencia menor al 20%
                                priceScore = 1;
                            }
                        }
                        
                        // Score total (nombre + precio)
                        const totalScore = nameScore + priceScore;
                        
                        // Solo considerar si tiene algún score mínimo
                        if (totalScore >= 3 && totalScore > bestScore) {
                            bestMatch = producto;
                            bestScore = totalScore;
                            bestNameScore = nameScore;
                        }
                    }
                    
                    // Si encontramos un buen match, agregarlo según coincidencia de nombre.
                    if (bestMatch) {
                        const hasNameMatch = bestNameScore && bestNameScore > 0;
                        if (hasNameMatch) {
                            foundProducts.push({
                                id: bestMatch.id,
                                display_name: bestMatch.nombre,
                                packaging: bestMatch.packaging,
                                thumbnail: bestMatch.imagen,
                                categoryL2: bestMatch.categoria_L2,
                                categoryL3: bestMatch.categoria_L3,
                                matchedIngredient: ingredient.name,
                                unit_price: bestMatch.precio,
                                matchScore: bestScore,
                                hasPriceMatch: ticketPrice ? Math.abs(ticketPrice - bestMatch.precio) / Math.max(ticketPrice, bestMatch.precio) < 0.10 : false
                            });
                            matchedIngredients.add(ingredient.name);

                            // Máximo 2 productos por ingrediente del ticket
                            if (foundProducts.filter(p => p.matchedIngredient === ingredient.name).length >= 2) {
                                break;
                            }
                        } else {
                            // No hay coincidencia significativa por nombre: no asociar automáticamente.
                            // En su lugar, generar sugerencias por proximidad de precio para que el usuario revise.
                            const suggestions = productosCache.productos
                                .filter(p => !nonFoodCategories.includes(p.categoria_L1) && p.precio)
                                .map(p => {
                                    const pr = ticketPrice && p.precio ? Math.abs(ticketPrice - p.precio) / Math.max(ticketPrice, p.precio) : 1;
                                    return { p, priceRatio: pr };
                                })
                                .sort((a, b) => a.priceRatio - b.priceRatio)
                                .slice(0, 5)
                                .map(s => ({
                                    id: s.p.id,
                                    display_name: s.p.nombre,
                                    packaging: s.p.packaging,
                                    thumbnail: s.p.imagen,
                                    categoryL2: s.p.categoria_L2,
                                    categoryL3: s.p.categoria_L3,
                                    unit_price: s.p.precio,
                                    priceRatio: s.priceRatio
                                }));

                            foundProducts.push({
                                matchedIngredient: ingredient.name,
                                suggestions,
                                needsReview: true
                            });
                        }
                    }
                }
                
                console.log(`✅ Encontrados ${foundProducts.length} productos que coinciden con ${matchedIngredients.size} ingredientes del ticket`);
                
                // Extract ticket date and total
                const ticketInfo = extractTicketInfo(ticketText);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    products: foundProducts.slice(0, 50),
                    ingredients: ingredients,
                    matchedCount: matchedIngredients.size,
                    ticketInfo: ticketInfo
                }));
            } catch (e) {
                console.error('Error finding products:', e && e.stack ? e.stack : e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Error finding products: ' + (e && e.message ? e.message : String(e)) }));
            }
        });
        return;
    }

    // OCR endpoint for images: uploads an image and returns extracted text + ingredients
    if (false && req.url === '/api/ocr-ticket' && req.method === 'POST') {
        // parse multipart manually (small payloads)
        const boundaryHeader = req.headers['content-type'] || '';
        const m = boundaryHeader.match(/boundary=(.*)$/);
        if (!m) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing boundary in content-type' }));
            return;
        }

        let body = Buffer.alloc(0);
        req.on('data', chunk => body = Buffer.concat([body, chunk]));
        req.on('end', async () => {
            try {
                const boundary = m[1];
                const parts = parseMultipart(body, boundary);
                const imagePart = parts.find(p => p.name === 'image' || p.name === 'photo');
                if (!imagePart) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'No image provided' }));
                    return;
                }

                const mime = (imagePart.filename && imagePart.filename.toLowerCase().endsWith('.png')) ? 'image/png' : 'image/jpeg';
                const b64 = imagePart.data.toString('base64');

                const prompt = `Eres un asistente con capacidad de visión. Extrae EL TEXTO DEL TICKET tal y como aparece en la imagen y DEVUÉLVELO EN ESPAÑOL si el ticket está en español. NO TRADUZCAS NI NORMALICES los nombres de los productos: devuelve las palabras exactamente como aparecen en la imagen (mayúsculas/minúsculas).\n\n` +
                    `Devuelve SOLO un objeto JSON con las claves:\n` +
                    `  \"text\": el texto completo del ticket con saltos de línea (\\n)\n` +
                    `  \"items\": un array con las líneas que parecen artículos del ticket, exactamente como aparecen (sin traducir)\n` +
                    `Ejemplo de salida:\n{\"text\":\"LÍNEA1\\nLÍNEA2\", \"items\": [\"1 BANANA 1,108 kg 1,72\", \"1 PAN 1,80\"] }\n` +
                    `Si no puedes extraer artículos con seguridad, incluye igualmente el texto tal cual y una lista vacía en \"items\". No añadas explicaciones ni traducciones.\n\nIMAGEN:\n` + `data:${mime};base64,${b64}`;

                try {
                    console.log('📷 OCR: sending image to OpenAI (size bytes):', imagePart.data.length);
                    const ocrResult = await callOpenAIFetch(prompt);
                    // Log raw result summary for debugging
                    try {
                        console.log('📷 OCR: OpenAI result keys:', Object.keys(ocrResult || {}));
                    } catch (e) {}
                    const ticketText = (ocrResult && ocrResult.text) ? ocrResult.text : (typeof ocrResult === 'string' ? ocrResult : '');
                    console.log('📷 OCR: extracted text length:', ticketText ? ticketText.length : 0);
                    if (ticketText) console.log('📷 OCR sample:', ticketText.substring(0, 400).replace(/\n/g, '\\n'));
                    const ingredients = extractIngredientsFromTicket(ticketText);
                    console.log('📷 OCR: ingredients parsed count:', ingredients.length);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ text: ticketText, ingredients }));
                } catch (err) {
                    console.error('OCR call error', err && (err.stack || err));
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'OCR failed: ' + (err && err.message ? err.message : String(err)) }));
                }
            } catch (e) {
                console.error('Error parsing multipart for OCR:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid multipart data' }));
            }
        });
        return;
    }

    // Map plain ticket text to products (POST JSON { ticketText: '...' })
    if (false && req.url === '/api/find-products-from-text' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { ticketText } = JSON.parse(body || '{}');
                const ingredients = extractIngredientsFromTicket(ticketText || '');
                const matches = [];
                for (const ingredient of ingredients) {
                    const ingredientNormalized = ingredient.name.toLowerCase().trim();
                    // Try associations
                    if (associationsCache[ingredientNormalized]) {
                        const assoc = associationsCache[ingredientNormalized];
                        const producto = productosCache.productos.find(p => p.id === assoc.productId);
                        if (producto) {
                            matches.push({ ingredient: ingredient.name, product: producto });
                            continue;
                        }
                    }

                    // Fallback: substring match
                    for (const p of productosCache.productos) {
                        if (!p || !p.nombre) continue;
                        if (p.nombre.toLowerCase().includes(ingredientNormalized)) {
                            matches.push({ ingredient: ingredient.name, product: p });
                            break;
                        }
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ingredients, matches }));
            } catch (e) {
                console.error('find-products-from-text error', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Error processing text' }));
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
        const rawQuery = urlParams.get('query') || '';
        const query = rawQuery.trim();
        const qnorm = normalizeSearch(query);

        if (qnorm.length < 2) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ results: [] }));
            return;
        }

        // Use indexed search when available for much faster lookups
        let found = [];
        if (searchIndex) {
            const matched = searchProductsIndexed(qnorm, 50);
            found = matched;
        } else {
            found = productosCache.productos.filter(p => normalizeSearch(p.nombre || '').includes(qnorm)).slice(0,50);
        }

        const results = found.slice(0,20).map(p => ({
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

        // Compress JSON response (gzip) to reduce payload over network
        try {
            const out = JSON.stringify({ results });
            const gz = zlib.gzipSync(out);
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Content-Encoding': 'gzip',
                'Content-Length': gz.length,
                'Access-Control-Allow-Origin': '*'
            });
            res.end(gz);
        } catch (e) {
            // Fallback to plain JSON
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ results }));
        }
        return;
    }

    // API local - Historial de precios por producto
    if (req.url.startsWith('/api/price-history') && req.method === 'GET') {
        const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
        const productId = urlParams.get('productId');
        const days = parseInt(urlParams.get('days') || '0', 10);
        if (!productId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'productId required' }));
            return;
        }
        const arr = priceHistory[String(productId)] || [];
        if (days > 0) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            const cutoffStr = cutoff.toISOString().split('T')[0];
            const filtered = arr.filter(x => x.date >= cutoffStr);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(filtered));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(arr));
        return;
    }

    // Create a shareable recipe link (expires in 30 days)
    if (req.url === '/api/share-recipe' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const payload = JSON.parse(body || '{}');
                const recipe = payload.recipe;
                if (!recipe) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'recipe required' }));
                    return;
                }
                const token = crypto.randomBytes(16).toString('hex');
                const createdAt = new Date().toISOString();
                const expiresAt = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString();
                sharedRecipes[token] = { recipe, createdAt, expiresAt };
                saveSharedRecipes();
                const url = `/shared/recipe?token=${token}`;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ token, url, expiresAt }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid body' }));
            }
        });
        return;
    }

    // Create a shareable shopping list link (expires in 30 days)
    if (req.url === '/api/share-shopping-list' && req.method === 'POST') {
        const username = getAuthenticatedUsername(req);
        if (!username) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Usuario no autenticado' }));
            return;
        }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const payload = JSON.parse(body || '{}');
                // If client provides explicit list, use it; otherwise use user's saved shoppingList
                const listItems = Array.isArray(payload.list) ? payload.list : (usersCache[username].shoppingList || []);
                if (!Array.isArray(listItems) || listItems.length === 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Lista vacía o inválida' }));
                    return;
                }
                const token = crypto.randomBytes(16).toString('hex');
                const createdAt = new Date().toISOString();
                const expiresAt = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString();
                sharedLists[token] = { list: listItems, createdAt, expiresAt, from: username };
                saveSharedLists();
                const url = `/shared/list?token=${token}`;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ token, url, expiresAt }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid body' }));
            }
        });
        return;
    }

    // Send an existing share token to another user (adds to recipient inbox)
    if (req.url === '/api/share-to-user' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { token, toUser, fromUser } = JSON.parse(body || '{}');
                if (!token || !toUser) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'token and toUser required' }));
                    return;
                }
                if (!sharedRecipes[token]) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'token not found' }));
                    return;
                }
                const cleanTo = String(toUser).trim().toLowerCase();
                if (!usersCache[cleanTo]) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'recipient user not found' }));
                    return;
                }
                usersCache[cleanTo].sharedReceived = usersCache[cleanTo].sharedReceived || [];
                usersCache[cleanTo].sharedReceived.push({ token, from: fromUser || null, createdAt: new Date().toISOString() });
                saveUsers();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid body' }));
            }
        });
        return;
    }

    // Serve shared recipe by token
    if (req.url.startsWith('/shared/recipe') && req.method === 'GET') {
        const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
        const token = urlParams.get('token');
        if (!token) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'token required' }));
            return;
        }
        const entry = sharedRecipes[token];
        if (!entry) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
            return;
        }
        if (new Date() > new Date(entry.expiresAt)) {
            // expired - delete and save
            delete sharedRecipes[token];
            saveSharedRecipes();
            res.writeHead(410, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'expired' }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ recipe: entry.recipe, createdAt: entry.createdAt, expiresAt: entry.expiresAt }));
        return;
    }

    // Serve a shared shopping list by token
    if (req.url.startsWith('/shared/list') && req.method === 'GET') {
        const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
        const token = urlParams.get('token');
        if (!token) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'token required' }));
            return;
        }
        const entry = sharedLists[token];
        if (!entry) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
            return;
        }
        if (new Date() > new Date(entry.expiresAt)) {
            delete sharedLists[token];
            saveSharedLists();
            res.writeHead(410, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'expired' }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ list: entry.list, createdAt: entry.createdAt, expiresAt: entry.expiresAt, from: entry.from }));
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
        console.error('❌ PDF parser not available');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'PDF parser not installed' }));
        return;
    }

    console.log('📄 Iniciando procesamiento de ticket...');
    let body = [];
    
    req.on('data', chunk => {
        body.push(chunk);
    });

    req.on('end', async () => {
        try {
            console.log('📄 Datos del formulario recibidos, tamaño:', Buffer.concat(body).length);
            const buffer = Buffer.concat(body);
            
            // Parse multipart form data manually
            const boundary = req.headers['content-type']?.split('boundary=')[1];
            if (!boundary) {
                console.error('❌ No boundary found in content-type');
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid form data' }));
                return;
            }
            
            console.log('📄 Boundary:', boundary);
            const parts = parseMultipart(buffer, boundary);
            console.log('📄 Partes parseadas:', parts.length);

            let pdfBuffer = null;
            let option = 'recipes';
            let ticketParts = 0;

            for (const part of parts) {
                console.log('📄 Parte:', part.name, part.filename, part.data ? part.data.length : 0);
                if (part.name === 'ticket' && part.data) {
                    pdfBuffer = part.data;
                    ticketParts++;
                } else if (part.name === 'option') {
                    option = part.data.toString().trim();
                }
            }

            if (ticketParts > 1) {
                console.error('❌ Multiple ticket files provided');
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Solo se permite un archivo PDF' }));
                return;
            }

            if (!pdfBuffer) {
                console.error('❌ No PDF buffer found');
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'No se proporcionó un archivo PDF' }));
                return;
            }

            console.log('📄 PDF buffer size:', pdfBuffer.length);

            const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
            if (pdfBuffer.length > MAX_BYTES) {
                console.error('❌ PDF demasiado grande:', pdfBuffer.length);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'El archivo supera el límite de 5 MB' }));
                return;
            }

            // Quick magic bytes check for PDF
            try {
                const header = pdfBuffer.slice(0, 4).toString();
                if (header !== '%PDF') {
                    console.error('❌ Archivo no tiene encabezado PDF válido:', header);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'El archivo no es un PDF válido' }));
                    return;
                }
            } catch (e) {
                console.error('❌ Error comprobando encabezado PDF:', e);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'No se pudo validar el archivo' }));
                return;
            }
            
            // Parse PDF using helper function
            console.log('📄 Iniciando parsing del PDF...');
            const ticketText = await parsePDF(pdfBuffer);
            console.log('📄 PDF parseado exitosamente, longitud del texto:', ticketText.length);
            
            console.log('📄 Ticket procesado, texto extraído:', ticketText.substring(0, 200) + '...');
            
            // Generate prompt based on option, passing ticketText to include in response
            if (option === 'weekly') {
                console.log('📄 Generando menú semanal...');
                generateWeeklyMenu(ticketText, res, true);
            } else {
                console.log('📄 Generando recetas...');
                generateRecipesFromTicket(ticketText, res, true);
            }
            
        } catch (e) {
            console.error('❌ Error procesando ticket:', e);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Error processing PDF: ' + e.message }));
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
        ,/--\s*\d+\s*of\s*\d+\s*--/i
        ,/verificad[oó]/i
        ,/^kg\s*\/\s*kg/i
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
        
        // Extraer precio de la línea (patrones comunes: 1,23€, 1.23 €, etc.)
        let price = null;
        const priceMatch = cleanLine.match(/(\d+[,.]\d{2})\s*€?/i);
        if (priceMatch) {
            price = parseFloat(priceMatch[1].replace(',', '.'));
        }
        
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
        // Excluir nombres que son solo unidades o ruido (ej: "kg /kg", "-- 1 of 1 --", "Verificado...")
        const lowerName = productName.toLowerCase();
        const isUnitSlash = /^([a-z]{1,3}\s*\/\s*[a-z]{1,3})$/i.test(productName);
        const isNoiseToken = lowerName.includes('verificado') || lowerName.includes('of 1') || productName.includes('--');

        if (productName.length >= 4 && 
            productName.length <= 50 && 
            !ingredients.some(i => i.name === productName) &&
            /[a-záéíóúñ]/i.test(productName) && // Debe contener letras
            !/^\d+$/.test(productName) && // No puede ser solo números
            !productName.includes('****') && // No datos de tarjeta
            productName.split(' ').length <= 6 &&
            !isUnitSlash && !isNoiseToken) { // Filtrar unidades y ruido
            ingredients.push({
                name: productName,
                price: price
            });
        }
    }
    
    return ingredients.slice(0, 30); // Máximo 30 ingredientes
}

// Extract date and total from ticket text
function extractTicketInfo(ticketText) {
    let date = null;
    let total = null;
    
    // Try to find date patterns (DD/MM/YYYY or similar)
    const datePatterns = [
        /(\d{2}\/\d{2}\/\d{4})/,
        /(\d{2}-\d{2}-\d{4})/,
        /(\d{4}-\d{2}-\d{2})/
    ];
    
    for (const pattern of datePatterns) {
        const match = ticketText.match(pattern);
        if (match) {
            const parts = match[1].split(/[\/\-]/);
            if (parts[0].length === 4) {
                // YYYY-MM-DD format
                date = `${parts[0]}-${parts[1]}-${parts[2]}`;
            } else {
                // DD/MM/YYYY format
                date = `${parts[2]}-${parts[1]}-${parts[0]}`;
            }
            break;
        }
    }
    
    // If no date found, use current date
    if (!date) {
        date = new Date().toISOString().split('T')[0];
    }
    
    // Try to find total (looking for patterns like "TOTAL" followed by amount)
    const totalPatterns = [
        /total[:\s]+(\d+[,\.]\d{2})/i,
        /importe\s*total[:\s]+(\d+[,\.]\d{2})/i,
        /a\s*pagar[:\s]+(\d+[,\.]\d{2})/i
    ];
    
    for (const pattern of totalPatterns) {
        const match = ticketText.match(pattern);
        if (match) {
            total = parseFloat(match[1].replace(',', '.'));
            break;
        }
    }
    
    return { date, total };
}

// Generate recipes from ticket
function generateRecipesFromTicket(ticketText, res, includeTicketText = false) {
    // Extraer ingredientes localmente (si es una lista ya procesada, usarla directamente)
    const isAlreadyIngredientsList = !ticketText.includes('MERCADONA') && !ticketText.includes('€');
    const ingredients = isAlreadyIngredientsList ? ticketText.split(', ').map(name => ({ name, price: null })) : extractIngredientsFromTicket(ticketText);
    const ingredientsList = ingredients.map(i => i.name).join(', ');
    
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
                "steps": ["Paso 1 de la preparación", "Paso 2 de la preparación"],
                "nutrition": { "kcal_per_100g": 0, "fat_g": 0.0, "carbs_g": 0.0, "protein_g": 0.0 }
    try {
        if (fs.existsSync(PRICE_HISTORY_FILE)) {
            priceHistory = JSON.parse(fs.readFileSync(PRICE_HISTORY_FILE, 'utf8')) || {};
            console.log('📈 Cargado price history, productos con historial:', Object.keys(priceHistory).length);
        } else {
            priceHistory = {};
        }
    } catch (err) {
        console.error('Error cargando price_history.json:', err);
        priceHistory = {};
    }
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
    const ingredients = isAlreadyIngredientsList ? ticketText.split(', ').map(name => ({ name, price: null })) : extractIngredientsFromTicket(ticketText);
    const ingredientsList = ingredients.map(i => i.name).join(', ');
    
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
            "steps": ["Paso 1 de la preparación", "Paso 2 de la preparación"],
            "nutrition": { "kcal_per_100g": 0, "fat_g": 0.0, "carbs_g": 0.0, "protein_g": 0.0 }
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
    if (!OPENAI_API_KEY) {
        console.error('❌ No OpenAI API key configured');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'OpenAI API key not configured' }));
        return;
    }

    console.log('🤖 Enviando prompt a OpenAI...');
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
        console.log('📡 Respuesta OpenAI status:', openaiRes.statusCode);
        
        let data = '';
        openaiRes.on('data', chunk => {
            data += chunk;
        });

        openaiRes.on('end', () => {
            try {
                const response = JSON.parse(data);
                
                if (response.error) {
                    console.error('❌ OpenAI API error:', response.error);
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: 'OpenAI API error: ' + response.error.message }));
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
        console.error('❌ Error conectando a OpenAI:', error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Error connecting to OpenAI: ' + error.message }));
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
    console.log(`Servidor arrancado: http://localhost:${PORT} (LAN: http://${localIP}:${PORT})`);
    
    if (!productosCache) {
        console.log('\n⚠️  No hay datos locales. Ejecuta: node sync-productos.js\n');
    }
    // Record initial price snapshot at startup and schedule daily snapshots
    try {
        recordPriceSnapshot();
    } catch (e) {
        console.error('Error recording initial price snapshot:', e);
    }

    // Schedule daily snapshots every 24 hours
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    setInterval(() => {
        try {
            recordPriceSnapshot();
        } catch (e) {
            console.error('Error recording scheduled price snapshot:', e);
        }
    }, ONE_DAY_MS);
});
