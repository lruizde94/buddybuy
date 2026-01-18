/**
 * Script para sincronizar productos de Mercadona
 * Descarga todos los productos y los guarda en un archivo JSON local
 * 
 * Ejecutar con: node sync-productos.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const MERCADONA_API = 'tienda.mercadona.es';
const OUTPUT_FILE = path.join(__dirname, 'data', 'productos.json');
const CATEGORIES_FILE = path.join(__dirname, 'data', 'categorias.json');

// Asegurar que existe el directorio data
if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'));
}

// Función para hacer peticiones HTTPS
function fetchAPI(apiPath) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: MERCADONA_API,
            port: 443,
            path: apiPath,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'es-ES,es;q=0.9'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Error parsing JSON: ' + e.message));
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

// Esperar un tiempo para evitar rate limiting
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Obtener todas las categorías
async function fetchCategories() {
    console.log('📂 Obteniendo categorías...');
    const data = await fetchAPI('/api/categories/');
    return data.results || [];
}

// Obtener productos de una subcategoría
async function fetchSubcategoryProducts(subcategoryId) {
    const data = await fetchAPI(`/api/categories/${subcategoryId}`);
    return data.categories || [];
}

// Función principal
async function syncProducts() {
    console.log('═══════════════════════════════════════════════════');
    console.log('🛒 Sincronizando productos de Mercadona...');
    console.log('═══════════════════════════════════════════════════\n');

    const startTime = Date.now();
    let totalProducts = 0;
    const allProducts = [];
    const allCategories = [];

    try {
        // Obtener categorías principales (L1)
        const categoriesL1 = await fetchCategories();
        console.log(`✅ Encontradas ${categoriesL1.length} categorías principales\n`);

        // Guardar estructura de categorías
        for (const catL1 of categoriesL1) {
            allCategories.push({
                id: catL1.id,
                name: catL1.name,
                subcategories: (catL1.categories || []).map(c => ({
                    id: c.id,
                    name: c.name
                }))
            });
        }

        // Recorrer cada categoría y subcategoría
        for (const categoryL1 of categoriesL1) {
            const nombreL1 = categoryL1.name;
            console.log(`\n📁 ${nombreL1}`);

            const subcategories = categoryL1.categories || [];
            
            for (const categoryL2 of subcategories) {
                const nombreL2 = categoryL2.name;
                const subcategoryId = categoryL2.id;

                process.stdout.write(`   └─ ${nombreL2}... `);

                try {
                    // Pequeña pausa para no saturar la API
                    await sleep(200);

                    const categoriesL3 = await fetchSubcategoryProducts(subcategoryId);
                    let subCount = 0;

                    for (const categoryL3 of categoriesL3) {
                        const nombreL3 = categoryL3.name;
                        const products = categoryL3.products || [];

                        for (const product of products) {
                            const priceInstructions = product.price_instructions || {};
                            
                            allProducts.push({
                                id: product.id,
                                nombre: product.display_name,
                                categoria_L1: nombreL1,
                                categoria_L2: nombreL2,
                                categoria_L3: nombreL3,
                                precio: parseFloat(priceInstructions.unit_price) || 0,
                                precio_anterior: priceInstructions.previous_unit_price 
                                    ? parseFloat(priceInstructions.previous_unit_price) 
                                    : null,
                                packaging: product.packaging || '',
                                precio_bulk: priceInstructions.bulk_price 
                                    ? parseFloat(priceInstructions.bulk_price) 
                                    : null,
                                unit_size: priceInstructions.unit_size || '',
                                size_format: priceInstructions.size_format || '',
                                iva: priceInstructions.iva || 0,
                                es_nuevo: priceInstructions.is_new || false,
                                tiene_descuento: priceInstructions.price_decreased || false,
                                es_pack: priceInstructions.is_pack || false,
                                url: product.share_url || '',
                                imagen: product.thumbnail || ''
                            });
                            subCount++;
                        }
                    }

                    totalProducts += subCount;
                    console.log(`${subCount} productos`);

                } catch (error) {
                    console.log(`❌ Error: ${error.message}`);
                }
            }
        }

        // Guardar productos en JSON
        const outputData = {
            ultima_actualizacion: new Date().toISOString(),
            total_productos: allProducts.length,
            productos: allProducts
        };

        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputData, null, 2), 'utf-8');
        fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(allCategories, null, 2), 'utf-8');

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log('\n═══════════════════════════════════════════════════');
        console.log('✅ Sincronización completada!');
        console.log(`📦 Total productos: ${totalProducts}`);
        console.log(`⏱️  Tiempo: ${elapsed} segundos`);
        console.log(`💾 Guardado en: ${OUTPUT_FILE}`);
        console.log('═══════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('\n❌ Error durante la sincronización:', error.message);
        process.exit(1);
    }
}

// Ejecutar
syncProducts();
