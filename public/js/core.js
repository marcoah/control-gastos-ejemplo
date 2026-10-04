// =====================================================================
// Utilidades compartidas: estado, API, formato, toasts, modal y errores.
// =====================================================================

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export const state = {
  config: { locale: 'es-AR', currency: 'ARS', iva: 0.21, timezone: 'America/Argentina/Buenos_Aires', hoy: null },
  categorias: [],
  proveedores: [],
};

export const ESTADO_TEXTO = { pagada: 'Pagada', pendiente: 'Pendiente', cancelada: 'Anulada' };
export const CONDICION_IVA_TEXTO = {
  responsable_inscripto: 'Responsable inscripto',
  monotributista: 'Monotributista',
  exento: 'IVA exento',
  no_alcanzado: 'No alcanzado',
  exterior: 'Proveedor del exterior',
};
const ESTADO_BADGE = {
  pagada: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  pendiente: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  cancelada: 'bg-slate-100 text-slate-500 ring-slate-500/20 line-through',
};

// ---------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------
export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let fmtMoneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
let fmtMonedaCorta = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', notation: 'compact', maximumFractionDigits: 1 });
let fmtNumero = new Intl.NumberFormat('es-AR');
let fmtImporte = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function configurarFormato(config) {
  Object.assign(state.config, config);
  const { locale, currency } = state.config;
  fmtMoneda = new Intl.NumberFormat(locale, { style: 'currency', currency });
  fmtMonedaCorta = new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
  fmtNumero = new Intl.NumberFormat(locale);
  fmtImporte = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const moneda = (n) => fmtMoneda.format(Number(n) || 0);
export const monedaCorta = (n) => fmtMonedaCorta.format(Number(n) || 0);
export const entero = (n) => fmtNumero.format(Number(n) || 0);
/** Importe para mostrar dentro de un input: 1234.5 -> "1.234,50" */
export const importeInput = (n) => (n === '' || n == null || Number.isNaN(Number(n)) ? '' : fmtImporte.format(Number(n)));

// Fechas 'AAAA-MM-DD' -> texto local, sin desfases de zona horaria.
export function fecha(iso, opts = { day: '2-digit', month: '2-digit', year: 'numeric' }) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat(state.config.locale, { ...opts, timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
}

// Timestamps -> fecha y hora en la zona horaria configurada (Buenos Aires).
export function fechaHora(ts) {
  if (!ts) return '—';
  return new Intl.DateTimeFormat(state.config.locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: state.config.timezone,
  }).format(new Date(ts));
}

export function hoyLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/**
 * Convierte lo que escribe el usuario a número. Acepta formato argentino
 * ("1.234,56"), punto decimal ("1234.56") y el símbolo $. Devuelve NaN si
 * no es un importe válido.
 */
export function parsearMonto(valor) {
  if (typeof valor === 'number') return valor;
  let s = String(valor ?? '').trim().replace(/[$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

// CUIT: '30712345604' -> '30-71234560-4' (también formatea mientras se escribe)
export function formatearCuit(valor) {
  const d = String(valor ?? '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

export function esCuitValido(valor) {
  const cuit = String(valor ?? '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(cuit)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(cuit[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) return false;
  return dv === Number(cuit[10]);
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------
export class ApiError extends Error {
  constructor(message, { status = 0, details = null, requestId = null } = {}) {
    super(message);
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Sin respuesta del servidor: el Worker no pudo registrarlo, lo intenta el navegador.
    reportarError('Falla de red al llamar a la API', { path, method, error: String(err) });
    throw new ApiError('No se pudo conectar con el servidor. Revisá tu conexión.', { status: 0 });
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error || `Error ${res.status}`, {
      status: res.status,
      details: data?.details,
      requestId: data?.request_id || res.headers.get('x-request-id'),
    });
  }
  return data;
}

// ---------------------------------------------------------------------
// Registro de errores del navegador -> /api/logs
// ---------------------------------------------------------------------
const recientes = new Map();
let enviadosEnMinuto = 0;
setInterval(() => (enviadosEnMinuto = 0), 60_000);

export function reportarError(mensaje, detalle = null, nivel = 'error') {
  const clave = `${nivel}:${mensaje}`;
  const ahora = Date.now();
  if (recientes.has(clave) && ahora - recientes.get(clave) < 30_000) return; // evita repetidos
  if (enviadosEnMinuto >= 10) return; // límite por minuto
  recientes.set(clave, ahora);
  enviadosEnMinuto++;
  fetch('/api/logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nivel, mensaje: String(mensaje).slice(0, 2000), detalle, ruta: location.hash || '/' }),
    keepalive: true,
  }).catch(() => {});
}

export function instalarCapturaDeErrores() {
  window.addEventListener('error', (e) => {
    // "Script error." sin archivo = error de un script de otro origen (extensiones,
    // CDN): el navegador oculta el detalle y no aporta nada al registro.
    if (e.message === 'Script error.' && !e.filename) return;
    reportarError(e.message || 'Error de JavaScript', {
      archivo: e.filename,
      linea: e.lineno,
      columna: e.colno,
      stack: e.error?.stack?.split('\n').slice(0, 8).join('\n'),
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r instanceof ApiError && r.status) return; // ya lo registró el Worker
    reportarError(`Promesa rechazada: ${r?.message ?? r}`, { stack: r?.stack?.split('\n').slice(0, 8).join('\n') });
  });
}

// ---------------------------------------------------------------------
// Toasts y modal de confirmación
// ---------------------------------------------------------------------
export function toast(mensaje, tipo = 'ok', extra = '') {
  const estilos = {
    ok: { ring: 'ring-blue-200', icono: 'text-blue-600', path: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    error: { ring: 'ring-red-200', icono: 'text-red-600', path: 'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z' },
  }[tipo];
  const el = document.createElement('div');
  el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  el.className = `flex w-full max-w-sm items-start gap-3 rounded-xl bg-white p-4 shadow-lg ring-1 ${estilos.ring} transition duration-300 -translate-y-2 opacity-0`;
  el.innerHTML = `
    <svg class="h-5 w-5 shrink-0 ${estilos.icono}" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="${estilos.path}"/></svg>
    <div class="text-sm text-slate-700"><p>${esc(mensaje)}</p>${extra ? `<p class="mt-1 text-xs text-slate-500">${esc(extra)}</p>` : ''}</div>`;
  $('#toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.remove('-translate-y-2', 'opacity-0'));
  setTimeout(() => {
    el.classList.add('opacity-0');
    setTimeout(() => el.remove(), 300);
  }, tipo === 'error' ? 7000 : 3500);
}

/** Toast de error con el código de seguimiento (request id) cuando lo hay. */
export function toastError(err, prefijo = '') {
  const msg = prefijo ? `${prefijo}: ${err.message}` : err.message;
  const extra = err.requestId && (err.status >= 500 || err.status === 0)
    ? `Código ${err.requestId} · Detalle en Configuración → Registro de errores`
    : '';
  toast(msg, 'error', extra);
}

export function confirmar(titulo, mensaje, textoAceptar = 'Eliminar') {
  const modal = $('#modal');
  $('#modal-titulo').textContent = titulo;
  $('#modal-mensaje').textContent = mensaje;
  $('#modal-aceptar').textContent = textoAceptar;
  modal.classList.remove('hidden');
  $('#modal-aceptar').focus();
  return new Promise((resolve) => {
    const cerrar = (valor) => {
      modal.classList.add('hidden');
      $('#modal-aceptar').removeEventListener('click', aceptar);
      $$('[data-modal-cerrar]', modal).forEach((b) => b.removeEventListener('click', cancelar));
      document.removeEventListener('keydown', onKey);
      resolve(valor);
    };
    const aceptar = () => cerrar(true);
    const cancelar = () => cerrar(false);
    const onKey = (e) => e.key === 'Escape' && cerrar(false);
    $('#modal-aceptar').addEventListener('click', aceptar);
    $$('[data-modal-cerrar]', modal).forEach((b) => b.addEventListener('click', cancelar));
    document.addEventListener('keydown', onKey);
  });
}

// ---------------------------------------------------------------------
// Errores de validación por campo (respuestas 409/422 de la API)
// ---------------------------------------------------------------------
export function limpiarErrores(form) {
  $$('[data-error]', form).forEach((p) => {
    p.textContent = '';
    p.classList.add('hidden');
  });
  $$('[aria-invalid="true"]', form).forEach((i) => {
    i.classList.remove('ring-2', 'ring-red-500');
    i.removeAttribute('aria-invalid');
  });
}

export function marcarError(form, campo, msg) {
  const p = $(`[data-error="${campo}"]`, form);
  if (p) {
    p.textContent = msg;
    p.classList.remove('hidden');
  }
  const input = form.elements[campo];
  if (input?.classList) {
    input.classList.add('ring-2', 'ring-red-500');
    input.setAttribute('aria-invalid', 'true');
  }
}

export function mostrarErrores(form, err) {
  limpiarErrores(form);
  let primero = null;
  if (err.details && typeof err.details === 'object') {
    for (const [campo, msg] of Object.entries(err.details)) {
      marcarError(form, campo, msg);
      primero ??= form.elements[campo];
    }
  }
  primero?.focus?.();
  toastError(err);
}

// ---------------------------------------------------------------------
// Fragmentos de HTML reutilizables
// ---------------------------------------------------------------------
export function filaVacia(columnas, texto) {
  return `<tr><td colspan="${columnas}" class="px-6 py-12 text-center text-sm text-slate-500">${esc(texto)}</td></tr>`;
}

export function badgeEstado(estado) {
  return `<span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${ESTADO_BADGE[estado] || ''}">${ESTADO_TEXTO[estado] || esc(estado)}</span>`;
}

export function badgeActivo(activo, si = 'Activo', no = 'Inactivo') {
  return activo
    ? `<span class="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">${si}</span>`
    : `<span class="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-500/20">${no}</span>`;
}

export function botonesAccion(tipo, id, avisoEliminar = '') {
  return `
    <div class="inline-flex gap-1">
      <button type="button" data-accion="editar-${tipo}" data-id="${id}" class="rounded-lg p-2 text-slate-500 hover:bg-blue-50 hover:text-blue-700" title="Editar">
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"/></svg>
        <span class="sr-only">Editar</span>
      </button>
      <button type="button" data-accion="eliminar-${tipo}" data-id="${id}" class="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600" title="${esc(avisoEliminar || 'Eliminar')}">
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
        <span class="sr-only">Eliminar</span>
      </button>
    </div>`;
}

// ---------------------------------------------------------------------
// Catálogos compartidos (categorías y proveedores)
// Cada carga emite un evento para que las vistas se actualicen.
// ---------------------------------------------------------------------
export async function cargarCategorias() {
  const { data } = await api('/categorias');
  state.categorias = data;
  document.dispatchEvent(new CustomEvent('datos:categorias'));
}

export async function cargarProveedores() {
  const { data } = await api('/proveedores');
  state.proveedores = data;
  document.dispatchEvent(new CustomEvent('datos:proveedores'));
}

/** Llena un <select> conservando la opción elegida. */
export function llenarSelect(sel, items, { vacio, valor, texto, incluir } = {}) {
  const actual = incluir != null ? String(incluir) : sel.value;
  sel.innerHTML =
    (vacio != null ? `<option value="">${esc(vacio)}</option>` : '') +
    items.map((i) => `<option value="${esc(valor(i))}">${esc(texto(i))}</option>`).join('');
  sel.value = actual;
  if (sel.value !== actual) sel.value = '';
}
