/**
 * RZR-Track — Frontend Vanilla JS (ES Module)
 * Conecta directamente con la API REST (/api/*) del servidor local.
 */

const API_BASE = '';
const MODO_LOCAL = false;

const TARIFA_POR_HORA = 500.0;
const COSTO_EXTRAS = 300.0;
const INACTIVITY_LIMIT_MS = 10 * 60 * 1000; // 10 minutos (igual que el script Python)

const SUCURSAL_MAP = {
  1: 'Mazamitla',
  2: 'Tapalpa',
  3: 'Mazatlán',
  4: 'Chacala',
};

const state = {
  token: null,
  usuario: '',
  nickname: '',
  fechaTexto: '',
  fechaTuple: '',
  activeView: 'reserva',
  selectedBranch: 1,
  selectedRzr: 'RZR-01',
  ticketLocked: false,
  recordsTab: 'reservas',
  reservas: [],
  clientes: [],
  files: [],
  activeFile: null,
  inactivityTimer: null,
};

// =========================================================
// UTILIDADES DE FORMATO Y API
// =========================================================
function formatCurrency(amount) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(amount);
}

function getTodayFormatted() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function validateDateString(text) {
  const match = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return false;
  const dia = Number.parseInt(match[1], 10);
  const mes = Number.parseInt(match[2], 10);
  const anio = Number.parseInt(match[3], 10);
  return dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && anio >= 2000 && anio <= 2100;
}

async function apiRequest(path, options = {}) {
  if (path.includes('/reservas')) {
if (!options.method || options.method === 'GET') {
return JSON.parse(localStorage.getItem('reservas_rzr') || '[]');
}
return { ok: true };
}
if (path.includes('/clientes')) {
return [];
}
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error || data.detail || 'Error de comunicación con el servidor.';
    throw new Error(message);
  }
  return data;
}

function showFeedback(elementId, message, type = 'success') {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.classList.remove('is-success', 'is-error');
  el.classList.add(type === 'error' ? 'is-error' : 'is-success');
  el.hidden = false;
}

function hideFeedback(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}

function setButtonLoading(button, isLoading) {
  if (!button) return;
  button.disabled = isLoading;
  const spinner = button.querySelector('.btn-spinner');
  if (spinner) spinner.hidden = !isLoading;
}

function setBarLoading(barId, isLoading) {
  const bar = document.getElementById(barId);
  if (bar) bar.hidden = !isLoading;
}

// =========================================================
// CONTROL DE INACTIVIDAD (10 MINUTOS)
// =========================================================
function resetInactivityTimer() {
  if (!state.token) return;
  if (state.inactivityTimer) {
    window.clearTimeout(state.inactivityTimer);
  }
  state.inactivityTimer = window.setTimeout(() => {
    const modal = document.getElementById('inactivity-modal');
    if (modal && state.token) {
      modal.hidden = false;
    }
  }, INACTIVITY_LIMIT_MS);
}

function clearInactivityTimer() {
  if (state.inactivityTimer) {
    window.clearTimeout(state.inactivityTimer);
    state.inactivityTimer = null;
  }
}

