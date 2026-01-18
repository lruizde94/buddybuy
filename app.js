// ===== Constants =====
// API URL - Usamos el proxy local de Node.js
const API_BASE_URL = '/api';
const MENU_API_URL = '/generar-menu';

// ===== State =====
let allCategories = [];
let currentProducts = [];
let searchTimeout = null;
let selectedIngredients = [];
let favoriteMenus = JSON.parse(localStorage.getItem('favoriteMenus') || '[]');
let shoppingList = JSON.parse(localStorage.getItem('shoppingList') || '[]');
let shoppingSearchTimeout = null;

// User state
let currentUser = localStorage.getItem('currentUser') || null;
let userFavoriteProducts = [];
let oauthUserInfo = null; // Para guardar info de usuario OAuth (nombre, foto, etc.)

// ===== DOM Elements =====
const categoriesNav = document.getElementById('categoriesNav');
const productsGrid = document.getElementById('productsGrid');
const categoryTitle = document.getElementById('categoryTitle');
const productsCount = document.getElementById('productsCount');
const loadingProducts = document.getElementById('loadingProducts');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const sortSelect = document.getElementById('sortSelect');
const productModal = document.getElementById('productModal');
const modalBody = document.getElementById('modalBody');
const modalClose = document.getElementById('modalClose');
const menuToggle = document.getElementById('menuToggle');
const sidebar = document.getElementById('sidebar');
const closeSidebar = document.getElementById('closeSidebar');
const overlay = document.getElementById('overlay');

// Ingredients Panel Elements
const ingredientsPanel = document.getElementById('ingredientsPanel');
const ingredientsList = document.getElementById('ingredientsList');
const ingredientsCount = document.getElementById('ingredientsCount');
const clearIngredients = document.getElementById('clearIngredients');
const generateMenu = document.getElementById('generateMenu');
const ingredientsToggle = document.getElementById('ingredientsToggle');
const toggleCount = document.getElementById('toggleCount');
const ingredientsCollapsedIcons = document.getElementById('ingredientsCollapsedIcons');
let ingredientsCollapsed = true; // default: show compact icon

// Menu Modal Elements
const menuModal = document.getElementById('menuModal');
const menuModalClose = document.getElementById('menuModalClose');
const menuLoading = document.getElementById('menuLoading');
const menuContent = document.getElementById('menuContent');

// ===== Category Icons =====
const categoryIcons = {
    'Aceite, especias y salsas': '🫒',
    'Agua y refrescos': '🥤',
    'Aperitivos': '🥨',
    'Arroz, legumbres y pasta': '🍝',
    'Azúcar, caramelos y chocolate': '🍫',
    'Bebé': '👶',
    'Bodega': '🍷',
    'Cacao, café e infusiones': '☕',
    'Carne': '🥩',
    'Cereales y galletas': '🥣',
    'Charcutería y quesos': '🧀',
    'Congelados': '🧊',
    'Conservas, caldos y cremas': '🥫',
    'Cuidado del cabello': '💇',
    'Cuidado facial y corporal': '🧴',
    'Fitoterapia y parafarmacia': '💊',
    'Fruta y verdura': '🥬',
    'Huevos, leche y mantequilla': '🥛',
    'Limpieza y hogar': '🧹',
    'Maquillaje': '💄',
    'Marisco y pescado': '🐟',
    'Mascotas': '🐾',
    'Panadería y pastelería': '🥐',
    'Pizzas y platos preparados': '🍕',
    'Postres y yogures': '🍮',
    'Zumos': '🧃',
    default: '📦'
};

// ===== Helper Functions =====
function getIcon(categoryName) {
    // Primero intenta coincidencia exacta
    if (categoryIcons[categoryName]) {
        return categoryIcons[categoryName];
    }
    // Luego busca por coincidencia parcial
    for (const [key, icon] of Object.entries(categoryIcons)) {
        if (key !== 'default' && categoryName.toLowerCase().includes(key.toLowerCase())) {
            return icon;
        }
    }
    return categoryIcons.default;
}

// Normaliza texto para búsqueda: pasa a minúsculas y elimina acentos/diacríticos
function normalizeText(str) {
    if (!str) return '';
    try {
        return str.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    } catch (e) {
        // Fallback for older environments: basic accent replacements
        return str.replace(/[áàäâÁÀÄÂ]/g,'a')
                  .replace(/[éèëêÉÈËÊ]/g,'e')
                  .replace(/[íìïîÍÌÏÎ]/g,'i')
                  .replace(/[óòöôÓÒÖÔ]/g,'o')
                  .replace(/[úùüûÚÙÜÛ]/g,'u')
                  .replace(/[ñÑ]/g,'n')
                  .toLowerCase();
    }
}

function formatPrice(price) {
    return new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: 'EUR'
    }).format(price);
}

function showLoading() {
    loadingProducts.classList.remove('hidden');
    productsGrid.innerHTML = '';
}

function hideLoading() {
    loadingProducts.classList.add('hidden');
}

function closeSidebarMobile() {
    sidebar.classList.remove('active');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
}

// ===== API Functions =====
async function fetchCategories() {
    try {
        const response = await fetch(`${API_BASE_URL}/categories/`);
        if (!response.ok) throw new Error('Error fetching categories');
        const data = await response.json();
        return data.results || [];
    } catch (error) {
        console.error('Error fetching categories:', error);
        return [];
    }
}

async function fetchSubcategoryProducts(subcategoryId) {
    try {
        const response = await fetch(`${API_BASE_URL}/categories/${subcategoryId}`);
        if (!response.ok) throw new Error('Error fetching products');
        const data = await response.json();
        return data.categories || [];
    } catch (error) {
        console.error('Error fetching products:', error);
        return [];
    }
}

// ===== Render Functions =====
function renderCategories(categories) {
    if (categories.length === 0) {
        categoriesNav.innerHTML = `
            <div class="loading-categories">
                <p>No se pudieron cargar las categorías</p>
                <button onclick="initApp()" style="margin-top: 10px; padding: 10px 20px; cursor: pointer;">
                    Reintentar
                </button>
            </div>
        `;
        return;
    }

    let html = '';
    categories.forEach((category, index) => {
        const icon = getIcon(category.name);
        const subcategories = category.categories || [];
        
        html += `
            <div class="category-item">
                <button class="category-btn" data-index="${index}" data-id="${category.id}">
                    <span class="icon">${icon}</span>
                    <span>${category.name}</span>
                </button>
                <div class="subcategories" id="subcategories-${index}">
                    ${subcategories.map(sub => `
                        <button class="subcategory-btn" data-id="${sub.id}" data-name="${sub.name}" data-parent="${category.name}">
                            ${sub.name}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    });

    categoriesNav.innerHTML = html;

    // Add event listeners
    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = e.currentTarget.dataset.index;
            toggleSubcategories(index);
        });
    });

    document.querySelectorAll('.subcategory-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const name = e.currentTarget.dataset.name;
            const parent = e.currentTarget.dataset.parent;
            loadSubcategoryProducts(id, name, parent);
            
            // Mark active
            document.querySelectorAll('.subcategory-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            // Close sidebar on mobile
            if (window.innerWidth <= 768) {
                closeSidebarMobile();
            }
        });
    });
}

function toggleSubcategories(index) {
    const subcategoriesDiv = document.getElementById(`subcategories-${index}`);
    const btn = document.querySelector(`.category-btn[data-index="${index}"]`);
    
    // Close all others
    document.querySelectorAll('.subcategories').forEach(div => {
        if (div.id !== `subcategories-${index}`) {
            div.classList.remove('show');
        }
    });
    document.querySelectorAll('.category-btn').forEach(b => {
        if (b.dataset.index !== index) {
            b.classList.remove('active');
        }
    });
    
    subcategoriesDiv.classList.toggle('show');
    btn.classList.toggle('active');
}

async function loadSubcategoryProducts(subcategoryId, subcategoryName, parentName) {
    showLoading();
    categoryTitle.textContent = `${parentName} › ${subcategoryName}`;
    
    const categories = await fetchSubcategoryProducts(subcategoryId);
    let products = [];
    
    categories.forEach(cat => {
        if (cat.products) {
            cat.products.forEach(product => {
                products.push({
                    ...product,
                    categoryL2: subcategoryName,
                    categoryL3: cat.name
                });
            });
        }
    });
    
    currentProducts = products;
    hideLoading();
    renderProducts(products);
}

function renderProducts(products) {
    if (products.length === 0) {
        productsGrid.innerHTML = `
            <div class="no-results">
                <div class="no-results-icon">🔍</div>
                <h3>No se encontraron productos</h3>
                <p>Intenta con otra categoría o término de búsqueda</p>
            </div>
        `;
        productsCount.textContent = '0 productos';
        return;
    }

    productsCount.textContent = `${products.length} productos`;

    let html = products.map(product => {
        const priceInstructions = product.price_instructions || {};
        const price = priceInstructions.unit_price || 0;
        const previousPrice = priceInstructions.previous_unit_price;
        const unitSize = priceInstructions.unit_size || '';
        const sizeFormat = priceInstructions.size_format || '';
        const bulkPrice = priceInstructions.bulk_price;
        const isNew = priceInstructions.is_new;
        const priceDecreased = priceInstructions.price_decreased;
        const isPack = priceInstructions.is_pack;

        let badges = '';
        if (isNew) badges += '<span class="badge badge-new">Nuevo</span>';
        if (priceDecreased) badges += '<span class="badge badge-discount">Oferta</span>';
        if (isPack) badges += '<span class="badge badge-pack">Pack</span>';

        const isFavorited = isProductFavorited(product.id);
        const favoriteBtn = currentUser ? `
            <button class="btn-favorite-product ${isFavorited ? 'favorited' : ''}" 
                    data-product-id="${product.id}"
                    onclick="toggleProductFavorite(${product.id}, event)">
                ${isFavorited ? '❤️' : '🤍'}
            </button>
        ` : '';

        return `
            <article class="product-card" data-product='${JSON.stringify(product).replace(/'/g, "&#39;")}'>
                ${favoriteBtn}
                <img src="${product.thumbnail || 'https://via.placeholder.com/200?text=Sin+imagen'}" 
                     alt="${product.display_name}" 
                     class="product-image"
                     loading="lazy"
                     onerror="this.src='https://via.placeholder.com/200?text=Sin+imagen'">
                <div class="product-info">
                    <p class="product-category">${product.categoryL3 || ''}</p>
                    <h3 class="product-name">${product.display_name}</h3>
                    <p class="product-packaging">${product.packaging || ''}</p>
                    <div class="product-price-container">
                        <span class="product-price">${formatPrice(price)}</span>
                        ${previousPrice ? `<span class="product-old-price">${formatPrice(parseFloat(previousPrice))}</span>` : ''}
                        ${bulkPrice ? `<span class="product-unit-price">${formatPrice(bulkPrice)}/${sizeFormat}</span>` : ''}
                    </div>
                    ${badges ? `<div class="product-badges">${badges}</div>` : ''}
                    <div class="product-actions">
                        <button class="btn-add-to-list" 
                                data-product-id="${product.id}"
                                onclick="event.stopPropagation(); addProductToShoppingList('${product.id}', '${product.display_name.replace(/'/g, "\\'")}', '${product.thumbnail || ''}')">
                            📋 Lista
                        </button>
                        <button class="btn-add-ingredient ${isIngredientSelected(product.id) ? 'added' : ''}" 
                                data-product-id="${product.id}"
                                onclick="event.stopPropagation(); addIngredient(${JSON.stringify(product).replace(/"/g, '&quot;')})">
                            ${isIngredientSelected(product.id) ? '✓ Añadido' : '🥗 Receta'}
                        </button>
                    </div>
                </div>
            </article>
        `;
    }).join('');

    productsGrid.innerHTML = html;

    // Add click events to product cards
    document.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-add-ingredient')) return;
            const productData = JSON.parse(card.dataset.product.replace(/&#39;/g, "'"));
            openProductModal(productData);
        });
    });
}

