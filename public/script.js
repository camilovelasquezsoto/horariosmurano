/**
 * LÓGICA INTEGRAL - MURANO VOLEY "NEXT LEVEL"
 */

const API_BASE_URL = '/api';

const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const timeSlots = ["17:30", "19:00", "20:30", "22:00"];
const timeMap = {
    "17:30": "17:30–19:00",
    "19:00": "19:00–20:30",
    "20:30": "20:30–22:00",
    "22:00": "22:00–23:30"
};

// Imágenes por defecto cuando no hay foto
const DEFAULT_IMAGE          = '/logomurano.png';                                    // fallback global
const DEFAULT_IMAGE_CAT      = '/fotos_categorias/imagenpredeterminada.png';         // categorías sin foto
const DEFAULT_IMAGE_TRAINER  = '/profesores/fotopredeterminadaprofe.png';            // entrenadores sin foto


// Descripciones y rangos de edad por categoría
const CATEGORY_DESCRIPTIONS = {
    'Tc varones':  'Técnica Competitiva · 18+ años',
    'Tc damas':    'Técnica Competitiva · 18+ años',
    'U18 DAMAS':   'Sub 18 · Nacidas 2008 – 2010',
    'U18 VARONES': 'Sub 18 · Nacidos 2008 – 2010',
    'U16 A DAMAS': 'Sub 16 · Nacidas 2010 – 2012',
    'U16 B DAMAS': 'Sub 16 · Nacidas 2010 – 2012',
    'U16 VARONES': 'Sub 16 · Nacidos 2010 – 2012',
    'U14 DAMAS':   'Sub 14 · Nacidas 2012 – 2014',
    'U14 B DAMAS': 'Sub 14 · Nacidas 2012 – 2014',
    'U14 VARONES': 'Sub 14 · Nacidos 2012 – 2014',
    'U12 DAMAS':   'Sub 12 · Nacidas 2014 – 2016',
    'Mini Voley':  'Mini Voley · Nacidos 2016 en adelante'
};

/** Simplifica "Cancha 1 - Centro Deportivo" → "Cancha 1" */
function simplifyGymName(name) {
    return name ? name.split(' - ')[0] : '';
}

/** Badge de género/tipo para tarjetas de categoría */
function getCategoryBadge(name) {
    const n = (name || '').toUpperCase();
    if (n.includes('MINI'))            return '<span class="cat-badge badge-mini">🏐 Mini Voley</span>';
    if (n.startsWith('TC') && n.includes('DAMA'))  return '<span class="cat-badge badge-damas">🏆 TC · Damas</span>';
    if (n.startsWith('TC') && n.includes('VARON')) return '<span class="cat-badge badge-varones">🏆 TC · Varones</span>';
    if (n.includes('DAMA'))            return '<span class="cat-badge badge-damas">♀ Damas</span>';
    if (n.includes('VARON'))           return '<span class="cat-badge badge-varones">♂ Varones</span>';
    return '';
}

/** Detecta género para atributo data-gender */
function getCategoryGender(name) {
    const n = (name || '').toUpperCase();
    if (n.includes('MINI'))  return 'mini';
    if (n.includes('DAMA'))  return 'damas';
    if (n.includes('VARON')) return 'varones';
    return 'all';
}

/** Filtra tarjetas de categoría por género */
function filterCategories(gender, btn) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.card[data-gender]').forEach(card => {
        card.style.display = (gender === 'all' || card.dataset.gender === gender) ? '' : 'none';
    });
}

/** Clase CSS de color según género del evento */
function getEventGenderClass(categoryName) {
    const n = (categoryName || '').toUpperCase();
    if (n.includes('MINI'))  return 'ev-mini';
    if (n.includes('DAMA'))  return 'ev-damas';
    if (n.includes('VARON')) return 'ev-varones';
    return '';
}

/** Marca el botón activo en el nav inferior móvil */
function setMobileNav(activeId) {
    document.querySelectorAll('.mob-nav-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(activeId);
    if (btn) btn.classList.add('active');
}

/**
 * --- UTILIDADES ---
 */

function safeKey(str) {
    return String(str).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function escQ(str) {
    return String(str || '').replace(/'/g, "\\'");
}

function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3000);
}

function showView(v) {
    if (v === 'finance-view' && !isFinanceAuthenticated()) {
        openFinanceAuthModal();
        return;
    }
    const views = ['main-view', 'auth-view', 'admin-panel-view', 'finance-view'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    const target = document.getElementById(v);
    if (target) target.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * --- RENDERIZADO Y SKELETONS ---
 */

function renderSkeletons(count = 4) {
    const container = document.getElementById('list-container');
    if (!container) return;
    container.innerHTML = Array(count).fill(0).map(() => `
        <div class="card">
            <div class="card-inner">
                <div class="card-info">
                    <div class="img-box skeleton"></div>
                    <div class="card-text-group">
                        <div class="skeleton" style="height:24px; width:80%; margin-bottom:10px;"></div>
                        <div class="skeleton" style="height:16px; width:60%;"></div>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

async function renderList(type) {
    showView('main-view');
    renderSkeletons();
    
    const url = type === 'gym' ? '/gyms' : type === 'cat' ? '/categories' : '/trainers';
    
    try {
        const res = await fetch(`${API_BASE_URL}${url}`);
        
        if (!res.ok) {
            throw new Error(`Error ${res.status}: Problema con la base de datos.`);
        }

        const data = await res.json();
        const container = document.getElementById('list-container');
        
        if (!data || data.length === 0) {
            container.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--text-dim); padding:40px;">No hay datos cargados.</p>`;
            document.getElementById('global-map-container').classList.add('hidden');
            return;
        }

        // Renderizado especial para el complejo de canchas
        if (type === 'gym') {
            document.getElementById('global-map-wrapper').classList.add('hidden');
            renderGymComplex(data);
            return;
        }

        // Lógica del Mapa Global
        const mapWrapper = document.getElementById('global-map-wrapper');
        const mapContainer = document.getElementById('global-map-container');
        if (type === 'gym' && data.length > 0 && data[0].address) {
            window.currentMapUrl = buildMapUrl(data[0].address);
            if (window.currentMapUrl) {
                mapWrapper.classList.remove('hidden');
                mapContainer.classList.add('hidden');
                mapContainer.innerHTML = '';
                const btnMap = document.getElementById('toggle-map-btn');
                if (btnMap) {
                    btnMap.textContent = '🗺️ Ver Mapa del Complejo';
                    btnMap.style.borderColor = 'var(--accent)';
                    btnMap.style.color = 'var(--accent)';
                }
            } else {
                mapWrapper.classList.add('hidden');
            }
        } else {
            mapWrapper.classList.add('hidden');
        }

        // Barra de filtros solo para categorías
        const filterBar = type === 'cat' ? `
        <div class="filter-bar" style="grid-column:1/-1">
            <span class="filter-label">Filtrar:</span>
            <button class="filter-btn active" onclick="filterCategories('all', this)">Todos</button>
            <button class="filter-btn" onclick="filterCategories('damas', this)">♀ Damas</button>
            <button class="filter-btn" onclick="filterCategories('varones', this)">♂ Varones</button>
            <button class="filter-btn" onclick="filterCategories('mini', this)">🏐 Mini</button>
        </div>` : '';

        container.innerHTML = filterBar + data.map(item => {
            const key    = safeKey(item.id || item.name);
            const rawId  = type === 'trainer' ? item.name : item.id;
            const fallbackImg = type === 'cat' ? DEFAULT_IMAGE_CAT
                : type === 'trainer' ? DEFAULT_IMAGE_TRAINER
                : DEFAULT_IMAGE;
            const imgSrc = type === 'cat'
                ? (item.image_url || DEFAULT_IMAGE_CAT)
                : type === 'trainer'
                    ? (item.trainer_image_url || item.image_url || DEFAULT_IMAGE_TRAINER)
                    : (item.image_url || DEFAULT_IMAGE);
            const badge  = type === 'cat' ? getCategoryBadge(item.name) : '';
            const desc   = type === 'cat' ? (CATEGORY_DESCRIPTIONS[item.name] || '') : '';
            const gender = type === 'cat' ? getCategoryGender(item.name) : 'all';

            return `
            <div class="card" id="card-wrapper-${key}" data-gender="${gender}">
                <div class="card-inner">
                    <div class="card-info">
                        <div class="img-box">
                            <img src="${imgSrc}"
                                 onerror="this.src='${fallbackImg}'"
                                 loading="lazy">
                            <div class="img-overlay">
                                <span class="img-overlay-name">${item.name}</span>
                            </div>
                        </div>
                        <div class="card-text-group">
                            ${badge ? `<div class="cat-badge-wrapper">${badge}</div>` : ''}
                            <h3 class="card-title-mobile">${item.name}</h3>
                            ${desc ? `<p class="cat-description">${desc}</p>` : ''}
                            <button class="primary" onclick="toggleSchedule(this, '${type}', '${escQ(String(rawId))}', '${key}')"
                                    style="width:100%; margin-top:12px;">
                                Ver Horarios
                            </button>
                            ${type === 'cat' && localStorage.getItem('user_id') ? `
                            <button onclick="saveCategoryFavs(${item.id})" style="width:100%; margin-top:8px; padding:10px; background:transparent; border:1px solid #444; color:var(--text-muted); font-size:0.8rem; display:flex; justify-content:center; align-items:center; gap:5px;">
                                ⭐ Guardar Categoría
                            </button>
                            ` : ''}
                        </div>
                    </div>
                    <div class="card-schedule hidden" id="sched-${key}"></div>
                </div>
            </div>`;
        }).join('');

        // Animación escalonada de entrada
        requestAnimationFrame(() => {
            document.querySelectorAll('#list-container .card').forEach((card, i) => {
                card.style.opacity = '0';
                card.style.animation = 'none';
                setTimeout(() => {
                    card.style.animation = `slideUp 0.45s cubic-bezier(0.16,1,0.3,1) ${i * 0.055}s both`;
                }, 16);
            });
        });

        // Estado activo en nav superior
        document.querySelectorAll('.nav-bar button').forEach(b => b.classList.remove('active'));
        const activeNavBtn = document.querySelector(`.nav-bar button[onclick*="'${type}'"]`);
        if (activeNavBtn) activeNavBtn.classList.add('active');
    } catch (e) {
        console.error(e);
        const container = document.getElementById('list-container');
        document.getElementById('global-map-container').classList.add('hidden');
        container.innerHTML = `
            <div style="grid-column:1/-1; text-align:center; padding:40px;">
                <p style="color:var(--accent); font-weight:bold;">⚠️ Error de conexión</p>
                <p style="color:var(--text-dim); margin-top:10px;">${e.message}</p>
                <button onclick="renderList('${type}')" style="margin-top:20px;">Reintentar</button>
            </div>
        `;
    }
}

/**
 * --- COMPLEJO DE CANCHAS ---
 * Renderiza una sola tarjeta panorámica con foto compartida
 * y botones individuales por cancha.
 */
function renderGymComplex(gyms) {
    const container = document.getElementById('list-container');
    const sharedImage = gyms[0]?.image_url || '';
    const sharedAddress = gyms[0]?.address || '';
    const mapUrl = sharedAddress ? buildMapUrl(sharedAddress) : null;

    const courtButtons = gyms.map(gym => {
        const courtNum = gym.name.split(' - ')[0]; // "Cancha 1"
        const key = safeKey(gym.id);
        return `
        <button class="court-btn" id="court-btn-${key}"
            onclick="toggleGymSchedule(this, ${gym.id}, '${escQ(courtNum)}', '${key}')">
            <span class="court-number">${courtNum.replace(/\D/g, '')}</span>
            <div class="court-btn-info">
                <span class="court-label">${courtNum}</span>
                <span class="court-action">Ver Horarios</span>
            </div>
            <span class="court-chevron">›</span>
        </button>`;
    }).join('');

    container.innerHTML = `
    <div class="complex-card" id="complex-card">
        <div class="complex-photo">
            <img src="${sharedImage}"
                 onerror="this.style.background='linear-gradient(135deg,#111,#1a1a1a)'"
                 alt="Centro Deportivo Austral" loading="lazy">
            <div class="complex-photo-overlay">
                <div>
                    <h2 class="complex-title">Centro Deportivo Austral</h2>
                    <p class="complex-subtitle">Puerto Montt &nbsp;·&nbsp; 3 Canchas</p>
                </div>
                ${mapUrl ? `
                <a href="${sharedAddress}" target="_blank" rel="noopener" class="complex-map-btn">
                    🗺️ Ver Mapa
                </a>` : ''}
            </div>
        </div>
        <div class="complex-courts">
            ${courtButtons}
        </div>
        <div class="complex-schedule hidden" id="complex-schedule">
            <div class="complex-sched-header" id="complex-sched-header"></div>
            <div id="complex-sched-content"></div>
        </div>
    </div>`;
}

async function toggleGymSchedule(btn, gymId, gymName, key) {
    const schedule   = document.getElementById('complex-schedule');
    const header     = document.getElementById('complex-sched-header');
    const content    = document.getElementById('complex-sched-content');
    const isOpen     = btn.classList.contains('active');

    // Desactivar todos los botones
    document.querySelectorAll('.court-btn').forEach(b => {
        b.classList.remove('active');
        b.querySelector('.court-action').textContent = 'Ver Horarios';
        b.querySelector('.court-chevron').textContent = '›';
    });

    // Si era el mismo abierto, cierra
    if (isOpen) {
        schedule.classList.add('hidden');
        return;
    }

    // Indicar carga
    btn.querySelector('.court-action').textContent = 'Cargando...';

    try {
        const res = await fetch(`${API_BASE_URL}/trainings/by-gym/${gymId}`);
        const trs = await res.json();

        header.innerHTML = `
            <div class="complex-sched-title">
                <span class="court-dot"></span>${gymName}
            </div>`;
        content.innerHTML = generateGridHTML(trs, 'gym');
        schedule.classList.remove('hidden');

        btn.classList.add('active');
        btn.querySelector('.court-action').textContent = 'Ocultar';
        btn.querySelector('.court-chevron').textContent = '∨';

        schedule.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
        btn.querySelector('.court-action').textContent = 'Ver Horarios';
        toast('Error al obtener horarios');
    }
}

async function toggleSchedule(btn, type, id, wrapperKey) {
    const container = document.getElementById(`sched-${wrapperKey}`);
    const cardWrapper = document.getElementById(`card-wrapper-${wrapperKey}`);
    const map = document.getElementById(`map-${wrapperKey}`);

    if (!container.classList.contains('hidden')) {
        container.classList.add('hidden');
        if (map) map.classList.add('hidden');
        cardWrapper.classList.remove('expanded');
        btn.textContent = 'Ver Horarios';
        btn.classList.add('primary');
        return;
    }

    btn.textContent = 'Cargando...';
    const url = type === 'gym' ? `/trainings/by-gym/${id}` : type === 'cat' ? `/trainings/by-cat/${id}` : `/trainings/by-trainer/${encodeURIComponent(id)}`;

    try {
        const res = await fetch(`${API_BASE_URL}${url}`);
        const trs = await res.json();
        
        container.innerHTML = generateGridHTML(trs, type);
        container.classList.remove('hidden');
        if (map) map.classList.remove('hidden');
        
        cardWrapper.classList.add('expanded');
        btn.textContent = 'Ocultar';
        btn.classList.remove('primary');
        
        cardWrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
        btn.textContent = 'Ver Horarios';
        toast('Error al obtener horarios');
    }
}

// (funciones generateGridHTML y renderEventCard definidas más abajo — versiones con viewType)

/**
 * --- ADMINISTRACIÓN ---
 */

async function loadAdminPanel() {
    showView('admin-panel-view');
    try {
        const [gyms, cats, trainers] = await Promise.all([
            (await fetch(`${API_BASE_URL}/gyms`)).json(),
            (await fetch(`${API_BASE_URL}/categories`)).json(),
            (await fetch(`${API_BASE_URL}/trainers`)).json()
        ]);

        document.getElementById('t_gym').innerHTML = gyms.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
        document.getElementById('t_cat').innerHTML = cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

        document.getElementById('manage-gyms').innerHTML = `
            <details>
                <summary>Gestionar Canchas (${gyms.length})</summary>
                ${gyms.map(g => `
                <div class="admin-list-item">
                    <span>${g.name}</span>
                    <div class="item-actions">
                        <button onclick="deleteData('gyms', ${g.id})">Borrar</button>
                    </div>
                </div>`).join('')}
            </details>`;

        document.getElementById('manage-cats').innerHTML = `
            <details>
                <summary>Gestionar Categorías (${cats.length})</summary>
                ${cats.map(c => `
                <div class="admin-list-item">
                    <span>${c.name} — ${c.trainer_name || 'Sin profesor'}</span>
                    <div class="item-actions">
                        <button onclick="deleteData('categories', ${c.id})">Borrar</button>
                    </div>
                </div>`).join('')}
            </details>`;

        document.getElementById('manage-trainers').innerHTML = `
            <details>
                <summary>Gestionar Profesores (${trainers.length})</summary>
                ${trainers.map(t => `
                <div class="admin-list-item">
                    <span>${t.name}</span>
                    <div class="item-actions">
                        <button onclick="deleteTrainer('${escQ(t.name)}')">Desvincular</button>
                    </div>
                </div>`).join('')}
            </details>`;

    } catch (e) { toast('Error al cargar panel'); }
}

async function saveTraining() {
    const data = {
        gym_id: document.getElementById('t_gym').value,
        category_id: document.getElementById('t_cat').value,
        day_of_week: document.getElementById('t_day').value,
        start_time: document.getElementById('t_start').value
    };
    const res = await fetch(`${API_BASE_URL}/trainings`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    if (res.ok) { toast('✅ Horario creado'); setTimeout(() => location.reload(), 1000); }
}

async function deleteTraining(id) {
    if (!confirm("⚠️ ATENCIÓN ADMIN:\n\n¿Estás seguro de que deseas ELIMINAR esta clase de la base de datos?\n\n(Esto la borrará del calendario para todos los usuarios).")) return;
    await fetch(`${API_BASE_URL}/trainings/${id}`, { method: 'DELETE' });
    toast('Horario eliminado del sistema');
    setTimeout(() => location.reload(), 800);
}

async function saveGym() {
    const name      = document.getElementById('g_name').value.trim();
    const address   = document.getElementById('g_address').value.trim();
    const image_url = document.getElementById('g_img').value.trim();
    if (!name) return toast('El nombre es obligatorio');
    try {
        const res = await fetch(`${API_BASE_URL}/gyms`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name, address, image_url })
        });
        if (res.ok) { toast('✅ Cancha guardada'); loadAdminPanel(); }
        else toast('Error al guardar la cancha');
    } catch (e) { toast('Error de red'); }
}