// =========================================================
// PANTALLA DE AUTENTICACIÓN
// =========================================================
function switchAuthTab(mode) {
  const isLogin = mode === 'login';
  const tabLogin = document.getElementById('tab-login');
  const tabReg = document.getElementById('tab-register');
  const formLogin = document.getElementById('form-login');
  const formReg = document.getElementById('form-register');

  tabLogin.classList.toggle('is-active', isLogin);
  tabLogin.setAttribute('aria-selected', String(isLogin));
  tabReg.classList.toggle('is-active', !isLogin);
  tabReg.setAttribute('aria-selected', String(!isLogin));

  formLogin.hidden = !isLogin;
  formReg.hidden = isLogin;
  hideFeedback('auth-feedback');
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  hideFeedback('auth-feedback');

  const userInput = document.getElementById('reg-usuario');
  const passInput = document.getElementById('reg-password');
  const confirmInput = document.getElementById('reg-password-confirm');
  const submitBtn = document.getElementById('btn-register-submit');

  const usuario = userInput.value.trim();
  const password = passInput.value;
  const confirm = confirmInput.value;

  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(usuario)) {
    showFeedback(
      'auth-feedback',
      'El usuario debe tener entre 3 y 32 caracteres válidos (letras, números, ., _, -).',
      'error',
    );
    userInput.focus();
    return;
  }
  if (password.length < 4) {
    showFeedback('auth-feedback', 'La contraseña debe tener al menos 4 caracteres.', 'error');
    passInput.focus();
    return;
  }
  if (password !== confirm) {
    showFeedback('auth-feedback', 'Las contraseñas no coinciden.', 'error');
    confirmInput.focus();
    return;
  }

  setButtonLoading(submitBtn, true);
  setBarLoading('auth-loading-bar', true);

  try {
    if (MODO_LOCAL) {
  let usuarios = JSON.parse(localStorage.getItem('usuarios_rzr') || '[]');
  if (usuarios.find(u => u.usuario === usuario)) {
    showFeedback('auth-feedback', 'Ese usuario ya existe, intenta iniciar sesión', 'error');
    setButtonLoading(submitBtn, false);
    setBarLoading('auth-loading-bar', false);
    return;
  }
  usuarios.push({ usuario: usuario, password: password, nickname: usuario });
  localStorage.setItem('usuarios_rzr', JSON.stringify(usuarios));
  document.getElementById('form-register').reset();
  document.getElementById('login-usuario').value = usuario;
  switchAuthTab('login');
  showFeedback('auth-feedback', 'Cuenta creada. Ahora inicia sesión con tu cuenta.', 'success');
  setButtonLoading(submitBtn, false);
  setBarLoading('auth-loading-bar', false);
  return;
}
    const fechaTexto = document.getElementById('login-fecha').value.trim();
    const res = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        usuario,
        password,
        fechaTexto: validateDateString(fechaTexto) ? fechaTexto : undefined,
      }),
    });

    document.getElementById('form-register').reset();
    document.getElementById('login-usuario').value = usuario;
    switchAuthTab('login');
    showFeedback(
      'auth-feedback',
      `${res.mensaje} Ahora inicia sesión con tu cuenta.`,
      'success',
    );
  } catch (err) {
    showFeedback('auth-feedback', err.message, 'error');
  } finally {
    setButtonLoading(submitBtn, false);
    setBarLoading('auth-loading-bar', false);
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  hideFeedback('auth-feedback');

  const nickInput = document.getElementById('login-nickname');
  const fechaInput = document.getElementById('login-fecha');
  const userInput = document.getElementById('login-usuario');
  const passInput = document.getElementById('login-password');
  const submitBtn = document.getElementById('btn-login-submit');

  const nickname = nickInput.value.trim();
  const fechaTexto = fechaInput.value.trim();
  const usuario = userInput.value.trim();
  const password = passInput.value;

  if (!validateDateString(fechaTexto)) {
    showFeedback(
      'auth-feedback',
      'Error: la fecha debe ser numérica y con formato DD/MM/AAAA.',
      'error',
    );
    fechaInput.focus();
    return;
  }

  if (!usuario || !password) {
    showFeedback('auth-feedback', 'Ingresa tu usuario y contraseña para continuar.', 'error');
    return;
  }

  setButtonLoading(submitBtn, true);
  setBarLoading('auth-loading-bar', true);

  try {
    if (MODO_LOCAL) {
  let usuarios = JSON.parse(localStorage.getItem('usuarios_rzr') || '[]');
  let encontrado = usuarios.find(u => u.usuario === usuario && u.password === password);
  if (!encontrado) {
    showFeedback('auth-feedback', 'Usuario o contraseña incorrectos', 'error');
    setButtonLoading(submitBtn, false);
    setBarLoading('auth-loading-bar', false);
    return;
  }
  state.token = 'local-' + usuario;
  state.usuario = encontrado.usuario;
  state.nickname = encontrado.nickname || usuario;
  state.fechaTexto = fechaTexto;
  passInput.value = '';
  enterWorkspace('Bienvenido ' + usuario);
  return;
}
    const res = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        usuario,
        password,
        nickname: nickname || usuario,
        fechaTexto,
      }),
    });

    state.token = res.token;
    state.usuario = res.usuario;
    state.nickname = res.nickname;
    state.fechaTexto = res.fechaTexto;
    state.fechaTuple = res.fechaTuple;

    passInput.value = '';
    enterWorkspace(res.mensaje);
  } catch (err) {
    showFeedback('auth-feedback', err.message, 'error');
  } finally {
    setButtonLoading(submitBtn, false);
    setBarLoading('auth-loading-bar', false);
  }
}