function openProductModal(product) {
    const priceInstructions = product.price_instructions || {};
    const price = priceInstructions.unit_price || 0;
    const previousPrice = priceInstructions.previous_unit_price;
    const unitSize = priceInstructions.unit_size || '';
    const sizeFormat = priceInstructions.size_format || '';
    const bulkPrice = priceInstructions.bulk_price;
    const iva = priceInstructions.iva || 'N/A';
    const sellingMethod = priceInstructions.selling_method === 1 ? 'Por unidad' : 'Por peso';

    modalBody.innerHTML = `
        <img src="${product.thumbnail || 'https://via.placeholder.com/400?text=Sin+imagen'}" 
             alt="${product.display_name}" 
             class="modal-image"
             onerror="this.src='https://via.placeholder.com/400?text=Sin+imagen'">
        
        <p class="modal-category">${product.categoryL2 || ''} › ${product.categoryL3 || ''}</p>
        <h2 class="modal-title">${product.display_name}</h2>
        
        <div class="modal-details">
            <div class="modal-detail-row">
                <span class="modal-detail-label">Empaquetado</span>
                <span class="modal-detail-value">${product.packaging || 'N/A'}</span>
            </div>
            <div class="modal-detail-row">
                <span class="modal-detail-label">Tamaño</span>
                <span class="modal-detail-value">${unitSize} ${sizeFormat}</span>
            </div>
            <div class="modal-detail-row">
                <span class="modal-detail-label">Método de venta</span>
                <span class="modal-detail-value">${sellingMethod}</span>
            </div>
            <div class="modal-detail-row">
                <span class="modal-detail-label">IVA</span>
                <span class="modal-detail-value">${iva}%</span>
            </div>
            <div class="modal-detail-row">
                <span class="modal-detail-label">ID Producto</span>
                <span class="modal-detail-value">${product.id}</span>
            </div>
        </div>
        
        <div class="modal-price-section">
            <span class="modal-price">${formatPrice(price)}</span>
            ${previousPrice ? `<span class="modal-old-price">${formatPrice(parseFloat(previousPrice))}</span>` : ''}
            ${bulkPrice ? `<p class="modal-unit-price">${formatPrice(bulkPrice)} / ${sizeFormat}</p>` : ''}
        </div>
        
        ${product.share_url ? `
            <div style="text-align: center;">
                <a href="${product.share_url}" target="_blank" rel="noopener noreferrer" class="modal-link">
                    Ver en Mercadona
                </a>
            </div>
        ` : ''}
    `;

    productModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeProductModal() {
    productModal.classList.remove('active');
    document.body.style.overflow = '';
}

// ===== Search Functions =====
async function searchProducts(query) {
    if (!query.trim()) {
        renderProducts([]);
        categoryTitle.textContent = 'Resultados de búsqueda';
        return;
    }
    showLoading();
    categoryTitle.textContent = `Buscando: "${query}"`;

    // Fetch all categories and search through products
    const categories = await fetchCategories();
    let allProducts = [];
    const qnorm = normalizeText(query);

    for (const category of categories) {
        for (const subcategory of (category.categories || [])) {
            const subcatData = await fetchSubcategoryProducts(subcategory.id);
            for (const cat of subcatData) {
                if (cat.products) {
                    for (const product of cat.products) {
                        const nameNorm = normalizeText(product.display_name || product.nombre || '');
                        if (nameNorm.includes(qnorm)) {
                            allProducts.push({
                                ...product,
                                categoryL1: category.name,
                                categoryL2: subcategory.name,
                                categoryL3: cat.name
                            });
                        }
                    }
                }
            }
        }
    }

    currentProducts = allProducts;
    hideLoading();
    renderProducts(allProducts);
}

function performQuickSearch(query) {
    if (!query.trim()) {
        if (currentProducts.length === 0) {
            productsGrid.innerHTML = `
                <div class="welcome-message">
                    <div class="welcome-icon">🛍️</div>
                    <h3>¡Bienvenido al explorador de productos!</h3>
                    <p>Selecciona una categoría del menú lateral para ver los productos disponibles.</p>
                </div>
            `;
            categoryTitle.textContent = 'Selecciona una categoría';
        }
        return;
    }

    const qnorm = normalizeText(query);
    const filtered = currentProducts.filter(p => {
        const name = p.display_name || p.nombre || '';
        return normalizeText(name).includes(qnorm);
    });
    
    categoryTitle.textContent = `Filtrando: "${query}"`;
    renderProducts(filtered);
}

// ===== Sort Function =====
function sortProducts(sortBy) {
    let sorted = [...currentProducts];
    
    switch (sortBy) {
        case 'name':
            sorted.sort((a, b) => a.display_name.localeCompare(b.display_name));
            break;
        case 'price-asc':
            sorted.sort((a, b) => {
                const priceA = a.price_instructions?.unit_price || 0;
                const priceB = b.price_instructions?.unit_price || 0;
                return priceA - priceB;
            });
            break;
        case 'price-desc':
            sorted.sort((a, b) => {
                const priceA = a.price_instructions?.unit_price || 0;
                const priceB = b.price_instructions?.unit_price || 0;
                return priceB - priceA;
            });
            break;
    }
    
    renderProducts(sorted);
}

// ===== Event Listeners =====
function setupEventListeners() {
    // Search
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            performQuickSearch(e.target.value);
        }, 300);
    });

    searchBtn.addEventListener('click', () => {
        const query = searchInput.value;
        if (query.trim()) {
            searchProducts(query);
        }
    });

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = searchInput.value;
            if (query.trim()) {
                searchProducts(query);
            }
        }
    });

    // Sort
    sortSelect.addEventListener('change', (e) => {
        sortProducts(e.target.value);
    });

    // Modal
    modalClose.addEventListener('click', closeProductModal);
    productModal.addEventListener('click', (e) => {
        if (e.target === productModal) {
            closeProductModal();
        }
    });

    // Mobile menu
    menuToggle.addEventListener('click', () => {
        sidebar.classList.add('active');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    });

    closeSidebar.addEventListener('click', closeSidebarMobile);
    overlay.addEventListener('click', closeSidebarMobile);

    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeProductModal();
            closeMenuModal();
            closeSidebarMobile();
        }
    });

    // Ingredients Panel Events
    ingredientsToggle.addEventListener('click', toggleIngredientsPanel);
    clearIngredients.addEventListener('click', clearAllIngredients);
    generateMenu.addEventListener('click', generateMenuRequest);
        // Clicking header toggles collapsed/expanded state
        const ingredientsHeader = document.querySelector('.ingredients-header');
        if (ingredientsHeader) {
            ingredientsHeader.addEventListener('click', (e) => {
                // Avoid toggling when clicking the remove buttons inside
                if (e.target.classList && e.target.classList.contains('ingredient-remove')) return;
                ingredientsCollapsed = !ingredientsCollapsed;
                ingredientsPanel.classList.toggle('collapsed', ingredientsCollapsed);
                ingredientsHeader.setAttribute('aria-expanded', (!ingredientsCollapsed).toString());
            });
        }
        // Apply initial collapsed state
        ingredientsPanel.classList.toggle('collapsed', ingredientsCollapsed);
    menuModalClose.addEventListener('click', closeMenuModal);
    menuModal.addEventListener('click', (e) => {
        if (e.target === menuModal) {
            closeMenuModal();
        }
    });
}

// ===== Ingredients Functions =====
function addIngredient(product) {
    const exists = selectedIngredients.find(i => i.id === product.id);
    if (exists) {
        removeIngredient(product.id);
        return;
    }

    selectedIngredients.push({
        id: product.id,
        name: product.display_name,
        thumbnail: product.thumbnail
    });

    updateIngredientsUI();
    showIngredientsPanel();
    // Auto-collapse to icon after adding to avoid covering UI
    ingredientsCollapsed = true;
    ingredientsPanel.classList.add('collapsed');
    ingredientsToggle.classList.add('hidden');
}

function removeIngredient(productId) {
    selectedIngredients = selectedIngredients.filter(i => i.id !== productId);
    updateIngredientsUI();
    // If no ingredients left, expand panel back to normal and show toggle
    if (selectedIngredients.length === 0) {
        ingredientsCollapsed = false;
        ingredientsPanel.classList.remove('collapsed');
        ingredientsToggle.classList.remove('hidden');
    }
}

function clearAllIngredients() {
    selectedIngredients = [];
    updateIngredientsUI();
    // Reset collapsed state and show toggle
    ingredientsCollapsed = false;
    ingredientsPanel.classList.remove('collapsed');
    ingredientsToggle.classList.remove('hidden');
}

function isIngredientSelected(productId) {
    return selectedIngredients.some(i => i.id === productId);
}

function updateIngredientsUI() {
    const count = selectedIngredients.length;
    ingredientsCount.textContent = count;
    toggleCount.textContent = count;

    if (count === 0) {
        toggleCount.classList.add('hidden');
        ingredientsList.innerHTML = '<p class="empty-ingredients">Haz clic en "+ Añadir" en los productos para agregar ingredientes</p>';
        generateMenu.disabled = true;
    } else {
        toggleCount.classList.remove('hidden');
        generateMenu.disabled = false;
        
        ingredientsList.innerHTML = selectedIngredients.map(ingredient => `
            <div class="ingredient-item">
                <div class="ingredient-info">
                    <img src="${ingredient.thumbnail || 'https://via.placeholder.com/40'}" alt="${ingredient.name}" onerror="this.src='https://via.placeholder.com/40'">
                    <span class="ingredient-name">${ingredient.name}</span>
                </div>
                <button class="ingredient-remove" onclick="removeIngredient('${ingredient.id}')">&times;</button>
            </div>
        `).join('');
        
            // Collapsed icons (for compact view) - show up to 5 thumbnails
            if (ingredientsCollapsedIcons) {
                const maxThumbs = 3;
                const thumbs = selectedIngredients.slice(0, maxThumbs).map(ing => `
                    <img src="${ing.thumbnail || 'https://via.placeholder.com/40'}" title="${ing.name}" alt="${ing.name}" onerror="this.src='https://via.placeholder.com/40'"/>
                `).join('');
                const remaining = Math.max(0, selectedIngredients.length - maxThumbs);
                const extra = remaining > 0 ? `<div class="ingredients-extra">+${remaining}</div>` : '';
                ingredientsCollapsedIcons.innerHTML = `<div class="thumbs-row">${thumbs}</div>${extra}`;
            }
    }

    // Update add buttons in product cards
    document.querySelectorAll('.btn-add-ingredient').forEach(btn => {
        const productId = btn.dataset.productId;
        if (isIngredientSelected(productId)) {
            btn.textContent = '✓ Añadido';
            btn.classList.add('added');
        } else {
            btn.textContent = '+ Añadir';
            btn.classList.remove('added');
        }
    });
}

function toggleIngredientsPanel() {
    ingredientsPanel.classList.toggle('active');
    ingredientsToggle.classList.toggle('hidden');
}

function showIngredientsPanel() {
    ingredientsPanel.classList.add('active');
    ingredientsToggle.classList.add('hidden');
    // when showing explicitly, expand the panel
    ingredientsCollapsed = false;
    ingredientsPanel.classList.remove('collapsed');
}

function hideIngredientsPanel() {
    ingredientsPanel.classList.remove('active');
    ingredientsToggle.classList.remove('hidden');
}

// ===== Menu Generation =====
async function generateMenuRequest() {
    if (selectedIngredients.length === 0) return;

    menuModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    menuLoading.style.display = 'block';
    menuContent.innerHTML = '';

    const ingredientNames = selectedIngredients.map(i => i.name).join(', ');

    try {
        const response = await fetch(MENU_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ingredients: ingredientNames
            })
        });

        if (!response.ok) {
            throw new Error('Error generating menu');
        }

        const data = await response.json();
        currentMenuData = { recipes: data.recipes, ingredients: ingredientNames };
        menuLoading.style.display = 'none';
        renderMenu(data, ingredientNames);

    } catch (error) {
        console.error('Error generating menu:', error);
        menuLoading.style.display = 'none';
        menuContent.innerHTML = `
            <div class="menu-error">
                <h3>❌ Error al generar el menú</h3>
                <p>No se pudo generar el menú en este momento. Por favor, inténtalo de nuevo más tarde.</p>
                <p style="margin-top: 10px; font-size: 0.85rem;">Si el problema persiste, revisa la configuración del servidor.</p>
            </div>
        `;
    }
}