async function saveCat() {
    const name               = document.getElementById('cat_name').value.trim();
    const trainer_name       = document.getElementById('trainer_name').value.trim();
    const image_url          = document.getElementById('cat_img').value.trim();
    const trainer_image_url  = document.getElementById('trainer_img').value.trim();
    if (!name) return toast('El nombre es obligatorio');
    try {
        const res = await fetch(`${API_BASE_URL}/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name, trainer_name, image_url, trainer_image_url })
        });
        if (res.ok) { toast('✅ Categoría guardada'); loadAdminPanel(); }
        else toast('Error al guardar la categoría');
    } catch (e) { toast('Error de red'); }
}

async function deleteTrainer(name) {
    if (!confirm(`¿Desvincular al entrenador "${name}" de todas las categorías?`)) return;
    try {
        await fetch(`${API_BASE_URL}/trainers/${encodeURIComponent(name)}`, { method: 'DELETE' });
        toast('Entrenador desvinculado');
        loadAdminPanel();
    } catch (e) { toast('Error al desvincular'); }
}

async function deleteData(type, id) {
    if (!confirm('¿Seguro que deseas eliminar?')) return;
    await fetch(`${API_BASE_URL}/${type}/${id}`, { method: 'DELETE' });
    loadAdminPanel();
}

/**
 * --- AUTENTICACIÓN ---
 */

async function login() {
    const email = document.getElementById('l_email').value;
    const password = document.getElementById('l_pass').value;
    if (!email || !password) return toast('Completa los datos');

    try {
        const res = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ email, password })
        });
        if (res.ok) {
            const d = await res.json();
            localStorage.setItem('user_id', d.user_id);
            localStorage.setItem('email', d.email);
            localStorage.setItem('role', d.role);
            toast('¡Hola de nuevo!');
            setTimeout(() => location.reload(), 1000);
        } else toast('Credenciales inválidas');
    } catch (e) { toast('Error de red'); }
}

async function register() {
    const email = document.getElementById('l_email').value;
    const password = document.getElementById('l_pass').value;
    const adminKey = document.getElementById('r_key').value;
    if (!email || !password) return toast('Completa los datos');

    try {
        const res = await fetch(`${API_BASE_URL}/register`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ email, password, adminKey })
        });
        if (res.ok) toast('Usuario creado. ¡Ingresa!');
        else toast('Error al registrar');
    } catch (e) { toast('Error de red'); }
}

function updateUI() {
    const user = localStorage.getItem('email');
    const role = localStorage.getItem('role');
    const panel = document.getElementById('auth-panel');
    if (!panel) return;
    if (user) {
        panel.innerHTML = `
            <span>${user}</span>
            <button onclick="openFinanceModule()" style="border-color:var(--accent); color:var(--accent); font-weight:700; margin-right:6px;">💰 Finanzas</button>
            ${role === 'admin' ? '<button onclick="loadAdminPanel()" class="primary">Admin</button>' : ''}
            <button onclick="logout()">Salir</button>`;
    } else {
        panel.innerHTML = `
            <button onclick="openFinanceModule()" style="border-color:var(--accent); color:var(--accent); font-weight:700; margin-right:8px;">💰 Finanzas</button>
            <button onclick="showView('auth-view')" class="primary">Ingresar</button>`;
    }
}

function logout() {
    localStorage.clear();
    location.reload();
}

/**
 * --- MAPAS Y FAVORITOS ---
 */

function buildMapUrl(address) {
    if (!address) return null;
    // Si es un link acortado de Google Maps o un link completo, lo transformamos para embed
    if (address.includes('google.com/maps') || address.includes('goo.gl')) {
        // Enlazar coordenadas directamente suele ser más seguro, pero como tenemos un enlace dinámico,
        // forzaremos la búsqueda por nombre del recinto si el link acortado falla por políticas.
        // Dado que el usuario pidió este link específico: https://maps.app.goo.gl/YsFjhnZZEDHSkpLo8
        return `https://maps.google.com/maps?q=${encodeURIComponent('Centro Deportivo Austral Puerto Montt')}&output=embed&z=15`;
    }
    return `https://maps.google.com/maps?q=${encodeURIComponent(address)}&output=embed&z=15`;
}

async function toggleFav(tId) {
    const userId = localStorage.getItem('user_id');
    if (!userId) return toast('Inicia sesión');
    try {
        const res = await fetch(`${API_BASE_URL}/toggle-favorite`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({training_id: tId, user_id: userId})
        });
        const d = await res.json();
        toast(d.action === 'added' ? '⭐ Guardado en Favoritos' : '❌ Eliminado de Favoritos');
        // Si estamos en la vista de favoritos, refrescar para que desaparezca
        if (document.querySelector('.favs-wrapper')) {
            renderFavorites();
        }
    } catch (e) { toast('Error al actualizar'); }
}

function toggleGlobalMap() {
    const container = document.getElementById('global-map-container');
    const btn = document.getElementById('toggle-map-btn');
    if (container.classList.contains('hidden')) {
        if (!container.innerHTML.includes('iframe')) {
            container.innerHTML = `<iframe class="gym-map" src="${window.currentMapUrl}" allowfullscreen="" loading="lazy"></iframe>`;
        }
        container.classList.remove('hidden');
        btn.textContent = '🗺️ Ocultar Mapa';
        btn.style.borderColor = 'var(--text-muted)';
        btn.style.color = 'var(--text-muted)';
    } else {
        container.classList.add('hidden');
        btn.textContent = '🗺️ Ver Mapa del Complejo';
        btn.style.borderColor = 'var(--accent)';
        btn.style.color = 'var(--accent)';
    }
}

async function saveCategoryFavs(categoryId) {
    const userId = localStorage.getItem('user_id');
    if (!userId) return toast('Inicia sesión primero');
    
    // Obtenemos el botón de manera segura usando event.currentTarget
    const btn = event ? event.currentTarget : document.activeElement;
    const originalText = btn.innerHTML; // Guardamos el HTML original para restaurarlo después

    try {
        btn.textContent = '⏳ Guardando...';
        btn.disabled = true; // Desactivar para evitar múltiples clics
        
        // Obtener todos los horarios de esta categoría
        const res = await fetch(`${API_BASE_URL}/trainings/by-cat/${categoryId}`);
        const trs = await res.json();
        
        if (!trs || trs.length === 0) {
            toast('No hay horarios para guardar');
            btn.innerHTML = originalText;
            btn.disabled = false;
            return;
        }

        // Guardarlos uno por uno (nuestra ruta de toggle-favorite los agregará si no existen)
        for (let t of trs) {
            // Intentar agregarlo. Si devuelve 'removed' (porque ya existía), lo volvemos a agregar
            const favRes = await fetch(`${API_BASE_URL}/toggle-favorite`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({training_id: t.id, user_id: userId})
            });
            const favData = await favRes.json();
            
            // Si la acción fue remover, lo volvemos a enviar para que quede guardado sí o sí
            if (favData.action === 'removed') {
                await fetch(`${API_BASE_URL}/toggle-favorite`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({training_id: t.id, user_id: userId})
                });
            }
        }
        toast(`✅ Categoría completa guardada`);
        btn.innerHTML = '✔️ Guardado con éxito';
        btn.style.color = 'var(--success)';
        btn.style.borderColor = 'var(--success)';
        
        // Restaurar estado visual después de 3 segundos
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.color = '';
            btn.style.borderColor = '';
            btn.disabled = false;
        }, 3000);

    } catch (e) { 
        toast('❌ Error al guardar categoría'); 
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

/**
 * Renderiza un bloque de evento en la grilla de horarios.
 * viewType: 'gym' | 'cat' | 'trainer' | 'fav'
 *   - 'gym'     → muestra categoría + profe
 *   - 'cat'     → muestra cancha + profe
 *   - 'trainer' → muestra categoría + cancha (elimina nombre redundante del profe)
 *   - 'fav'     → muestra categoría + cancha
 */
function renderEventCard(t, viewType = 'gym') {
    const isAdmin     = localStorage.getItem('role') === 'admin';
    const isFav       = viewType === 'fav';
    const gymShort    = simplifyGymName(t.gym_name);
    const genderClass = getEventGenderClass(t.category_name);

    let titulo, subtitulo;
    switch (viewType) {
        case 'trainer':
            titulo    = t.category_name || 'Entrenamiento';
            subtitulo = gymShort ? `🏟 ${gymShort}` : '';
            break;
        case 'cat':
            titulo    = gymShort || 'Cancha';
            subtitulo = t.trainer_name || 'Sin profesor';
            break;
        case 'fav':
            titulo    = t.category_name || 'Entrenamiento';
            subtitulo = gymShort ? `🏟 ${gymShort}` : (t.trainer_name || '');
            break;
        default: // 'gym'
            titulo    = t.category_name || 'Entrenamiento';
            subtitulo = t.trainer_name || 'Sin profesor';
    }

    return `
        <div class="event-card ${genderClass}">
            <div class="ev-title">${titulo}</div>
            ${subtitulo ? `<div class="ev-trainer">${subtitulo}</div>` : ''}
            <div class="ev-actions">
                <button onclick="toggleFav(${t.id})" class="ev-btn${isFav ? ' ev-btn-danger' : ''}" title="${isFav ? 'Quitar de Favoritos' : 'Guardar en Favoritos'}">
                    ${isFav ? '🗑️' : '⭐'}
                </button>
                ${isAdmin ? `<button onclick="deleteTraining(${t.id})" class="ev-btn ev-btn-danger" title="Borrar clase">✕</button>` : ''}
            </div>
        </div>`;
}

function generateGridHTML(trs, viewType = 'gym') {
    // Estado vacío: sin horarios definidos aún
    if (!trs || trs.length === 0) {
        return `<div class="empty-schedule">
            <span class="empty-icon">🏐</span>
            <p class="empty-title">Horarios próximamente</p>
            <p class="empty-sub">Los entrenamientos de esta categoría aún no tienen horario asignado.</p>
        </div>`;
    }

    let html = `<div class="schedule-grid">`;
    html += `<div class="cell header">Hora</div>`;
    days.forEach(d => html += `<div class="cell header">${d.substring(0,3)}</div>`);

    timeSlots.forEach(slot => {
        html += `<div class="cell time-label">${timeMap[slot]}</div>`;
        days.forEach(d => {
            const matches = trs.filter(t => t.day_of_week === d && t.start_time === slot);
            html += `<div class="cell">${matches.map(t => renderEventCard(t, viewType)).join('')}</div>`;
        });
    });
    return html + `</div>`;
}

async function renderFavorites() {
    const userId = localStorage.getItem('user_id');
    if (!userId) return toast('Inicia sesión primero');
    showView('main-view');
    renderSkeletons(2);
    try {
        const res = await fetch(`${API_BASE_URL}/favorites/${userId}`);
        const trs = await res.json();
        document.getElementById('list-container').innerHTML = `
            <div class="favs-wrapper" style="grid-column: 1 / -1;">
                <h2 style="font-family:'Barlow Condensed'; font-size:2rem; margin-bottom:20px; color:var(--accent);">⭐ Mis Favoritos</h2>
                ${trs.length === 0 ? '<p style="color:var(--text-dim)">No tienes favoritos guardados aún.</p>' : generateGridHTML(trs, 'fav')}
            </div>`;
    } catch (e) { toast('Error al cargar favoritos'); }
}

/**
 * ══════════════════════════════════════════════════════════════════
 * 💰 MÓDULO DE PAGOS, COBRANZAS Y CONCILIACIÓN (MURANO FINANZAS)
 * ══════════════════════════════════════════════════════════════════
 */

let currentFinancePeriod = 'SEPTIEMBRE-2026';
let currentFinanceStatusFilter = 'TODOS';
let currentExtrasAssignedFilter = 'TODOS';
let allFinanceAthletes = [];
let filteredAthletesCache = [];
let athletesPage = 1;
let athletesPageSize = 25;

let allFinancePendingMovements = [];
let filteredPendingCache = [];
let pendingPage = 1;
let pendingPageSize = 20;

let allFinanceExtrasMovements = [];
let filteredExtrasCache = [];
let extrasPage = 1;
let extrasPageSize = 25;

let currentActiveAthlete = null;
let currentEditingMovement = null;
let splitParts = [];
let parsedCartolaRows = [];

function formatCLP(amount) {
    const val = parseFloat(amount) || 0;
    return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        maximumFractionDigits: 0
    }).format(val);
}

// ── AUTENTICACIÓN Y SEGURIDAD MÓDULO FINANZAS (CLAVE: Vimaca1970) ──
const FINANCE_MASTER_PIN = 'Vimaca1970';

function isFinanceAuthenticated() {
    return sessionStorage.getItem('murano_finance_auth') === 'true';
}

function openFinanceModule() {
    if (isFinanceAuthenticated()) {
        showView('finance-view');
        loadFinanceData();
    } else {
        openFinanceAuthModal();
    }
}

function openFinanceAuthModal() {
    const modal = document.getElementById('f-auth-modal');
    const input = document.getElementById('f-auth-pin-input');
    const err = document.getElementById('f-auth-error-msg');
    if (err) err.style.display = 'none';
    if (input) input.value = '';
    if (modal) modal.classList.remove('hidden');
    setTimeout(() => { if (input) input.focus(); }, 120);
}

function closeFinanceAuthModal() {
    const modal = document.getElementById('f-auth-modal');
    if (modal) modal.classList.add('hidden');
}

function handleFinanceAuthSubmit(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('f-auth-pin-input');
    const err = document.getElementById('f-auth-error-msg');
    const val = input ? input.value.trim() : '';

    if (val.toLowerCase() === FINANCE_MASTER_PIN.toLowerCase()) {
        sessionStorage.setItem('murano_finance_auth', 'true');
        closeFinanceAuthModal();
        toast('🔓 Acceso concedido a Finanzas');
        showView('finance-view');
        loadFinanceData();
    } else {
        if (err) err.style.display = 'block';
        if (input) {
            input.select();
            input.focus();
        }
    }
}

function lockFinanceModule() {
    sessionStorage.removeItem('murano_finance_auth');
    toast('🔒 Sesión de finanzas cerrada');
    showView('main-view');
}

function triggerCartolaUpload() {
    const input = document.getElementById('f-cartola-quick-input') || document.getElementById('cartola-file-input');
    if (input) input.click();
}

function changeFinancePeriod() {
    const sel = document.getElementById('f-period-select');
    if (sel) {
        currentFinancePeriod = sel.value;
        loadFinanceData();
    }
}

function switchFinanceTab(tabId) {
    const tabs = ['athletes', 'extras', 'pending', 'cartola', 'categories', 'expenses'];
    tabs.forEach(t => {
        const content = document.getElementById(`f-tab-${t}`);
        const btn = document.getElementById(`f-tab-btn-${t}`);
        if (content) content.classList.add('hidden');
        if (btn) btn.classList.remove('active');
    });

    const activeContent = document.getElementById(`f-tab-${tabId}`);
    const activeBtn = document.getElementById(`f-tab-btn-${tabId}`);
    if (activeContent) activeContent.classList.remove('hidden');
    if (activeBtn) activeBtn.classList.add('active');

    if (tabId === 'expenses') {
        loadExpenses();
    }
}

let cachedSummaryData = null;

async function loadFinanceData() {
    try {
        // 1. Cargar Resumen KPIs
        const sumRes = await fetch(`${API_BASE_URL}/finance/summary?period=${currentFinancePeriod}`);
        const summary = await sumRes.json();
        cachedSummaryData = summary;

        if (summary) {
            // Totales separados: Mensualidades vs Extras vs General
            const elMens = document.getElementById('kpi-mensualidades');
            if (elMens) elMens.textContent = formatCLP(summary.total_mensualidades);

            const elExt = document.getElementById('kpi-extras');
            if (elExt) elExt.textContent = formatCLP(summary.total_extras);

            const elGen = document.getElementById('kpi-total-general');
            if (elGen) elGen.textContent = formatCLP(summary.recaudado);

            const elEsp = document.getElementById('kpi-esperado');
            if (elEsp) elEsp.textContent = formatCLP(summary.esperado);

            const elDeuda = document.getElementById('kpi-deuda-mensualidades');
            if (elDeuda) {
                const deuda = Math.max(0, summary.esperado - summary.total_mensualidades);
                elDeuda.textContent = `Deuda mensualidades: ${formatCLP(deuda)}`;
            }

            const elPagaron = document.getElementById('kpi-alumnos-pagaron');
            if (elPagaron) elPagaron.textContent = `${summary.alumnos_pagaron} de ${summary.total_activos} alumnos al día`;

            const pendCount = summary.pendientes_asignar?.cantidad || 0;
            const elPendCount = document.getElementById('kpi-pendientes-count');
            if (elPendCount) elPendCount.textContent = pendCount;

            const elPendMonto = document.getElementById('kpi-pendientes-monto');
            if (elPendMonto) elPendMonto.textContent = `${formatCLP(summary.pendientes_asignar?.monto || 0)} por asignar`;

            const badgePend = document.getElementById('f-pending-badge');
            if (badgePend) {
                badgePend.textContent = pendCount;
                if (pendCount > 0) badgePend.classList.remove('hidden');
                else badgePend.classList.add('hidden');
            }

            // KPIs Egresos y Saldo Neto Operativo
            const elEgrTotal = document.getElementById('kpi-egresos-total');
            if (elEgrTotal) elEgrTotal.textContent = formatCLP(summary.total_egresos || 0);

            const elEgrCount = document.getElementById('kpi-egresos-count');
            if (elEgrCount) elEgrCount.textContent = `${summary.count_egresos || 0} comprobantes`;

            const elSaldoNeto = document.getElementById('kpi-saldo-neto');
            if (elSaldoNeto) {
                const saldo = summary.saldo_neto !== undefined ? summary.saldo_neto : ((summary.recaudado || 0) - (summary.total_egresos || 0));
                elSaldoNeto.textContent = formatCLP(saldo);
                elSaldoNeto.style.color = saldo >= 0 ? 'var(--success)' : 'var(--danger)';
            }

            const elSaldoNetoSub = document.getElementById('kpi-saldo-neto-sub');
            if (elSaldoNetoSub) {
                const saldo = summary.saldo_neto !== undefined ? summary.saldo_neto : ((summary.recaudado || 0) - (summary.total_egresos || 0));
                elSaldoNetoSub.textContent = saldo >= 0 ? '✅ Superávit Operativo' : '⚠️ Déficit Operativo';
            }

            const elEgrIngresos = document.getElementById('kpi-egresos-ingresos-total');
            if (elEgrIngresos) elEgrIngresos.textContent = formatCLP(summary.recaudado || 0);

            renderCategoriesByMode();
        }

        // 2. Cargar Nómina de Deportistas
        const athRes = await fetch(`${API_BASE_URL}/finance/athletes?period=${currentFinancePeriod}`);
        const athData = await athRes.json();
        allFinanceAthletes = athData.athletes || [];

        populateCategoryFilter(allFinanceAthletes);
        filterAthletesTable();

        // 3. Cargar Movimientos Pendientes de Asignar
        const pendRes = await fetch(`${API_BASE_URL}/finance/movements?period=${currentFinancePeriod}&status=PENDIENTE`);
        allFinancePendingMovements = await pendRes.json();
        filterPendingTable();

        // 4. Cargar Pagos Extras y Otros Ingresos
        const extRes = await fetch(`${API_BASE_URL}/finance/movements?period=${currentFinancePeriod}&only_extras=true`);
        allFinanceExtrasMovements = await extRes.json();

        const badgeExt = document.getElementById('f-extras-badge');
        if (badgeExt) {
            badgeExt.textContent = allFinanceExtrasMovements.length;
            if (allFinanceExtrasMovements.length > 0) badgeExt.classList.remove('hidden');
            else badgeExt.classList.add('hidden');
        }

        const totalExtrasMonto = allFinanceExtrasMovements.reduce((sum, m) => sum + (parseFloat(m.amount) || 0), 0);
        const badgeTotal = document.getElementById('f-extras-badge-total');
        if (badgeTotal) badgeTotal.textContent = `${formatCLP(totalExtrasMonto)} en ${allFinanceExtrasMovements.length} pagos extras`;

        filterExtrasTable();

    } catch (err) {
        console.error('Error cargando datos de finanzas:', err);
        toast('Error al sincronizar datos financieros');
    }
}

function populateCategoryFilter(athletes) {
    const selCat = document.getElementById('f-cat-filter');
    const selAgrup = document.getElementById('f-agrupacion-filter');
    const modalCat = document.getElementById('modal-edit-cat');
    const modalAgrup = document.getElementById('modal-edit-agrupacion');

    const cats = [...new Set(athletes.map(a => a.category).filter(Boolean))].sort();
    const agrups = [...new Set(athletes.map(a => a.agrupacion).filter(Boolean))].sort();

    if (selCat) {
        const currentVal = selCat.value;
        selCat.innerHTML = '<option value="TODAS">Todas las Categorías (Edad)</option>' + 
            cats.map(c => `<option value="${c}">${c}</option>`).join('');
        if (cats.includes(currentVal)) selCat.value = currentVal;
    }

    if (selAgrup) {
        const currentAgrup = selAgrup.value;
        selAgrup.innerHTML = '<option value="TODAS">Todas las Agrupaciones (Equipos)</option>' + 
            agrups.map(ag => `<option value="${ag}">${ag}</option>`).join('');
        if (agrups.includes(currentAgrup)) selAgrup.value = currentAgrup;
    }

    if (modalCat) {
        modalCat.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
    }

    if (modalAgrup) {
        modalAgrup.innerHTML = agrups.map(ag => `<option value="${ag}">${ag}</option>`).join('');
    }
}

function setStatusFilter(status, btn) {
    currentFinanceStatusFilter = status;
    document.querySelectorAll('.f-status-pills .f-pill').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
    filterAthletesTable();
}

