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

        container.innerHTML = data.map(item => {
            const key = safeKey(item.id || item.name);
            const rawId = type === 'trainer' ? item.name : item.id;

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
                            <button class="primary" onclick="toggleSchedule(this, '${type}', '${escQ(String(rawId))}', '${key}')"
                                    style="width:100%; margin-top:15px;">
                                Ver Horarios
                            </button>
                            ${type === 'cat' && localStorage.getItem('user_id') ? `
                            <button onclick="saveCategoryFavs(${item.id})" style="width:100%; margin-top:8px; padding:10px; background:transparent; border:1px solid #444; color:var(--text-muted); font-size:0.8rem; display:flex; justify-content:center; align-items:center; gap:5px;">
                                ⭐ Guardar Categoría Completa
                            </button>
                            ` : ''}
                        </div>
                    </div>
                    <div class="card-schedule hidden" id="sched-${key}"></div>
                </div>
            </div>`;
        }).join('');
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
                 alt="Centro Deportivo Murano" loading="lazy">
            <div class="complex-photo-overlay">
                <div>
                    <h2 class="complex-title">Centro Deportivo</h2>
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
        content.innerHTML = generateGridHTML(trs);
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
            <div class="ev-actions" style="margin-top:5px; display:flex; flex-wrap:wrap; gap:5px;">
                <button onclick="toggleFav(${t.id})" title="Añadir/Quitar de Favoritos" style="padding:4px 8px; font-size:0.7rem; background:rgba(0,0,0,0.3); border:1px solid #444; color:white; cursor:pointer; border-radius:4px; display:flex; align-items:center; gap:4px;">
                    ⭐ Fav
                </button>
                ${isAdmin ? `
                <button onclick="deleteTraining(${t.id})" title="Borrar este bloque del sistema" style="padding:4px 8px; font-size:0.7rem; background:rgba(255,23,68,0.2); border:1px solid var(--danger); color:var(--danger); cursor:pointer; border-radius:4px; display:flex; align-items:center; gap:4px;">
                    ✕ Borrar Clase
                </button>` : ''}
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

function renderEventCard(t, isFavView = false) {
    const titulo = t.category_name || t.gym_name || "Entrenamiento";
    const isAdmin = localStorage.getItem('role') === 'admin';
    return `
        <div class="event-card">
            <div class="ev-title">${titulo}</div>
            <div class="ev-trainer">${t.trainer_name || 'Sin profesor'}</div>
            <div class="ev-actions" style="margin-top:5px; display:flex; flex-wrap:wrap; gap:5px;">
                ${isFavView ? `
                <button onclick="toggleFav(${t.id})" title="Eliminar de Favoritos" style="padding:4px 8px; font-size:0.7rem; background:rgba(255,255,255,0.1); border:1px solid #666; color:#ccc; cursor:pointer; border-radius:4px; display:flex; align-items:center; gap:4px;">
                    🗑️ Quitar
                </button>
                ` : `
                <button onclick="toggleFav(${t.id})" title="Añadir/Quitar de Favoritos" style="padding:4px 8px; font-size:0.7rem; background:rgba(0,0,0,0.3); border:1px solid #444; color:white; cursor:pointer; border-radius:4px; display:flex; align-items:center; gap:4px;">
                    ⭐ Fav
                </button>
                `}
                
                ${isAdmin ? `
                <button onclick="deleteTraining(${t.id})" title="Borrar este bloque del sistema" style="padding:4px 8px; font-size:0.7rem; background:rgba(255,23,68,0.2); border:1px solid var(--danger); color:var(--danger); cursor:pointer; border-radius:4px; display:flex; align-items:center; gap:4px;">
                    ✕ Borrar Clase
                </button>` : ''}
            </div>
        </div>`;
}

function generateGridHTML(trs, isFavView = false) {
    let html = `<div class="schedule-grid">`;
    html += `<div class="cell header">Hora</div>`;
    days.forEach(d => html += `<div class="cell header">${d}</div>`);
    
    timeSlots.forEach(slot => {
        html += `<div class="cell time-label">${timeMap[slot]}</div>`;
        days.forEach(d => {
            const matches = trs.filter(t => t.day_of_week === d && t.start_time === slot);
            html += `<div class="cell">${matches.map(t => renderEventCard(t, isFavView)).join('')}</div>`;
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
                ${trs.length === 0 ? '<p>No tienes favoritos.</p>' : generateGridHTML(trs, true)}
            </div>`;
    } catch (e) { toast('Error al cargar favoritos'); }
}

document.addEventListener('DOMContentLoaded', () => {
    updateUI();
    renderList('gym');
});