function renderMenu(data, ingredientNames, fromTicket = false) {
    console.log('🍽️ renderMenu llamado con:', data);
    const recipes = data.recipes || [];
    console.log('📋 Recetas encontradas:', recipes.length, recipes);
    
    if (recipes.length === 0) {
        menuContent.innerHTML = `
            <div class="menu-error">
                <h3>🍳 No se encontraron recetas</h3>
                <p>Intenta con otros ingredientes</p>
            </div>
        `;
        return;
    }

    const ingredientTags = ingredientNames.split(', ').map(name => 
        `<span class="menu-ingredient-tag">${name}</span>`
    ).join('');

    const switchButton = fromTicket && parsedTicketText ? `
        <button class="btn-switch-option" onclick="generateAlternativeFromTicket('weekly')">
            📅 Cambiar a Menú Semanal
        </button>
    ` : '';

    // Guardar recetas para poder guardarlas individualmente
    window.currentRecipes = recipes;
    window.currentIngredientsUsed = ingredientNames;

    menuContent.innerHTML = `
        <div class="menu-header">
            <h2>🍽️ Tu Menú Personalizado</h2>
            <p>Recetas basadas en tus ingredientes:</p>
            <div class="menu-ingredients-used">${ingredientTags}</div>
            <div class="menu-actions">
                ${switchButton}
            </div>
        </div>
        ${recipes.map((recipe, index) => `
            <div class="recipe-card" data-recipe-index="${index}">
                <div class="recipe-header">
                    <span class="recipe-number">${index + 1}</span>
                    <h3 class="recipe-title">${recipe.name}</h3>
                    <button class="btn-save-recipe ${isRecipeFavorited(recipe.name) ? 'saved' : ''}" 
                            onclick="toggleRecipeFavorite(${index})" 
                            title="Guardar receta">
                        ${isRecipeFavorited(recipe.name) ? '⭐' : '☆'}
                    </button>
                </div>
                <div class="recipe-meta">
                    <span>⏱️ ${recipe.time || 'N/A'}</span>
                    <span>📊 ${recipe.difficulty || 'N/A'}</span>
                    <span>👥 ${recipe.servings || 'N/A'}</span>
                </div>
                <div class="recipe-section">
                    <h4>📝 Ingredientes</h4>
                    <ul>
                        ${recipe.ingredients.map(ing => `<li>${ing}</li>`).join('')}
                    </ul>
                </div>
                <div class="recipe-section">
                    <h4>👨‍🍳 Preparación</h4>
                    <ul class="recipe-steps">
                        ${recipe.steps.map(step => `<li>${step}</li>`).join('')}
                    </ul>
                </div>
            </div>
        `).join('')}
    `;
}

function closeMenuModal() {
    menuModal.classList.remove('active');
    document.body.style.overflow = '';
}

// ===== Favorites Functions =====
let currentMenuData = null;

// Verificar si una receta ya está en favoritos
function isRecipeFavorited(recipeName) {
    return favoriteMenus.some(m => m.recipes && m.recipes.some(r => r.name === recipeName));
}

// Guardar/quitar receta individual de favoritos
function toggleRecipeFavorite(recipeIndex) {
    const recipes = window.currentRecipes;
    if (!recipes || !recipes[recipeIndex]) return;
    
    const recipe = recipes[recipeIndex];
    const existingIndex = favoriteMenus.findIndex(m => 
        m.recipes && m.recipes.length === 1 && m.recipes[0].name === recipe.name
    );
    
    const button = document.querySelector(`.recipe-card[data-recipe-index="${recipeIndex}"] .btn-save-recipe`);
    
    if (existingIndex !== -1) {
        // Quitar de favoritos
        favoriteMenus.splice(existingIndex, 1);
        if (button) {
            button.classList.remove('saved');
            button.textContent = '☆';
        }
        showNotification('Receta eliminada de favoritos');
    } else {
        // Añadir a favoritos
        const recipeToSave = {
            id: Date.now(),
            ingredients: window.currentIngredientsUsed || '',
            recipes: [recipe],
            date: new Date().toLocaleDateString('es-ES'),
            isSingleRecipe: true
        };
        favoriteMenus.push(recipeToSave);
        if (button) {
            button.classList.add('saved');
            button.textContent = '⭐';
        }
        showNotification('✅ Receta guardada en favoritos');
    }
    
    localStorage.setItem('favoriteMenus', JSON.stringify(favoriteMenus));
    updateFavoritesCount();
}

function saveMenuToFavorites() {
    if (!currentMenuData) return;
    
    const menuId = Date.now();
    const menuToSave = {
        id: menuId,
        ingredients: currentMenuData.ingredients,
        recipes: currentMenuData.recipes,
        date: new Date().toLocaleDateString('es-ES')
    };
    
    const exists = favoriteMenus.find(m => 
        m.ingredients === menuToSave.ingredients
    );
    
    if (exists) {
        showNotification('Este menú ya está en favoritos');
        return;
    }
    
    favoriteMenus.push(menuToSave);
    localStorage.setItem('favoriteMenus', JSON.stringify(favoriteMenus));
    updateFavoritesCount();
    showNotification('✅ Menú guardado en favoritos');
}

function removeFavoriteMenu(menuId) {
    favoriteMenus = favoriteMenus.filter(m => m.id !== menuId);
    localStorage.setItem('favoriteMenus', JSON.stringify(favoriteMenus));
    updateFavoritesCount();
    renderFavorites();
}

function updateFavoritesCount() {
    const count = favoriteMenus.length;
    const favoritesCountEl = document.getElementById('favoritesCount');
    if (favoritesCountEl) {
        favoritesCountEl.textContent = count;
        favoritesCountEl.style.display = count > 0 ? 'flex' : 'none';
    }
}

function showFavoritesModal() {
    const favoritesModal = document.getElementById('favoritesModal');
    favoritesModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    renderFavorites();
}

function closeFavoritesModal() {
    const favoritesModal = document.getElementById('favoritesModal');
    favoritesModal.classList.remove('active');
    document.body.style.overflow = '';
}

function renderFavorites() {
    const favoritesContent = document.getElementById('favoritesContent');
    
    if (favoriteMenus.length === 0) {
        favoritesContent.innerHTML = `
            <div class="favorites-empty">
                <div class="empty-icon">⭐</div>
                <h3>No tienes menús favoritos</h3>
                <p>Genera un menú personalizado y guárdalo aquí.</p>
            </div>
        `;
        return;
    }

    favoritesContent.innerHTML = favoriteMenus.map(menu => `
        <div class="favorite-menu-card">
            <div class="favorite-menu-info">
                <h3>Menú del ${menu.date}</h3>
                <p>${menu.recipes.length} recetas</p>
                <div class="favorite-ingredients">
                    ${menu.ingredients.split(', ').slice(0, 3).map(i => `<span>${i}</span>`).join('')}
                    ${menu.ingredients.split(', ').length > 3 ? `<span>+${menu.ingredients.split(', ').length - 3} más</span>` : ''}
                </div>
            </div>
            <div class="favorite-menu-actions">
                <button class="btn-view-favorite" onclick="viewFavoriteMenu(${menu.id})">👁️ Ver</button>
                <button class="btn-remove-favorite" onclick="removeFavoriteMenu(${menu.id})">🗑️</button>
            </div>
        </div>
    `).join('');
}

function viewFavoriteMenu(menuId) {
    const menu = favoriteMenus.find(m => m.id === menuId);
    if (!menu) return;
    
    closeFavoritesModal();
    currentMenuData = { recipes: menu.recipes, ingredients: menu.ingredients };
    menuModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    menuLoading.style.display = 'none';
    renderMenu({ recipes: menu.recipes }, menu.ingredients);
}

function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => notification.classList.add('show'), 100);
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 2500);
}

// ===== Ticket Upload Functions =====
let ticketFile = null;
let ticketOption = 'products'; // PDF uploads only parse/find products now
let parsedTicketText = null; // Texto extraído del PDF para reutilizar

function showTicketModal() {
    document.getElementById('ticketModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    setupTicketDragDrop();
}

function closeTicketModal() {
    document.getElementById('ticketModal').classList.remove('active');
    document.body.style.overflow = '';
    resetTicketForm();
}

function setupTicketDragDrop() {
    const uploadArea = document.getElementById('ticketUploadArea');
    const fileInput = document.getElementById('ticketFileInput');
    
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (!files || files.length === 0) {
            showNotification('No se detectó ningún archivo');
            return;
        }
        if (files.length > 1) {
            showNotification('Solo puedes adjuntar un archivo');
            return;
        }
        const file = files[0];
        const maxSize = 5 * 1024 * 1024; // 5 MB
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            showNotification('Solo se permiten archivos PDF');
            return;
        }
        if (file.size > maxSize) {
            showNotification('El archivo supera el límite de 5 MB');
            return;
        }
        handleTicketFile(file);
    });
    
    fileInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        if (files.length > 1) {
            showNotification('Solo puedes adjuntar un archivo');
            fileInput.value = '';
            return;
        }
        const file = files[0];
        const maxSize = 5 * 1024 * 1024; // 5 MB
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            showNotification('Solo se permiten archivos PDF');
            fileInput.value = '';
            return;
        }
        if (file.size > maxSize) {
            showNotification('El archivo supera el límite de 5 MB');
            fileInput.value = '';
            return;
        }
        handleTicketFile(file);
    });
}

function handleTicketFile(file) {
    ticketFile = file;
    document.getElementById('ticketUploadArea').classList.add('hidden');
    document.getElementById('ticketFileInfo').classList.remove('hidden');
    document.getElementById('ticketFileName').textContent = file.name;
    updateProcessButton();
}

function removeTicketFile() {
    ticketFile = null;
    document.getElementById('ticketUploadArea').classList.remove('hidden');
    document.getElementById('ticketFileInfo').classList.add('hidden');
    document.getElementById('ticketFileInput').value = '';
    updateProcessButton();
}

function selectTicketOption(option) {
    // Deprecated: options other than 'products' were removed.
    ticketOption = 'products';
    const btn = document.getElementById('btnFindProducts');
    if (btn) btn.classList.add('selected');
    updateProcessButton();
}

function updateProcessButton() {
    const btn = document.getElementById('processTicketBtn');
    // Enable if a file is selected (we only support product matching from PDF uploads)
    btn.disabled = !ticketFile;
}

function resetTicketForm() {
    ticketFile = null;
    ticketOption = 'products';
    parsedTicketText = null;
    document.getElementById('ticketUploadArea').classList.remove('hidden');
    document.getElementById('ticketFileInfo').classList.add('hidden');
    document.getElementById('ticketFileInput').value = '';
    document.querySelectorAll('.btn-option').forEach(btn => btn.classList.remove('selected'));
    updateProcessButton();
}

async function processTicket() {
    if (!ticketFile) return;

    const currentFile = ticketFile;
    const formData = new FormData();
    formData.append('ticket', currentFile);

    closeTicketModal();

    // Mostrar modal de carga
    menuModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    menuLoading.style.display = 'block';
    menuContent.innerHTML = '';

    try {
        // Always use the products matching endpoint for uploaded PDFs
        const response = await fetch('/api/find-ticket-products', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            let errText = await response.text().catch(() => '');
            try { errText = JSON.parse(errText).error || errText; } catch (e) {}
            throw new Error('Error finding products: ' + (errText || response.status));
        }

        const data = await response.json();
        menuLoading.style.display = 'none';
        // Render the confirmation UI where user can map/confirm products
        renderTicketProducts(data);

    } catch (error) {
        console.error('Error processing ticket:', error);
        menuLoading.style.display = 'none';
        const message = (error && error.message) ? error.message : 'No se pudo leer el ticket. Asegúrate de que sea un PDF válido.';
        menuContent.innerHTML = `
            <div class="menu-error">
                <h3>❌ Error al procesar el ticket</h3>
                <p>${message}</p>
            </div>
        `;
    }
}