function normalizeStr(str) {
    if (!str) return '';
    return str.toString().toLowerCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function smartNormalize(str) {
    if (!str) return '';
    return str.toString().toLowerCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/z/g, 's')
        .replace(/c([ei])/g, 's$1')
        .replace(/v/g, 'b');
}

function matchStudent(student, query) {
    if (!query || !query.trim()) return true;
    const rawSearch = query.trim();
    const cleanSearchRut = rawSearch.replace(/[^0-9Kk]/g, '').toUpperCase();
    const tokens = rawSearch.split(/\s+/).filter(Boolean).map(smartNormalize);
    if (tokens.length === 0) return true;

    const normName = smartNormalize(student.full_name || `${student.first_name || ''} ${student.last_name || ''}`);
    const normCat = smartNormalize(student.category || '');
    const normNotes = smartNormalize(student.notes || '');
    const studentRutClean = (student.rut || '').replace(/[^0-9Kk]/g, '').toUpperCase();

    const payerData = (student.payer_ruts || []).map(r => ({
        normPayer: smartNormalize(r.payer_name || ''),
        rutClean: (r.payer_rut || '').replace(/[^0-9Kk]/g, '').toUpperCase()
    }));

    if (cleanSearchRut.length >= 3) {
        if (studentRutClean && studentRutClean.includes(cleanSearchRut)) return true;
        if (payerData.some(r => r.rutClean && r.rutClean.includes(cleanSearchRut))) return true;
    }

    const combined = `${normName} ${normCat} ${normNotes} ${payerData.map(r => r.normPayer).join(' ')}`;
    return tokens.every(t => combined.includes(t));
}

function onAthletesSearchChange() {
    const rawSearch = document.getElementById('f-search-input')?.value || '';
    const clearBtn = document.getElementById('btn-clear-ath-search');
    if (clearBtn) {
        if (rawSearch.trim()) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
    }
    athletesPage = 1;
    filterAthletesTable();
}

function clearAthleteSearch() {
    const inp = document.getElementById('f-search-input');
    if (inp) inp.value = '';
    const clearBtn = document.getElementById('btn-clear-ath-search');
    if (clearBtn) clearBtn.classList.add('hidden');
    athletesPage = 1;
    filterAthletesTable();
}

function resetAthletesFilters() {
    const searchInp = document.getElementById('f-search-input');
    if (searchInp) searchInp.value = '';
    const clearBtn = document.getElementById('btn-clear-ath-search');
    if (clearBtn) clearBtn.classList.add('hidden');

    const catSel = document.getElementById('f-cat-filter');
    if (catSel) catSel.value = 'TODAS';
    const agrupSel = document.getElementById('f-agrupacion-filter');
    if (agrupSel) agrupSel.value = 'TODAS';
    const semaforoSel = document.getElementById('f-semaforo-filter');
    if (semaforoSel) semaforoSel.value = 'TODOS';
    const feeSel = document.getElementById('f-fee-filter');
    if (feeSel) feeSel.value = 'TODOS';

    currentFinanceStatusFilter = 'TODOS';
    document.querySelectorAll('.f-status-pills .f-pill').forEach(p => {
        if (p.getAttribute('data-status') === 'TODOS' || p.textContent.trim().toLowerCase() === 'todos') {
            p.classList.add('active');
        } else {
            p.classList.remove('active');
        }
    });

    athletesPage = 1;
    filterAthletesTable();
}

function filterAthletesTable() {
    const rawSearch = document.getElementById('f-search-input')?.value || '';
    const cat = document.getElementById('f-cat-filter')?.value || 'TODAS';
    const agrupacion = document.getElementById('f-agrupacion-filter')?.value || 'TODAS';
    const semaforo = document.getElementById('f-semaforo-filter')?.value || 'TODOS';
    const fee = document.getElementById('f-fee-filter')?.value || 'TODOS';

    filteredAthletesCache = allFinanceAthletes.filter(a => {
        // Filtro Categoría (Edad)
        if (cat !== 'TODAS' && a.category !== cat) return false;

        // Filtro Agrupación (Equipos Bayes)
        if (agrupacion !== 'TODAS' && a.agrupacion !== agrupacion) return false;

        // Filtro Inactivos / Retirados vs Activos
        const isAthInactive = a.status === 'INACTIVO' || a.status === 'RETIRADO';
        if (semaforo === 'INACTIVO') {
            if (!isAthInactive) return false;
        } else {
            // Por defecto ocultar alumnos inactivos o retirados
            if (isAthInactive) return false;
        }

        // Filtro Semáforo Deuda
        if (semaforo !== 'TODOS' && semaforo !== 'INACTIVO') {
            const sem = a.debt_semaforo || (a.payment_status === 'PAGADO' ? 'AL_DIA' : a.payment_status === 'BECADO' ? 'BECADO' : 'AMARILLO');
            if (semaforo === 'AL_DIA' && sem !== 'AL_DIA' && a.payment_status !== 'PAGADO') return false;
            if (semaforo === 'AMARILLO' && sem !== 'AMARILLO') return false;
            if (semaforo === 'NARANJA' && sem !== 'NARANJA') return false;
            if (semaforo === 'ROJO' && sem !== 'ROJO') return false;
            if (semaforo === 'BECADO' && sem !== 'BECADO' && a.payment_status !== 'BECADO') return false;
        }

        // Filtro Arancel / Cuota
        if (fee !== 'TODOS') {
            const fUpper = (a.fee_type || '').toUpperCase();
            const catUpper = (a.category || '').toUpperCase();
            if (fee === 'REGULAR' && fUpper !== 'REGULAR') return false;
            if (fee === 'ADULTO' && fUpper !== 'ADULTO') return false;
            if (fee === 'MINIVOLEY' && fUpper !== 'MINIVOLEY') return false;
            if (fee === 'MASTER' && fUpper !== 'MASTER' && !catUpper.includes('MASTER')) return false;
            if (fee === 'BECADO' && fUpper !== 'BECADO' && a.payment_status !== 'BECADO' && fUpper !== 'BECA_COMPLETA') return false;
        }

        // Filtro Estado
        if (currentFinanceStatusFilter !== 'TODOS') {
            if (currentFinanceStatusFilter === 'PAGADO' && a.payment_status !== 'PAGADO') return false;
            if (currentFinanceStatusFilter === 'PENDIENTE' && (a.payment_status === 'PAGADO' || a.payment_status === 'BECADO')) return false;
            if (currentFinanceStatusFilter === 'PARCIAL' && a.payment_status !== 'PARCIAL') return false;
            if (currentFinanceStatusFilter === 'BECADO' && a.payment_status !== 'BECADO') return false;
        }

        // Búsqueda inteligente multi-token
        if (rawSearch.trim() && !matchStudent(a, rawSearch)) {
            return false;
        }

        return true;
    });

    const statsEl = document.getElementById('f-athletes-count-stats');
    if (statsEl) {
        statsEl.textContent = `Mostrando ${filteredAthletesCache.length} de ${allFinanceAthletes.length} alumnos`;
    }

    renderAthletesPage();
}

function changeAthletesPage(delta) {
    const total = filteredAthletesCache.length;
    const totalPages = athletesPageSize === 'ALL' ? 1 : Math.max(1, Math.ceil(total / athletesPageSize));
    athletesPage += delta;
    if (athletesPage < 1) athletesPage = 1;
    if (athletesPage > totalPages) athletesPage = totalPages;
    renderAthletesPage();
}

function changeAthletesPageSize(size) {
    athletesPageSize = size === 'ALL' ? 'ALL' : parseInt(size, 10);
    athletesPage = 1;
    renderAthletesPage();
}

function renderAthletesPage() {
    const total = filteredAthletesCache.length;
    const totalPages = athletesPageSize === 'ALL' ? 1 : Math.max(1, Math.ceil(total / athletesPageSize));
    if (athletesPage > totalPages) athletesPage = totalPages;
    if (athletesPage < 1) athletesPage = 1;

    const start = athletesPageSize === 'ALL' ? 0 : (athletesPage - 1) * athletesPageSize;
    const end = athletesPageSize === 'ALL' ? total : start + athletesPageSize;
    const paged = filteredAthletesCache.slice(start, end);

    renderAthletesTable(paged);

    const infoEl = document.getElementById('f-ath-page-info');
    if (infoEl) {
        infoEl.textContent = `Página ${athletesPage} de ${totalPages} (${total} alumnos)`;
    }
    const prevBtn = document.getElementById('f-ath-prev-btn');
    if (prevBtn) prevBtn.disabled = (athletesPage <= 1);
    const nextBtn = document.getElementById('f-ath-next-btn');
    if (nextBtn) nextBtn.disabled = (athletesPage >= totalPages);
}

function renderAthletesTable(athletes) {
    const tbody = document.getElementById('f-athletes-tbody');
    if (!tbody) return;

    if (!athletes || athletes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">No se encontraron deportistas con los filtros seleccionados.</td></tr>`;
        return;
    }

    tbody.innerHTML = athletes.map(a => {
        // Semáforo Deuda Badge
        let semaforoBadge = '';
        const isInactive = a.status === 'INACTIVO' || a.status === 'RETIRADO';
        const sem = a.debt_semaforo || (a.payment_status === 'PAGADO' ? 'AL_DIA' : a.payment_status === 'BECADO' ? 'BECADO' : 'AMARILLO');
        
        if (isInactive) {
            semaforoBadge = a.status === 'RETIRADO'
                ? '<span class="badge-semaforo" style="background:#2a1b1b; color:#ff6b6b; border:1px solid #742a2a;">🚪 Retirado</span>'
                : '<span class="badge-semaforo" style="background:#222; color:#888; border:1px solid #444;">💤 Inactivo</span>';
        } else if (sem === 'AL_DIA' || a.payment_status === 'PAGADO') {
            semaforoBadge = '<span class="badge-semaforo badge-semaforo-al-dia">🟢 Al Día</span>';
        } else if (sem === 'BECADO' || a.payment_status === 'BECADO' || a.fee_type === 'BECA_COMPLETA') {
            semaforoBadge = '<span class="badge-semaforo badge-semaforo-becado">⚪ Becado</span>';
        } else if (sem === 'ROJO') {
            semaforoBadge = `<span class="badge-semaforo badge-semaforo-rojo" title="Deuda crítica mayor a 3 meses">${a.unpaid_months ? `🔴 ${a.unpaid_months} Meses` : '🔴 3+ Meses'}</span>`;
        } else if (sem === 'NARANJA') {
            semaforoBadge = '<span class="badge-semaforo badge-semaforo-naranja" title="2 meses consecutivos pendientes">🟠 2 Meses</span>';
        } else {
            semaforoBadge = '<span class="badge-semaforo badge-semaforo-amarillo" title="1 mes pendiente">🟡 1 Mes</span>';
        }

        // RUTs chips
        const rutsHtml = (a.formatted_ruts || []).map(r => `
            <span class="rut-chip" title="${r.payer_name || 'Apoderado'}">${r.formatted_rut}</span>
        `).join('') || '<span style="color:var(--text-dim); font-size:0.75rem;">Sin RUT</span>';

        const hasDebt = !isInactive && (a.debt_amount > 0 || (a.payment_status !== 'PAGADO' && a.payment_status !== 'BECADO' && a.fee_type !== 'BECA_COMPLETA'));

        return `
            <tr style="${isInactive ? 'opacity:0.75; background:rgba(0,0,0,0.15);' : ''}">
                <td>
                    <strong style="color:var(--text); font-size:0.92rem; display:block;">${a.full_name}</strong>
                    ${a.phone ? `<small style="color:var(--accent-light); font-size:0.75rem; display:block;">📞 ${a.phone}</small>` : ''}
                    ${a.notes ? `<small style="color:var(--text-dim); font-size:0.75rem;">${a.notes}</small>` : ''}
                </td>
                <td>
                    <span class="badge-agrupacion" style="font-weight:600; font-size:0.84rem; display:inline-block;">${a.agrupacion || 'Sin Agrupación'}</span>
                </td>
                <td>${semaforoBadge}</td>
                <td><strong>${(a.fee_type === 'BECADO' || a.fee_type === 'BECA_COMPLETA' || isInactive) ? (isInactive ? '-' : '$0') : formatCLP(a.monthly_fee)}</strong></td>
                <td style="color:${parseFloat(a.amount_paid) > 0 ? 'var(--success)' : 'var(--text-dim)'}; font-weight:700;">
                    ${formatCLP(a.amount_paid)}
                </td>
                <td>
                    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:4px;">
                        ${rutsHtml}
                        <button class="btn-add-rut" onclick="promptAddRut(${a.id})" title="Vincular otro RUT">+ RUT</button>
                    </div>
                </td>
                <td style="text-align:right; white-space:nowrap;">
                    ${hasDebt ? `<button class="btn-whatsapp btn-whatsapp-sm" onclick="openWhatsAppModal(${a.id})" title="Cobranza personalizada por WhatsApp" style="margin-right:4px;">💬 Cobrar</button>` : ''}
                    <button class="btn-action-sm" onclick="openAthleteModal(${a.id})">Ficha</button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterPendingTable() {
    const rawSearch = document.getElementById('f-pending-search-input')?.value || '';
    const cleanSearchRut = rawSearch.replace(/[^0-9Kk]/g, '').toUpperCase();
    const tokens = rawSearch.split(/\s+/).filter(Boolean).map(smartNormalize);
    const concept = document.getElementById('f-pending-concept-filter')?.value || 'TODOS';
    const amountFilter = document.getElementById('f-pending-amount-filter')?.value || 'TODOS';

    filteredPendingCache = allFinancePendingMovements.filter(m => {
        // Filtro Concepto
        if (concept !== 'TODOS' && m.category_concept !== concept) return false;

        // Filtro Monto
        const amt = parseFloat(m.amount) || 0;
        if (amountFilter === 'EXACT_50' && Math.round(amt) !== 50000) return false;
        if (amountFilter === 'EXACT_36' && Math.round(amt) !== 36000) return false;
        if (amountFilter === 'EXACT_35' && Math.round(amt) !== 35000) return false;
        if (amountFilter === 'ABOVE_50' && amt <= 50000) return false;
        if (amountFilter === 'BELOW_35' && amt >= 35000) return false;

        // Filtro Búsqueda
        if (tokens.length > 0) {
            const normPayer = smartNormalize(m.payer_name || '');
            const normBank = smartNormalize(m.bank_origin || '');
            const normNotes = smartNormalize(m.notes || '');
            const rutClean = (m.payer_rut || '').replace(/[^0-9Kk]/g, '').toUpperCase();

            if (cleanSearchRut.length >= 3 && rutClean.includes(cleanSearchRut)) {
                return true;
            }

            const combined = `${normPayer} ${normBank} ${normNotes}`;
            if (!tokens.every(t => combined.includes(t))) return false;
        }

        return true;
    });

    const statsEl = document.getElementById('f-pending-count-stats');
    if (statsEl) {
        statsEl.textContent = `Mostrando ${filteredPendingCache.length} de ${allFinancePendingMovements.length} transferencias`;
    }

    renderPendingPage();
}

function changePendingPage(delta) {
    const total = filteredPendingCache.length;
    const totalPages = pendingPageSize === 'ALL' ? 1 : Math.max(1, Math.ceil(total / pendingPageSize));
    pendingPage += delta;
    if (pendingPage < 1) pendingPage = 1;
    if (pendingPage > totalPages) pendingPage = totalPages;
    renderPendingPage();
}

function changePendingPageSize(size) {
    pendingPageSize = size === 'ALL' ? 'ALL' : parseInt(size, 10);
    pendingPage = 1;
    renderPendingPage();
}

function renderPendingPage() {
    const total = filteredPendingCache.length;
    const totalPages = pendingPageSize === 'ALL' ? 1 : Math.max(1, Math.ceil(total / pendingPageSize));
    if (pendingPage > totalPages) pendingPage = totalPages;
    if (pendingPage < 1) pendingPage = 1;

    const start = pendingPageSize === 'ALL' ? 0 : (pendingPage - 1) * pendingPageSize;
    const end = pendingPageSize === 'ALL' ? total : start + pendingPageSize;
    const paged = filteredPendingCache.slice(start, end);

    renderPendingMovements(paged);

    const infoEl = document.getElementById('f-pend-page-info');
    if (infoEl) infoEl.textContent = `Página ${pendingPage} de ${totalPages} (${total} pendientes)`;
    const prevBtn = document.getElementById('f-pend-prev-btn');
    if (prevBtn) prevBtn.disabled = (pendingPage <= 1);
    const nextBtn = document.getElementById('f-pend-next-btn');
    if (nextBtn) nextBtn.disabled = (pendingPage >= totalPages);
}

function resetPendingFilters() {
    const searchInp = document.getElementById('f-pending-search-input');
    if (searchInp) searchInp.value = '';
    const conceptSel = document.getElementById('f-pending-concept-filter');
    if (conceptSel) conceptSel.value = 'TODOS';
    const amountSel = document.getElementById('f-pending-amount-filter');
    if (amountSel) amountSel.value = 'TODOS';
    filterPendingTable();
}

function renderPendingMovements(movements) {
    const tbody = document.getElementById('f-pending-tbody');
    if (!tbody) return;

    if (!movements || movements.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">🎉 ¡Excelente! No hay transferencias pendientes por asignar en este período.</td></tr>`;
        return;
    }

    tbody.innerHTML = movements.map(m => {
        const selectedConcept = m.category_concept || 'MENSUALIDAD';
        return `
        <tr>
            <td style="white-space:nowrap; font-size:0.82rem; color:var(--text-muted);">${m.date || 'S/F'}</td>
            <td><code style="color:var(--accent-light); font-weight:700;">${m.formatted_rut || m.payer_rut || 'Sin RUT'}</code></td>
            <td>
                <strong style="color:var(--text); display:block;">${m.payer_name || 'Desconocido'}</strong>
                <small style="color:var(--text-dim); font-size:0.75rem;">${m.notes || m.bank_origin || ''}</small>
            </td>
            <td><span style="font-size:0.8rem; color:var(--text-muted);">${m.bank_origin || '-'}</span></td>
            <td><strong style="color:var(--success); font-size:0.95rem;">${formatCLP(m.amount)}</strong></td>
            <td>
                <select id="pending-concept-${m.id}" class="f-form-select" style="padding:4px 8px; font-size:0.8rem; background:#181818; border:1px solid #333; color:#fff; border-radius:6px; min-width:140px;">
                    <option value="POR_DEFINIR" ${(selectedConcept === 'POR_DEFINIR' || selectedConcept === 'EXTRA') ? 'selected' : ''}>⚡ Por definir</option>
                    <option value="OTROS" ${selectedConcept === 'OTROS' ? 'selected' : ''}>📦 Otros (Varios)</option>
                    <option value="MENSUALIDAD" ${selectedConcept === 'MENSUALIDAD' ? 'selected' : ''}>💳 Mensualidad</option>
                    <option value="MATRICULA" ${selectedConcept === 'MATRICULA' ? 'selected' : ''}>🎓 Matrícula</option>
                    <option value="ROPA" ${selectedConcept === 'ROPA' ? 'selected' : ''}>👕 Ropa</option>
                    <option value="DEBE" ${selectedConcept === 'DEBE' ? 'selected' : ''}>⏳ Debe</option>
                    <option value="PASES" ${selectedConcept === 'PASES' ? 'selected' : ''}>🎫 Pases</option>
                    <option value="TALLERES" ${selectedConcept === 'TALLERES' ? 'selected' : ''}>🏐 Talleres</option>
                    <option value="CLASES_PERSONALIZADAS" ${selectedConcept === 'CLASES_PERSONALIZADAS' ? 'selected' : ''}>🏋️ Clases personalizadas</option>
                    <option value="ARRIENDO_GYM" ${selectedConcept === 'ARRIENDO_GYM' ? 'selected' : ''}>🏢 Pago arriendo gym</option>
                </select>
            </td>
            <td>
                <div class="pending-assign-box" style="position:relative; min-width:260px;">
                    <div id="pending-chip-${m.id}" class="selected-ath-chip hidden">
                        <span id="pending-chip-name-${m.id}" style="font-size:0.8rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></span>
                        <button type="button" onclick="clearPendingSelectedAthlete(${m.id})">✕</button>
                    </div>
                    <div id="pending-input-wrap-${m.id}">
                        <input type="text" id="pending-input-${m.id}" class="f-form-input" style="font-size:0.82rem; padding:6px 10px;" placeholder="🔍 Escribe para buscar alumno..." oninput="searchAthletesForPending(${m.id}, this.value)" autocomplete="off">
                        <div id="pending-results-${m.id}" class="ath-dropdown-results hidden"></div>
                    </div>
                    <input type="hidden" id="pending-val-${m.id}" value="">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
                        <label style="font-size:0.75rem; color:var(--text-muted); cursor:pointer;">
                            <input type="checkbox" id="assign-rem-${m.id}" checked> Recordar RUT
                        </label>
                        <div style="display:flex; gap:6px;">
                            <button class="btn-action-sm" onclick="openCreateAthleteFromPending(${m.id})" title="Crear un alumno nuevo en el sistema y asignarle este pago de inmediato" style="color:var(--accent-light); font-weight:700;">➕ Nuevo</button>
                            <button class="btn-action-sm" onclick="openSplitMovementModal(${m.id})" title="Dividir este pago si es para 2 hermanos o varios conceptos">✂️ Dividir</button>
                            <button class="primary" style="padding:4px 10px; font-size:0.78rem;" onclick="assignMovement(${m.id})">✓ Asignar</button>
                        </div>
                    </div>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function searchAthletesForPending(movId, query) {
    const resultsEl = document.getElementById(`pending-results-${movId}`);
    if (!resultsEl) return;
    if (!query || !query.trim()) {
        resultsEl.classList.add('hidden');
        resultsEl.innerHTML = '';
        return;
    }

    const matches = allFinanceAthletes.filter(a => matchStudent(a, query)).slice(0, 8);

    let html = '';
    if (matches.length === 0) {
        html = `<div style="padding:8px 12px; font-size:0.8rem; color:var(--text-dim); text-align:center;">No se encontraron deportistas</div>`;
    } else {
        html = matches.map(a => `
            <div class="ath-dropdown-item" onclick="selectAthleteForPending(${movId}, ${a.id}, '${escQ(a.full_name)}', '${escQ(a.category)}')">
                <div>
                    <strong style="color:var(--text);">${a.full_name}</strong>
                    <small style="color:var(--text-dim); display:block; font-size:0.75rem;">${a.category} • ${a.agrupacion || 'Sin Agrupación'}</small>
                </div>
                <span style="font-weight:700; color:var(--accent-light); font-size:0.8rem;">${a.fee_type === 'BECADO' ? '$0' : formatCLP(a.monthly_fee)}</span>
            </div>
        `).join('');
    }

    html += `
        <div style="padding:6px; border-top:1px solid #333; background:rgba(255,255,255,0.03); text-align:center;">
            <button type="button" class="btn-action-sm" onclick="openCreateAthleteFromPending(${movId}, '${escQ(query)}')" style="width:100%; font-size:0.78rem; padding:4px 8px; color:var(--accent-light); border-color:var(--accent-dim);">
                ➕ Crear nuevo alumno "${escapeHtml(query)}"
            </button>
        </div>
    `;

    resultsEl.innerHTML = html;
    resultsEl.classList.remove('hidden');
}

function selectAthleteForPending(movId, athleteId, athleteName, athleteCat) {
    document.getElementById(`pending-val-${movId}`).value = athleteId;
    document.getElementById(`pending-chip-name-${movId}`).textContent = `👤 ${athleteName} (${athleteCat})`;
    document.getElementById(`pending-chip-${movId}`).classList.remove('hidden');
    document.getElementById(`pending-input-wrap-${movId}`).classList.add('hidden');
    document.getElementById(`pending-results-${movId}`).classList.add('hidden');
}

function clearPendingSelectedAthlete(movId) {
    document.getElementById(`pending-val-${movId}`).value = '';
    document.getElementById(`pending-chip-${movId}`).classList.add('hidden');
    document.getElementById(`pending-input-wrap-${movId}`).classList.remove('hidden');
    const input = document.getElementById(`pending-input-${movId}`);
    if (input) {
        input.value = '';
        input.focus();
    }
}

async function assignMovement(movId, forcedAthleteId) {
    const valInput = document.getElementById(`pending-val-${movId}`);
    const athleteId = forcedAthleteId !== undefined ? forcedAthleteId : valInput?.value;
    const chk = document.getElementById(`assign-rem-${movId}`);
    const conceptSel = document.getElementById(`pending-concept-${movId}`);
    const concept = conceptSel ? conceptSel.value : 'MENSUALIDAD';

    if (!athleteId) {
        if (concept === 'ARRIENDO_GYM' || concept === 'OTROS') {
            if (!confirm(`¿Deseas registrar este ingreso de ${concept === 'ARRIENDO_GYM' ? 'Pago arriendo gym' : 'Otros'} como ingreso general del club (sin alumno)?`)) {
                return;
            }
        } else {
            return toast('Busca y selecciona un alumno en el buscador primero (o elige Arriendo Gym / Otros para ingreso general)');
        }
    }

    try {
        const res = await fetch(`${API_BASE_URL}/finance/movements/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                movement_id: movId,
                athlete_id: athleteId ? parseInt(athleteId, 10) : null,
                concept: concept,
                remember_rut: chk ? chk.checked : true,
                period: currentFinancePeriod
            })
        });

        const data = await res.json();
        if (res.ok) {
            toast('✅ Pago asignado y conciliado con éxito');
            loadFinanceData();
        } else {
            toast(data.error || 'Error al asignar');
        }
    } catch (e) {
        toast('Error de conexión al asignar');
    }
}