// =========================================================
// TRANSICIÓN AL ESPACIO DE TRABAJO
// =========================================================
function enterWorkspace(welcomeMessage) {
  document.getElementById('auth-screen').hidden = true;
  document.getElementById('workspace-screen').hidden = false;

  updateSessionHeaderInfo();
  updateLiveTicketPreview();
  switchWorkspaceView('reserva');
  showFeedback('workspace-feedback', welcomeMessage, 'success');
  resetInactivityTimer();
}

function logoutToAuth(reasonMessage) {
  clearInactivityTimer();
  const farewell = reasonMessage || `Sesión cerrada. Gracias, ${state.nickname || 'Operador'}.`;
  state.token = null;
  state.usuario = '';
  state.nickname = '';
  state.activeFile = null;
  state.reservas = [];
  state.clientes = [];

  document.getElementById('inactivity-modal').hidden = true;
  document.getElementById('workspace-screen').hidden = true;
  document.getElementById('auth-screen').hidden = false;
  hideFeedback('workspace-feedback');
  showFeedback('auth-feedback', farewell, 'success');
}

function updateSessionHeaderInfo() {
  document.getElementById('sidebar-operator-name').textContent = state.nickname;
  document.getElementById('sidebar-user-handle').textContent = `@${state.usuario}`;
  document.getElementById('sidebar-date-label').textContent = state.fechaTexto;
  document.getElementById('update-fecha-input').value = state.fechaTexto;
  document.getElementById('ticket-fecha').textContent = state.fechaTexto;
}

function switchWorkspaceView(viewName) {
  state.activeView = viewName;

  document.querySelectorAll('.workspace-view').forEach((section) => {
    section.hidden = section.id !== `view-${viewName}`;
  });

  document.querySelectorAll('.topbar-nav .nav-link, .sidebar-item').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.view === viewName);
  });

  // Cerrar menú móvil si estaba abierto
  const sidebar = document.getElementById('workspace-sidebar');
  if (sidebar.classList.contains('is-open')) {
    sidebar.classList.remove('is-open');
    document.getElementById('btn-mobile-menu').setAttribute('aria-expanded', 'false');
  }

  if (viewName === 'historial') {
    loadRecords();
  } else if (viewName === 'archivos') {
    loadFilesList();
  }
}

// =========================================================
// ACTUALIZAR FECHA OPERATIVA
// =========================================================
async function handleUpdateDate(event) {
  event.preventDefault();
  const input = document.getElementById('update-fecha-input');
  const resetBox = document.getElementById('update-fecha-reset');
  const fechaTexto = input.value.trim();

  if (!validateDateString(fechaTexto)) {
    showFeedback(
      'workspace-feedback',
      'Error: la fecha debe ser numérica y con formato DD/MM/AAAA.',
      'error',
    );
    return;
  }

  setBarLoading('workspace-loading-bar', true);
  try {
    const res = await apiRequest('/api/session/date', {
      method: 'POST',
      body: JSON.stringify({
        fechaTexto,
        resetFiles: resetBox.checked,
      }),
    });
    state.fechaTexto = res.fechaTexto;
    state.fechaTuple = res.fechaTuple;
    updateSessionHeaderInfo();
    document.getElementById('form-update-date').hidden = true;
    resetBox.checked = false;
    showFeedback('workspace-feedback', res.mensaje, 'success');

    if (state.activeView === 'archivos') loadFilesList();
    if (state.activeView === 'historial') loadRecords();
  } catch (err) {
    showFeedback('workspace-feedback', err.message, 'error');
  } finally {
    setBarLoading('workspace-loading-bar', false);
  }
}

