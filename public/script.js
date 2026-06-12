/**
 * LÓGICA INTEGRAL - MURANO VOLEY "NEXT LEVEL"
 * 
 * Este archivo gestiona TODA la interactividad:
 * - Carga premium con Skeletons.
 * - Gestión de Horarios por Cancha/Categoría/Profesor.
 * - Panel de Administración completo.
 * - Favoritos y Autenticación.
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
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3000);
}

function showView(v) {
    const views = ['main-view', 'auth-view', 'admin-panel-view'];
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
        const data = await res.json();

        const container = document.getElementById('list-container');
        if (!data || data.length === 0) {
            container.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--text-dim); padding:40px;">No se encontraron datos. Asegúrate de cargar el SQL y configurar DATABASE_URL.</p>`;
            return;
        }

        container.innerHTML = data.map(item => {
            const key = safeKey(item.id || item.name);
            const rawId = type === 'trainer' ? item.name : item.id;
            const mapUrl = (type === 'gym' && item.address) ? buildMapUrl(item.address) : null;

            return `
            <div class="card" id="card-wrapper-${key}">
                <div class="card-inner">
                    <div class="card-info">
                        <div class="img-box">
                            <img src="${item.image_url || 'https://via.placeholder.com/300x300/111111/FF5722?text=+'}"
                                 onerror="this.src='https://via.placeholder.com/300x300/111111/FF5722?text=+'"
                                 loading="lazy">
                        </div>
                        <div class="card-text-group">
                            <h3>${item.name}</h3>
                            ${item.address ? `<div class="card-address">${item.address}</div>` : ''}
                            <button class="primary" onclick="toggleSchedule(this, '${type}', '${escQ(String(rawId))}', '${key}')"
                                    style="width:100%; margin-top:15px;">
                                Ver Horarios
                            </button>
                        </div>
                    </div>
                    <div class="card-schedule hidden" id="sched-${key}"></div>
                </div>
                ${mapUrl ? `<iframe class="gym-map hidden" id="map-${key}" src="${mapUrl}" allowfullscreen="" loading="lazy"></iframe>` : ''}
            </div>`;
        }).join('');
    } catch (e) {
        toast('Error al conectar con la API');
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
    const url = type === 'gym' 
        ? `/trainings/by-gym/${id}` 
        : type === 'cat' 
            ? `/trainings/by-cat/${id}` 
            : `/trainings/by-trainer/${encodeURIComponent(id)}`;

    try {
        const res = await fetch(`${API_BASE_URL}${url}`);
        const trs = await res.json();
        
        container.innerHTML = generateGridHTML(trs);
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

function generateGridHTML(trs) {
    let html = `<div class="schedule-grid">`;
    html += `<div class="cell header">Hora</div>`;
    days.forEach(d => html += `<div class="cell header">${d}</div>`);
    
    timeSlots.forEach(slot => {
        html += `<div class="cell time-label">${timeMap[slot]}</div>`;
        days.forEach(d => {
            const matches = trs.filter(t => t.day_of_week === d && t.start_time === slot);
            html += `<div class="cell">${matches.map(t => renderEventCard(t)).join('')}</div>`;
        });
    });
    return html + `</div>`;
}

function renderEventCard(t) {
    const titulo = t.category_name || t.gym_name || "Entrenamiento";
    const isAdmin = localStorage.getItem('role') === 'admin';
    return `
        <div class="event-card">
            <div class="ev-title">${titulo}</div>
            <div class="ev-trainer">${t.trainer_name || 'Sin profesor'}</div>
            <div class="ev-actions" style="margin-top:5px; display:flex; gap:5px;">
                <button onclick="toggleFav(${t.id})" style="padding:4px 8px; font-size:0.7rem; background:rgba(0,0,0,0.2); border:none; cursor:pointer; color:white;">⭐</button>
                ${isAdmin ? `<button onclick="deleteTraining(${t.id})" style="padding:4px 8px; font-size:0.7rem; background:var(--danger); border:none; cursor:pointer; color:white; border-radius:4px;">✕</button>` : ''}
            </div>
        </div>`;
}

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
                    <span>${c.name} - ${c.trainer_name}</span>
                    <div class="item-actions">
                        <button onclick="deleteData('categories', ${c.id})">Borrar</button>
                    </div>
                </div>`).join('')}
            </details>`;
    } catch (e) { toast('Error al cargar panel de control'); }
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
    if (!confirm("¿Eliminar este horario?")) return;
    await fetch(`${API_BASE_URL}/trainings/${id}`, { method: 'DELETE' });
    toast('Horario eliminado');
    setTimeout(() => location.reload(), 800);
}

async function deleteData(type, id) {
    if (!confirm("¿Seguro que deseas eliminar?")) return;
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
        if (res.ok) toast('Usuario creado. ¡Ahora ingresa!');
        else toast('Error al registrar');
    } catch (e) { toast('Error de red'); }
}

function updateUI() {
    const user = localStorage.getItem('email');
    const role = localStorage.getItem('role');
    const panel = document.getElementById('auth-panel');
    if (user) {
        panel.innerHTML = `
            <span>${user}</span>
            ${role === 'admin' ? '<button onclick="loadAdminPanel()" class="primary">Admin</button>' : ''}
            <button onclick="logout()">Salir</button>`;
    } else {
        panel.innerHTML = `<button onclick="showView('auth-view')" class="primary">Ingresar</button>`;
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
    // Si la dirección ya es un link de Google Maps (app.goo.gl), intentamos extraerlo o usarlo de base
    if (address.includes('http')) {
        return `https://maps.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
    }
    const query = encodeURIComponent(address + ', Puerto Montt, Chile');
    return `https://maps.google.com/maps?q=${query}&output=embed&z=16`;
}

async function toggleFav(tId) {
    const userId = localStorage.getItem('user_id');
    if (!userId) return toast('Inicia sesión para favoritos');
    try {
        const res = await fetch(`${API_BASE_URL}/toggle-favorite`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({training_id: tId, user_id: userId})
        });
        const d = await res.json();
        toast(d.action === 'added' ? '⭐ Guardado' : 'Eliminado');
    } catch (e) { toast('Error al actualizar'); }
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
                ${trs.length === 0 ? '<p>No tienes favoritos.</p>' : generateGridHTML(trs)}
            </div>`;
    } catch (e) { toast('Error al cargar favoritos'); }
}

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    updateUI();
    renderList('gym');
});