function renderCategoriesTable(categories) {
    const tbody = document.getElementById('f-categories-tbody');
    if (!tbody) return;

    if (!categories || categories.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">Sin datos de agrupaciones.</td></tr>`;
        return;
    }

    tbody.innerHTML = categories.map(c => {
        const name = c.agrupacion || c.category || c.name || 'Sin Agrupación';
        const esp = parseFloat(c.esperado) || 0;
        const recMens = parseFloat(c.recaudado_mensualidad) || 0;
        const recExt = parseFloat(c.recaudado_extras) || 0;
        const rec = parseFloat(c.recaudado_total) || (recMens + recExt) || parseFloat(c.recaudado) || 0;
        const pct = esp > 0 ? Math.min(100, Math.round((rec / esp) * 100)) : (rec > 0 ? 100 : 0);
        const barColor = pct >= 100 ? 'var(--success)' : pct >= 50 ? '#ffab00' : 'var(--danger)';

        return `
            <tr>
                <td><strong style="color:var(--text); font-size:0.92rem;">${name}</strong></td>
                <td>${c.total_alumnos} deportistas</td>
                <td>${formatCLP(esp)}</td>
                <td style="color:${rec >= esp && esp > 0 ? 'var(--success)' : 'var(--accent-light)'}; font-weight:700;">
                    ${formatCLP(rec)}
                    ${recExt > 0 ? `<br><small style="color:var(--text-muted); font-size:0.75rem; font-weight:normal;">(Mens: ${formatCLP(recMens)} + Ext: ${formatCLP(recExt)})</small>` : ''}
                </td>
                <td style="min-width:180px;">
                    <div style="display:flex; justify-content:space-between; font-size:0.8rem; font-weight:700;">
                        <span>${pct}% recaudado</span>
                    </div>
                    <div class="cat-progress-bar">
                        <div class="cat-progress-fill" style="width:${pct}%; background:${barColor};"></div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// ── GESTIÓN DE PAGOS EXTRAS Y OTROS INGRESOS ──

function setExtrasAssignedFilter(filter, btn) {
    currentExtrasAssignedFilter = filter;
    document.querySelectorAll('#f-tab-extras .f-status-pills .f-pill').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
    extrasPage = 1;
    filterExtrasTable();
}

function filterExtrasTable() {
    const rawSearch = document.getElementById('f-extras-search-input')?.value || '';
    const cleanSearchRut = rawSearch.replace(/[^0-9Kk]/g, '').toUpperCase();
    const tokens = rawSearch.split(/\s+/).filter(Boolean).map(smartNormalize);
    const conceptFilter = document.getElementById('f-extras-concept-filter')?.value || 'TODOS';

    filteredExtrasCache = allFinanceExtrasMovements.filter(m => {
        // Filtro Concepto
        if (conceptFilter !== 'TODOS') {
            if (conceptFilter === 'POR_DEFINIR') {
                if (m.category_concept !== 'POR_DEFINIR' && m.category_concept !== 'EXTRA') return false;
            } else if (conceptFilter === 'OTROS') {
                if (m.category_concept !== 'OTROS' && m.category_concept !== 'VARIOS') return false;
            } else if (m.category_concept !== conceptFilter) {
                return false;
            }
        }

        // Filtro Asignación Alumno / Botón Por Definir
        if (currentExtrasAssignedFilter === 'POR_DEFINIR') {
            if (m.category_concept !== 'POR_DEFINIR' && m.category_concept !== 'EXTRA') return false;
        } else if (currentExtrasAssignedFilter === 'CON_ALUMNO') {
            // Un pago se considera asignado solo si tiene alumno y su concepto no está por definir
            if (!m.athlete_id || m.category_concept === 'POR_DEFINIR' || m.category_concept === 'EXTRA') return false;
        } else if (currentExtrasAssignedFilter === 'SIN_ALUMNO') {
            if (m.athlete_id) return false;
        }

        // Filtro Búsqueda Inteligente
        if (tokens.length > 0) {
            const normName = smartNormalize(m.athlete_name || '');
            const normPayer = smartNormalize(m.payer_name || '');
            const normNotes = smartNormalize(m.notes || '');
            const normConcept = smartNormalize(m.category_concept || '');
            const rutClean = (m.payer_rut || '').replace(/[^0-9Kk]/g, '').toUpperCase();

            if (cleanSearchRut.length >= 3 && rutClean.includes(cleanSearchRut)) return true;

            const combined = `${normName} ${normPayer} ${normNotes} ${normConcept}`;
            if (!tokens.every(t => combined.includes(t))) return false;
        }

        return true;
    });

    const statsEl = document.getElementById('f-extras-count-stats');
    if (statsEl) {
        statsEl.textContent = `Mostrando ${filteredExtrasCache.length} de ${allFinanceExtrasMovements.length} pagos extras`;
    }

    renderExtrasPage();
}

function changeExtrasPage(delta) {
    const total = filteredExtrasCache.length;
    const totalPages = extrasPageSize === 'ALL' ? 1 : Math.max(1, Math.ceil(total / extrasPageSize));
    extrasPage += delta;
    if (extrasPage < 1) extrasPage = 1;
    if (extrasPage > totalPages) extrasPage = totalPages;
    renderExtrasPage();
}

function changeExtrasPageSize(size) {
    extrasPageSize = size === 'ALL' ? 'ALL' : parseInt(size, 10);
    extrasPage = 1;
    renderExtrasPage();
}

function renderExtrasPage() {
    const total = filteredExtrasCache.length;
    const totalPages = extrasPageSize === 'ALL' ? 1 : Math.max(1, Math.ceil(total / extrasPageSize));
    if (extrasPage > totalPages) extrasPage = totalPages;
    if (extrasPage < 1) extrasPage = 1;

    const start = extrasPageSize === 'ALL' ? 0 : (extrasPage - 1) * extrasPageSize;
    const end = extrasPageSize === 'ALL' ? total : start + extrasPageSize;
    const paged = filteredExtrasCache.slice(start, end);

    renderExtrasTable(paged);

    const infoEl = document.getElementById('f-ext-page-info');
    if (infoEl) infoEl.textContent = `Página ${extrasPage} de ${totalPages} (${total} pagos extras)`;
    const prevBtn = document.getElementById('f-ext-prev-btn');
    if (prevBtn) prevBtn.disabled = (extrasPage <= 1);
    const nextBtn = document.getElementById('f-ext-next-btn');
    if (nextBtn) nextBtn.disabled = (extrasPage >= totalPages);
}

function resetExtrasFilters() {
    const searchInp = document.getElementById('f-extras-search-input');
    if (searchInp) searchInp.value = '';
    const conceptSel = document.getElementById('f-extras-concept-filter');
    if (conceptSel) conceptSel.value = 'TODOS';
    currentExtrasAssignedFilter = 'TODOS';
    document.querySelectorAll('#f-tab-extras .f-status-pills .f-pill').forEach(p => {
        if (p.getAttribute('data-filter') === 'TODOS' || p.textContent.trim().toLowerCase() === 'todos') {
            p.classList.add('active');
        } else {
            p.classList.remove('active');
        }
    });
    extrasPage = 1;
    filterExtrasTable();
}

function getConceptBadgeHtml(concept) {
    const c = (concept || 'POR_DEFINIR').toUpperCase().replace(/\s+/g, '_');
    let cls = 'concept-por-definir';
    let label = '⚡ Por Definir';

    if (c === 'MENSUALIDAD') {
        cls = 'concept-mensualidad';
        label = '💳 Mensualidad';
    } else if (c === 'ANULADO') {
        cls = 'concept-anulado';
        label = '🚫 Anulado / Devuelto';
    } else if (c === 'ARRIENDO_CANCHA') {
        cls = 'concept-arriendo_gym';
        label = '🏟️ Arriendo Cancha';
    } else if (c === 'INSCRIPCION_CAMPEONATO_VISITA') {
        cls = 'concept-pases';
        label = '🏆 Inscripción Camp. (Visita)';
    } else if (c === 'PAGO_CAMPEONATO_LOCAL') {
        cls = 'concept-pases';
        label = '🥇 Pago Camp. (Local)';
    } else if (c === 'MATRICULA') {
        cls = 'concept-matricula';
        label = '🎓 Matrícula';
    } else if (c === 'ROPA') {
        cls = 'concept-ropa';
        label = '👕 Ropa';
    } else if (c === 'DEBE') {
        cls = 'concept-debe';
        label = '⏳ Debe';
    } else if (c === 'PASES') {
        cls = 'concept-pases';
        label = '🎫 Pases';
    } else if (c === 'TALLERES' || c === 'TALLER') {
        cls = 'concept-talleres';
        label = '🏐 Talleres';
    } else if (c === 'CLASES_PERSONALIZADAS' || c.includes('CLASES')) {
        cls = 'concept-clases_personalizadas';
        label = '🏋️ Clases personalizadas';
    } else if (c === 'ARRIENDO_GYM' || c.includes('ARRIENDO')) {
        cls = 'concept-arriendo_gym';
        label = '🏢 Pago arriendo gym';
    } else if (c === 'OTROS' || c === 'VARIOS') {
        cls = 'concept-otros';
        label = '📦 Otros (Varios)';
    } else if (c === 'POR_DEFINIR' || c === 'EXTRA') {
        cls = 'concept-por-definir';
        label = '⚡ Por Definir';
    } else {
        cls = 'concept-por-definir';
        label = `⚡ ${concept}`;
    }

    return `<span class="concept-badge ${cls}">${label}</span>`;
}

function renderExtrasTable(movements) {
    const tbody = document.getElementById('f-extras-tbody');
    if (!tbody) return;

    if (!movements || movements.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);">No hay pagos extras con los filtros seleccionados.</td></tr>`;
        return;
    }

    tbody.innerHTML = movements.map(m => {
        const studentInfo = m.athlete_name ? `
            <div>
                <strong style="color:var(--text); font-size:0.9rem; display:block;">${m.athlete_name}</strong>
                <span class="cat-pill" style="font-size:0.72rem;">${m.athlete_category || 'Club'}</span>
            </div>
        ` : `<span style="color:var(--text-dim); font-size:0.8rem; font-style:italic;">🏛️ Ingreso General / Sin Alumno</span>`;

        return `
            <tr>
                <td style="white-space:nowrap; font-size:0.82rem; color:var(--text-muted);">${m.date || 'S/F'}</td>
                <td>${studentInfo}</td>
                <td><code style="color:var(--accent-light); font-weight:700;">${m.formatted_rut || m.payer_rut || 'Sin RUT'}</code></td>
                <td>
                    <strong style="color:var(--text); font-size:0.88rem; display:block;">${m.payer_name || 'Desconocido'}</strong>
                    <small style="color:var(--text-dim); font-size:0.75rem;">${m.bank_origin || ''}</small>
                </td>
                <td><strong style="color:var(--success); font-size:0.95rem;">${formatCLP(m.amount)}</strong></td>
                <td>${getConceptBadgeHtml(m.category_concept)}</td>
                <td style="max-width:220px; font-size:0.8rem; color:var(--text-muted);">
                    ${m.notes || '-'}
                </td>
                <td style="text-align:right; white-space:nowrap;">
                    <button class="btn-action-sm" onclick="openEditMovementModal(${m.id})" title="Editar concepto o asignar alumno">✏️ Clasificar</button>
                    <button class="btn-action-sm" onclick="openSplitMovementModal(${m.id})" title="Dividir en partes para hermanos o varios conceptos" style="margin-left:4px;">✂️ Dividir</button>
                </td>
            </tr>
        `;
    }).join('');
}

function exportExtrasCSV() {
    if (!allFinanceExtrasMovements || allFinanceExtrasMovements.length === 0) {
        return toast('No hay pagos extras para exportar');
    }

    let csv = 'Fecha,Periodo,Alumno,Categoria,RUT Pagador,Nombre en Cartola,Monto,Concepto,Banco,Notas\n';
    allFinanceExtrasMovements.forEach(m => {
        csv += `"${m.date || ''}","${m.period || ''}","${m.athlete_name || 'General'}","${m.athlete_category || ''}","${m.formatted_rut || m.payer_rut || ''}","${(m.payer_name || '').replace(/"/g, '""')}",${m.amount},"${m.category_concept || 'EXTRA'}","${m.bank_origin || ''}","${(m.notes || '').replace(/"/g, '""')}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `pagos_extras_murano_${currentFinancePeriod}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast('📥 Planilla de pagos extras descargada');
}

// ── MODAL: EDITAR / CLASIFICAR MOVIMIENTO ──

function setupEditMovementModal(mov) {
    currentEditingMovement = mov;

    document.getElementById('edit-mov-date').textContent = `Fecha: ${mov.date || 'S/F'}`;
    document.getElementById('edit-mov-amount').textContent = formatCLP(mov.amount);
    document.getElementById('edit-mov-payer').textContent = `Pagador: ${mov.payer_name || 'Desconocido'}`;
    document.getElementById('edit-mov-rut').textContent = `RUT: ${mov.formatted_rut || mov.payer_rut || 'Sin RUT'}`;
    document.getElementById('edit-mov-concept').value = (mov.category_concept === 'EXTRA' ? 'POR_DEFINIR' : (mov.category_concept || 'POR_DEFINIR'));
    document.getElementById('edit-mov-period').value = mov.period || currentFinancePeriod;
    document.getElementById('edit-mov-notes').value = mov.notes || '';

    if (mov.athlete_id) {
        const ath = allFinanceAthletes.find(a => a.id === mov.athlete_id);
        const athName = mov.athlete_name || (ath ? ath.full_name : `${mov.first_name || ''} ${mov.last_name || ''}`.trim());
        const athCat = mov.athlete_category || (ath ? ath.category : '');
        selectAthleteForEdit(mov.athlete_id, athName, athCat);
    } else {
        clearEditMovementAthlete();
    }

    document.getElementById('f-edit-mov-modal')?.classList.remove('hidden');
}

async function openEditMovementModal(movId) {
    let mov = allFinanceExtrasMovements.find(m => m.id === movId) || 
              allFinancePendingMovements.find(m => m.id === movId) ||
              (typeof currentAthleteMovementsCache !== 'undefined' && currentAthleteMovementsCache.find(m => m.id === movId));

    if (!mov) {
        try {
            const res = await fetch(`${API_BASE_URL}/finance/movements?id=${movId}`);
            const list = await res.json();
            if (list && list.length > 0) mov = list[0];
        } catch (e) {}
    }

    if (!mov) return toast('Movimiento no encontrado');
    setupEditMovementModal(mov);
}

function closeEditMovementModal() {
    document.getElementById('f-edit-mov-modal')?.classList.add('hidden');
    currentEditingMovement = null;
}

function searchAthletesForEdit(query) {
    const resultsEl = document.getElementById('edit-mov-ath-results');
    if (!resultsEl) return;
    if (!query || !query.trim()) {
        resultsEl.classList.add('hidden');
        resultsEl.innerHTML = '';
        return;
    }

    const matches = allFinanceAthletes.filter(a => matchStudent(a, query)).slice(0, 8);

    if (matches.length === 0) {
        resultsEl.innerHTML = `<div style="padding:8px 12px; font-size:0.8rem; color:var(--text-dim);">No se encontraron deportistas</div>`;
    } else {
        resultsEl.innerHTML = matches.map(a => `
            <div class="ath-dropdown-item" onclick="selectAthleteForEdit(${a.id}, '${escQ(a.full_name)}', '${escQ(a.category)}')">
                <div>
                    <strong style="color:var(--text);">${a.full_name}</strong>
                    <small style="color:var(--text-dim); display:block; font-size:0.75rem;">${a.category}</small>
                </div>
                <span style="font-weight:700; color:var(--accent-light); font-size:0.8rem;">${a.fee_type === 'BECADO' ? '$0' : formatCLP(a.monthly_fee)}</span>
            </div>
        `).join('');
    }
    resultsEl.classList.remove('hidden');
}

let selectedEditAthleteId = null;

function selectAthleteForEdit(athleteId, athleteName, athleteCat) {
    selectedEditAthleteId = athleteId;
    const nameEl = document.getElementById('edit-mov-selected-name');
    if (nameEl) nameEl.textContent = `👤 ${athleteName} (${athleteCat})`;
    document.getElementById('edit-mov-selected-ath')?.classList.remove('hidden');
    document.getElementById('edit-mov-ath-search')?.classList.add('hidden');
    document.getElementById('edit-mov-ath-results')?.classList.add('hidden');
}

function clearEditMovementAthlete() {
    selectedEditAthleteId = null;
    document.getElementById('edit-mov-selected-ath')?.classList.add('hidden');
    const input = document.getElementById('edit-mov-ath-search');
    if (input) {
        input.classList.remove('hidden');
        input.value = '';
    }
    document.getElementById('edit-mov-ath-results')?.classList.add('hidden');
}

async function saveEditMovement() {
    if (!currentEditingMovement) return;

    const concept = document.getElementById('edit-mov-concept')?.value || 'EXTRA';
    const period = document.getElementById('edit-mov-period')?.value || currentFinancePeriod;
    const notes = document.getElementById('edit-mov-notes')?.value?.trim() || '';

    try {
        const res = await fetch(`${API_BASE_URL}/finance/movements/${currentEditingMovement.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                category_concept: concept,
                athlete_id: selectedEditAthleteId,
                period: period,
                notes: notes
            })
        });

        const data = await res.json();
        if (res.ok) {
            toast('✅ Movimiento actualizado exitosamente');
            closeEditMovementModal();
            loadFinanceData();
            if (currentActiveAthlete && currentActiveAthlete.id) {
                openAthleteModal(currentActiveAthlete.id);
            }
        } else {
            toast(data.error || 'Error al actualizar');
        }
    } catch (e) {
        toast('Error de conexión al actualizar');
    }
}

// ── MODAL: DIVIDIR / DESGLOSAR PAGO (PARA HERMANOS O MULTI-CONCEPTOS) ──

const FINANCE_PERIODS_LIST = [
    'JULIO-2026',
    'AGOSTO-2026',
    'SEPTIEMBRE-2026',
    'OCTUBRE-2026',
    'NOVIEMBRE-2026',
    'DICIEMBRE-2026',
    'ENERO-2027',
    'FEBRERO-2027',
    'MARZO-2027'
];

let currentSplittingMovement = null;

function openSplitMovementModal(movId) {
    const mov = allFinanceExtrasMovements.find(m => m.id === movId) || 
                allFinancePendingMovements.find(m => m.id === movId) ||
                (typeof currentAthleteMovementsCache !== 'undefined' && currentAthleteMovementsCache.find(m => m.id === movId));
    if (!mov) return toast('Movimiento no encontrado');
    currentSplittingMovement = mov;

    document.getElementById('split-orig-payer').textContent = mov.payer_name || 'Desconocido';
    document.getElementById('split-orig-meta').textContent = `${mov.date || 'S/F'} • RUT: ${mov.formatted_rut || mov.payer_rut || 'Sin RUT'} • ${mov.bank_origin || ''}`;
    document.getElementById('split-orig-amount').textContent = formatCLP(mov.amount);

    const totalAmt = parseFloat(mov.amount) || 0;
    const halfAmt = Math.floor(totalAmt / 2);
    const remAmt = totalAmt - halfAmt;

    // Inicializar con 2 partes por defecto
    splitParts = [
        { amount: halfAmt, athlete_id: mov.athlete_id || null, athlete_name: mov.athlete_name || '', athlete_cat: mov.athlete_category || '', concept: 'MENSUALIDAD', period: mov.period || currentFinancePeriod, notes: 'Parte 1' },
        { amount: remAmt, athlete_id: null, athlete_name: '', athlete_cat: '', concept: 'MENSUALIDAD', period: mov.period || currentFinancePeriod, notes: 'Parte 2' }
    ];

    renderSplitParts();
    updateSplitBalance();

    document.getElementById('f-split-modal')?.classList.remove('hidden');
}

function closeSplitModal() {
    document.getElementById('f-split-modal')?.classList.add('hidden');
    currentSplittingMovement = null;
    splitParts = [];
}

function autoSplitConsecutiveMonths() {
    if (!currentSplittingMovement) return;
    const total = parseFloat(currentSplittingMovement.amount) || 0;
    
    // Buscar alumno vinculado o sugerido
    let ath = null;
    if (currentSplittingMovement.athlete_id) {
        ath = allFinanceAthletes.find(a => a.id === currentSplittingMovement.athlete_id);
    }
    const fee = (ath && ath.monthly_fee) ? ath.monthly_fee : (total >= 100000 ? 50000 : 36000);
    const numMonths = Math.max(2, Math.floor(total / fee));
    const remainder = total - (fee * numMonths);

    const startIndex = FINANCE_PERIODS_LIST.indexOf(currentFinancePeriod);
    const baseIdx = startIndex >= 0 ? startIndex : 2;

    splitParts = [];
    for (let i = 0; i < numMonths; i++) {
        const periodName = FINANCE_PERIODS_LIST[baseIdx + i] || `MES-${i+1}`;
        splitParts.push({
            amount: fee + (i === numMonths - 1 ? remainder : 0),
            athlete_id: ath ? ath.id : null,
            athlete_name: ath ? ath.full_name : '',
            athlete_cat: ath ? ath.category : '',
            concept: 'MENSUALIDAD',
            period: periodName,
            notes: `Adelanto cuota ${periodName}`
        });
    }

    renderSplitParts();
    updateSplitBalance();
    toast(`Repartido en ${numMonths} meses consecutivos`);
}

function autoSplitEqualParts(partsCount) {
    if (!currentSplittingMovement) return;
    const total = parseFloat(currentSplittingMovement.amount) || 0;
    const count = parseInt(partsCount, 10) || 2;
    const basePart = Math.floor(total / count);
    const remainder = total - (basePart * count);

    const ath = currentSplittingMovement.athlete_id ? allFinanceAthletes.find(a => a.id === currentSplittingMovement.athlete_id) : null;

    splitParts = [];
    for (let i = 0; i < count; i++) {
        splitParts.push({
            amount: basePart + (i === count - 1 ? remainder : 0),
            athlete_id: i === 0 && ath ? ath.id : null,
            athlete_name: i === 0 && ath ? ath.full_name : '',
            athlete_cat: i === 0 && ath ? ath.category : '',
            concept: 'MENSUALIDAD',
            period: currentSplittingMovement.period || currentFinancePeriod,
            notes: `Parte ${i+1}`
        });
    }

    renderSplitParts();
    updateSplitBalance();
    toast(`Dividido en ${count} partes iguales`);
}

function renderSplitParts() {
    const container = document.getElementById('split-parts-container');
    if (!container) return;

    container.innerHTML = splitParts.map((part, idx) => {
        const hasAthlete = part.athlete_id && part.athlete_name;
        const curPeriod = part.period || currentFinancePeriod;

        return `
            <div class="split-part-card" id="split-part-card-${idx}">
                <div class="split-part-header">
                    <span>Parte #${idx + 1}</span>
                    ${splitParts.length > 2 ? `<button type="button" onclick="removeSplitPartRow(${idx})" style="background:transparent; border:none; color:var(--danger); cursor:pointer; font-size:0.78rem;">🗑️ Eliminar</button>` : ''}
                </div>
                <div class="split-grid" style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:8px;">
                    <div>
                        <label style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:3px;">MONTO ($ CLP)</label>
                        <input type="number" class="f-form-input" style="padding:6px 10px; font-size:0.88rem;" value="${part.amount}" oninput="onSplitPartAmountInput(${idx}, this.value)">
                    </div>
                    <div>
                        <label style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:3px;">CONCEPTO</label>
                        <select class="f-form-select" style="padding:6px 10px; font-size:0.88rem;" onchange="onSplitPartConceptChange(${idx}, this.value)">
                            <option value="MENSUALIDAD" ${part.concept === 'MENSUALIDAD' ? 'selected' : ''}>💳 Mensualidad</option>
                            <option value="POR_DEFINIR" ${part.concept === 'POR_DEFINIR' ? 'selected' : ''}>⚡ Por Definir</option>
                            <option value="ARRIENDO_CANCHA" ${part.concept === 'ARRIENDO_CANCHA' ? 'selected' : ''}>🏟️ Arriendo Cancha</option>
                            <option value="INSCRIPCION_CAMPEONATO_VISITA" ${part.concept === 'INSCRIPCION_CAMPEONATO_VISITA' ? 'selected' : ''}>🏆 Inscripción Camp. (Visita)</option>
                            <option value="PAGO_CAMPEONATO_LOCAL" ${part.concept === 'PAGO_CAMPEONATO_LOCAL' ? 'selected' : ''}>🥇 Pago Camp. (Local)</option>
                            <option value="MATRICULA" ${part.concept === 'MATRICULA' ? 'selected' : ''}>📋 Matrícula</option>
                            <option value="ROPA" ${part.concept === 'ROPA' ? 'selected' : ''}>👕 Ropa</option>
                            <option value="DEBE" ${part.concept === 'DEBE' ? 'selected' : ''}>⚠️ Debe</option>
                            <option value="PASES" ${part.concept === 'PASES' ? 'selected' : ''}>🎟️ Pases</option>
                            <option value="TALLERES" ${part.concept === 'TALLERES' ? 'selected' : ''}>🏐 Talleres</option>
                            <option value="CLASES_PERSONALIZADAS" ${part.concept === 'CLASES_PERSONALIZADAS' ? 'selected' : ''}>⭐ Clases personalizadas</option>
                            <option value="ARRIENDO_GYM" ${part.concept === 'ARRIENDO_GYM' ? 'selected' : ''}>🏢 Pago arriendo gym</option>
                            <option value="ANULADO" ${part.concept === 'ANULADO' ? 'selected' : ''}>🚫 Anulado</option>
                            <option value="OTROS" ${(part.concept === 'OTROS' || part.concept === 'EXTRA') ? 'selected' : ''}>⚪ Otros</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:3px;">MES / PERÍODO</label>
                        <select class="f-form-select" style="padding:6px 10px; font-size:0.88rem;" onchange="onSplitPartPeriodChange(${idx}, this.value)">
                            ${FINANCE_PERIODS_LIST.map(p => `<option value="${p}" ${curPeriod === p ? 'selected' : ''}>${p}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <div style="margin-bottom:8px;">
                    <label style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:3px;">ASIGNAR A ALUMNO</label>
                    <div class="ath-picker-container">
                        <div id="split-chip-${idx}" class="selected-ath-chip ${hasAthlete ? '' : 'hidden'}">
                            <span id="split-chip-name-${idx}" style="font-size:0.82rem;">${hasAthlete ? `👤 ${part.athlete_name} (${part.athlete_cat})` : ''}</span>
                            <button type="button" onclick="clearAthleteForSplit(${idx})">✕</button>
                        </div>
                        <div id="split-search-wrap-${idx}" class="${hasAthlete ? 'hidden' : ''}">
                            <input type="text" class="f-form-input" style="padding:6px 10px; font-size:0.84rem;" placeholder="🔍 Escribe para buscar alumno..." oninput="searchAthletesForSplit(${idx}, this.value)" autocomplete="off">
                            <div id="split-results-${idx}" class="ath-dropdown-results hidden"></div>
                        </div>
                    </div>
                </div>

                <div>
                    <label style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:3px;">GLOSA / NOTA</label>
                    <input type="text" class="f-form-input" style="padding:5px 10px; font-size:0.82rem;" value="${part.notes || ''}" placeholder="Ej. Cuota hermano 1" oninput="splitParts[${idx}].notes = this.value">
                </div>
            </div>
        `;
    }).join('');
}

function addSplitPartRow() {
    const origTotal = parseFloat(currentSplittingMovement?.amount) || 0;
    const currentSum = splitParts.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    const diff = Math.max(0, origTotal - currentSum);

    splitParts.push({
        amount: diff,
        athlete_id: null,
        athlete_name: '',
        athlete_cat: '',
        concept: 'MENSUALIDAD',
        period: currentFinancePeriod,
        notes: `Parte ${splitParts.length + 1}`
    });

    renderSplitParts();
    updateSplitBalance();
}

function removeSplitPartRow(index) {
    if (splitParts.length <= 2) return toast('Debe haber al menos 2 partes para dividir');
    splitParts.splice(index, 1);
    renderSplitParts();
    updateSplitBalance();
}

function onSplitPartAmountInput(index, val) {
    splitParts[index].amount = parseFloat(val) || 0;
    updateSplitBalance();
}

function onSplitPartConceptChange(index, val) {
    splitParts[index].concept = val;
}

function onSplitPartPeriodChange(index, val) {
    splitParts[index].period = val;
}

function searchAthletesForSplit(partIndex, query) {
    const resultsEl = document.getElementById(`split-results-${partIndex}`);
    if (!resultsEl) return;
    if (!query || !query.trim()) {
        resultsEl.classList.add('hidden');
        resultsEl.innerHTML = '';
        return;
    }

    const matches = allFinanceAthletes.filter(a => matchStudent(a, query)).slice(0, 8);

    if (matches.length === 0) {
        resultsEl.innerHTML = `<div style="padding:8px 12px; font-size:0.8rem; color:var(--text-dim);">No se encontraron deportistas</div>`;
    } else {
        resultsEl.innerHTML = matches.map(a => `
            <div class="ath-dropdown-item" onclick="selectAthleteForSplit(${partIndex}, ${a.id}, '${escQ(a.full_name)}', '${escQ(a.category)}')">
                <div>
                    <strong style="color:var(--text);">${a.full_name}</strong>
                    <small style="color:var(--text-dim); display:block; font-size:0.75rem;">${a.category}</small>
                </div>
                <span style="font-weight:700; color:var(--accent-light); font-size:0.8rem;">${a.fee_type === 'BECADO' ? '$0' : formatCLP(a.monthly_fee)}</span>
            </div>
        `).join('');
    }
    resultsEl.classList.remove('hidden');
}

function selectAthleteForSplit(partIndex, athleteId, athleteName, athleteCat) {
    splitParts[partIndex].athlete_id = athleteId;
    splitParts[partIndex].athlete_name = athleteName;
    splitParts[partIndex].athlete_cat = athleteCat;

    document.getElementById(`split-chip-name-${partIndex}`).textContent = `👤 ${athleteName} (${athleteCat})`;
    document.getElementById(`split-chip-${partIndex}`).classList.remove('hidden');
    document.getElementById(`split-search-wrap-${partIndex}`).classList.add('hidden');
    document.getElementById(`split-results-${partIndex}`).classList.add('hidden');
}

function clearAthleteForSplit(partIndex) {
    splitParts[partIndex].athlete_id = null;
    splitParts[partIndex].athlete_name = '';
    splitParts[partIndex].athlete_cat = '';

    document.getElementById(`split-chip-${partIndex}`).classList.add('hidden');
    document.getElementById(`split-search-wrap-${partIndex}`).classList.remove('hidden');
    const input = document.querySelector(`#split-search-wrap-${partIndex} input`);
    if (input) {
        input.value = '';
        input.focus();
    }
}

function updateSplitBalance() {
    if (!currentSplittingMovement) return;
    const origTotal = parseFloat(currentSplittingMovement.amount) || 0;
    const currentSum = splitParts.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    const diff = origTotal - currentSum;

    const sumDisplay = document.getElementById('split-sum-display');
    const statusEl = document.getElementById('split-balance-status');
    const submitBtn = document.getElementById('btn-submit-split');

    if (sumDisplay) sumDisplay.textContent = formatCLP(currentSum);

    if (Math.abs(diff) < 1) {
        if (statusEl) {
            statusEl.innerHTML = '✅ El total cuadra exactamente';
            statusEl.style.color = 'var(--success)';
        }
        if (submitBtn) submitBtn.disabled = false;
    } else if (diff > 0) {
        if (statusEl) {
            statusEl.innerHTML = `⚠️ Faltan ${formatCLP(diff)} por asignar`;
            statusEl.style.color = 'var(--danger)';
        }
        if (submitBtn) submitBtn.disabled = true;
    } else {
        if (statusEl) {
            statusEl.innerHTML = `⚠️ Excedido por ${formatCLP(Math.abs(diff))}`;
            statusEl.style.color = 'var(--danger)';
        }
        if (submitBtn) submitBtn.disabled = true;
    }
}

async function submitSplitMovement() {
    if (!currentSplittingMovement) return;

    const origTotal = parseFloat(currentSplittingMovement.amount) || 0;
    const currentSum = splitParts.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    if (Math.abs(origTotal - currentSum) > 1) {
        return toast('La suma de las partes debe ser idéntica al monto original');
    }

    const payload = {
        movement_id: currentSplittingMovement.id,
        splits: splitParts.map(p => ({
            amount: p.amount,
            athlete_id: p.athlete_id,
            concept: p.concept,
            notes: p.notes,
            period: p.period || currentFinancePeriod
        }))
    };

    const btn = document.getElementById('btn-submit-split');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Dividiendo...';
    }

    try {
        const res = await fetch(`${API_BASE_URL}/finance/movements/split`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok) {
            toast('🎉 ¡Pago dividido y asignado con éxito!');
            closeSplitModal();
            loadFinanceData();
            if (currentActiveAthlete && currentActiveAthlete.id) {
                openAthleteModal(currentActiveAthlete.id);
            }
        } else {
            toast(data.error || 'Error al dividir pago');
        }
    } catch (e) {
        toast('Error de conexión al dividir pago');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '✓ Confirmar y Dividir';
        }
    }
}

// ── MANEJO Y CONCILIACIÓN DE CARTOLA BANCARIA ──

let currentCartolaMode = 'CARTOLA'; // 'CARTOLA' | 'SCOTIABANK_MOV'

function setCartolaUploadMode(mode) {
    currentCartolaMode = mode;
    const cardCartola = document.getElementById('mode-card-cartola');
    const cardScotia = document.getElementById('mode-card-scotia');
    const dropIcon = document.getElementById('cartola-drop-icon');
    const dropTitle = document.getElementById('cartola-drop-title');
    const dropSub = document.getElementById('cartola-drop-sub');
    const dropFormats = document.getElementById('cartola-drop-formats');

    if (mode === 'SCOTIABANK_MOV') {
        if (cardScotia) cardScotia.classList.add('active');
        if (cardCartola) cardCartola.classList.remove('active');
        if (dropIcon) dropIcon.textContent = '🏦';
        if (dropTitle) dropTitle.textContent = 'Arrastra aquí el archivo typeDesc.xml de Scotiabank';
        if (dropSub) dropSub.textContent = 'o haz clic para seleccionar Últimos Movimientos (.xml o Excel)';
        if (dropFormats) dropFormats.textContent = 'Filtra automáticamente salidas de dinero y detecta transferencias dentro del mismo banco Scotiabank';
    } else {
        if (cardCartola) cardCartola.classList.add('active');
        if (cardScotia) cardScotia.classList.remove('active');
        if (dropIcon) dropIcon.textContent = '📥';
        if (dropTitle) dropTitle.textContent = 'Arrastra aquí la Cartola Bancaria (Excel o CSV)';
        if (dropSub) dropSub.textContent = 'o haz clic para seleccionar el archivo desde tu equipo';
        if (dropFormats) dropFormats.textContent = 'Formatos soportados: .xlsx, .xls, .csv';
    }
}

function handleCartolaFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const fileName = (file.name || '').toLowerCase();

    // Auto-detección: Si es XML de Scotiabank (typeDesc)
    if (fileName.endsWith('.xml')) {
        setCartolaUploadMode('SCOTIABANK_MOV');
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const xmlText = e.target.result;
                processScotiabankXML(xmlText);
            } catch (err) {
                console.error('Error leyendo XML Scotiabank:', err);
                toast('Error al leer el archivo XML de Scotiabank');
            }
        };
        reader.readAsText(file);
        return;
    }

    // Archivo Excel o CSV
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // Buscar hoja según período o primera
            let sheetName = workbook.SheetNames[0];
            const pUpper = currentFinancePeriod.toUpperCase();
            const matched = workbook.SheetNames.find(s => pUpper.includes(s.toUpperCase()) || s.toUpperCase().includes(pUpper.split('-')[0]));
            if (matched) sheetName = matched;

            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            processCartolaRows(rows);
        } catch (err) {
            console.error('Error leyendo cartola:', err);
            toast('Error al leer el archivo Excel/CSV');
        }
    };
    reader.readAsArrayBuffer(file);
}