// =========================================================
// VISTA 1: HACER RESERVA RZR Y TICKET EN VIVO
// =========================================================
function updateLiveTicketPreview() {
  if (state.ticketLocked) return;

  const nombre = document.getElementById('res-nombre').value.trim();
  const telefono = document.getElementById('res-telefono').value.trim();
  const horasRaw = Number.parseFloat(document.getElementById('res-horas').value);
  const horas = Number.isFinite(horasRaw) && horasRaw > 0 ? horasRaw : 0;

  const subtotal = horas * TARIFA_POR_HORA;
  const total = horas > 0 ? subtotal + COSTO_EXTRAS : COSTO_EXTRAS;

  document.getElementById('ticket-status-kicker').textContent = 'Resumen en vivo';
  document.getElementById('ticket-heading').textContent = 'Ticket de reserva';
  document.getElementById('ticket-folio-text').textContent = 'Borrador';
  document.getElementById('ticket-sucursal').textContent =
    SUCURSAL_MAP[state.selectedBranch] || 'Mazamitla';
  document.getElementById('ticket-rzr').textContent = state.selectedRzr;
  document.getElementById('ticket-cliente').textContent = nombre || 'Sin asignar';
  document.getElementById('ticket-telefono').textContent = telefono || '—';
  document.getElementById('ticket-horas').textContent = `${horas.toFixed(1)} hrs`;
  document.getElementById('ticket-fecha').textContent = state.fechaTexto || getTodayFormatted();
  document.getElementById('ticket-hours-calc').textContent = horas.toString();
  document.getElementById('ticket-subtotal').textContent = formatCurrency(subtotal);
  document.getElementById('ticket-total').textContent = formatCurrency(total);
  document.getElementById('ticket-confirmed-actions').hidden = true;
}

function renderConfirmedTicket(ticket) {
  state.ticketLocked = true;
  document.getElementById('ticket-status-kicker').textContent = 'Reserva confirmada';
  document.getElementById('ticket-heading').textContent = 'Ticket oficial RZR-Track';
  document.getElementById('ticket-folio-text').textContent = ticket.folio;
  document.getElementById('ticket-sucursal').textContent = ticket.sucursal;
  document.getElementById('ticket-rzr').textContent = ticket.rzr;
  document.getElementById('ticket-cliente').textContent = ticket.nombre;
  document.getElementById('ticket-telefono').textContent = ticket.telefono;
  document.getElementById('ticket-horas').textContent = `${Number(ticket.horas).toFixed(1)} hrs`;
  document.getElementById('ticket-fecha').textContent = `${ticket.fechaTexto} ${ticket.fecha}`;
  document.getElementById('ticket-hours-calc').textContent = String(ticket.horas);
  document.getElementById('ticket-subtotal').textContent = formatCurrency(ticket.subtotal);
  document.getElementById('ticket-total').textContent = formatCurrency(ticket.total);
  document.getElementById('ticket-confirmed-actions').hidden = false;
}

function resetReservaForm() {
  state.ticketLocked = false;
  document.getElementById('res-nombre').value = '';
  document.getElementById('res-telefono').value = '';
  document.getElementById('res-horas').value = '2';
  updateLiveTicketPreview();
  document.getElementById('res-nombre').focus();
}

async function handleReservaSubmit(event) {
  event.preventDefault();
  hideFeedback('workspace-feedback');

  const nombreInput = document.getElementById('res-nombre');
  const telInput = document.getElementById('res-telefono');
  const horasInput = document.getElementById('res-horas');
  const submitBtn = document.getElementById('btn-submit-reserva');

  const nombre = nombreInput.value.trim();
  const telefono = telInput.value.trim();
  const horas = Number.parseFloat(horasInput.value);

  if (nombre.length < 2) {
    showFeedback('workspace-feedback', 'Ingresa el nombre completo del cliente.', 'error');
    nombreInput.focus();
    return;
  }
  if (!/^[0-9+\-\s()]{7,20}$/.test(telefono)) {
    showFeedback(
      'workspace-feedback',
      'Ingresa un número de teléfono válido (7 a 20 dígitos).',
      'error',
    );
    telInput.focus();
    return;
  }
  if (!Number.isFinite(horas) || horas <= 0 || horas > 72) {
    showFeedback(
      'workspace-feedback',
      'Ingresa una duración válida mayor a 0 y máximo 72 horas.',
      'error',
    );
    horasInput.focus();
    return;
  }

  setButtonLoading(submitBtn, true);
  setBarLoading('workspace-loading-bar', true);

  try {
    const res = await apiRequest('/api/reservas', {
      method: 'POST',
      body: JSON.stringify({
        idLocal: state.selectedBranch,
        nombre,
        telefono,
        rzr: state.selectedRzr,
        horas,
      }),
    });

    renderConfirmedTicket(res.ticket);
    showFeedback('workspace-feedback', res.mensaje, 'success');
  } catch (err) {
    showFeedback('workspace-feedback', err.message, 'error');
  } finally {
    setButtonLoading(submitBtn, false);
    setBarLoading('workspace-loading-bar', false);
  }
}