// Generar el otro tipo de menú usando el texto ya parseado
async function generateAlternativeFromTicket(newOption) {
    if (!parsedTicketText) {
        showNotification('No hay ticket procesado');
        return;
    }
    
    menuLoading.style.display = 'block';
    menuContent.innerHTML = '';
    
    try {
        const response = await fetch('/generar-desde-texto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ticketText: parsedTicketText,
                option: newOption
            })
        });
        
        if (!response.ok) {
            throw new Error('Error generating menu');
        }
        
        const data = await response.json();
        menuLoading.style.display = 'none';
        
        // Detectar automáticamente el tipo de respuesta
        if (data.weeklyMenu) {
            renderWeeklyMenu(data, true);
        } else if (data.recipes) {
            currentMenuData = { recipes: data.recipes, ingredients: data.ingredients, fromTicket: true };
            renderMenu(data, data.ingredients, true);
        } else {
            console.error('❌ Respuesta no reconocida:', data);
            menuContent.innerHTML = `
                <div class="menu-error">
                    <h3>❌ Error</h3>
                    <p>La respuesta del servidor no contiene recetas ni menú.</p>
                </div>
            `;
        }
        
    } catch (error) {
        console.error('Error:', error);
        menuLoading.style.display = 'none';
        menuContent.innerHTML = `
            <div class="menu-error">
                <h3>❌ Error al generar</h3>
                <p>No se pudo generar el menú. Inténtalo de nuevo.</p>
            </div>
        `;
    }
}

// Variables para el flujo de confirmación de ticket
let pendingTicketData = null;
let confirmedProducts = [];