function processScotiabankXML(xmlText) {
    if (!xmlText || !xmlText.includes('<movimiento')) {
        return toast('El archivo no contiene movimientos de Scotiabank válidos');
    }

    let movimientos = [];
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        const movElements = xmlDoc.getElementsByTagName('movimiento');
        for (let i = 0; i < movElements.length; i++) {
            const m = movElements[i];
            const getVal = (tag) => {
                const el = m.getElementsByTagName(tag)[0];
                return el ? el.textContent.trim() : '';
            };
            movimientos.push({
                monto: getVal('monto'),
                cargo: getVal('cargo'),
                abono: getVal('abono'),
                fecha: getVal('fecha_movimiento'),
                desc: getVal('descripcion'),
                doc: getVal('documento_numero'),
                sucursal: getVal('sucursal')
            });
        }
    } catch (e) {
        const regex = /<movimiento>(.*?)<\/movimiento>/gs;
        let match;
        while ((match = regex.exec(xmlText)) !== null) {
            const movXml = match[1];
            const getTag = (tag) => {
                const m = movXml.match(new RegExp('<' + tag + '>(.*?)</' + tag + '>'));
                return m ? m[1].trim() : '';
            };
            movimientos.push({
                monto: getTag('monto'),
                cargo: getTag('cargo'),
                abono: getTag('abono'),
                fecha: getTag('fecha_movimiento'),
                desc: getTag('descripcion'),
                doc: getTag('documento_numero'),
                sucursal: getTag('sucursal')
            });
        }
    }

    let totalLeidos = movimientos.length;
    let cargosDescartados = 0;
    parsedCartolaRows = [];

    movimientos.forEach(m => {
        const monto = parseFloat(m.monto) || 0;
        const abono = parseFloat(m.abono) || 0;
        const amt = abono || monto;

        // Descartar egresos, cargos negativos, compras Redcompra o salidas
        if (amt <= 0) {
            cargosDescartados++;
            return;
        }

        let payerRut = '';
        let payerName = m.desc || 'Desconocido';
        const tefMatch = m.desc.match(/TEF\s+([0-9Kk.-]+)\s*(.*)/i);
        if (tefMatch) {
            payerRut = tefMatch[1].replace(/[^0-9Kk]/g, '').toUpperCase();
            payerName = tefMatch[2].trim() || m.desc;
        } else if (m.desc.toUpperCase().startsWith('TRANSF. DE ')) {
            payerName = m.desc.substring(10).trim();
        }

        parsedCartolaRows.push({
            date: m.fecha,
            transfer_type: 'TRANSFERENCIA',
            account_dest: '',
            payer_rut: payerRut,
            payer_name: payerName,
            bank_origin: m.sucursal ? `Scotiabank (${m.sucursal})` : 'Scotiabank',
            account_origin: m.doc || '',
            amount: Math.round(amt),
            concept: m.desc
        });
    });

    if (parsedCartolaRows.length === 0) {
        return toast('No se encontraron abonos ni transferencias positivas en el archivo');
    }

    // Mostrar preview
    const previewBox = document.getElementById('cartola-preview-box');
    const previewTitle = document.getElementById('cartola-preview-title');
    const previewStats = document.getElementById('cartola-preview-stats');
    const previewTbody = document.getElementById('cartola-preview-tbody');

    if (previewBox && previewTbody) {
        previewBox.classList.remove('hidden');
        previewTitle.textContent = `🏦 Últimos Movimientos Scotiabank (${parsedCartolaRows.length} abonos listos)`;
        if (previewStats) {
            previewStats.innerHTML = `Total leídos: <strong>${totalLeidos}</strong> | Egresos/salidas descartados: <strong style="color:var(--danger);">${cargosDescartados}</strong> | Abonos a conciliar: <strong style="color:var(--success);">${parsedCartolaRows.length}</strong>`;
        }

        previewTbody.innerHTML = parsedCartolaRows.slice(0, 12).map(m => `
            <tr>
                <td style="white-space:nowrap;">${m.date}</td>
                <td><code style="font-size:0.75rem; color:var(--text-muted);">${m.account_origin || '-'}</code></td>
                <td><code style="color:var(--accent-light); font-weight:700;">${m.payer_rut ? formatRut(m.payer_rut) : '<span style="color:#888;">Sin RUT</span>'}</code></td>
                <td>
                    <strong style="color:var(--text);">${m.payer_name}</strong>
                    ${m.payer_rut ? '' : '<small style="color:#ffab00; display:block; font-size:0.72rem;">⚡ Transf. interna Scotiabank</small>'}
                </td>
                <td><span style="font-size:0.8rem; color:var(--text-muted);">${m.bank_origin}</span></td>
                <td><strong style="color:var(--success); font-size:0.92rem;">${formatCLP(m.amount)}</strong></td>
            </tr>
        `).join('') + (parsedCartolaRows.length > 12 ? `<tr><td colspan="6" style="text-align:center; color:var(--text-dim);">... y ${parsedCartolaRows.length - 12} abonos más</td></tr>` : '');
    }

    toast(`🏦 ${parsedCartolaRows.length} abonos de Scotiabank listos para conciliar (se omitirán duplicados automáticamente)`);
}