// =========================================================
// VISTA 2: HISTORIAL DE RESERVAS Y CLIENTES
// =========================================================
async function loadRecords() {
  setBarLoading('workspace-loading-bar', true);
  try {
    const data = await apiRequest('/api/records');
    state.reservas = data.reservas || [];
    state.clientes = data.clientes || [];
    document.getElementById('count-reservas').textContent = String(state.reservas.length);
    document.getElementById('count-clientes').textContent = String(state.clientes.length);
    renderRecordsTable();
  } catch (err) {
    showFeedback('workspace-feedback', err.message, 'error');
  } finally {
    setBarLoading('workspace-loading-bar', false);
  }
}

function renderRecordsTable() {
  const thead = document.getElementById('records-thead');
  const tbody = document.getElementById('records-tbody');
  const emptyBox = document.getElementById('records-empty');
  const branchSelect = document.getElementById('records-branch-filter');

  const query = document.getElementById('records-search').value.trim().toLowerCase();
  const branchFilter = branchSelect.value;
  branchSelect.hidden = state.recordsTab !== 'reservas';

  thead.textContent = '';
  tbody.textContent = '';

  const headerRow = document.createElement('tr');
  if (state.recordsTab === 'reservas') {
    ['Fecha', 'Cliente', 'Sucursal', 'Unidad RZR', 'Total'].forEach((label, idx) => {
      const th = document.createElement('th');
      th.textContent = label;
      if (idx === 4) th.className = 'text-right';
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const filtered = state.reservas.filter((r) => {
      const matchesBranch = branchFilter === 'all' || r.sucursal === branchFilter;
      const matchesQuery =
        !query ||
        r.cliente.toLowerCase().includes(query) ||
        r.rzr.toLowerCase().includes(query) ||
        r.sucursal.toLowerCase().includes(query);
      return matchesBranch && matchesQuery;
    });

    emptyBox.hidden = filtered.length > 0;
    filtered.forEach((r) => {
      const tr = document.createElement('tr');
      const cells = [
        {text: r.fecha, cls: 'mono-inline'},
        {text: r.cliente, cls: ''},
        {text: r.sucursal, cls: ''},
        {text: r.rzr, cls: 'mono-inline'},
        {text: formatCurrency(r.total), cls: 'mono-inline text-right'},
      ];
      cells.forEach((cell) => {
        const td = document.createElement('td');
        td.textContent = cell.text;
        if (cell.cls) td.className = cell.cls;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  } else {
    ['Nombre del cliente', 'Teléfono registrado'].forEach((label, idx) => {
      const th = document.createElement('th');
      th.textContent = label;
      if (idx === 1) th.className = 'text-right';
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const filtered = state.clientes.filter((c) => {
      return (
        !query ||
        c.nombre.toLowerCase().includes(query) ||
        c.telefono.toLowerCase().includes(query)
      );
    });

    emptyBox.hidden = filtered.length > 0;
    filtered.forEach((c) => {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = c.nombre;
      const tdPhone = document.createElement('td');
      tdPhone.textContent = c.telefono;
      tdPhone.className = 'mono-inline text-right';
      tr.appendChild(tdName);
      tr.appendChild(tdPhone);
      tbody.appendChild(tr);
    });
  }
}

// =========================================================
// VISTA 3: GESTOR DE ARCHIVOS (.TXT)
// =========================================================
async function loadFilesList() {
  setBarLoading('workspace-loading-bar', true);
  try {
    const data = await apiRequest('/api/files');
    state.files = data.files || [];
    renderFilesList();

    if (state.files.length > 0) {
      const stillExists = state.files.some((f) => f.nombre === state.activeFile);
      const target = stillExists ? state.activeFile : state.files[0].nombre;
      await openFile(target);
    }
  } catch (err) {
    showFeedback('workspace-feedback', err.message, 'error');
  } finally {
    setBarLoading('workspace-loading-bar', false);
  }
}

function renderFilesList() {
  const listEl = document.getElementById('files-list');
  const countEl = document.getElementById('files-count-label');
  listEl.textContent = '';
  countEl.textContent = `${state.files.length} archivos`;

  state.files.forEach((file) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `file-item-btn${state.activeFile === file.nombre ? ' is-active' : ''}`;
    btn.addEventListener('click', () => openFile(file.nombre));

    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-item-name';
    nameSpan.textContent = file.nombre;

    const metaSpan = document.createElement('span');
    metaSpan.className = 'mono-muted';
    metaSpan.textContent = `${file.lineas} lín`;

    btn.appendChild(nameSpan);
    btn.appendChild(metaSpan);
    li.appendChild(btn);
    listEl.appendChild(li);
  });
}

async function openFile(nombre) {
  setBarLoading('workspace-loading-bar', true);
  try {
    const data = await apiRequest(`/api/files/${encodeURIComponent(nombre)}`);
    state.activeFile = data.nombre;
    document.getElementById('active-file-title').textContent = data.nombre;
    document.getElementById('active-file-content').textContent =
      data.contenido || '(Archivo vacío)';
    document.getElementById('btn-reload-active-file').disabled = false;
    document.getElementById('append-file-text').disabled = false;
    document.getElementById('btn-append-file').disabled = false;
    renderFilesList();
  } catch (err) {
    showFeedback('workspace-feedback', err.message, 'error');
  } finally {
    setBarLoading('workspace-loading-bar', false);
  }
}

async function handleCreateFileSubmit(event) {
  event.preventDefault();
  hideFeedback('workspace-feedback');
  const input = document.getElementById('new-file-name');
  const nombreNuevo = input.value.trim();

  if (!/^[a-zA-Z0-9_-]{1,40}(\.txt)?$/.test(nombreNuevo)) {
    showFeedback(
      'workspace-feedback',
      'Usa entre 1 y 40 caracteres válidos (letras, números, guion o guion bajo).',
      'error',
    );
    input.focus();
    return;
  }

  setBarLoading('workspace-loading-bar', true);
  try {
    const res = await apiRequest('/api/files/create', {
      method: 'POST',
      body: JSON.stringify({nombreNuevo}),
    });
    input.value = '';
    state.activeFile = res.nombre;
    showFeedback('workspace-feedback', res.mensaje, 'success');
    await loadFilesList();
  } catch (err) {
    showFeedback('workspace-feedback', err.message, 'error');
  } finally {
    setBarLoading('workspace-loading-bar', false);
  }
}

async function handleAppendFileSubmit(event) {
  event.preventDefault();
  hideFeedback('workspace-feedback');
  if (!state.activeFile) return;

  const input = document.getElementById('append-file-text');
  const texto = input.value.trim();
  if (!texto) {
    showFeedback('workspace-feedback', 'Escribe el contenido que deseas guardar.', 'error');
    input.focus();
    return;
  }

  setBarLoading('workspace-loading-bar', true);
  try {
    const res = await apiRequest('/api/files/append', {
      method: 'POST',
      body: JSON.stringify({
        nombreArchivo: state.activeFile,
        texto,
      }),
    });
    input.value = '';
    document.getElementById('active-file-content').textContent = res.contenido;
    showFeedback('workspace-feedback', res.mensaje, 'success');
    await loadFilesList();
  } catch (err) {
    showFeedback('workspace-feedback', err.message, 'error');
  } finally {
    setBarLoading('workspace-loading-bar', false);
  }
}

// =========================================================
// INICIALIZACIÓN Y EVENT LISTENERS
// =========================================================
async function bootstrapApp() {
  const fechaInput = document.getElementById('login-fecha');
  fechaInput.value = getTodayFormatted();

  try {
    const info = await apiRequest('/api/state');
    if (info.fechaTexto) {
      fechaInput.value = info.fechaTexto;
      document.getElementById('auth-date-summary').textContent =
        `Operación diaria · ${info.fechaTexto}`;
    }
    if (!info.hasRegisteredUsers) {
      document.getElementById('auth-first-user-hint').textContent =
        'Aún no hay operadores registrados. Crea el primer usuario en la pestaña Registrarse.';
    }
  } catch {
    // Si el servidor aún está iniciando, mantiene la fecha local del navegador
  }

  // Tabs Login / Registro
  document.getElementById('tab-login').addEventListener('click', () => switchAuthTab('login'));
  document
    .getElementById('tab-register')
    .addEventListener('click', () => switchAuthTab('register'));

  document.getElementById('form-login').addEventListener('submit', handleLoginSubmit);
  document.getElementById('form-register').addEventListener('submit', handleRegisterSubmit);

  // Navegación del espacio de trabajo
  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => switchWorkspaceView(btn.dataset.view));
  });

  document.getElementById('btn-mobile-menu').addEventListener('click', () => {
    const sidebar = document.getElementById('workspace-sidebar');
    const isOpen = sidebar.classList.toggle('is-open');
    document.getElementById('btn-mobile-menu').setAttribute('aria-expanded', String(isOpen));
  });

  document.getElementById('btn-logout').addEventListener('click', () => {
    logoutToAuth('Cambiando de usuario. Vuelve a iniciar sesión para continuar.');
  });

  // Editor de fecha en barra lateral
  document.getElementById('btn-toggle-date-editor').addEventListener('click', () => {
    const form = document.getElementById('form-update-date');
    form.hidden = !form.hidden;
  });
  document.getElementById('btn-cancel-date-editor').addEventListener('click', () => {
    document.getElementById('form-update-date').hidden = true;
  });
  document.getElementById('form-update-date').addEventListener('submit', handleUpdateDate);

  // Controles de reserva RZR
  document.querySelectorAll('[data-branch]').forEach((tile) => {
    tile.addEventListener('click', () => {
      state.ticketLocked = false;
      state.selectedBranch = Number(tile.dataset.branch);
      document.querySelectorAll('[data-branch]').forEach((t) => {
        t.classList.toggle('is-selected', t === tile);
      });
      updateLiveTicketPreview();
    });
  });

  document.querySelectorAll('[data-rzr]').forEach((tile) => {
    tile.addEventListener('click', () => {
      state.ticketLocked = false;
      state.selectedRzr = tile.dataset.rzr;
      document.querySelectorAll('[data-rzr]').forEach((t) => {
        t.classList.toggle('is-selected', t === tile);
      });
      updateLiveTicketPreview();
    });
  });

  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.ticketLocked = false;
      document.getElementById('res-horas').value = btn.dataset.hours;
      updateLiveTicketPreview();
    });
  });

  ['res-nombre', 'res-telefono', 'res-horas'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      state.ticketLocked = false;
      updateLiveTicketPreview();
    });
  });

  document.getElementById('form-reserva').addEventListener('submit', handleReservaSubmit);
  document.getElementById('btn-new-reserva').addEventListener('click', resetReservaForm);
  document.getElementById('btn-print-ticket').addEventListener('click', () => window.print());

  // Historial y clientes
  document.getElementById('btn-refresh-records').addEventListener('click', loadRecords);
  document.getElementById('subtab-reservas').addEventListener('click', () => {
    state.recordsTab = 'reservas';
    document.getElementById('subtab-reservas').classList.add('is-active');
    document.getElementById('subtab-clientes').classList.remove('is-active');
    renderRecordsTable();
  });
  document.getElementById('subtab-clientes').addEventListener('click', () => {
    state.recordsTab = 'clientes';
    document.getElementById('subtab-clientes').classList.add('is-active');
    document.getElementById('subtab-reservas').classList.remove('is-active');
    renderRecordsTable();
  });
  document.getElementById('records-search').addEventListener('input', renderRecordsTable);
  document
    .getElementById('records-branch-filter')
    .addEventListener('change', renderRecordsTable);
  document.getElementById('btn-empty-create-reserva').addEventListener('click', () => {
    switchWorkspaceView('reserva');
  });

  // Gestor de archivos
  document.getElementById('btn-refresh-files').addEventListener('click', loadFilesList);
  document.getElementById('btn-reload-active-file').addEventListener('click', () => {
    if (state.activeFile) openFile(state.activeFile);
  });
  document.getElementById('form-create-file').addEventListener('submit', handleCreateFileSubmit);
  document.getElementById('form-append-file').addEventListener('submit', handleAppendFileSubmit);

  // Modal de inactividad (10 min)
  document.getElementById('btn-inactivity-continue').addEventListener('click', () => {
    document.getElementById('inactivity-modal').hidden = true;
    resetInactivityTimer();
  });
  document.getElementById('btn-inactivity-exit').addEventListener('click', () => {
    logoutToAuth('Regresando a la pantalla inicial por inactividad.');
  });

  ['click', 'keydown', 'pointerdown'].forEach((evt) => {
    document.addEventListener(evt, resetInactivityTimer, {passive: true});
  });
}

document.addEventListener('DOMContentLoaded', bootstrapApp);
