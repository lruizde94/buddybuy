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

    for (const category of categories) {
        for (const subcategory of (category.categories || [])) {
            const subcatData = await fetchSubcategoryProducts(subcategory.id);
            for (const cat of subcatData) {
                if (cat.products) {
                    for (const product of cat.products) {
                        if (product.display_name.toLowerCase().includes(query.toLowerCase())) {
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

    const filtered = currentProducts.filter(p => 
        p.display_name.toLowerCase().includes(query.toLowerCase())
    );
    
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
}

function removeIngredient(productId) {
    selectedIngredients = selectedIngredients.filter(i => i.id !== productId);
    updateIngredientsUI();
}

function clearAllIngredients() {
    selectedIngredients = [];
    updateIngredientsUI();
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
let ticketOption = null;
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
        if (files.length > 0 && files[0].type === 'application/pdf') {
            handleTicketFile(files[0]);
        } else {
            showNotification('Por favor, selecciona un archivo PDF');
        }
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleTicketFile(e.target.files[0]);
        }
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
    ticketOption = option;
    document.querySelectorAll('.btn-option').forEach(btn => btn.classList.remove('selected'));
    if (option === 'recipes') {
        document.getElementById('btnRecipes').classList.add('selected');
    } else if (option === 'weekly') {
        document.getElementById('btnWeeklyMenu').classList.add('selected');
    } else if (option === 'products') {
        document.getElementById('btnFindProducts').classList.add('selected');
    }
    updateProcessButton();
}

function updateProcessButton() {
    const btn = document.getElementById('processTicketBtn');
    btn.disabled = !(ticketFile && ticketOption);
}

function resetTicketForm() {
    ticketFile = null;
    ticketOption = null;
    parsedTicketText = null;
    document.getElementById('ticketUploadArea').classList.remove('hidden');
    document.getElementById('ticketFileInfo').classList.add('hidden');
    document.getElementById('ticketFileInput').value = '';
    document.querySelectorAll('.btn-option').forEach(btn => btn.classList.remove('selected'));
    updateProcessButton();
}

async function processTicket() {
    if (!ticketFile || !ticketOption) return;
    
    // Guardar valores antes de cerrar el modal (que los resetea)
    const currentFile = ticketFile;
    const currentOption = ticketOption;
    
    const formData = new FormData();
    formData.append('ticket', currentFile);
    formData.append('option', currentOption);
    
    closeTicketModal();
    
    // Mostrar modal de carga
    menuModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    menuLoading.style.display = 'block';
    menuContent.innerHTML = '';
    
    try {
        // Si es la opción de buscar productos, usar endpoint diferente
        if (currentOption === 'products') {
            const response = await fetch('/api/find-ticket-products', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error('Error finding products');
            }
            
            const data = await response.json();
            menuLoading.style.display = 'none';
            renderTicketProducts(data);
            return;
        }
        
        const response = await fetch('/procesar-ticket', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('Error processing ticket');
        }
        
        const data = await response.json();
        
        console.log('📦 Datos recibidos del servidor:', data);
        console.log('🎯 Opción seleccionada:', ticketOption);
        
        // Guardar el texto parseado para reutilizar
        if (data.ticketText) {
            parsedTicketText = data.ticketText;
        }
        
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
        console.error('Error processing ticket:', error);
        menuLoading.style.display = 'none';
        menuContent.innerHTML = `
            <div class="menu-error">
                <h3>❌ Error al procesar el ticket</h3>
                <p>No se pudo leer el ticket. Asegúrate de que sea un PDF válido.</p>
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

// Renderizar productos encontrados del ticket
function renderTicketProducts(data) {
    const products = data.products || [];
    const ingredients = data.ingredients || [];
    
    if (products.length === 0) {
        menuContent.innerHTML = `
            <div class="menu-error">
                <h3>🔍 No se encontraron productos</h3>
                <p>No hemos podido identificar productos del ticket en nuestro catálogo.</p>
                <p style="margin-top: 10px; color: var(--text-muted);">
                    Ingredientes detectados: ${ingredients.length > 0 ? ingredients.join(', ') : 'Ninguno'}
                </p>
            </div>
        `;
        return;
    }
    
    // Contar cuántos ya son favoritos
    const alreadyFavorites = products.filter(p => userFavoriteProducts.includes(p.id)).length;
    
    menuContent.innerHTML = `
        <div class="ticket-products-header">
            <h2>🛒 Productos de tu Ticket</h2>
            <p>Hemos encontrado estos productos de Mercadona que coinciden con tu compra</p>
            <div class="ticket-products-stats">
                <div class="stat-item">
                    <div class="stat-number">${products.length}</div>
                    <div class="stat-label">Productos encontrados</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number">${ingredients.length}</div>
                    <div class="stat-label">Ingredientes detectados</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number">${alreadyFavorites}</div>
                    <div class="stat-label">Ya en favoritos</div>
                </div>
            </div>
        </div>
        
        <div class="ticket-products-grid">
            ${products.map(product => {
                const isFavorite = userFavoriteProducts.includes(product.id);
                return `
                    <div class="ticket-product-card" data-product-id="${product.id}">
                        <img src="${product.thumbnail || 'https://via.placeholder.com/80'}" alt="${product.display_name}" onerror="this.src='https://via.placeholder.com/80'">
                        <div class="product-match">📌 ${product.matchedIngredient}</div>
                        <h4>${product.display_name}</h4>
                        <div class="product-price">${product.unit_price ? product.unit_price.toFixed(2) + '€' : 'N/A'}</div>
                        <button class="btn-add-favorite ${isFavorite ? 'added' : ''}" 
                                onclick="toggleTicketProductFavorite('${product.id}', this)">
                            ${isFavorite ? '✅ En favoritos' : '❤️ Añadir a favoritos'}
                        </button>
                    </div>
                `;
            }).join('')}
        </div>
        
        <div class="ticket-products-actions">
            <button class="btn-add-all-favorites" onclick="addAllTicketProductsToFavorites()">
                ❤️ Añadir todos a favoritos
            </button>
            <button class="btn-add-to-shopping" onclick="addTicketProductsToShoppingList()">
                📋 Añadir a lista de compra
            </button>
        </div>
    `;
    
    // Guardar productos para acciones en batch
    window.currentTicketProducts = products;
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
            currentUserName.textContent = currentUser;
        }
        
        userFavoritesToggle.style.display = 'flex';
        updateUserFavoritesCount();
    } else {
        userInfo.style.display = 'none';
        loginPrompt.style.display = 'flex';
        userFavoritesToggle.style.display = 'none';
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