function handlePasteCartola() {
    const text = document.getElementById('cartola-paste-area')?.value || '';
    if (!text.trim()) return toast('Pega texto de la cartola primero');

    if (text.includes('<cartola') || text.includes('<movimiento')) {
        setCartolaUploadMode('SCOTIABANK_MOV');
        return processScotiabankXML(text);
    }

    const lines = text.trim().split('\n');
    const rows = lines.map(l => l.split('\t').length > 1 ? l.split('\t') : l.split(';'));
    processCartolaRows(rows);
}

function processCartolaRows(rows) {
    if (!rows || rows.length === 0) return toast('La cartola está vacía');

    // Buscar encabezado
    let headerIdx = -1;
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
        const rowStr = (rows[r] || []).join(' ').toLowerCase();
        if (rowStr.includes('fecha') || rowStr.includes('rut')) {
            headerIdx = r;
            break;
        }
    }

    const startIdx = headerIdx !== -1 ? headerIdx + 1 : 0;
    parsedCartolaRows = [];

    for (let r = startIdx; r < rows.length; r++) {
        const row = rows[r];
        if (!row || !row[0]) continue;

        let date = row[0];
        let rut = row[3] || '';
        let name = row[4] || '';
        let amount = row[7] || row[5] || row[1] || 0;
        let bank = row[5] || '';
        let concept = row[8] || '';

        // Limpiar monto
        let cleanAmt = 0;
        if (typeof amount === 'number') cleanAmt = Math.round(amount);
        else {
            let s = amount.toString().replace(/[$\s]/g, '');
            if (s.includes(',')) s = s.split(',')[0];
            s = s.replace(/\./g, '');
            cleanAmt = parseInt(s, 10) || 0;
        }

        if (cleanAmt > 0) {
            parsedCartolaRows.push({
                date: date.toString().trim(),
                transfer_type: (row[1] || 'TRANSFERENCIA').toString().trim(),
                account_dest: (row[2] || '').toString().trim(),
                payer_rut: rut.toString().replace(/[^0-9Kk]/g, '').toUpperCase(),
                payer_name: name.toString().trim(),
                bank_origin: bank.toString().trim(),
                account_origin: (row[6] || '').toString().trim(),
                amount: cleanAmt,
                concept: concept.toString().trim()
            });
        }
    }

    if (parsedCartolaRows.length === 0) {
        return toast('No se encontraron movimientos válidos en la cartola');
    }

    // Mostrar preview
    const previewBox = document.getElementById('cartola-preview-box');
    const previewTitle = document.getElementById('cartola-preview-title');
    const previewStats = document.getElementById('cartola-preview-stats');
    const previewTbody = document.getElementById('cartola-preview-tbody');

    if (previewBox && previewTbody) {
        previewBox.classList.remove('hidden');
        previewTitle.textContent = `📋 Vista previa (${parsedCartolaRows.length} movimientos detectados para ${currentFinancePeriod})`;
        if (previewStats) {
            previewStats.innerHTML = `Movimientos a conciliar: <strong style="color:var(--success);">${parsedCartolaRows.length}</strong>`;
        }

        previewTbody.innerHTML = parsedCartolaRows.slice(0, 10).map(m => `
            <tr>
                <td style="white-space:nowrap;">${m.date}</td>
                <td><code style="font-size:0.75rem; color:var(--text-muted);">${m.account_origin || '-'}</code></td>
                <td><code>${m.payer_rut ? formatRut(m.payer_rut) : 'Sin RUT'}</code></td>
                <td>${m.payer_name || 'Sin nombre'}</td>
                <td>${m.bank_origin || '-'}</td>
                <td><strong style="color:var(--success);">${formatCLP(m.amount)}</strong></td>
            </tr>
        `).join('') + (parsedCartolaRows.length > 10 ? `<tr><td colspan="6" style="text-align:center; color:var(--text-dim);">... y ${parsedCartolaRows.length - 10} movimientos más</td></tr>` : '');
    }

    toast(`✅ ${parsedCartolaRows.length} movimientos listos para conciliar`);
}

async function executeCartolaReconciliation() {
    if (!parsedCartolaRows || parsedCartolaRows.length === 0) {
        return toast('Carga una cartola o archivo de movimientos primero');
    }

    const btn = document.getElementById('btn-run-reconciliation');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Conciliando con la BD...';
    }

    try {
        const res = await fetch(`${API_BASE_URL}/finance/cartola/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                period: currentFinancePeriod,
                movements: parsedCartolaRows
            })
        });

        const data = await res.json();
        if (res.ok) {
            toast('🎉 ¡Movimientos conciliados exitosamente!');
            const resBox = document.getElementById('cartola-result-box');
            const resDesc = document.getElementById('cartola-result-desc');
            if (resBox && resDesc) {
                resBox.classList.remove('hidden');
                resDesc.innerHTML = `
                    <strong>Resumen del proceso para ${data.period}:</strong><br>
                    • Total abonos procesados: <strong>${data.total_leidos}</strong><br>
                    • Nuevos movimientos insertados: <strong style="color:var(--success);">${data.insertados}</strong><br>
                    • Conciliados automáticamente a deportistas: <strong>${data.conciliados_automaticamente}</strong><br>
                    • Pendientes de asignar: <strong style="color:#ffc400;">${data.pendientes_por_asignar}</strong><br>
                    • Duplicados ya registrados (omitidos): <strong>${data.duplicados_omitidos}</strong>
                `;
            }

            // Ocultar preview y recargar datos financieros
            document.getElementById('cartola-preview-box')?.classList.add('hidden');
            parsedCartolaRows = [];
            loadFinanceData();
        } else {
            toast(data.error || 'Error al procesar movimientos');
        }
    } catch (e) {
        toast('Error de red al procesar movimientos');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🚀 Conciliar Transferencias';
        }
    }
}

// ── MODAL: FICHA DEL ALUMNO ──

function renderModalRuts(athlete) {
    const listEl = document.getElementById('modal-ath-ruts-list');
    if (!listEl) return;
    const ruts = (athlete && (athlete.formatted_ruts || athlete.payer_ruts)) || [];
    if (ruts.length === 0) {
        listEl.innerHTML = '<span style="color:var(--text-muted); font-size:0.8rem;">Sin RUTs de apoderados vinculados aún.</span>';
        return;
    }
    listEl.innerHTML = ruts.map(r => `
        <span class="rut-chip" style="font-size:0.82rem; padding:4px 8px; display:inline-flex; align-items:center; gap:6px;">
            <span>${r.formatted_rut || r.payer_rut} ${r.payer_name ? `(${r.payer_name})` : ''}</span>
            <button onclick="removePayerRut(${r.id})" style="background:transparent; border:none; color:var(--danger); cursor:pointer; font-size:0.85rem; padding:0 2px;" title="Desvincular RUT">✕</button>
        </span>
    `).join('');
}

function openAthleteModal(athleteId) {
    try {
        const athlete = allFinanceAthletes.find(a => String(a.id) === String(athleteId));
        if (!athlete) {
            toast('⚠️ No se encontró la información del deportista');
            return;
        }
        currentActiveAthlete = athlete;

        // Mostrar el modal inmediatamente
        const modal = document.getElementById('f-athlete-modal');
        if (modal) modal.classList.remove('hidden');

        const elName = document.getElementById('modal-ath-name');
        if (elName) elName.textContent = athlete.full_name;

        const elCat = document.getElementById('modal-ath-cat');
        if (elCat) elCat.textContent = athlete.category || 'Sin Categoría';

        const elFee = document.getElementById('modal-ath-fee');
        if (elFee) elFee.textContent = (athlete.fee_type === 'BECADO' || athlete.fee_type === 'BECA_COMPLETA') ? '$0 (Becado)' : formatCLP(athlete.monthly_fee);

        const elNotes = document.getElementById('modal-ath-notes');
        if (elNotes) elNotes.value = athlete.notes || '';

        // Agrupación & Semáforo badges in modal
        const agrupEl = document.getElementById('modal-ath-agrupacion');
        if (agrupEl) agrupEl.textContent = athlete.agrupacion || 'Sin Agrupación';

        const isInactive = athlete.status === 'INACTIVO' || athlete.status === 'RETIRADO';

        const sem = athlete.debt_semaforo || (athlete.payment_status === 'PAGADO' ? 'AL_DIA' : athlete.payment_status === 'BECADO' ? 'BECADO' : 'AMARILLO');
        const semEl = document.getElementById('modal-ath-semaforo');
        if (semEl) {
            if (isInactive) {
                semEl.className = 'badge-semaforo';
                semEl.style.background = '#222';
                semEl.style.color = '#888';
                semEl.textContent = athlete.status === 'RETIRADO' ? '🚪 Retirado' : '💤 Inactivo';
            } else {
                semEl.style.background = '';
                semEl.style.color = '';
                semEl.className = 'badge-semaforo ' + (
                    sem === 'AL_DIA' ? 'badge-semaforo-al-dia' :
                    sem === 'BECADO' ? 'badge-semaforo-becado' :
                    sem === 'ROJO' ? 'badge-semaforo-rojo' :
                    sem === 'NARANJA' ? 'badge-semaforo-naranja' : 'badge-semaforo-amarillo'
                );
                semEl.textContent = sem === 'AL_DIA' ? '🟢 Al Día' :
                                    sem === 'BECADO' ? '⚪ Becado' :
                                    sem === 'ROJO' ? `🔴 ${athlete.unpaid_months ? `${athlete.unpaid_months} Meses` : '3+ Meses'}` :
                                    sem === 'NARANJA' ? '🟠 2 Meses' : '🟡 1 Mes';
            }
        }

        // Status badge
        const stEl = document.getElementById('modal-ath-status');
        if (stEl) {
            if (isInactive) {
                stEl.className = 'badge-status';
                stEl.style.background = '#333';
                stEl.style.color = '#aaa';
                stEl.textContent = athlete.status === 'RETIRADO' ? 'Retirado' : 'Inactivo';
            } else {
                stEl.style.background = '';
                stEl.style.color = '';
                stEl.className = 'badge-status ' + (
                    athlete.payment_status === 'PAGADO' ? 'badge-ok' :
                    athlete.payment_status === 'BECADO' ? 'badge-becado' :
                    athlete.payment_status === 'PARCIAL' ? 'badge-parcial' : 'badge-deuda'
                );
                stEl.textContent = athlete.payment_status === 'PAGADO' ? 'Al Día' :
                                   athlete.payment_status === 'BECADO' ? 'Becado' :
                                   athlete.payment_status === 'PARCIAL' ? 'Parcial' : 'Con Deuda';
            }
        }

        // Populate editable fields in Ficha details
        const editCat = document.getElementById('modal-edit-cat');
        if (editCat) {
            if (athlete.category && !Array.from(editCat.options).some(o => o.value === athlete.category)) {
                const opt = document.createElement('option');
                opt.value = athlete.category;
                opt.textContent = athlete.category;
                editCat.appendChild(opt);
            }
            editCat.value = athlete.category || '';
        }

        const editAgrup = document.getElementById('modal-edit-agrupacion');
        if (editAgrup) {
            if (athlete.agrupacion && !Array.from(editAgrup.options).some(o => o.value === athlete.agrupacion)) {
                const opt = document.createElement('option');
                opt.value = athlete.agrupacion;
                opt.textContent = athlete.agrupacion;
                editAgrup.appendChild(opt);
            }
            editAgrup.value = athlete.agrupacion || '';
        }

        const editFeeType = document.getElementById('modal-edit-fee-type');
        if (editFeeType) editFeeType.value = athlete.fee_type || 'REGULAR';

        const editFeeAmt = document.getElementById('modal-edit-fee-amount');
        if (editFeeAmt) editFeeAmt.value = athlete.monthly_fee || 50000;

        const editPhone = document.getElementById('modal-edit-phone');
        if (editPhone) editPhone.value = athlete.phone || '';

        const editApodPhone = document.getElementById('modal-edit-apoderado-phone');
        if (editApodPhone) editApodPhone.value = athlete.apoderado_phone || '';

        const editJoinDate = document.getElementById('modal-edit-join-date');
        if (editJoinDate) {
            editJoinDate.value = athlete.join_date ? new Date(athlete.join_date).toISOString().slice(0, 10) : '2026-09-01';
        }

        const editStatus = document.getElementById('modal-edit-status');
        if (editStatus) editStatus.value = athlete.status || 'ACTIVO';

        const editNotes = document.getElementById('modal-edit-notes');
        if (editNotes) editNotes.value = athlete.notes || '';

        // Botón de Cobranza WhatsApp en el modal (oculto para inactivos/retirados)
        const btnWa = document.getElementById('btn-modal-wa-charge');
        if (btnWa) {
            const hasDebt = !isInactive && (athlete.debt_amount > 0 || (athlete.payment_status !== 'PAGADO' && athlete.payment_status !== 'BECADO' && athlete.fee_type !== 'BECA_COMPLETA'));
            btnWa.style.display = hasDebt ? 'inline-flex' : 'none';
        }

        renderModalRuts(athlete);

        // Cargar historial de pagos de forma desacoplada
        loadAthleteMovementsHistory(athlete.id);
    } catch (err) {
        console.error('Error al abrir ficha:', err);
    }
}

async function loadAthleteMovementsHistory(athleteId) {
    const tbody = document.getElementById('modal-ath-payments-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:15px; color:var(--text-muted);">Cargando historial...</td></tr>`;

    try {
        const res = await fetch(`${API_BASE_URL}/finance/movements?athlete_id=${athleteId}`);
        const movs = await res.json();
        currentAthleteMovementsCache = movs || [];
        if (tbody) {
            if (!movs || movs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:15px; color:var(--text-muted);">No hay transferencias registradas para este alumno.</td></tr>`;
            } else {
                tbody.innerHTML = movs.map(m => {
                    const isAnulado = m.category_concept === 'ANULADO';
                    return `
                    <tr style="${isAnulado ? 'opacity:0.6;' : ''}">
                        <td>${m.date || '-'}</td>
                        <td><span class="cat-pill">${m.period || '-'}</span></td>
                        <td><code>${m.formatted_rut || m.payer_rut || '-'}</code></td>
                        <td>${getConceptBadgeHtml(m.category_concept)}</td>
                        <td style="color:${isAnulado ? 'var(--text-muted)' : 'var(--success)'}; font-weight:700; ${isAnulado ? 'text-decoration:line-through;' : ''}">
                            ${formatCLP(m.amount)}
                        </td>
                        <td style="text-align:center;">
                            <button class="btn-action-sm" onclick="openEditMovementModal(${m.id})" style="font-size:0.75rem; padding:3px 8px;" title="Editar o reclasificar pago">✏️ Editar</button>
                        </td>
                    </tr>
                `}).join('');
            }
        }
    } catch (e) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--danger);">Error cargando historial</td></tr>`;
    }
}