// Renderizar productos encontrados del ticket - MODO CONFIRMACIÓN
function renderTicketProducts(data) {
    const products = data.products || [];
    const ingredients = data.ingredients || [];
    const ticketInfo = data.ticketInfo || {};
    
    // Guardar datos pendientes para confirmar
    pendingTicketData = {
        ticketInfo,
        ingredients,
        originalProducts: products
    };
    confirmedProducts = [];
    
    // Agrupar productos por ingrediente detectado
    const ingredientMatches = {};
    for (const ingredient of ingredients) {
        ingredientMatches[ingredient.name] = products.filter(p => p.matchedIngredient === ingredient.name);
    }
    
    // Ingredientes sin match
    const unmatchedIngredients = ingredients.filter(ing => !ingredientMatches[ing.name] || ingredientMatches[ing.name].length === 0);
    const matchedIngredients = ingredients.filter(ing => ingredientMatches[ing.name] && ingredientMatches[ing.name].length > 0);
    
    menuContent.innerHTML = `
        <div class="ticket-confirm-header">
            <h2>🧾 Confirmar Productos del Ticket</h2>
            <p>Revisa y confirma los productos detectados. Puedes buscar alternativas si la asociación no es correcta.</p>
            <div class="ticket-info-bar">
                <span>📅 Fecha: <strong>${ticketInfo.date || 'No detectada'}</strong></span>
                <span>💰 Total detectado: <strong>${ticketInfo.total ? formatPrice(ticketInfo.total) : 'No detectado'}</strong></span>
                <span>📦 Ingredientes: <strong>${ingredients.length}</strong></span>
            </div>
        </div>
        
        <div class="ticket-confirm-list" id="ticketConfirmList">
            ${matchedIngredients.map((ingredient, index) => {
                const matches = ingredientMatches[ingredient.name] || [];
                const topMatch = matches[0];
                return `
                    <div class="ticket-confirm-item" data-ingredient="${ingredient.name}" data-index="${index}">
                        <div class="confirm-item-header">
                            <span class="ingredient-label">📌 Del ticket:</span>
                            <span class="ingredient-name">${ingredient.name}${ingredient.price ? ` <small>(${formatPrice(ingredient.price)})</small>` : ''}</span>
                            <span class="match-status ${topMatch ? 'matched' : 'unmatched'}">
                                ${topMatch ? (topMatch.hasPriceMatch ? '💰✓ Precio coincide' : '✓ Asociado') : '✗ Sin asociar'}
                            </span>
                        </div>
                        <div class="confirm-item-body">
                            <div class="matched-product" id="matchedProduct${index}">
                                ${topMatch ? `
                                    <img src="${topMatch.thumbnail || 'https://via.placeholder.com/60'}" alt="${topMatch.display_name}" onerror="this.src='https://via.placeholder.com/60'">
                                    <div class="product-info">
                                        <div class="product-name">${topMatch.display_name}</div>
                                        <div class="product-category">${topMatch.categoryL2 || ''}</div>
                                        <div class="product-price">${topMatch.unit_price ? formatPrice(topMatch.unit_price) : 'N/A'}</div>
                                    </div>
                                    ${topMatch.suggestions ? `
                                    <div class="product-suggestions">
                                        <small>Sugerencias (precio no coincide):</small>
                                        <div class="suggestion-list">
                                            ${topMatch.suggestions.map(s => `
                                                <div class="suggestion-item" onclick='selectProductForTicket(${index}, ${JSON.stringify(s).replace(/'/g, "&#39;")})'>
                                                    <img src="${s.thumbnail || 'https://via.placeholder.com/40'}" onerror="this.src='https://via.placeholder.com/40'">
                                                    <span>${s.display_name} — ${s.unit_price ? formatPrice(s.unit_price) : 'N/A'}</span>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                    ` : ''}
                                    <input type="hidden" class="selected-product-id" value="${topMatch.id}">
                                    <input type="hidden" class="selected-product-name" value="${topMatch.display_name}">
                                    <input type="hidden" class="selected-product-price" value="${topMatch.unit_price || 0}">
                                    <input type="hidden" class="selected-product-category" value="${topMatch.categoryL2 || 'Sin categoría'}">
                                ` : `
                                    <div class="no-match">
                                        <span>❓</span>
                                        <span>No se encontró producto</span>
                                    </div>
                                `}
                            </div>
                            <div class="confirm-item-actions">
                                <button class="btn-change-product" onclick="showProductSearch(${index}, '${ingredient.name.replace(/'/g, "\\'")}')">
                                    🔍 Buscar otro
                                </button>
                                <button class="btn-skip-product" onclick="skipProduct(${index})">
                                    ❌ Omitir
                                </button>
                            </div>
                        </div>
                        <div class="product-search-container hidden" id="productSearch${index}">
                            <input type="text" class="product-search-input" placeholder="Buscar producto..." 
                                oninput="searchProductForTicket(this.value, ${index})" value="${ingredient.name}">
                            <div class="product-search-results" id="searchResults${index}"></div>
                        </div>
                    </div>
                `;
            }).join('')}
            
            ${unmatchedIngredients.length > 0 ? `
                <div class="unmatched-section">
                    <h4>⚠️ Ingredientes sin asociar (${unmatchedIngredients.length})</h4>
                    ${unmatchedIngredients.map((ingredient, i) => {
                        const index = matchedIngredients.length + i;
                        return `
                            <div class="ticket-confirm-item unmatched" data-ingredient="${ingredient.name}" data-index="${index}">
                                <div class="confirm-item-header">
                                    <span class="ingredient-label">📌 Del ticket:</span>
                                    <span class="ingredient-name">${ingredient.name}${ingredient.price ? ` <small>(${formatPrice(ingredient.price)})</small>` : ''}</span>
                                    <button class="btn-search-small" onclick="showProductSearch(${index}, '${ingredient.name.replace(/'/g, "\\'")}')">
                                        🔍 Buscar
                                    </button>
                                </div>
                                <div class="matched-product hidden" id="matchedProduct${index}"></div>
                                <div class="product-search-container hidden" id="productSearch${index}">
                                    <input type="text" class="product-search-input" placeholder="Buscar producto..." 
                                           oninput="searchProductForTicket(this.value, ${index})" value="${ingredient.name}">
                                    <div class="product-search-results" id="searchResults${index}"></div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : ''}
        </div>
        
        <div class="ticket-confirm-actions">
            <button class="btn-cancel-ticket" onclick="closeMenuModal()">
                ❌ Cancelar
            </button>
            <button class="btn-confirm-ticket" onclick="confirmAndSaveTicket()">
                ✅ Confirmar y Guardar Ticket
            </button>
        </div>
    `;
}

function showProductSearch(index, ingredient) {
    const searchContainer = document.getElementById(`productSearch${index}`);
    searchContainer.classList.toggle('hidden');
    
    if (!searchContainer.classList.contains('hidden')) {
        const input = searchContainer.querySelector('.product-search-input');
        input.focus();
        // Trigger initial search
        searchProductForTicket(ingredient, index);
    }
}

let ticketSearchTimeout = null;
async function searchProductForTicket(query, index) {
    if (ticketSearchTimeout) clearTimeout(ticketSearchTimeout);
    
    const resultsContainer = document.getElementById(`searchResults${index}`);
    
    if (query.length < 2) {
        resultsContainer.innerHTML = '<p class="search-hint">Escribe al menos 2 caracteres</p>';
        return;
    }
    
    resultsContainer.innerHTML = '<p class="searching">Buscando...</p>';
    
    ticketSearchTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`/api/search?query=${encodeURIComponent(query)}`);
            const data = await response.json();
            const results = data.results || [];
            
            if (results.length === 0) {
                resultsContainer.innerHTML = '<p class="no-results">No se encontraron productos</p>';
                return;
            }
            
            resultsContainer.innerHTML = results.slice(0, 8).map(product => `
                <div class="search-result-item" onclick="selectProductForTicket(${index}, ${JSON.stringify(product).replace(/"/g, '&quot;')})">
                    <img src="${product.thumbnail || 'https://via.placeholder.com/40'}" alt="${product.display_name}" onerror="this.src='https://via.placeholder.com/40'">
                    <div class="result-info">
                        <div class="result-name">${product.display_name}</div>
                        <div class="result-price">${product.price_instructions?.unit_price ? formatPrice(product.price_instructions.unit_price) : 'N/A'}</div>
                    </div>
                </div>
            `).join('');
        } catch (e) {
            console.error('Error searching products:', e);
            resultsContainer.innerHTML = '<p class="search-error">Error al buscar</p>';
        }
    }, 300);
}

function selectProductForTicket(index, product) {
    const matchedProductDiv = document.getElementById(`matchedProduct${index}`);
    const searchContainer = document.getElementById(`productSearch${index}`);
    const itemDiv = document.querySelector(`.ticket-confirm-item[data-index="${index}"]`);
    
    const price = product.price_instructions?.unit_price || product.unit_price || 0;
    const category = product.categoryL2 || product.price_instructions?.categoryL2 || 'Sin categoría';
    
    matchedProductDiv.innerHTML = `
        <img src="${product.thumbnail || 'https://via.placeholder.com/60'}" alt="${product.display_name}" onerror="this.src='https://via.placeholder.com/60'">
        <div class="product-info">
            <div class="product-name">${product.display_name}</div>
            <div class="product-category">${category}</div>
            <div class="product-price">${formatPrice(price)}</div>
        </div>
        <input type="hidden" class="selected-product-id" value="${product.id}">
        <input type="hidden" class="selected-product-name" value="${product.display_name}">
        <input type="hidden" class="selected-product-price" value="${price}">
        <input type="hidden" class="selected-product-category" value="${category}">
    `;
    
    matchedProductDiv.classList.remove('hidden');
    searchContainer.classList.add('hidden');
    
    // Update status
    const statusSpan = itemDiv.querySelector('.match-status');
    if (statusSpan) {
        statusSpan.className = 'match-status matched';
        statusSpan.textContent = '✓ Asociado';
    }
    
    itemDiv.classList.remove('unmatched');
    itemDiv.classList.add('confirmed');
    
    showNotification(`✅ Producto seleccionado: ${product.display_name}`);
}

function skipProduct(index) {
    const itemDiv = document.querySelector(`.ticket-confirm-item[data-index="${index}"]`);
    const matchedProductDiv = document.getElementById(`matchedProduct${index}`);
    
    matchedProductDiv.innerHTML = `
        <div class="no-match skipped">
            <span>⏭️</span>
            <span>Omitido</span>
        </div>
    `;
    
    const statusSpan = itemDiv.querySelector('.match-status');
    if (statusSpan) {
        statusSpan.className = 'match-status skipped';
        statusSpan.textContent = '⏭️ Omitido';
    }
    
    itemDiv.classList.add('skipped');
}

function confirmAndSaveTicket() {
    // Collect all confirmed products
    const items = document.querySelectorAll('.ticket-confirm-item:not(.skipped)');
    const products = [];
    
    items.forEach(item => {
        const productId = item.querySelector('.selected-product-id');
        const productName = item.querySelector('.selected-product-name');
        const productPrice = item.querySelector('.selected-product-price');
        const productCategory = item.querySelector('.selected-product-category');
        
        if (productId && productName) {
            products.push({
                id: productId.value,
                name: productName.value,
                price: parseFloat(productPrice?.value || 0),
                category: productCategory?.value || 'Sin categoría'
            });
        }
    });
    
    if (products.length === 0) {
        showNotification('⚠️ No hay productos para guardar');
        return;
    }
    
    // Calculate total from confirmed products
    const total = products.reduce((sum, p) => sum + p.price, 0);
    
    const ticketData = {
        date: pendingTicketData?.ticketInfo?.date || new Date().toISOString().split('T')[0],
        total: pendingTicketData?.ticketInfo?.total || total,
        products: products
    };
    
    if (currentUser) {
        saveTicketToHistory(ticketData);
        showNotification(`✅ Ticket guardado con ${products.length} productos`);
        
        // Save product associations for future automatic matching
        saveProductAssociations(products);
    } else {
        showNotification('⚠️ Inicia sesión para guardar el ticket');
    }
    
    // Show final summary
    renderConfirmedTicketSummary(ticketData, products);
}

function renderConfirmedTicketSummary(ticketData, products) {
    const alreadyFavorites = products.filter(p => userFavoriteProducts.map(String).includes(String(p.id))).length;
    
    menuContent.innerHTML = `
        <div class="ticket-products-header">
            <h2>✅ Ticket Confirmado</h2>
            <p>Se han guardado los siguientes productos en tu historial</p>
            <div class="ticket-products-stats">
                <div class="stat-item">
                    <div class="stat-number">${products.length}</div>
                    <div class="stat-label">Productos guardados</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number">${formatPrice(ticketData.total)}</div>
                    <div class="stat-label">Total</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number">${alreadyFavorites}</div>
                    <div class="stat-label">Ya en favoritos</div>
                </div>
            </div>
        </div>
        
        <div class="ticket-products-grid">
            ${products.map(product => {
                const isFavorite = userFavoriteProducts.map(String).includes(String(product.id));
                // Find original product data for thumbnail
                const originalProduct = pendingTicketData?.originalProducts?.find(p => String(p.id) === String(product.id));
                return `
                    <div class="ticket-product-card" data-product-id="${product.id}">
                        <img src="${originalProduct?.thumbnail || 'https://via.placeholder.com/80'}" alt="${product.name}" onerror="this.src='https://via.placeholder.com/80'">
                        <h4>${product.name}</h4>
                        <div class="product-category-tag">${product.category}</div>
                        <div class="product-price">${formatPrice(product.price)}</div>
                        <button class="btn-add-favorite ${isFavorite ? 'added' : ''}" 
                                onclick="toggleTicketProductFavorite('${product.id}', this)">
                            ${isFavorite ? '✅ En favoritos' : '❤️ Añadir a favoritos'}
                        </button>
                    </div>
                `;
            }).join('')}
        </div>
        
        <div class="ticket-products-actions">
            <button class="btn-add-all-favorites" onclick="addAllConfirmedToFavorites()">
                ❤️ Añadir todos a favoritos
            </button>
            <button class="btn-view-profile" onclick="closeMenuModal(); showProfileModal();">
                👤 Ver en Mi Perfil
            </button>
        </div>
    `;
    
    // Save products for batch actions
    window.currentTicketProducts = products.map(p => {
        const original = pendingTicketData?.originalProducts?.find(op => String(op.id) === String(p.id));
        return original || { id: p.id, display_name: p.name, unit_price: p.price };
    });
}

async function saveProductAssociations(products) {
    try {
        // Categorías que NO son de comida
        const nonFoodCategories = [
            'Bebé',
            'Cuidado del cabello',
            'Cuidado facial y corporal', 
            'Fitoterapia y parafarmacia',
            'Limpieza y hogar',
            'Maquillaje',
            'Mascotas'
        ];
        
        // Collect associations from the confirmation UI
        const associations = [];
        const items = document.querySelectorAll('.ticket-confirm-item:not(.skipped)');
        
        items.forEach(item => {
            const ingredient = item.dataset.ingredient;
            const productId = item.querySelector('.selected-product-id')?.value;
            const productCategory = item.querySelector('.selected-product-category')?.value;
            
            if (ingredient && productId && productCategory && !nonFoodCategories.includes(productCategory)) {
                associations.push({
                    ticketItem: ingredient,
                    productId: productId
                });
            }
        });
        
        if (associations.length === 0) return;
        
        // Send to server
        const response = await fetch('/api/save-product-associations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ associations })
        });
        
        const result = await response.json();
        if (result.saved > 0) {
            console.log(`💾 Guardadas ${result.saved} asociaciones para matching futuro`);
        }
    } catch (error) {
        console.error('Error saving associations:', error);
    }
}

function addAllConfirmedToFavorites() {
    if (!currentUser) {
        showNotification('Inicia sesión para guardar favoritos');
        return;
    }
    
    const products = window.currentTicketProducts || [];
    products.forEach(async (product) => {
        if (!userFavoriteProducts.map(String).includes(String(product.id))) {
            try {
                await fetch('/api/user/favorites', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'X-User': currentUser
                    },
                    body: JSON.stringify({
                        productId: String(product.id),
                        action: 'add'
                    })
                });
                userFavoriteProducts.push(String(product.id));
            } catch (e) {
                console.error('Error adding favorite:', e);
            }
        }
    });
    
    updateUserFavoritesCount();
    showNotification(`✅ ${products.length} productos añadidos a favoritos`);
    
    // Update buttons
    document.querySelectorAll('.btn-add-favorite').forEach(btn => {
        btn.classList.add('added');
        btn.textContent = '✅ En favoritos';
    });
}

function closeMenuModal() {
    menuModal.classList.remove('active');
    document.body.style.overflow = '';
}

// Toggle favorito desde ticket products
async function toggleTicketProductFavorite(productId, button) {
    if (!currentUser) {
        showNotification('Inicia sesión para guardar favoritos');
        return;
    }
    
    // Convertir a string para comparar correctamente
    const productIdStr = String(productId);
    const isFavorite = userFavoriteProducts.map(String).includes(productIdStr);
    
    try {
        const response = await fetch('/api/user/favorites', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-User': currentUser
            },
            body: JSON.stringify({
                productId: productIdStr,
                action: isFavorite ? 'remove' : 'add'
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            userFavoriteProducts = data.favorites || [];
            
            if (isFavorite) {
                button.classList.remove('added');
                button.textContent = '❤️ Añadir a favoritos';
                showNotification('Eliminado de favoritos');
            } else {
                button.classList.add('added');
                button.textContent = '✅ En favoritos';
                showNotification('Añadido a favoritos');
            }
            
            updateFavoritesCount();
            updateUserFavoritesCount();
        }
    } catch (error) {
        console.error('Error:', error);
        showNotification('Error al actualizar favoritos');
    }
}

// Añadir todos los productos del ticket a favoritos
async function addAllTicketProductsToFavorites() {
    if (!currentUser) {
        showNotification('Inicia sesión para guardar favoritos');
        return;
    }
    
    const products = window.currentTicketProducts || [];
    if (products.length === 0) return;
    
    let added = 0;
    const currentFavoritesStr = userFavoriteProducts.map(String);
    
    for (const product of products) {
        const productIdStr = String(product.id);
        if (!currentFavoritesStr.includes(productIdStr)) {
            try {
                const response = await fetch('/api/user/favorites', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'X-User': currentUser
                    },
                    body: JSON.stringify({
                        productId: productIdStr,
                        action: 'add'
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    userFavoriteProducts = data.favorites || [];
                    added++;
                }
            } catch (error) {
                console.error('Error adding favorite:', error);
            }
        }
    }
    
    // Actualizar UI
    document.querySelectorAll('.ticket-product-card .btn-add-favorite').forEach(btn => {
        btn.classList.add('added');
        btn.textContent = '✅ En favoritos';
    });
    
    updateFavoritesCount();
    showNotification(`${added} productos añadidos a favoritos`);
}

// Añadir productos del ticket a la lista de compra
function addTicketProductsToShoppingList() {
    const products = window.currentTicketProducts || [];
    if (products.length === 0) return;
    
    let added = 0;
    
    for (const product of products) {
        const existingItem = shoppingList.find(item => item.id === product.id);
        if (!existingItem) {
            shoppingList.push({
                id: product.id,
                name: product.display_name,
                quantity: 1,
                checked: false,
                thumbnail: product.thumbnail
            });
            added++;
        }
    }
    
    saveShoppingList();
    showNotification(`${added} productos añadidos a la lista de compra`);
}

// Añadir un producto individual a la lista de compra
function addProductToShoppingList(productId, productName, thumbnail) {
    const existingItem = shoppingList.find(item => String(item.id) === String(productId));
    
    if (existingItem) {
        existingItem.quantity++;
        showNotification(`${productName} (x${existingItem.quantity})`);
    } else {
        shoppingList.push({
            id: productId,
            name: productName,
            quantity: 1,
            checked: false,
            thumbnail: thumbnail
        });
        showNotification(`📋 ${productName} añadido a la lista`);
    }
    
    saveShoppingList();
    updateShoppingListCount();
}

function renderWeeklyMenu(data, fromTicket = false) {
    const days = data.weeklyMenu || [];
    const ingredients = data.ingredients || '';
    
    if (days.length === 0) {
        menuContent.innerHTML = `
            <div class="menu-error">
                <h3>🍳 No se pudo generar el menú</h3>
                <p>Intenta con otro ticket</p>
            </div>
        `;
        return;
    }
    
    const dayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    const dayEmojis = ['📅', '📅', '📅', '📅', '📅', '🎉', '🌞'];
    
    const switchButton = fromTicket && parsedTicketText ? `
        <button class="btn-switch-option" onclick="generateAlternativeFromTicket('recipes')">
            🍳 Cambiar a Recetas Rápidas
        </button>
    ` : '';
    
    menuContent.innerHTML = `
        <div class="menu-header">
            <h2>📅 Tu Menú Semanal</h2>
            <p>Basado en tu ticket de compra</p>
            <div class="menu-actions">
                <button class="btn-save-menu" onclick="saveWeeklyMenuToFavorites()">⭐ Guardar en Favoritos</button>
                ${switchButton}
            </div>
        </div>
        <div class="weekly-menu">
            ${days.map((day, index) => `
                <div class="day-card">
                    <h3>${dayEmojis[index]} ${dayNames[index]}</h3>
                    <div class="day-meals">
                        <div class="meal-item">
                            <span class="meal-type">🌅 Desayuno</span>
                            <span class="meal-name">${day.breakfast || 'No definido'}</span>
                        </div>
                        <div class="meal-item">
                            <span class="meal-type">☀️ Comida</span>
                            <span class="meal-name">${day.lunch || 'No definido'}</span>
                        </div>
                        <div class="meal-item">
                            <span class="meal-type">🌙 Cena</span>
                            <span class="meal-name">${day.dinner || 'No definido'}</span>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    
    // Guardar para favoritos
    currentMenuData = { weeklyMenu: days, ingredients: ingredients, isWeekly: true, fromTicket: fromTicket };
}

function saveWeeklyMenuToFavorites() {
    if (!currentMenuData || !currentMenuData.isWeekly) return;
    
    const menuId = Date.now();
    const menuToSave = {
        id: menuId,
        ingredients: currentMenuData.ingredients,
        weeklyMenu: currentMenuData.weeklyMenu,
        isWeekly: true,
        date: new Date().toLocaleDateString('es-ES')
    };
    
    favoriteMenus.push(menuToSave);
    localStorage.setItem('favoriteMenus', JSON.stringify(favoriteMenus));
    updateFavoritesCount();
    showNotification('✅ Menú semanal guardado en favoritos');
}

// ===== Shopping List Functions =====

let isShoppingMode = false;
let sharedLists = [];

async function showShoppingListModal() {
    const modal = document.getElementById('shoppingListModal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Load user's list from server if logged in
    if (currentUser) {
        await loadUserShoppingList();
    }
    
    renderShoppingList();
    renderSharedLists();
    setupShoppingSearch();
}

function closeShoppingListModal() {
    const modal = document.getElementById('shoppingListModal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
    document.getElementById('shoppingSearchResults').classList.remove('active');
    document.getElementById('shareOptions').style.display = 'none';
    
    // Exit shopping mode when closing
    if (isShoppingMode) {
        exitShoppingMode();
    }
}

function setupShoppingSearch() {
    const searchInput = document.getElementById('shoppingListSearch');
    const searchResults = document.getElementById('shoppingSearchResults');
    
    searchInput.addEventListener('input', (e) => {
        clearTimeout(shoppingSearchTimeout);
        const query = e.target.value.trim();
        
        if (query.length < 2) {
            searchResults.classList.remove('active');
            return;
        }
        
        shoppingSearchTimeout = setTimeout(async () => {
            const results = await searchProductsForList(query);
            renderShoppingSearchResults(results);
        }, 300);
    });
    
    // Close search when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.shopping-list-search')) {
            searchResults.classList.remove('active');
        }
    });
}

async function searchProductsForList(query) {
    try {
        const response = await fetch(`/api/search?query=${encodeURIComponent(query)}`);
        if (!response.ok) return [];
        const data = await response.json();
        return data.results || [];
    } catch (error) {
        console.error('Error searching products:', error);
        return [];
    }
}

function renderShoppingSearchResults(products) {
    const container = document.getElementById('shoppingSearchResults');
    
    if (products.length === 0) {
        container.innerHTML = '<div class="search-result-item"><p>No se encontraron productos</p></div>';
        container.classList.add('active');
        return;
    }
    
    container.innerHTML = products.slice(0, 10).map(product => {
        const price = product.price_instructions?.unit_price || 0;
        const isWeight = product.price_instructions?.selling_method === 2;
        const inList = shoppingList.some(item => item.id === product.id);
        
        return `
            <div class="search-result-item ${inList ? 'added' : ''}" onclick="addToShoppingList(${JSON.stringify(product).replace(/"/g, '&quot;')})">
                <img src="${product.thumbnail || 'https://via.placeholder.com/45'}" alt="${product.display_name}" 
                     onerror="this.src='https://via.placeholder.com/45'">
                <div class="search-result-info">
                    <h4>${product.display_name}</h4>
                    <span>${product.packaging || ''} ${isWeight ? '(peso aprox.)' : ''}</span>
                </div>
                <span class="search-result-price">${formatPrice(price)}</span>
            </div>
        `;
    }).join('');
    
    container.classList.add('active');
}

function addToShoppingList(product) {
    const existingIndex = shoppingList.findIndex(item => item.id === product.id);
    
    if (existingIndex >= 0) {
        shoppingList[existingIndex].quantity += 1;
    } else {
        const priceInfo = product.price_instructions || {};
        shoppingList.push({
            id: product.id,
            name: product.display_name,
            thumbnail: product.thumbnail,
            packaging: product.packaging,
            price: priceInfo.unit_price || 0,
            bulkPrice: priceInfo.bulk_price || null,
            isWeight: priceInfo.selling_method === 2,
            sizeFormat: priceInfo.size_format || '',
            quantity: 1
        });
    }
    
    saveShoppingList();
    renderShoppingList();
    updateShoppingListCount();
    showNotification(`${product.display_name} añadido a la lista`);
}

function removeFromShoppingList(productId) {
    shoppingList = shoppingList.filter(item => String(item.id) !== String(productId));
    saveShoppingList();
    renderShoppingList();
    updateShoppingListCount();
}

function updateShoppingItemQuantity(productId, delta) {
    const item = shoppingList.find(item => String(item.id) === String(productId));
    if (item) {
        item.quantity = Math.max(1, (parseInt(item.quantity) || 1) + delta);
        saveShoppingList();
        renderShoppingList();
    }
}

function renderShoppingList() {
    const container = document.getElementById('shoppingListContent');
    const totalEl = document.getElementById('shoppingListTotal');
    const noteEl = document.getElementById('shoppingListNote');
    const searchSection = document.getElementById('shoppingListSearchSection');
    const actionsEl = document.getElementById('shoppingListActions');
    const modeActionsEl = document.getElementById('shoppingModeActions');
    const subtitleEl = document.getElementById('shoppingListSubtitle');
    
    // Toggle UI based on mode
    if (isShoppingMode) {
        searchSection.style.display = 'none';
        actionsEl.style.display = 'none';
        modeActionsEl.style.display = 'flex';
        subtitleEl.textContent = '🛒 Modo compra: toca los productos para marcarlos';
    } else {
        searchSection.style.display = 'block';
        actionsEl.style.display = 'flex';
        modeActionsEl.style.display = 'none';
        subtitleEl.textContent = 'Añade productos y comparte tu lista';
    }
    
    if (shoppingList.length === 0) {
        container.innerHTML = `
            <div class="empty-shopping-list">
                <span>🛒</span>
                <p>Tu lista está vacía</p>
                <small>Busca productos arriba para añadirlos</small>
            </div>
        `;
        totalEl.textContent = '0,00 €';
        noteEl.style.display = 'none';
        return;
    }
    
    let total = 0;
    let hasWeightProducts = false;
    
    // Filter out checked items for total (they're "bought")
    const activeItems = shoppingList.filter(item => !item.checked);
    
    container.innerHTML = shoppingList.map(item => {
        if (!item.checked) {
            const itemPrice = parseFloat(item.price) || 0;
            const itemQty = parseInt(item.quantity) || 1;
            const itemTotal = itemPrice * itemQty;
            total += itemTotal;
        }
        if (item.isWeight) hasWeightProducts = true;
        
        const itemId = String(item.id).replace(/'/g, "\\'");
        
        if (isShoppingMode) {
            return `
                <div class="shopping-item shopping-mode ${item.checked ? 'checked' : ''}" 
                     onclick="toggleShoppingItem('${itemId}')">
                    <span class="check-indicator">${item.checked ? '✅' : '⬜'}</span>
                    <img src="${item.thumbnail || 'https://via.placeholder.com/50'}" alt="${item.name}"
                         onerror="this.src='https://via.placeholder.com/50'">
                    <div class="shopping-item-info">
                        <h4>${item.name}</h4>
                        <span class="item-details">${item.packaging || ''} × ${item.quantity}</span>
                    </div>
                    <span class="shopping-item-price">${formatPrice((parseFloat(item.price) || 0) * (parseInt(item.quantity) || 1))}</span>
                </div>
            `;
        } else {
            return `
                <div class="shopping-item">
                    <img src="${item.thumbnail || 'https://via.placeholder.com/50'}" alt="${item.name}"
                         onerror="this.src='https://via.placeholder.com/50'">
                    <div class="shopping-item-info">
                        <h4>${item.name}</h4>
                        <span class="item-details">${item.packaging || ''} - ${formatPrice(parseFloat(item.price) || 0)}/ud</span>
                        ${item.isWeight ? '<span class="item-weight-note">⚖️ Precio aproximado (producto al peso)</span>' : ''}
                    </div>
                    <div class="shopping-item-quantity">
                        <button onclick="updateShoppingItemQuantity('${itemId}', -1)">−</button>
                        <span>${item.quantity}</span>
                        <button onclick="updateShoppingItemQuantity('${itemId}', 1)">+</button>
                    </div>
                    <span class="shopping-item-price">${formatPrice((parseFloat(item.price) || 0) * (parseInt(item.quantity) || 1))}</span>
                    <button class="shopping-item-remove" onclick="removeFromShoppingList('${itemId}')">×</button>
                </div>
            `;
        }
    }).join('');
    
    totalEl.textContent = formatPrice(total);
    noteEl.style.display = hasWeightProducts ? 'inline' : 'none';
    noteEl.textContent = isShoppingMode ? `(${activeItems.length} pendientes)` : '(algunos productos son al peso)';
}

function clearShoppingList() {
    if (shoppingList.length === 0) return;
    
    if (confirm('¿Vaciar la lista de la compra?')) {
        shoppingList = [];
        saveShoppingList();
        renderShoppingList();
        updateShoppingListCount();
        showNotification('Lista vaciada');
    }
}

function shareShoppingList() {
    if (shoppingList.length === 0) {
        showNotification('La lista está vacía');
        return;
    }
    
    // Encode shopping list in base64 for URL
    const listData = shoppingList.map(item => ({
        id: item.id,
        name: item.name,
        thumbnail: item.thumbnail,
        packaging: item.packaging,
        price: item.price,
        isWeight: item.isWeight,
        quantity: item.quantity
    }));
    
    const encoded = btoa(encodeURIComponent(JSON.stringify(listData)));
    const shareUrl = `${window.location.origin}${window.location.pathname}?lista=${encoded}`;
    
    // Try to use Web Share API first
    if (navigator.share) {
        navigator.share({
            title: 'Mi Lista de la Compra - Mercadona',
            text: `Lista con ${shoppingList.length} productos (${document.getElementById('shoppingListTotal').textContent} aprox.)`,
            url: shareUrl
        }).catch(() => {
            copyShareLink(shareUrl);
        });
    } else {
        copyShareLink(shareUrl);
    }
}

function copyShareLink(url) {
    navigator.clipboard.writeText(url).then(() => {
        showNotification('¡Enlace copiado al portapapeles!');
    }).catch(() => {
        // Fallback: show in prompt
        prompt('Copia este enlace para compartir:', url);
    });
}

function loadSharedList() {
    const urlParams = new URLSearchParams(window.location.search);
    const listParam = urlParams.get('lista');
    
    if (listParam) {
        try {
            const decoded = JSON.parse(decodeURIComponent(atob(listParam)));
            if (Array.isArray(decoded) && decoded.length > 0) {
                shoppingList = decoded;
                saveShoppingList();
                updateShoppingListCount();
                
                // Clean URL
                window.history.replaceState({}, document.title, window.location.pathname);
                
                // Show the list
                setTimeout(() => {
                    showShoppingListModal();
                    showNotification(`Lista cargada con ${decoded.length} productos`);
                }, 500);
            }
        } catch (e) {
            console.error('Error loading shared list:', e);
        }
    }
}

function saveShoppingList() {
    localStorage.setItem('shoppingList', JSON.stringify(shoppingList));
    
    // Also save to server if logged in
    if (currentUser) {
        saveUserShoppingList();
    }
}

async function saveUserShoppingList() {
    try {
        await fetch('/api/user/shopping-list', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-User': currentUser
            },
            body: JSON.stringify({ shoppingList })
        });
    } catch (e) {
        console.error('Error saving shopping list to server:', e);
    }
}

async function loadUserShoppingList() {
    try {
        const response = await fetch('/api/user/shopping-list', {
            headers: { 'X-User': currentUser }
        });
        const data = await response.json();
        
        if (data.shoppingList) {
            shoppingList = data.shoppingList;
            localStorage.setItem('shoppingList', JSON.stringify(shoppingList));
        }
        
        if (data.sharedLists) {
            sharedLists = data.sharedLists;
        }
    } catch (e) {
        console.error('Error loading shopping list:', e);
    }
}

function updateShoppingListCount() {
    const countEl = document.getElementById('shoppingListCount');
    const total = shoppingList.reduce((sum, item) => sum + (item.checked ? 0 : item.quantity), 0);
    
    if (total > 0) {
        countEl.textContent = total;
        countEl.style.display = 'flex';
    } else {
        countEl.style.display = 'none';
    }
}

// ===== Shopping Mode (Voy a Comprar) =====

function startShoppingMode() {
    if (shoppingList.length === 0) {
        showNotification('Tu lista está vacía');
        return;
    }
    
    isShoppingMode = true;
    // Reset checked status
    shoppingList.forEach(item => item.checked = false);
    renderShoppingList();
    showNotification('🛒 Modo compra activado - Toca los productos para marcarlos');
}

function exitShoppingMode() {
    // Remove checked items (they were bought)
    const boughtItems = shoppingList.filter(item => item.checked);
    shoppingList = shoppingList.filter(item => !item.checked);
    
    isShoppingMode = false;
    saveShoppingList();
    renderShoppingList();
    updateShoppingListCount();
    
    if (boughtItems.length > 0) {
        showNotification(`✅ Compra terminada - ${boughtItems.length} productos comprados`);
    }
}

function toggleShoppingItem(productId) {
    const item = shoppingList.find(item => String(item.id) === String(productId));
    if (item) {
        item.checked = !item.checked;
        renderShoppingList();
    }
}

// ===== Share Functions =====

function showShareOptions() {
    const shareOptions = document.getElementById('shareOptions');
    shareOptions.style.display = shareOptions.style.display === 'none' ? 'block' : 'none';
}

async function shareToUser() {
    if (!currentUser) {
        showNotification('Debes iniciar sesión para compartir');
        showLoginModal();
        return;
    }
    
    const targetUser = document.getElementById('shareToUserInput').value.trim().toLowerCase();
    
    if (!targetUser) {
        showNotification('Ingresa el nombre del usuario');
        return;
    }
    
    if (targetUser === currentUser) {
        showNotification('No puedes compartir contigo mismo');
        return;
    }
    
    try {
        const response = await fetch('/api/user/share-list', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-User': currentUser
            },
            body: JSON.stringify({ targetUser })
        });
        
        const data = await response.json();
        
        if (data.error) {
            showNotification(data.error);
        } else {
            showNotification(`✅ Lista enviada a ${targetUser}`);
            document.getElementById('shareToUserInput').value = '';
            document.getElementById('shareOptions').style.display = 'none';
        }
    } catch (e) {
        console.error('Error sharing list:', e);
        showNotification('Error al compartir la lista');
    }
}

function renderSharedLists() {
    const section = document.getElementById('sharedListsSection');
    const container = document.getElementById('sharedListsContainer');
    
    if (!sharedLists || sharedLists.length === 0) {
        section.style.display = 'none';
        return;
    }
    
    section.style.display = 'block';
    
    container.innerHTML = sharedLists.map((list, index) => {
        const date = new Date(list.date).toLocaleDateString('es-ES');
        const itemCount = list.items.length;
        const total = list.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        return `
            <div class="shared-list-card">
                <div class="shared-list-info">
                    <h5>📨 De: ${list.from}</h5>
                    <span>${itemCount} productos - ${formatPrice(total)} | ${date}</span>
                </div>
                <div class="shared-list-actions">
                    <button class="btn-accept-list" onclick="mergeSharedList(${index})">✓ Añadir</button>
                    <button class="btn-dismiss-list" onclick="dismissSharedList(${index})">✕</button>
                </div>
            </div>
        `;
    }).join('');
}

async function mergeSharedList(listIndex) {
    try {
        const response = await fetch('/api/user/merge-shared-list', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-User': currentUser
            },
            body: JSON.stringify({ listIndex })
        });
        
        const data = await response.json();
        
        if (data.success) {
            shoppingList = data.shoppingList;
            sharedLists = data.sharedLists;
            localStorage.setItem('shoppingList', JSON.stringify(shoppingList));
            
            renderShoppingList();
            renderSharedLists();
            updateShoppingListCount();
            showNotification('✅ Lista añadida a tu compra');
        }
    } catch (e) {
        console.error('Error merging list:', e);
        showNotification('Error al añadir la lista');
    }
}

async function dismissSharedList(listIndex) {
    try {
        const response = await fetch('/api/user/dismiss-shared-list', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-User': currentUser
            },
            body: JSON.stringify({ listIndex })
        });
        
        const data = await response.json();
        
        if (data.success) {
            sharedLists = data.sharedLists;
            renderSharedLists();
        }
    } catch (e) {
        console.error('Error dismissing list:', e);
    }
}

// ===== User Login System =====

async function showLoginModal() {
    const modal = document.getElementById('loginModal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Load existing test users (exclude OAuth users)
    try {
        const response = await fetch('/api/users');
        const data = await response.json();
        
        if (data.users && data.users.length > 0) {
            // Filter out OAuth users (they start with 'google_')
            const testUsers = data.users.filter(user => !user.startsWith('google_'));
            
            if (testUsers.length > 0) {
                const existingUsers = document.getElementById('existingUsers');
                const usersList = document.getElementById('usersList');
                
                usersList.innerHTML = testUsers.map(user => 
                    `<button class="user-btn" onclick="quickLogin('${user}')">${user}</button>`
                ).join('');
                
                existingUsers.style.display = 'block';
            }
        }
    } catch (e) {
        console.error('Error loading users:', e);
    }
    
    document.getElementById('usernameInput').focus();
}

function closeLoginModal() {
    document.getElementById('loginModal').classList.remove('active');
    document.body.style.overflow = '';
    document.getElementById('usernameInput').value = '';
}

// ===== Google OAuth Functions =====

function loginWithGoogle() {
    // Redirect to OAuth endpoint
    window.location.href = '/auth/google';
}

async function checkOAuthSession() {
    try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();
        
        if (data.authenticated) {
            currentUser = data.userId;
            oauthUserInfo = data.userInfo;
            localStorage.setItem('currentUser', currentUser);
            
            // Load favorites
            await loadUserSession();
            updateUserUI();
            return true;
        }
    } catch (e) {
        console.error('Error checking OAuth session:', e);
    }
    return false;
}

async function logoutOAuth() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
        console.error('Error logging out:', e);
    }
    oauthUserInfo = null;
    logoutUser();
}

// ===== Test Login Functions =====

async function loginUser() {
    const username = document.getElementById('usernameInput').value.trim();
    if (!username || username.length < 2) {
        showNotification('El nombre debe tener al menos 2 caracteres');
        return;
    }
    
    await doLogin(username);
}

async function quickLogin(username) {
    await doLogin(username);
}

async function doLogin(username) {
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        
        const data = await response.json();
        
        if (data.error) {
            showNotification(data.error);
            return;
        }
        
        currentUser = data.username;
        localStorage.setItem('currentUser', currentUser);
        userFavoriteProducts = data.user.favoriteProducts || [];
        
        updateUserUI();
        closeLoginModal();
        showNotification(`¡Bienvenido, ${currentUser}!`);
        
        // Refresh products to show favorite buttons
        if (currentProducts.length > 0) {
            renderProducts(currentProducts);
        }
    } catch (e) {
        console.error('Login error:', e);
        showNotification('Error al iniciar sesión');
    }
}

function logoutUser() {
    // If OAuth user, also logout from server
    if (oauthUserInfo) {
        logoutOAuth();
        return;
    }
    
    currentUser = null;
    userFavoriteProducts = [];
    oauthUserInfo = null;
    localStorage.removeItem('currentUser');
    updateUserUI();
    showNotification('Sesión cerrada');
    
    // Refresh products to hide favorite buttons
    if (currentProducts.length > 0) {
        renderProducts(currentProducts);
    }
}

function updateUserUI() {
    const userInfo = document.getElementById('userInfo');
    const loginPrompt = document.getElementById('loginPrompt');
    const userFavoritesToggle = document.getElementById('userFavoritesToggle');
    const currentUserName = document.getElementById('currentUserName');
    const ticketToggle = document.getElementById('ticketToggle');
    const shoppingListToggle = document.getElementById('shoppingListToggle');
    const favoritesToggle = document.getElementById('favoritesToggle');
    
    if (currentUser) {
        userInfo.style.display = 'flex';
        loginPrompt.style.display = 'none';
        
        // Show OAuth user info with avatar if available
        if (oauthUserInfo && oauthUserInfo.picture) {
            currentUserName.innerHTML = `
                <span class="oauth-user-info">
                    <img src="${oauthUserInfo.picture}" alt="avatar" class="oauth-user-avatar">
                    <span>${oauthUserInfo.name || oauthUserInfo.email}</span>
                </span>
            `;
        } else {
            // Show initials (first 2 letters of name) when no profile picture
            const displayName = (oauthUserInfo && oauthUserInfo.name) ? oauthUserInfo.name : currentUser;
            const initials = displayName.substring(0, 2).toUpperCase();
            currentUserName.innerHTML = `
                <span class="oauth-user-info">
                    <span class="user-initials-avatar">${initials}</span>
                    <span>${displayName}</span>
                </span>
            `;
        }
        
        userFavoritesToggle.style.display = 'flex';
        updateUserFavoritesCount();
        // Enable global actions for logged users
        if (ticketToggle) {
            ticketToggle.style.display = 'flex';
            ticketToggle.onclick = () => showTicketModal();
        }
        if (shoppingListToggle) {
            shoppingListToggle.style.display = 'flex';
            shoppingListToggle.onclick = () => showShoppingListModal();
        }
        if (favoritesToggle) {
            favoritesToggle.style.display = 'flex';
            favoritesToggle.onclick = () => showFavoritesModal();
        }
        if (generateMenu) generateMenu.removeAttribute('disabled');
    } else {
        userInfo.style.display = 'none';
        loginPrompt.style.display = 'flex';
        userFavoritesToggle.style.display = 'none';
        // Hide/disable actions for anonymous users
        if (ticketToggle) {
            ticketToggle.style.display = 'none';
            ticketToggle.onclick = null;
        }
        if (shoppingListToggle) {
            shoppingListToggle.style.display = 'none';
            shoppingListToggle.onclick = null;
        }
        if (favoritesToggle) {
            favoritesToggle.style.display = 'none';
            favoritesToggle.onclick = null;
        }
        if (generateMenu) generateMenu.setAttribute('disabled', 'true');
    }
}

async function loadUserSession() {
    if (currentUser) {
        try {
            const response = await fetch('/api/user/favorites', {
                headers: { 'X-User': currentUser }
            });
            const data = await response.json();
            
            if (data.favorites) {
                userFavoriteProducts = data.favorites.map(p => p.id);
            }
            
            updateUserUI();
        } catch (e) {
            console.error('Error loading user session:', e);
            currentUser = null;
            localStorage.removeItem('currentUser');
        }
    }
    updateUserUI();
}

async function toggleProductFavorite(productId, event) {
    if (event) event.stopPropagation();
    
    if (!currentUser) {
        showLoginModal();
        return;
    }
    
    const isFavorited = userFavoriteProducts.includes(productId);
    const action = isFavorited ? 'remove' : 'add';
    
    try {
        const response = await fetch('/api/user/favorites', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-User': currentUser
            },
            body: JSON.stringify({ productId, action })
        });
        
        const data = await response.json();
        
        if (data.success) {
            userFavoriteProducts = data.favorites;
            updateUserFavoritesCount();
            
            // Update button state
            const btn = document.querySelector(`.btn-favorite-product[data-product-id="${productId}"]`);
            if (btn) {
                btn.classList.toggle('favorited', !isFavorited);
                btn.textContent = isFavorited ? '🤍' : '❤️';
            }
            
            showNotification(isFavorited ? 'Eliminado de favoritos' : 'Añadido a favoritos');
        }
    } catch (e) {
        console.error('Error toggling favorite:', e);
        showNotification('Error al actualizar favoritos');
    }
}

function updateUserFavoritesCount() {
    const countEl = document.getElementById('userFavoritesCount');
    const count = userFavoriteProducts.length;
    
    if (count > 0) {
        countEl.textContent = count;
        countEl.style.display = 'flex';
    } else {
        countEl.style.display = 'none';
    }
}

async function showUserFavoritesCategory() {
    if (!currentUser) {
        showLoginModal();
        return;
    }
    
    categoryTitle.textContent = '❤️ Mis Productos Favoritos';
    loadingProducts.classList.remove('hidden');
    productsGrid.innerHTML = '';
    
    try {
        const response = await fetch('/api/user/favorites', {
            headers: { 'X-User': currentUser }
        });
        const data = await response.json();
        
        loadingProducts.classList.add('hidden');
        
        if (data.favorites && data.favorites.length > 0) {
            currentProducts = data.favorites;
            renderProducts(currentProducts);
        } else {
            productsGrid.innerHTML = `
                <div class="welcome-message">
                    <div class="welcome-icon">❤️</div>
                    <h3>No tienes productos favoritos</h3>
                    <p>Navega por las categorías y pulsa el ❤️ en los productos que te gusten.</p>
                </div>
            `;
            productsCount.textContent = '0 productos';
        }
    } catch (e) {
        console.error('Error loading favorites:', e);
        loadingProducts.classList.add('hidden');
        productsGrid.innerHTML = `
            <div class="welcome-message">
                <div class="welcome-icon">❌</div>
                <h3>Error al cargar favoritos</h3>
                <p>Inténtalo de nuevo más tarde.</p>
            </div>
        `;
    }
}

function isProductFavorited(productId) {
    return userFavoriteProducts.includes(productId);
}

// ===== Profile, Tickets & Stats Functions =====

let userTickets = [];

function showProfileModal() {
    if (!currentUser) {
        showNotification('Debes iniciar sesión para ver tu perfil');
        return;
    }
    
    document.getElementById('profileModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Set user name
    const displayName = (oauthUserInfo && oauthUserInfo.name) ? oauthUserInfo.name : currentUser;
    document.getElementById('profileUserName').textContent = displayName;
    
    // Load tickets by default
    switchProfileTab('tickets');
}

function closeProfileModal() {
    document.getElementById('profileModal').classList.remove('active');
    document.body.style.overflow = '';
}

function switchProfileTab(tab) {
    // Update tab buttons
    document.getElementById('tabTickets').classList.remove('active');
    document.getElementById('tabStats').classList.remove('active');
    document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add('active');
    
    // Update content
    document.getElementById('ticketsTabContent').classList.add('hidden');
    document.getElementById('statsTabContent').classList.add('hidden');
    
    if (tab === 'tickets') {
        document.getElementById('ticketsTabContent').classList.remove('hidden');
        loadUserTickets();
    } else {
        document.getElementById('statsTabContent').classList.remove('hidden');
        loadUserStats();
    }
}

async function loadUserTickets() {
    try {
        const response = await fetch('/api/user/tickets', {
            headers: { 'X-User': currentUser }
        });
        const data = await response.json();
        userTickets = data.tickets || [];
        renderTicketsList(userTickets);
    } catch (e) {
        console.error('Error loading tickets:', e);
    }
}

function renderTicketsList(tickets) {
    const container = document.getElementById('ticketsList');
    
    if (tickets.length === 0) {
        container.innerHTML = `
            <div class="empty-tickets">
                <span>🧾</span>
                <p>No tienes tickets guardados</p>
                <small>Sube un ticket de compra y se guardará automáticamente aquí</small>
            </div>
        `;
        return;
    }
    
    // Sort by date descending
    const sortedTickets = [...tickets].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    container.innerHTML = sortedTickets.map(ticket => `
        <div class="ticket-card">
            <div class="ticket-card-header">
                <div class="ticket-date">
                    <span class="ticket-icon">🧾</span>
                    <span>${formatTicketDate(ticket.date)}</span>
                </div>
                <div class="ticket-total">${formatPrice(ticket.total)}</div>
            </div>
            <div class="ticket-card-body">
                <div class="ticket-products-preview">
                    ${ticket.products.slice(0, 5).map(p => `
                        <span class="ticket-product-tag">${p.name}</span>
                    `).join('')}
                    ${ticket.products.length > 5 ? `<span class="ticket-more">+${ticket.products.length - 5} más</span>` : ''}
                </div>
                <div class="ticket-stats">
                    <span>${ticket.products.length} productos</span>
                </div>
            </div>
            <div class="ticket-card-actions">
                <button class="btn-ticket-detail" onclick="showTicketDetail('${ticket.hash}')">Ver detalle</button>
                <button class="btn-ticket-delete" onclick="deleteTicket('${ticket.hash}')">🗑️</button>
            </div>
        </div>
    `).join('');
}

function formatTicketDate(dateStr) {
    if (!dateStr) return 'Fecha desconocida';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('es-ES', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
    } catch (e) {
        return dateStr;
    }
}

function showTicketDetail(hash) {
    const ticket = userTickets.find(t => t.hash === hash);
    if (!ticket) return;
    
    const modalContent = `
        <div class="ticket-detail">
            <h3>🧾 Ticket del ${formatTicketDate(ticket.date)}</h3>
            <div class="ticket-detail-total">
                <span>Total:</span>
                <span class="total-value">${formatPrice(ticket.total)}</span>
            </div>
            <div class="ticket-detail-products">
                <h4>Productos (${ticket.products.length})</h4>
                <table class="ticket-products-table">
                    <thead>
                        <tr>
                            <th>Producto</th>
                            <th>Categoría</th>
                            <th>Precio</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${ticket.products.map(p => `
                            <tr>
                                <td>${p.name}</td>
                                <td><span class="category-tag">${p.category || 'Sin categoría'}</span></td>
                                <td>${formatPrice(p.price)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    document.getElementById('menuContent').innerHTML = modalContent;
    document.getElementById('menuLoading').style.display = 'none';
    document.getElementById('menuModal').classList.add('active');
}

async function deleteTicket(hash) {
    if (!confirm('¿Eliminar este ticket de tu historial?')) return;
    
    try {
        await fetch('/api/user/tickets', {
            method: 'DELETE',
            headers: { 
                'Content-Type': 'application/json',
                'X-User': currentUser 
            },
            body: JSON.stringify({ ticketHash: hash })
        });
        
        showNotification('Ticket eliminado');
        loadUserTickets();
    } catch (e) {
        console.error('Error deleting ticket:', e);
    }
}

async function saveTicketToHistory(ticketData) {
    if (!currentUser) return;
    
    try {
        const response = await fetch('/api/user/tickets', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-User': currentUser 
            },
            body: JSON.stringify({ ticket: ticketData })
        });
        
        const data = await response.json();
        if (data.success && !data.duplicate) {
            showNotification('✅ Ticket guardado en tu historial');
        }
    } catch (e) {
        console.error('Error saving ticket:', e);
    }
}

async function loadUserStats() {
    const startDate = document.getElementById('statsStartDate').value;
    const endDate = document.getElementById('statsEndDate').value;
    
    let url = '/api/user/stats';
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (params.toString()) url += '?' + params.toString();
    
    try {
        const response = await fetch(url, {
            headers: { 'X-User': currentUser }
        });
        const stats = await response.json();
        renderStats(stats);
    } catch (e) {
        console.error('Error loading stats:', e);
    }
}

function renderStats(stats) {
    // Summary cards
    document.getElementById('statTotalTickets').textContent = stats.totalTickets || 0;
    document.getElementById('statTotalSpent').textContent = formatPrice(stats.totalSpent || 0);
    document.getElementById('statAvgTicket').textContent = stats.totalTickets > 0 
        ? formatPrice(stats.totalSpent / stats.totalTickets) 
        : '0,00 €';
    
    // Category chart with expandable products
    const categoryChart = document.getElementById('categoryChart');
    const categories = Object.entries(stats.categoryBreakdown || {}).sort((a, b) => b[1] - a[1]);
    const categoryProducts = stats.categoryProducts || {};
    
    if (categories.length === 0) {
        categoryChart.innerHTML = '<p class="no-data">No hay datos disponibles</p>';
    } else {
        const maxValue = categories[0][1];
        categoryChart.innerHTML = categories.slice(0, 15).map(([cat, value], index) => {
            const products = categoryProducts[cat] || [];
            const productsList = products.map(p => `
                <div class="category-product-item">
                    <span class="product-name">${p.name}</span>
                    <span class="product-count">${p.count}x</span>
                    <span class="product-spent">${formatPrice(p.totalSpent)}</span>
                </div>
            `).join('');
            
            return `
                <div class="category-accordion" data-category="${index}">
                    <div class="category-bar-row" onclick="toggleCategoryAccordion(${index})">
                        <div class="category-expand-icon">▶</div>
                        <div class="category-name">${cat}</div>
                        <div class="category-bar-container">
                            <div class="category-bar" style="width: ${(value / maxValue * 100)}%"></div>
                        </div>
                        <div class="category-value">${formatPrice(value)}</div>
                    </div>
                    <div class="category-products-list" id="categoryProducts${index}">
                        <div class="category-products-header">
                            <span>Productos en "${cat}"</span>
                            <span>${products.length} productos</span>
                        </div>
                        ${productsList || '<p class="no-products">No hay productos</p>'}
                    </div>
                </div>
            `;
        }).join('');
    }
    
    // Top products
    const topProductsList = document.getElementById('topProductsList');
    const topProducts = stats.topProducts || [];
    
    if (topProducts.length === 0) {
        topProductsList.innerHTML = '<p class="no-data">No hay datos disponibles</p>';
    } else {
        topProductsList.innerHTML = topProducts.slice(0, 10).map((product, i) => `
            <div class="top-product-row">
                <span class="product-rank">${i + 1}</span>
                <span class="product-name">${product.name}</span>
                <span class="product-count">${product.count}x</span>
                <span class="product-spent">${formatPrice(product.totalSpent)}</span>
            </div>
        `).join('');
    }
    
    // Monthly chart
    const monthlyChart = document.getElementById('monthlyChart');
    const months = Object.entries(stats.monthlySpending || {}).sort((a, b) => a[0].localeCompare(b[0]));
    
    if (months.length === 0) {
        monthlyChart.innerHTML = '<p class="no-data">No hay datos disponibles</p>';
    } else {
        const maxMonthValue = Math.max(...months.map(m => m[1]));
        monthlyChart.innerHTML = `
            <div class="monthly-bars">
                ${months.map(([month, value]) => {
                    const [year, monthNum] = month.split('-');
                    const monthName = new Date(year, parseInt(monthNum) - 1).toLocaleDateString('es-ES', { month: 'short' });
                    return `
                        <div class="monthly-bar-col">
                            <div class="monthly-bar" style="height: ${(value / maxMonthValue * 100)}%"></div>
                            <div class="monthly-label">${monthName} ${year.slice(2)}</div>
                            <div class="monthly-value">${formatPrice(value)}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }
}

function toggleCategoryAccordion(index) {
    const accordion = document.querySelector(`.category-accordion[data-category="${index}"]`);
    const productsList = document.getElementById(`categoryProducts${index}`);
    const icon = accordion.querySelector('.category-expand-icon');
    
    if (accordion.classList.contains('expanded')) {
        accordion.classList.remove('expanded');
        productsList.style.maxHeight = '0';
        icon.textContent = '▶';
    } else {
        // Close other open accordions
        document.querySelectorAll('.category-accordion.expanded').forEach(acc => {
            acc.classList.remove('expanded');
            acc.querySelector('.category-products-list').style.maxHeight = '0';
            acc.querySelector('.category-expand-icon').textContent = '▶';
        });
        
        accordion.classList.add('expanded');
        productsList.style.maxHeight = productsList.scrollHeight + 'px';
        icon.textContent = '▼';
    }
}

function clearDateFilters() {
    document.getElementById('statsStartDate').value = '';
    document.getElementById('statsEndDate').value = '';
    loadUserStats();
}

function setQuickDateFilter(period) {
    const today = new Date();
    let startDate = new Date();
    
    switch(period) {
        case 'week':
            startDate.setDate(today.getDate() - 7);
            break;
        case 'month':
            startDate.setMonth(today.getMonth() - 1);
            break;
        case '3months':
            startDate.setMonth(today.getMonth() - 3);
            break;
        case 'year':
            startDate = new Date(today.getFullYear(), 0, 1);
            break;
        case 'all':
            document.getElementById('statsStartDate').value = '';
            document.getElementById('statsEndDate').value = '';
            loadUserStats();
            return;
    }
    
    document.getElementById('statsStartDate').value = startDate.toISOString().split('T')[0];
    document.getElementById('statsEndDate').value = today.toISOString().split('T')[0];
    loadUserStats();
}

// Function to extract date and total from ticket text
function parseTicketInfo(ticketText) {
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
                date = `${parts[0]}-${parts[1]}-${parts[2]}`;
            } else {
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
        /importe[:\s]+(\d+[,\.]\d{2})/i,
        /(\d+[,\.]\d{2})\s*€?\s*$/m
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

// ===== Initialize App =====
async function initApp() {
    categoriesNav.innerHTML = `
        <div class="loading-categories">
            <div class="spinner"></div>
            <p>Cargando categorías...</p>
        </div>
    `;

    // Check for OAuth session first
    const hasOAuthSession = await checkOAuthSession();
    
    // If no OAuth session, try to load regular user session
    if (!hasOAuthSession && currentUser) {
        await loadUserSession();
    }

    allCategories = await fetchCategories();
    renderCategories(allCategories);
    updateFavoritesCount();
    updateShoppingListCount();
    loadSharedList();
    
    // Check for OAuth error in URL
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('error')) {
        const errorMessages = {
            'auth_denied': 'Autenticación cancelada',
            'no_code': 'Error en la autenticación',
            'token_error': 'Error obteniendo acceso',
            'user_info_error': 'Error obteniendo datos de usuario',
            'parse_error': 'Error procesando respuesta',
            'network_error': 'Error de conexión'
        };
        const errorMsg = errorMessages[urlParams.get('error')] || 'Error de autenticación';
        showNotification(`❌ ${errorMsg}`);
        // Clean URL
        window.history.replaceState({}, document.title, '/');
    }
}

// Start the app
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    initApp();
});