function closeAthleteModal() {
    document.getElementById('f-athlete-modal')?.classList.add('hidden');
    currentActiveAthlete = null;
}

function onFeeTypeChangeInModal(feeType) {
    const feeInp = document.getElementById('modal-edit-fee-amount');
    if (!feeInp) return;
    if (feeType === 'BECA_COMPLETA' || feeType === 'BECADO') {
        feeInp.value = 0;
    } else if (feeType === 'MEDIA_BECA') {
        feeInp.value = 25000;
    } else if (feeType === 'CONVENIO_HERMANOS') {
        feeInp.value = 35000;
    } else if (feeType === 'REGULAR') {
        const cat = (document.getElementById('modal-edit-cat')?.value || '').toLowerCase();
        if (cat.includes('tc') || cat.includes('adult')) {
            feeInp.value = 35000;
        } else if (cat.includes('master') || cat.includes('mini')) {
            feeInp.value = 36000;
        } else {
            feeInp.value = 50000;
        }
    }
}

async function saveAthleteProfileChanges() {
    if (!currentActiveAthlete) return;
    const cat = document.getElementById('modal-edit-cat')?.value;
    const agrup = document.getElementById('modal-edit-agrupacion')?.value;
    const feeType = document.getElementById('modal-edit-fee-type')?.value;
    const feeAmount = parseFloat(document.getElementById('modal-edit-fee-amount')?.value) || 0;
    const phone = document.getElementById('modal-edit-phone')?.value?.trim();
    const apoderadoPhone = document.getElementById('modal-edit-apoderado-phone')?.value?.trim();
    const joinDate = document.getElementById('modal-edit-join-date')?.value;
    const status = document.getElementById('modal-edit-status')?.value;
    const notes = document.getElementById('modal-edit-notes')?.value?.trim();

    try {
        const res = await fetch(`${API_BASE_URL}/finance/athletes/${currentActiveAthlete.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                category: cat,
                agrupacion: agrup,
                fee_type: feeType,
                monthly_fee: feeAmount,
                phone: phone,
                apoderado_phone: apoderadoPhone,
                join_date: joinDate,
                status: status,
                notes: notes
            })
        });

        if (res.ok) {
            toast('✅ Ficha, categoría, arancel y estado actualizados con éxito');
            currentActiveAthlete.category = cat;
            currentActiveAthlete.agrupacion = agrup;
            currentActiveAthlete.fee_type = feeType;
            currentActiveAthlete.monthly_fee = feeAmount;
            currentActiveAthlete.phone = phone;
            currentActiveAthlete.apoderado_phone = apoderadoPhone;
            currentActiveAthlete.join_date = joinDate;
            currentActiveAthlete.status = status;
            currentActiveAthlete.notes = notes;

            document.getElementById('modal-ath-cat').textContent = cat;
            document.getElementById('modal-ath-fee').textContent = (feeType === 'BECA_COMPLETA' || feeType === 'BECADO') ? '$0 (Becado)' : formatCLP(feeAmount);
            loadFinanceData();
        } else {
            const data = await res.json();
            toast(data.error || 'Error al actualizar ficha');
        }
    } catch (e) {
        toast('Error de red al actualizar ficha');
    }
}

function promptAddRut(athleteId) {
    const rut = prompt('Ingresa el RUT del apoderado o alumno (ej. 15.234.567-8):');
    if (!rut) return;
    const name = prompt('Nombre del apoderado / titular de la cuenta:') || 'Apoderado';

    addRutApi(athleteId, rut, name);
}

async function addRutToCurrentAthlete() {
    if (!currentActiveAthlete) return;
    const input = document.getElementById('modal-new-rut-input');
    const rut = input?.value?.trim();
    if (!rut) return toast('Escribe un RUT válido');

    await addRutApi(currentActiveAthlete.id, rut, 'Apoderado');
    if (input) input.value = '';
}

async function addRutApi(athleteId, rut, payerName) {
    try {
        const res = await fetch(`${API_BASE_URL}/finance/athletes/ruts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                athlete_id: athleteId,
                payer_rut: rut,
                payer_name: payerName,
                relationship: 'Apoderado'
            })
        });

        const data = await res.json();
        if (res.ok) {
            toast('✅ RUT vinculado y pagos conciliados retroactivamente');
            loadFinanceData();
            if (currentActiveAthlete && currentActiveAthlete.id === athleteId) {
                currentActiveAthlete.payer_ruts = currentActiveAthlete.payer_ruts || [];
                currentActiveAthlete.payer_ruts.push(data);
                renderModalRuts(currentActiveAthlete);
            }
        } else {
            toast(data.error || 'Error al vincular RUT');
        }
    } catch (e) {
        toast('Error de conexión');
    }
}

async function removePayerRut(rutId) {
    if (!confirm('¿Deseas desvincular este RUT del alumno?')) return;
    try {
        const res = await fetch(`${API_BASE_URL}/finance/athletes/ruts/${rutId}`, { method: 'DELETE' });
        if (res.ok) {
            toast('RUT desvinculado');
            if (currentActiveAthlete) {
                currentActiveAthlete.payer_ruts = currentActiveAthlete.payer_ruts.filter(r => r.id !== rutId);
                renderModalRuts(currentActiveAthlete);
            }
            loadFinanceData();
        } else {
            toast('No se pudo desvincular');
        }
    } catch (e) { toast('Error de conexión'); }
}

async function saveAthleteNotes() {
    if (!currentActiveAthlete) return;
    const notes = document.getElementById('modal-ath-notes')?.value || '';
    try {
        const res = await fetch(`${API_BASE_URL}/finance/athletes/${currentActiveAthlete.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                first_name: currentActiveAthlete.first_name,
                last_name: currentActiveAthlete.last_name,
                category: currentActiveAthlete.category,
                fee_type: currentActiveAthlete.fee_type,
                monthly_fee: currentActiveAthlete.monthly_fee,
                status: currentActiveAthlete.status,
                notes: notes
            })
        });

        if (res.ok) {
            toast('✅ Observaciones guardadas');
            currentActiveAthlete.notes = notes;
            loadFinanceData();
        } else {
            toast('Error al guardar notas');
        }
    } catch (e) { toast('Error de red'); }
}

async function submitManualPayment() {
    if (!currentActiveAthlete) return;
    const amountInput = document.getElementById('manual-pay-amount');
    const methodInput = document.getElementById('manual-pay-method');
    const conceptInput = document.getElementById('manual-pay-concept');
    const dateInput = document.getElementById('manual-pay-date');

    const amount = amountInput?.value;
    if (!amount || parseFloat(amount) <= 0) {
        return toast('Ingresa un monto válido para el pago');
    }

    try {
        const res = await fetch(`${API_BASE_URL}/finance/payments/manual`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                athlete_id: currentActiveAthlete.id,
                amount: parseFloat(amount),
                method: methodInput?.value || 'EFECTIVO',
                concept: conceptInput?.value || 'MENSUALIDAD',
                date: dateInput?.value || new Date().toISOString().split('T')[0],
                period: currentFinancePeriod
            })
        });

        const data = await res.json();
        if (res.ok) {
            toast('✅ Pago manual registrado correctamente');
            if (amountInput) amountInput.value = '';
            // Recargar ficha del alumno y datos generales
            openAthleteModal(currentActiveAthlete.id);
            loadFinanceData();
        } else {
            toast(data.error || 'Error al registrar pago');
        }
    } catch (e) {
        toast('Error de conexión');
    }
}

// ── MODAL: NUEVO DEPORTISTA ──

let pendingMovementToAssignAfterCreate = null;

function openNewAthleteModal() {
    document.getElementById('f-new-athlete-modal')?.classList.remove('hidden');
    autoSelectFeeType();
}

function closeNewAthleteModal() {
    document.getElementById('f-new-athlete-modal')?.classList.add('hidden');
    pendingMovementToAssignAfterCreate = null;
}

function openCreateAthleteFromPending(movId, suggestedQuery) {
    pendingMovementToAssignAfterCreate = movId;
    const m = (allFinancePendingMovements && allFinancePendingMovements.find(x => x.id === movId)) || 
              (allFinanceMovements && allFinanceMovements.find(x => x.id === movId));

    const fNameInp = document.getElementById('new-ath-first-name');
    const lNameInp = document.getElementById('new-ath-last-name');
    const catSel = document.getElementById('new-ath-category');
    const agrupSel = document.getElementById('new-ath-agrupacion');
    const feeSel = document.getElementById('new-ath-fee-type');
    const rutInp = document.getElementById('new-ath-initial-rut');
    const payerInp = document.getElementById('new-ath-payer-name');
    const phoneInp = document.getElementById('new-ath-phone');
    const joinDateInp = document.getElementById('new-ath-join-date');
    const notesInp = document.getElementById('new-ath-notes');

    let firstName = '';
    let lastName = '';

    if (suggestedQuery && suggestedQuery.trim()) {
        const parts = suggestedQuery.trim().split(/\s+/);
        firstName = parts[0] || '';
        lastName = parts.slice(1).join(' ') || '';
    } else if (m && m.notes && !m.notes.includes('TEF') && !m.notes.includes('TRANSF') && !m.notes.includes('DE ')) {
        const cleanNotes = m.notes.replace(/AGOSTO|SEPTIEMBRE|JULIO|\|/gi, '').trim();
        const parts = cleanNotes.split(/\s+/);
        if (parts.length >= 2) {
            firstName = parts[0] || '';
            lastName = parts.slice(1).join(' ') || '';
        }
    }

    if (fNameInp) fNameInp.value = firstName;
    if (lNameInp) lNameInp.value = lastName;
    if (rutInp) rutInp.value = (m && m.payer_rut) ? formatRut(m.payer_rut) : '';
    if (payerInp) payerInp.value = (m && m.payer_name) || '';
    if (notesInp) notesInp.value = (m && m.notes) ? `Transferencia asociada: ${m.notes}` : '';

    if (joinDateInp) {
        if (m && m.date) joinDateInp.value = m.date.slice(0, 10);
        else joinDateInp.value = new Date().toISOString().slice(0, 10);
    }

    // Auto seleccionar tipo de cuota si el monto es típico
    if (m && m.amount) {
        const amt = parseFloat(m.amount);
        if (amt === 35000 && feeSel) feeSel.value = 'ADULTO';
        else if (amt === 36000 && feeSel) feeSel.value = 'MINIVOLEY';
        else if (amt === 50000 && feeSel) feeSel.value = 'REGULAR';
    }

    openNewAthleteModal();
}

function autoSelectFeeType() {
    const cat = (document.getElementById('new-ath-category')?.value || '').toLowerCase();
    const feeSel = document.getElementById('new-ath-fee-type');
    if (!feeSel) return;

    if (cat.includes('master') || cat.includes('máster')) {
        feeSel.value = 'MASTER';
    } else if (cat.includes('tc') || cat.includes('adult')) {
        feeSel.value = 'ADULTO';
    } else if (cat.includes('mini') || /\bu(6|7|8|9|10|11)\b/.test(cat)) {
        feeSel.value = 'MINIVOLEY';
    } else {
        feeSel.value = 'REGULAR';
    }
}

function updateNewAthFeeAmount() {
    // Automático según selección de fee type
}

async function saveNewAthlete() {
    const firstName = document.getElementById('new-ath-first-name')?.value?.trim();
    const lastName = document.getElementById('new-ath-last-name')?.value?.trim();
    const category = document.getElementById('new-ath-category')?.value;
    const agrupacion = document.getElementById('new-ath-agrupacion')?.value;
    const feeType = document.getElementById('new-ath-fee-type')?.value;
    const joinDate = document.getElementById('new-ath-join-date')?.value;
    const phone = document.getElementById('new-ath-phone')?.value?.trim();
    const initialRut = document.getElementById('new-ath-initial-rut')?.value?.trim();
    const payerName = document.getElementById('new-ath-payer-name')?.value?.trim();
    const notes = document.getElementById('new-ath-notes')?.value?.trim();

    if (!firstName || !lastName) {
        return toast('⚠️ Ingresa el nombre y apellido del deportista');
    }

    try {
        const res = await fetch(`${API_BASE_URL}/finance/athletes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                first_name: firstName,
                last_name: lastName,
                category: category,
                agrupacion: agrupacion,
                fee_type: feeType,
                join_date: joinDate,
                phone: phone,
                initial_rut: initialRut,
                payer_name: payerName,
                notes: notes
            })
        });

        if (res.ok) {
            const createdAthlete = await res.json();
            toast('✅ Deportista creado exitosamente');
            closeNewAthleteModal();

            // Si se originó desde una transferencia por asignar, vincularla inmediatamente
            if (pendingMovementToAssignAfterCreate && createdAthlete && createdAthlete.id) {
                const movId = pendingMovementToAssignAfterCreate;
                pendingMovementToAssignAfterCreate = null;
                const conceptSel = document.getElementById(`pending-concept-${movId}`);
                const concept = conceptSel ? conceptSel.value : 'MENSUALIDAD';
                await assignMovement(movId, createdAthlete.id);
                toast(`🎯 Transferencia asignada a ${createdAthlete.first_name} ${createdAthlete.last_name}`);
            }

            loadFinanceData();
        } else {
            const errData = await res.json();
            toast(errData.error || 'Error al crear deportista');
        }
    } catch (e) {
        toast('Error de conexión al crear deportista');
    }
}

function exportDebtorsCSV() {
    const debtors = allFinanceAthletes.filter(a => a.debt_amount > 0 && a.fee_type !== 'BECADO' && a.fee_type !== 'BECA_COMPLETA' && a.status !== 'INACTIVO' && a.status !== 'RETIRADO');
    if (debtors.length === 0) return toast('No hay deudores en este período');

    let csv = 'Alumno,Agrupacion,Telefono,Cuota Mensual,Pagado,Deuda,Estado,RUTs Asociados,Notas\n';
    debtors.forEach(d => {
        const ruts = (d.formatted_ruts || []).map(r => r.formatted_rut).join('; ');
        csv += `"${d.full_name}","${d.agrupacion || ''}","${d.phone || ''}",${d.monthly_fee},${d.amount_paid},${d.debt_amount},"${d.debt_semaforo || ''}","${ruts}","${(d.notes || '').replace(/"/g, '""')}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `deudores_murano_${currentFinancePeriod}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast('📥 Planilla de deudores descargada');
}

// ── COBRANZA PERSONALIZADA POR WHATSAPP ──

let currentWhatsAppAthlete = null;

function isAdultCategory(athlete) {
    if (!athlete) return false;
    const cat = `${athlete.category || ''} ${athlete.agrupacion || ''}`.toLowerCase();
    return cat.includes('tc') || cat.includes('master') || cat.includes('máster') || cat.includes('adulta') || cat.includes('adulto');
}

function openWhatsAppModal(athleteId) {
    const athlete = allFinanceAthletes.find(a => a.id === athleteId) || currentActiveAthlete;
    if (!athlete) return;
    currentWhatsAppAthlete = athlete;

    const debt = (athlete.debt_amount && athlete.debt_amount > 0) ? athlete.debt_amount : (athlete.monthly_fee || 50000);

    const nameEl = document.getElementById('wa-ath-name');
    const metaEl = document.getElementById('wa-ath-meta');
    const debtEl = document.getElementById('wa-ath-debt');
    const phoneInp = document.getElementById('wa-phone-input');
    const recipBadge = document.getElementById('wa-recipient-badge');
    const phoneLabel = document.getElementById('wa-phone-label');

    const isAdult = isAdultCategory(athlete);

    if (nameEl) nameEl.textContent = athlete.full_name;
    if (metaEl) metaEl.textContent = `${athlete.category} • ${athlete.agrupacion || 'Sin agrupación'}`;
    if (debtEl) debtEl.textContent = formatCLP(debt);

    if (isAdult) {
        if (recipBadge) {
            recipBadge.style.background = 'rgba(77, 171, 247, 0.2)';
            recipBadge.style.color = '#4dabf7';
            recipBadge.style.border = '1px solid rgba(77, 171, 247, 0.4)';
            recipBadge.textContent = '👤 Contacto Directo: Deportista (Categoría TC / Adulto)';
        }
        if (phoneLabel) phoneLabel.textContent = 'TELÉFONO O WHATSAPP DEL DEPORTISTA';
        if (phoneInp) phoneInp.value = athlete.phone || '';
    } else {
        if (recipBadge) {
            recipBadge.style.background = 'rgba(255, 171, 0, 0.2)';
            recipBadge.style.color = '#ffab00';
            recipBadge.style.border = '1px solid rgba(255, 171, 0, 0.4)';
            const ruts = athlete.payer_ruts || athlete.formatted_ruts || [];
            const apodName = ruts.find(r => r.payer_name)?.payer_name || 'Apoderado/a';
            recipBadge.textContent = `👨‍👩‍👧 Contacto: ${apodName} (Menor de edad)`;
        }
        if (phoneLabel) phoneLabel.textContent = 'TELÉFONO O WHATSAPP DEL APODERADO/A';
        if (phoneInp) phoneInp.value = athlete.apoderado_phone || athlete.phone || '';
    }

    resetWhatsAppTemplate();
    document.getElementById('f-whatsapp-modal')?.classList.remove('hidden');
}

function closeWhatsAppModal() {
    document.getElementById('f-whatsapp-modal')?.classList.add('hidden');
    currentWhatsAppAthlete = null;
}

function resetWhatsAppTemplate() {
    if (!currentWhatsAppAthlete) return;
    const a = currentWhatsAppAthlete;
    const debt = (a.debt_amount && a.debt_amount > 0) ? a.debt_amount : (a.monthly_fee || 50000);
    const period = currentFinancePeriod || 'el mes en curso';
    const isAdult = isAdultCategory(a);

    let template = '';
    if (isAdult) {
        template = `Hola ${a.first_name || a.full_name},

Te escribimos desde la tesorería de Club Vóleibol Murano para recordarte amablemente que mantienes pendiente la cuota deportiva correspondiente a ${period} por un monto de ${formatCLP(debt)} (${a.category}${a.agrupacion ? ` - ${a.agrupacion}` : ''}).

📋 Datos de transferencia:
• Banco: Scotiabank
• Tipo de cuenta: Cuenta Corriente
• N° de cuenta: 123456789
• Nombre: Club Deportivo Murano Voley
• RUT: 65.123.456-7
• Email: tesoreria@muranovoley.cl

Favor remitir el comprobante de transferencia a este mismo chat para conciliar y mantener tu cuenta al día.

¡Muchas gracias por tu compromiso continuo con el club! 🏐✨`;
    } else {
        template = `Hola estimad@ apoderad@ de ${a.full_name},

Le escribimos desde la tesorería de Club Vóleibol Murano para recordarle amablemente que mantiene pendiente la cuota deportiva correspondiente a ${period} por un monto de ${formatCLP(debt)} (${a.category}${a.agrupacion ? ` - ${a.agrupacion}` : ''}).

📋 Datos de transferencia:
• Banco: Scotiabank
• Tipo de cuenta: Cuenta Corriente
• N° de cuenta: 123456789
• Nombre: Club Deportivo Murano Voley
• RUT: 65.123.456-7
• Email: tesoreria@muranovoley.cl

Favor remitir el comprobante de transferencia a este mismo chat para conciliar y mantener la ficha de ${a.full_name} al día.

¡Muchas gracias por su apoyo continuo al club! 🏐✨`;
    }

    const txtArea = document.getElementById('wa-message-textarea');
    if (txtArea) txtArea.value = template;
}

async function sendWhatsAppMessage() {
    if (!currentWhatsAppAthlete) return;
    const phoneInp = document.getElementById('wa-phone-input');
    let rawPhone = (phoneInp?.value || '').trim();

    if (!rawPhone) {
        return toast('⚠️ Por favor ingresa el número de teléfono o WhatsApp');
    }

    // Limpiar número (eliminar espacios, signos, guiones)
    let cleanPhone = rawPhone.replace(/[^0-9]/g, '');
    if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) {
        cleanPhone = '56' + cleanPhone;
    } else if (cleanPhone.length === 8) {
        cleanPhone = '569' + cleanPhone;
    }

    const isAdult = isAdultCategory(currentWhatsAppAthlete);
    const saveCheck = document.getElementById('wa-save-phone-check');

    if (saveCheck && saveCheck.checked) {
        try {
            const body = isAdult 
                ? { phone: rawPhone } 
                : { apoderado_phone: rawPhone, phone: currentWhatsAppAthlete.phone || rawPhone };

            await fetch(`${API_BASE_URL}/finance/athletes/${currentWhatsAppAthlete.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (isAdult) {
                currentWhatsAppAthlete.phone = rawPhone;
            } else {
                currentWhatsAppAthlete.apoderado_phone = rawPhone;
                if (!currentWhatsAppAthlete.phone) currentWhatsAppAthlete.phone = rawPhone;
            }
        } catch (e) {
            console.error('Error guardando teléfono:', e);
        }
    }

    const msg = document.getElementById('wa-message-textarea')?.value || '';
    const waUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(msg)}`;

    toast('💬 Abriendo WhatsApp Web con el mensaje preparado...');
    window.open(waUrl, '_blank');
    closeWhatsAppModal();
}

// ── GESTIÓN DE EGRESOS Y GASTOS OPERATIVOS DEL CLUB ──

let allClubExpenses = [];
let filteredExpensesCache = [];
let currentEditingExpenseId = null;

async function loadExpenses() {
    const tbody = document.getElementById('f-expenses-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">Cargando egresos de ${currentFinancePeriod}...</td></tr>`;

    try {
        const res = await fetch(`${API_BASE_URL}/finance/expenses?period=${currentFinancePeriod}`);
        const data = await res.json();
        allClubExpenses = data.expenses || [];
        filterExpensesTable();
    } catch (e) {
        console.error('Error cargando egresos:', e);
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--danger);">Error al cargar egresos.</td></tr>`;
    }
}

function filterExpensesTable() {
    const search = (document.getElementById('f-expense-search')?.value || '').toLowerCase().trim();
    const cat = document.getElementById('f-expense-category-filter')?.value || 'TODOS';

    filteredExpensesCache = allClubExpenses.filter(e => {
        if (cat !== 'TODOS' && e.category !== cat) return false;
        if (search) {
            const combined = `${e.beneficiary || ''} ${e.receipt_number || ''} ${e.notes || ''} ${e.category || ''}`.toLowerCase();
            if (!combined.includes(search)) return false;
        }
        return true;
    });

    const statsEl = document.getElementById('f-expenses-count-stats');
    if (statsEl) statsEl.textContent = `Mostrando ${filteredExpensesCache.length} de ${allClubExpenses.length} egresos`;

    renderExpensesTable(filteredExpensesCache);
}

function renderExpensesTable(expenses) {
    const tbody = document.getElementById('f-expenses-tbody');
    if (!tbody) return;

    if (!expenses || expenses.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">No hay egresos registrados para este período.</td></tr>`;
        return;
    }

    const catLabels = {
        'ARRIENDO_GIMNASIO': '🏢 Arriendo Canchas/Gym',
        'HONORARIOS_ENTRENADORES': '🏐 Honorarios Staff',
        'TORNEOS_ARBITRAJE': '🏆 Torneos y Arbitrajes',
        'MATERIALES_INDUMENTARIA': '👕 Balones/Indumentaria',
        'SERVICIOS_BASICOS': '💡 Servicios/Operación',
        'OTROS': '📦 Otros Gastos'
    };

    tbody.innerHTML = expenses.map(e => `
        <tr>
            <td style="white-space:nowrap; font-size:0.85rem;">${e.date || '-'}</td>
            <td><strong style="color:var(--text);">${e.beneficiary || 'Proveedor'}</strong></td>
            <td><span class="cat-pill">${catLabels[e.category] || e.category}</span></td>
            <td><code style="font-size:0.75rem; color:var(--text-muted);">${e.receipt_number || '-'}</code></td>
            <td><span style="font-size:0.8rem; color:var(--text-muted);">${e.payment_method || '-'}</span></td>
            <td><strong style="color:var(--danger); font-size:0.95rem;">${formatCLP(e.amount)}</strong></td>
            <td style="text-align:right; white-space:nowrap;">
                <button class="btn-action-sm" onclick="openExpenseModal(${e.id})" title="Editar egreso" style="padding:3px 8px; font-size:0.75rem;">✏️</button>
                <button class="btn-action-sm" onclick="deleteExpense(${e.id})" title="Eliminar egreso" style="padding:3px 8px; font-size:0.75rem; color:var(--danger); border-color:rgba(244,67,54,0.3);">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function openExpenseModal(expenseId = null) {
    currentEditingExpenseId = expenseId;
    const title = document.getElementById('expense-modal-title');
    const dateInp = document.getElementById('expense-date');
    const periodSel = document.getElementById('expense-period');
    const catSel = document.getElementById('expense-category');
    const benInp = document.getElementById('expense-beneficiary');
    const amtInp = document.getElementById('expense-amount');
    const methSel = document.getElementById('expense-payment-method');
    const recInp = document.getElementById('expense-receipt');
    const notesInp = document.getElementById('expense-notes');

    if (expenseId) {
        const exp = allClubExpenses.find(e => e.id === expenseId);
        if (!exp) return;
        if (title) title.textContent = '✏️ Editar Egreso / Gasto';
        if (dateInp) dateInp.value = exp.date || '';
        if (periodSel) periodSel.value = exp.period || currentFinancePeriod;
        if (catSel) catSel.value = exp.category || 'OTROS';
        if (benInp) benInp.value = exp.beneficiary || '';
        if (amtInp) amtInp.value = exp.amount || '';
        if (methSel) methSel.value = exp.payment_method || 'TRANSFERENCIA';
        if (recInp) recInp.value = exp.receipt_number || '';
        if (notesInp) notesInp.value = exp.notes || '';
    } else {
        if (title) title.textContent = '📉 Registrar Egreso / Gasto';
        if (dateInp) dateInp.value = new Date().toISOString().split('T')[0];
        if (periodSel) periodSel.value = currentFinancePeriod;
        if (catSel) catSel.value = 'ARRIENDO_GIMNASIO';
        if (benInp) benInp.value = '';
        if (amtInp) amtInp.value = '';
        if (methSel) methSel.value = 'TRANSFERENCIA';
        if (recInp) recInp.value = '';
        if (notesInp) notesInp.value = '';
    }

    document.getElementById('f-expense-modal')?.classList.remove('hidden');
}

function closeExpenseModal() {
    document.getElementById('f-expense-modal')?.classList.add('hidden');
    currentEditingExpenseId = null;
}

async function saveExpense() {
    const date = document.getElementById('expense-date')?.value || new Date().toISOString().split('T')[0];
    const period = document.getElementById('expense-period')?.value || currentFinancePeriod;
    const category = document.getElementById('expense-category')?.value || 'OTROS';
    const beneficiary = document.getElementById('expense-beneficiary')?.value?.trim();
    const amount = parseFloat(document.getElementById('expense-amount')?.value) || 0;
    const payment_method = document.getElementById('expense-payment-method')?.value || 'TRANSFERENCIA';
    const receipt_number = document.getElementById('expense-receipt')?.value?.trim() || '';
    const notes = document.getElementById('expense-notes')?.value?.trim() || '';

    if (!beneficiary) {
        return toast('⚠️ Ingresa el nombre del beneficiario, proveedor o entrenador');
    }
    if (amount <= 0) {
        return toast('⚠️ Ingresa un monto de gasto válido mayor a $0');
    }

    const payload = { date, period, category, beneficiary, amount, payment_method, receipt_number, notes };

    try {
        let res;
        if (currentEditingExpenseId) {
            res = await fetch(`${API_BASE_URL}/finance/expenses/${currentEditingExpenseId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            res = await fetch(`${API_BASE_URL}/finance/expenses`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        if (res.ok) {
            toast(currentEditingExpenseId ? '✅ Egreso actualizado' : '✅ Egreso registrado correctamente');
            closeExpenseModal();
            loadExpenses();
            loadFinanceData();
        } else {
            const data = await res.json();
            toast(data.error || 'Error al guardar egreso');
        }
    } catch (e) {
        toast('Error de red al guardar egreso');
    }
}

async function deleteExpense(expenseId) {
    if (!confirm('¿Deseas eliminar este registro de egreso?')) return;
    try {
        const res = await fetch(`${API_BASE_URL}/finance/expenses/${expenseId}`, { method: 'DELETE' });
        if (res.ok) {
            toast('Egreso eliminado');
            loadExpenses();
            loadFinanceData();
        } else {
            toast('Error al eliminar');
        }
    } catch (e) {
        toast('Error de conexión');
    }
}

function exportExpensesCSV() {
    if (allClubExpenses.length === 0) return toast('No hay egresos para exportar');
    let csv = 'Fecha,Periodo,Categoria,Beneficiario,Monto,Medio Pago,N Comprobante,Notas\n';
    allClubExpenses.forEach(e => {
        csv += `"${e.date || ''}","${e.period || ''}","${e.category || ''}","${(e.beneficiary || '').replace(/"/g, '""')}",${e.amount},"${e.payment_method || ''}","${e.receipt_number || ''}","${(e.notes || '').replace(/"/g, '""')}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `egresos_murano_${currentFinancePeriod}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast('📥 Planilla de egresos descargada');
}

// ── REPORTE POR AGRUPACIONES Y SINCRONIZADOR BAYES ──

let currentCategoriesViewMode = 'agrupacion';

function setCategoriesViewMode(mode) {
    currentCategoriesViewMode = mode;
    const btnAgrup = document.getElementById('btn-cat-view-agrupacion');
    const btnCat = document.getElementById('btn-cat-view-category');
    const thTitle = document.getElementById('th-cat-title');

    if (mode === 'agrupacion') {
        if (btnAgrup) btnAgrup.classList.add('active');
        if (btnCat) btnCat.classList.remove('active');
        if (thTitle) thTitle.textContent = 'Agrupación / Equipo';
    } else {
        if (btnCat) btnCat.classList.add('active');
        if (btnAgrup) btnAgrup.classList.remove('active');
        if (thTitle) thTitle.textContent = 'Categoría (Por Edad)';
    }

    renderCategoriesByMode();
}

function renderCategoriesByMode() {
    if (!cachedSummaryData) return;
    if (currentCategoriesViewMode === 'agrupacion') {
        renderCategoriesTable(cachedSummaryData.agrupaciones || []);
    } else {
        renderCategoriesTable(cachedSummaryData.categorias || []);
    }
}

function openBayesSyncModal() {
    document.getElementById('f-bayes-sync-modal')?.classList.remove('hidden');
}

function closeBayesSyncModal() {
    document.getElementById('f-bayes-sync-modal')?.classList.add('hidden');
}

function copyBayesSnippet() {
    const snippet = document.getElementById('bayes-console-script');
    if (!snippet) return;
    snippet.select();
    navigator.clipboard.writeText(snippet.value).then(() => {
        toast('📋 ¡Código copiado! Pégalo en la consola de Bayes');
    }).catch(() => {
        toast('Selecciona y copia el texto del cuadro');
    });
}

async function submitBayesSync() {
    const rawText = document.getElementById('bayes-paste-input')?.value?.trim();
    if (!rawText) return toast('⚠️ Pega el contenido JSON o lista de alumnos de Bayes');

    let items = [];
    try {
        if (rawText.startsWith('[') || rawText.startsWith('{')) {
            const parsed = JSON.parse(rawText);
            items = Array.isArray(parsed) ? parsed : (parsed.deportistas || parsed.items || []);
        } else {
            const lines = rawText.split('\n').filter(Boolean);
            items = lines.map(line => {
                const parts = line.split('\t').length > 1 ? line.split('\t') : line.split(';');
                return {
                    name: parts[0]?.trim() || '',
                    category: parts[1]?.trim() || '',
                    agrupacion: parts[2]?.trim() || '',
                    phone: parts[3]?.trim() || ''
                };
            }).filter(i => i.name.length > 2);
        }
    } catch (e) {
        return toast('⚠️ El texto no tiene un formato JSON válido');
    }

    if (!items || items.length === 0) {
        return toast('No se encontraron registros de deportistas válidos en el texto');
    }

    toast(`⏳ Sincronizando ${items.length} deportistas con la base de datos...`);
    try {
        const res = await fetch(`${API_BASE_URL}/finance/bayes/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });
        const data = await res.json();
        if (res.ok) {
            toast(`🎉 ¡Sincronizado! Se actualizaron ${data.actualizados} de ${data.total_recibidos} deportistas`);
            closeBayesSyncModal();
            loadFinanceData();
        } else {
            toast(data.error || 'Error al sincronizar');
        }
    } catch (e) {
        toast('Error de conexión al sincronizar con Bayes');
    }
}

function initCartolaDropZone() {
    const dropZone = document.getElementById('cartola-drop-zone');
    if (!dropZone) return;

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
        }, false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt ? dt.files : null;
        if (files && files.length > 0) {
            handleCartolaFile({ target: { files: files } });
        }
    }, false);
}

// ── GESTIÓN HISTÓRICA, RESPALDO Y LIBERACIÓN DE BASE DE DATOS ──

async function openArchiveModal() {
    const modal = document.getElementById('f-archive-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    loadArchiveStats();
}

function closeArchiveModal() {
    document.getElementById('f-archive-modal')?.classList.add('hidden');
}

async function loadArchiveStats() {
    try {
        const res = await fetch(`${API_BASE_URL}/finance/archive/stats`);
        if (!res.ok) return;
        const data = await res.json();

        const movsEl = document.getElementById('db-stat-total-movs');
        const athsEl = document.getElementById('db-stat-total-aths');
        const persEl = document.getElementById('db-stat-total-periods');

        if (movsEl) movsEl.textContent = Number(data.total_records || 0).toLocaleString('es-CL');
        if (athsEl) athsEl.textContent = Number(data.total_athletes || 0).toLocaleString('es-CL');
        if (persEl) persEl.textContent = `${data.periods ? data.periods.length : 0} meses`;

        // Llenar selectores de periodos
        const exportSel = document.getElementById('archive-export-period');
        const purgeSel = document.getElementById('archive-purge-period');
        if (exportSel && data.periods) {
            exportSel.innerHTML = data.periods.map(p => `<option value="${p.period}" ${p.period === currentFinancePeriod ? 'selected' : ''}>${p.period} (${p.total_movements} movs)</option>`).join('');
        }
        if (purgeSel && data.periods) {
            purgeSel.innerHTML = data.periods.map(p => `<option value="${p.period}">${p.period} (${p.total_movements} movs)</option>`).join('');
        }
    } catch (e) {
        console.error('Error cargando estadísticas de archivo:', e);
    }
}

async function downloadMonthlyBackupJSON() {
    const period = document.getElementById('archive-export-period')?.value || currentFinancePeriod;
    toast(`⏳ Generando respaldo completo de ${period}...`);
    try {
        const res = await fetch(`${API_BASE_URL}/finance/archive/export?period=${encodeURIComponent(period)}`);
        if (!res.ok) return toast('Error al generar respaldo');
        const data = await res.json();

        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `respaldo_murano_${period}_${new Date().toISOString().split('T')[0]}.json`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast(`💾 ¡Respaldo de ${period} guardado con éxito!`);
    } catch (e) {
        toast('Error de red al descargar respaldo');
    }
}

async function downloadMonthlyBackupCSV() {
    const period = document.getElementById('archive-export-period')?.value || currentFinancePeriod;
    toast(`⏳ Exportando planilla CSV de ${period}...`);
    try {
        const res = await fetch(`${API_BASE_URL}/finance/archive/export?period=${encodeURIComponent(period)}`);
        if (!res.ok) return toast('Error al exportar datos');
        const data = await res.json();

        let csv = 'Fecha,Periodo,Tipo,RUT Pagador,Nombre Pagador,Monto,Concepto,Estado,Alumno Asignado,Categoria Alumno,Notas\n';
        (data.movements || []).forEach(m => {
            csv += `"${m.date || ''}","${m.period || ''}","${m.transfer_type || ''}","${m.payer_rut || ''}","${(m.payer_name || '').replace(/"/g, '""')}",${m.amount},"${m.category_concept || ''}","${m.status || ''}","${m.athlete_name || ''}","${m.athlete_category || ''}","${(m.notes || '').replace(/"/g, '""')}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `movimientos_murano_${period}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast(`📑 Planilla CSV de ${period} descargada`);
    } catch (e) {
        toast('Error al exportar CSV');
    }
}

async function executePurgeMonth() {
    const period = document.getElementById('archive-purge-period')?.value;
    const confirmText = document.getElementById('archive-purge-confirm')?.value.trim();

    if (!period) return toast('Selecciona un mes');
    if (confirmText !== 'ARCHIVAR') {
        return toast('⚠️ Debes escribir exactamente ARCHIVAR para confirmar');
    }

    if (!confirm(`¿Estás seguro de que ya guardaste el respaldo en tu disco y deseas liberar de la base de datos los movimientos de ${period}?`)) {
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/finance/archive/purge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ period, confirmation: 'ARCHIVAR' })
        });
        const data = await res.json();
        if (res.ok) {
            toast(`🧹 ¡Espacio liberado! Se archivaron ${data.deleted_count} movimientos de ${period}`);
            document.getElementById('archive-purge-confirm').value = '';
            loadArchiveStats();
            loadFinanceData();
        } else {
            toast(data.error || 'Error al archivar');
        }
    } catch (e) {
        toast('Error al comunicarse con el servidor');
    }
}

async function executeRestoreBackup() {
    const fileInp = document.getElementById('archive-restore-input');
    const file = fileInp ? fileInp.files[0] : null;
    if (!file) return toast('Selecciona un archivo .json de respaldo primero');

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.movements || !Array.isArray(data.movements)) {
                return toast('El archivo no contiene movimientos válidos de respaldo');
            }

            toast(`⏳ Restaurando ${data.movements.length} movimientos de ${data.period || 'respaldo'}...`);
            const res = await fetch(`${API_BASE_URL}/finance/archive/restore`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ period: data.period, movements: data.movements })
            });

            const resData = await res.json();
            if (res.ok) {
                toast(`🎉 ¡Respaldo restaurado! ${resData.restored_count} movimientos recargados en BD`);
                fileInp.value = '';
                loadArchiveStats();
                loadFinanceData();
            } else {
                toast(resData.error || 'Error al restaurar respaldo');
            }
        } catch (err) {
            console.error('Error parseando respaldo JSON:', err);
            toast('El archivo no es un JSON válido');
        }
    };
    reader.readAsText(file);
}

document.addEventListener('DOMContentLoaded', () => {
    updateUI();
    renderList('gym');
    initCartolaDropZone();
});

// ── ACCESIBILIDAD Y CIERRE DE MODALES (TECLA ESC Y CLICS EXTERNOS) ──
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeAthleteModal();
        closeNewAthleteModal();
        closeEditMovementModal();
        closeSplitModal();
        closeArchiveModal();
        closeWhatsAppModal();
        closeExpenseModal();
        closeBayesSyncModal();
        document.querySelectorAll('.ath-dropdown-results').forEach(el => el.classList.add('hidden'));
    }
});

window.addEventListener('click', (e) => {
    if (!e.target.closest('.ath-picker-container') && !e.target.closest('.pending-assign-box')) {
        document.querySelectorAll('.ath-dropdown-results').forEach(el => el.classList.add('hidden'));
    }
});


