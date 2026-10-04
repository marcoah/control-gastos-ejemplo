// =====================================================================
// Control de Gastos — frontend (JS vanilla, sin build)
// Habla exclusivamente con la API del Worker (/api/*).
// =====================================================================

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const state = {
  config: { locale: 'es-AR', currency: 'ARS', iva: 0.21, hoy: null },
  categorias: [],
  facturas: { page: 1, pageSize: 15, total: 0, filtros: {} },
  chart: null,
};

const ESTADO_BADGE = {
  pagada: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  pendiente: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  cancelada: 'bg-slate-100 text-slate-500 ring-slate-500/20 line-through',
};
const ESTADO_TEXTO = { pagada: 'Pagada', pendiente: 'Pendiente', cancelada: 'Anulada' };

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let fmtMoneda;
const moneda = (n) => fmtMoneda.format(Number(n) || 0);
const monedaCorta = (n) =>
  new Intl.NumberFormat(state.config.locale, {
    style: 'currency',
    currency: state.config.currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(n) || 0);
const entero = (n) => new Intl.NumberFormat(state.config.locale).format(Number(n) || 0);

// Fechas 'AAAA-MM-DD' -> texto local, sin desfases de zona horaria.
function fecha(iso, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat(state.config.locale, { ...opts, timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
}

// CUIT: '30712345604' -> '30-71234560-4' (también formatea mientras se escribe)
function formatearCuit(valor) {
  const d = String(valor ?? '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

const ALICUOTAS = [0.21, 0.105, 0.27];

function fijarAlicuota(tasa) {
  const sel = $('#f-alicuota');
  const opcion = [...sel.options].find((o) => o.value !== 'manual' && Number(o.value) === Number(tasa));
  sel.value = opcion ? opcion.value : 'manual';
}

function deducirAlicuota(subtotal, impuestos) {
  if (!impuestos) return '0';
  if (!subtotal) return 'manual';
  const tasa = ALICUOTAS.find((t) => Math.abs(subtotal * t - impuestos) < 0.015);
  return tasa != null ? String(tasa) : 'manual';
}

function hoyLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

class ApiError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error || `Error ${res.status}`, data?.details);
  return data;
}

// ---------------------------------------------------------------------
// Toasts y modal
// ---------------------------------------------------------------------
function toast(mensaje, tipo = 'ok') {
  const estilos = {
    ok: { ring: 'ring-blue-200', icono: 'text-blue-600', path: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    error: { ring: 'ring-red-200', icono: 'text-red-600', path: 'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z' },
  }[tipo];
  const el = document.createElement('div');
  el.className = `pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl bg-white p-4 shadow-lg ring-1 ${estilos.ring} transition duration-300 translate-y-2 opacity-0`;
  el.innerHTML = `
    <svg class="h-5 w-5 shrink-0 ${estilos.icono}" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="${estilos.path}"/></svg>
    <p class="text-sm text-slate-700">${esc(mensaje)}</p>`;
  $('#toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.remove('translate-y-2', 'opacity-0'));
  setTimeout(() => {
    el.classList.add('opacity-0');
    setTimeout(() => el.remove(), 300);
  }, tipo === 'error' ? 6000 : 3500);
}

function confirmar(titulo, mensaje, textoAceptar = 'Eliminar') {
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

// Errores de validación por campo (respuesta 422 de la API)
function limpiarErrores(form) {
  $$('[data-error]', form).forEach((p) => {
    p.textContent = '';
    p.classList.add('hidden');
  });
  $$('.ring-red-500', form).forEach((i) => i.classList.remove('ring-2', 'ring-red-500'));
}

function mostrarErrores(form, err) {
  limpiarErrores(form);
  if (err.details && typeof err.details === 'object') {
    for (const [campo, msg] of Object.entries(err.details)) {
      const p = $(`[data-error="${campo}"]`, form);
      if (p) {
        p.textContent = msg;
        p.classList.remove('hidden');
      }
      form.elements[campo]?.classList?.add('ring-2', 'ring-red-500');
    }
  }
  toast(err.message, 'error');
}

// ---------------------------------------------------------------------
// Navegación por hash
// ---------------------------------------------------------------------
const VISTAS = ['dashboard', 'facturas', 'categorias'];

function navegar() {
  const vista = VISTAS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard';
  $$('[data-view]').forEach((s) => s.classList.toggle('hidden', s.dataset.view !== vista));
  $$('[data-nav]').forEach((a) => {
    const activo = a.dataset.nav === vista;
    a.classList.toggle('bg-white', activo);
    a.classList.toggle('text-blue-900', activo);
    a.classList.toggle('shadow-sm', activo);
    a.classList.toggle('text-blue-100', !activo);
    a.classList.toggle('hover:bg-white/10', !activo);
    a.setAttribute('aria-current', activo ? 'page' : 'false');
  });
  if (vista === 'dashboard') cargarDashboard();
  if (vista === 'facturas') cargarFacturas();
  if (vista === 'categorias') renderCategorias();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------------
async function cargarCategorias() {
  const { data } = await api('/categorias');
  state.categorias = data;
  renderSelectsCategorias();
  renderCategorias();
}

function renderSelectsCategorias(incluirId) {
  const sel = $('#f-categoria');
  const actual = incluirId != null ? String(incluirId) : sel.value;
  const activas = state.categorias.filter((c) => c.activa || String(c.id) === actual);
  sel.innerHTML =
    '<option value="">Seleccioná…</option>' +
    activas.map((c) => `<option value="${c.id}">${esc(c.nombre)}${c.activa ? '' : ' (inactiva)'}</option>`).join('');
  sel.value = actual;

  const flt = $('#flt-categoria');
  const actualFlt = flt.value;
  flt.innerHTML =
    '<option value="">Todas las categorías</option>' +
    state.categorias.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  flt.value = actualFlt;
}

function renderCategorias() {
  const tbody = $('#tabla-categorias');
  if (!state.categorias.length) {
    tbody.innerHTML = filaVacia(6, 'Todavía no hay categorías. Creá la primera con el formulario.');
    return;
  }
  tbody.innerHTML = state.categorias
    .map(
      (c) => `
      <tr class="hover:bg-slate-50/70">
        <td class="px-6 py-3">
          <div class="flex items-center gap-3">
            <span class="h-3 w-3 shrink-0 rounded-full ring-2 ring-white" style="background:${esc(c.color)}; box-shadow:0 0 0 1px ${esc(c.color)}"></span>
            <div class="min-w-0">
              <p class="font-medium text-slate-900">${esc(c.nombre)}</p>
              ${c.descripcion ? `<p class="truncate text-xs text-slate-500">${esc(c.descripcion)}</p>` : ''}
            </div>
          </div>
        </td>
        <td class="px-3 py-3 text-right tabular text-slate-700">${c.presupuesto_mensual != null ? moneda(c.presupuesto_mensual) : '<span class="text-slate-400">—</span>'}</td>
        <td class="px-3 py-3 text-right tabular text-slate-700">${entero(c.facturas)}</td>
        <td class="px-3 py-3 text-right tabular text-slate-700">${moneda(c.gasto_total)}</td>
        <td class="px-3 py-3">
          ${
            c.activa
              ? '<span class="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">Activa</span>'
              : '<span class="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-500/20">Inactiva</span>'
          }
        </td>
        <td class="whitespace-nowrap px-6 py-3 text-right">
          ${botonesAccion('categoria', c.id, c.facturas > 0 ? 'Tiene facturas asociadas' : '')}
        </td>
      </tr>`,
    )
    .join('');
}

function editarCategoria(id) {
  const c = state.categorias.find((x) => x.id === id);
  if (!c) return;
  const f = $('#form-categoria');
  limpiarErrores(f);
  f.elements.id.value = c.id;
  f.elements.nombre.value = c.nombre;
  f.elements.descripcion.value = c.descripcion ?? '';
  f.elements.presupuesto_mensual.value = c.presupuesto_mensual ?? '';
  f.elements.color.value = c.color;
  f.elements.activa.checked = c.activa;
  $('#categoria-form-titulo').textContent = `Editar categoría #${c.id}`;
  $('#categoria-guardar').textContent = 'Actualizar categoría';
  f.elements.nombre.focus();
}

function resetFormCategoria() {
  const f = $('#form-categoria');
  f.reset();
  f.elements.id.value = '';
  limpiarErrores(f);
  $('#categoria-form-titulo').textContent = 'Nueva categoría';
  $('#categoria-guardar').textContent = 'Guardar categoría';
}

async function guardarCategoria(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const id = f.elements.id.value;
  const body = {
    nombre: f.elements.nombre.value,
    descripcion: f.elements.descripcion.value,
    presupuesto_mensual: f.elements.presupuesto_mensual.value,
    color: f.elements.color.value,
    activa: f.elements.activa.checked,
  };
  const btn = $('#categoria-guardar');
  btn.disabled = true;
  try {
    await api(id ? `/categorias/${id}` : '/categorias', { method: id ? 'PUT' : 'POST', body });
    toast(id ? 'Categoría actualizada.' : 'Categoría creada.');
    resetFormCategoria();
    await cargarCategorias();
  } catch (err) {
    mostrarErrores(f, err);
  } finally {
    btn.disabled = false;
  }
}

async function eliminarCategoria(id) {
  const c = state.categorias.find((x) => x.id === id);
  if (!c) return;
  const ok = await confirmar('Eliminar categoría', `Se eliminará "${c.nombre}". Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await api(`/categorias/${id}`, { method: 'DELETE' });
    toast('Categoría eliminada.');
    if ($('#form-categoria').elements.id.value === String(id)) resetFormCategoria();
    await cargarCategorias();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------------------------------------------------------------
// Facturas
// ---------------------------------------------------------------------
async function cargarFacturas() {
  const { page, pageSize, filtros } = state.facturas;
  const params = new URLSearchParams({ page, page_size: pageSize });
  for (const [k, v] of Object.entries(filtros)) if (v) params.set(k, v);

  $('#tabla-facturas').innerHTML = filaVacia(7, 'Cargando…');
  try {
    const res = await api(`/facturas?${params}`);
    state.facturas.total = res.total;
    renderFacturas(res.data);
  } catch (err) {
    $('#tabla-facturas').innerHTML = filaVacia(7, `No se pudieron cargar las facturas: ${err.message}`);
    toast(err.message, 'error');
  }
}

function renderFacturas(filas) {
  const { page, pageSize, total } = state.facturas;
  const tbody = $('#tabla-facturas');

  tbody.innerHTML = filas.length
    ? filas
        .map(
          (f) => `
      <tr class="hover:bg-slate-50/70">
        <td class="whitespace-nowrap px-6 py-3 text-slate-700">${fecha(f.fecha)}</td>
        <td class="whitespace-nowrap px-3 py-3 text-xs text-slate-600">
          <span class="mr-1 inline-flex h-5 w-5 items-center justify-center rounded bg-slate-100 font-semibold text-slate-700">${esc(f.tipo_comprobante)}</span><span class="font-mono">${esc(f.numero_comprobante)}</span>
        </td>
        <td class="px-3 py-3">
          <p class="font-medium text-slate-900">${esc(f.proveedor)}</p>
          ${f.cuit_proveedor ? `<p class="font-mono text-xs text-slate-400">CUIT ${esc(formatearCuit(f.cuit_proveedor))}</p>` : ''}
        </td>
        <td class="px-3 py-3">
          <span class="inline-flex items-center gap-1.5 text-slate-700">
            <span class="h-2 w-2 rounded-full" style="background:${esc(f.categoria?.color)}"></span>${esc(f.categoria?.nombre)}
          </span>
        </td>
        <td class="px-3 py-3">${badgeEstado(f.estado)}</td>
        <td class="whitespace-nowrap px-3 py-3 text-right font-semibold tabular text-slate-900">${moneda(f.total)}</td>
        <td class="whitespace-nowrap px-6 py-3 text-right">${botonesAccion('factura', f.id)}</td>
      </tr>`,
        )
        .join('')
    : filaVacia(7, 'No hay facturas con esos filtros.');

  // Guardamos las filas para poder editarlas sin otra petición
  state.facturas.filas = filas;

  const desde = total ? (page - 1) * pageSize + 1 : 0;
  const hasta = Math.min(page * pageSize, total);
  $('#facturas-info').textContent = `Mostrando ${entero(desde)}–${entero(hasta)} de ${entero(total)} facturas`;
  $('#pag-anterior').disabled = page <= 1;
  $('#pag-siguiente').disabled = hasta >= total;

  // Sugerencias de proveedores para el formulario
  const dl = $('#lista-proveedores');
  const existentes = new Set($$('option', dl).map((o) => o.value));
  filas.forEach((f) => {
    if (!existentes.has(f.proveedor)) {
      const o = document.createElement('option');
      o.value = f.proveedor;
      dl.appendChild(o);
      existentes.add(f.proveedor);
    }
  });
}

function badgeEstado(estado) {
  return `<span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${ESTADO_BADGE[estado] || ''}">${ESTADO_TEXTO[estado] || esc(estado)}</span>`;
}

function recalcularTotal() {
  const f = $('#form-factura');
  const subtotal = Number(f.elements.subtotal.value) || 0;
  const alicuota = $('#f-alicuota').value;
  if (alicuota !== 'manual') {
    const tasa = Number(alicuota);
    f.elements.impuestos.value = subtotal ? (Math.round(subtotal * tasa * 100) / 100).toFixed(2) : '';
  }
  const impuestos = Number(f.elements.impuestos.value) || 0;
  $('#f-total').textContent = moneda(subtotal + impuestos);
}

function resetFormFactura() {
  const f = $('#form-factura');
  f.reset();
  f.elements.id.value = '';
  f.elements.fecha.value = state.config.hoy || hoyLocal();
  fijarAlicuota(state.config.iva);
  limpiarErrores(f);
  renderSelectsCategorias();
  recalcularTotal();
  $('#factura-form-titulo').textContent = 'Nueva factura';
  $('#factura-guardar').textContent = 'Guardar factura';
  $('#factura-editando').classList.add('hidden');
}

function editarFactura(id) {
  const fac = state.facturas.filas?.find((x) => x.id === id);
  if (!fac) return;
  const f = $('#form-factura');
  limpiarErrores(f);
  f.elements.id.value = fac.id;
  f.elements.tipo_comprobante.value = fac.tipo_comprobante;
  f.elements.numero_comprobante.value = fac.numero_comprobante;
  f.elements.fecha.value = fac.fecha;
  f.elements.proveedor.value = fac.proveedor;
  f.elements.cuit_proveedor.value = fac.cuit_proveedor ? formatearCuit(fac.cuit_proveedor) : '';
  f.elements.subtotal.value = Number(fac.subtotal).toFixed(2);
  f.elements.impuestos.value = Number(fac.impuestos).toFixed(2);
  f.elements.metodo_pago.value = fac.metodo_pago;
  f.elements.notas.value = fac.notas ?? '';
  $$('input[name="estado"]', f).forEach((r) => (r.checked = r.value === fac.estado));

  // Si la categoría está inactiva hay que incluirla en el select
  renderSelectsCategorias(fac.categoria_id);

  // Respetar el IVA guardado: se deduce la alícuota o queda en "Manual"
  $('#f-alicuota').value = deducirAlicuota(Number(fac.subtotal), Number(fac.impuestos));
  recalcularTotal();

  $('#factura-form-titulo').textContent = 'Editar factura';
  $('#factura-guardar').textContent = 'Actualizar factura';
  const badge = $('#factura-editando');
  badge.textContent = `Editando #${fac.id} · ${fac.tipo_comprobante} ${fac.numero_comprobante}`;
  badge.classList.remove('hidden');
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  f.elements.numero_comprobante.focus({ preventScroll: true });
}

async function guardarFactura(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const id = f.elements.id.value;
  const body = {
    tipo_comprobante: f.elements.tipo_comprobante.value,
    numero_comprobante: f.elements.numero_comprobante.value,
    fecha: f.elements.fecha.value,
    categoria_id: f.elements.categoria_id.value,
    proveedor: f.elements.proveedor.value,
    cuit_proveedor: f.elements.cuit_proveedor.value.replace(/\D/g, ''),
    subtotal: f.elements.subtotal.value,
    impuestos: f.elements.impuestos.value || 0,
    metodo_pago: f.elements.metodo_pago.value,
    estado: f.querySelector('input[name="estado"]:checked')?.value,
    notas: f.elements.notas.value,
  };
  const btn = $('#factura-guardar');
  btn.disabled = true;
  try {
    await api(id ? `/facturas/${id}` : '/facturas', { method: id ? 'PUT' : 'POST', body });
    toast(id ? 'Factura actualizada.' : 'Factura cargada.');
    resetFormFactura();
    if (!id) state.facturas.page = 1;
    await Promise.all([cargarFacturas(), cargarCategorias()]);
  } catch (err) {
    mostrarErrores(f, err);
  } finally {
    btn.disabled = false;
  }
}

async function eliminarFactura(id) {
  const fac = state.facturas.filas?.find((x) => x.id === id);
  const ok = await confirmar(
    'Eliminar factura',
    fac ? `Se eliminará la factura ${fac.tipo_comprobante} ${fac.numero_comprobante} de ${fac.proveedor} por ${moneda(fac.total)}.` : 'Se eliminará la factura.',
  );
  if (!ok) return;
  try {
    await api(`/facturas/${id}`, { method: 'DELETE' });
    toast('Factura eliminada.');
    if ($('#form-factura').elements.id.value === String(id)) resetFormFactura();
    if (state.facturas.filas?.length === 1 && state.facturas.page > 1) state.facturas.page--;
    await Promise.all([cargarFacturas(), cargarCategorias()]);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------
function kpi({ titulo, valor, detalle = '', icono, extra = '' }) {
  return `
    <div class="relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-slate-500">${titulo}</p>
          <p class="mt-2 truncate text-3xl font-semibold tracking-tight text-slate-900 tabular">${valor}</p>
        </div>
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-100">
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="${icono}"/></svg>
        </span>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">${extra}${detalle}</div>
    </div>`;
}

function variacion(actual, anterior) {
  if (!anterior) return actual ? '<span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">Nuevo</span>' : '';
  const pct = ((actual - anterior) / anterior) * 100;
  const sube = pct >= 0;
  // En gastos, subir es "malo": rojo; bajar es "bueno": azul.
  const cls = sube ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700';
  const flecha = sube ? '▲' : '▼';
  return `<span class="rounded-md px-1.5 py-0.5 text-xs font-semibold ${cls}">${flecha} ${Math.abs(pct).toFixed(1)}%</span>`;
}

const ICONOS = {
  doc: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  cash: 'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z',
  trend: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
  clock: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  ticket: 'M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z',
  tag: 'M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z M6 6h.008v.008H6V6z',
};

async function cargarDashboard() {
  try {
    const { data: d } = await api('/dashboard');
    renderDashboard(d);
  } catch (err) {
    $('#kpis').innerHTML = `<div class="rounded-2xl bg-red-50 p-6 text-sm text-red-700 ring-1 ring-red-200 sm:col-span-2 lg:col-span-3">No se pudo cargar el dashboard: ${esc(err.message)}</div>`;
    toast(err.message, 'error');
  }
}

function renderDashboard(d) {
  $('#dash-fecha').textContent = fecha(d.fecha_corte, { day: 'numeric', month: 'long', year: 'numeric' });

  const gasto = Number(d.gasto_mes);
  const proyeccion = d.dia_actual ? (gasto / d.dia_actual) * d.dias_mes : 0;
  const ticket = d.facturas_mes ? gasto / d.facturas_mes : 0;
  const topCat = d.por_categoria.find((c) => Number(c.gasto) > 0);
  const nombreMes = fecha(d.fecha_corte, { month: 'long' });

  $('#kpis').innerHTML = [
    kpi({
      titulo: 'Facturas registradas',
      valor: entero(d.total_facturas),
      icono: ICONOS.doc,
      detalle: `<span><strong class="font-semibold text-slate-700">${entero(d.facturas_mes)}</strong> en ${nombreMes}</span>`,
    }),
    kpi({
      titulo: 'Gasto del mes a la fecha',
      valor: moneda(gasto),
      icono: ICONOS.cash,
      extra: variacion(gasto, Number(d.gasto_mes_anterior_mismo_periodo)),
      detalle: `<span>vs. ${moneda(d.gasto_mes_anterior_mismo_periodo)} mismo período del mes anterior</span>`,
    }),
    kpi({
      titulo: 'Proyección al cierre del mes',
      valor: moneda(proyeccion),
      icono: ICONOS.trend,
      extra: variacion(proyeccion, Number(d.gasto_mes_anterior_total)),
      detalle: `<span>al ritmo de ${moneda(d.dia_actual ? gasto / d.dia_actual : 0)}/día · mes anterior ${monedaCorta(d.gasto_mes_anterior_total)}</span>`,
    }),
    kpi({
      titulo: 'Pendientes de pago',
      valor: moneda(d.pendientes.monto),
      icono: ICONOS.clock,
      detalle: `<span><strong class="font-semibold text-slate-700">${entero(d.pendientes.cantidad)}</strong> factura(s) por pagar</span>`,
    }),
    kpi({
      titulo: 'Ticket promedio del mes',
      valor: moneda(ticket),
      icono: ICONOS.ticket,
      detalle: `<span>monto medio por factura en ${nombreMes}</span>`,
    }),
    kpi({
      titulo: 'Categoría con mayor gasto',
      valor: topCat ? esc(topCat.nombre) : '—',
      icono: ICONOS.tag,
      detalle: topCat
        ? `<span>${moneda(topCat.gasto)} · ${gasto ? ((topCat.gasto / gasto) * 100).toFixed(0) : 0}% del gasto del mes</span>`
        : '<span>sin gastos este mes</span>',
    }),
  ].join('');

  renderChart(d.tendencia);
  renderPresupuesto(d.por_categoria);

  $('#dash-ultimas').innerHTML = d.ultimas.length
    ? d.ultimas
        .map(
          (f) => `
      <li class="flex items-center justify-between gap-4 px-6 py-3.5">
        <div class="flex min-w-0 items-center gap-3">
          <span class="h-9 w-1 shrink-0 rounded-full" style="background:${esc(f.categoria_color)}"></span>
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-slate-900">${esc(f.proveedor)}</p>
            <p class="truncate text-xs text-slate-500">Fact. ${esc(f.tipo_comprobante)} ${esc(f.numero_comprobante)} · ${esc(f.categoria)} · ${fecha(f.fecha)}</p>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-3">
          ${badgeEstado(f.estado)}
          <span class="w-28 text-right text-sm font-semibold tabular text-slate-900">${moneda(f.total)}</span>
        </div>
      </li>`,
        )
        .join('')
    : '<li class="px-6 py-10 text-center text-sm text-slate-500">Todavía no hay facturas.</li>';

  const maxProv = Math.max(1, ...d.top_proveedores.map((p) => Number(p.total)));
  $('#dash-proveedores').innerHTML = d.top_proveedores.length
    ? d.top_proveedores
        .map(
          (p, i) => `
      <li class="px-6 py-3.5">
        <div class="flex items-center justify-between gap-3 text-sm">
          <span class="flex min-w-0 items-center gap-2">
            <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[11px] font-bold text-blue-700">${i + 1}</span>
            <span class="truncate font-medium text-slate-800">${esc(p.proveedor)}</span>
          </span>
          <span class="shrink-0 font-semibold tabular text-slate-900">${monedaCorta(p.total)}</span>
        </div>
        <div class="mt-2 h-1.5 rounded-full bg-slate-100"><div class="h-1.5 rounded-full bg-blue-600" style="width:${(Number(p.total) / maxProv) * 100}%"></div></div>
        <p class="mt-1 text-xs text-slate-500">${entero(p.facturas)} factura(s)</p>
      </li>`,
        )
        .join('')
    : '<li class="px-6 py-10 text-center text-sm text-slate-500">Sin movimientos este mes.</li>';
}

function renderPresupuesto(categorias) {
  const lista = categorias.filter((c) => Number(c.presupuesto) > 0 || Number(c.gasto) > 0);
  $('#dash-presupuesto').innerHTML = lista.length
    ? lista
        .map((c) => {
          const gasto = Number(c.gasto);
          const presupuesto = Number(c.presupuesto) || 0;
          const pct = presupuesto ? (gasto / presupuesto) * 100 : null;
          const barra = pct == null ? 'bg-slate-400' : pct > 100 ? 'bg-red-600' : pct >= 80 ? 'bg-amber-500' : 'bg-blue-600';
          const etiqueta =
            pct == null
              ? '<span class="text-slate-400">sin presupuesto</span>'
              : `<span class="${pct > 100 ? 'font-semibold text-red-600' : pct >= 80 ? 'font-semibold text-amber-600' : 'text-slate-500'}">${pct.toFixed(0)}%</span>`;
          return `
        <li>
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="flex min-w-0 items-center gap-2">
              <span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background:${esc(c.color)}"></span>
              <span class="truncate font-medium text-slate-700">${esc(c.nombre)}</span>
            </span>
            ${etiqueta}
          </div>
          <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
            <div class="h-2 rounded-full ${barra}" style="width:${pct == null ? (gasto ? 100 : 0) : Math.min(100, pct)}%"></div>
          </div>
          <p class="mt-1 text-xs tabular text-slate-500">${moneda(gasto)}${presupuesto ? ` de ${moneda(presupuesto)}` : ''}</p>
        </li>`;
        })
        .join('')
    : '<li class="py-6 text-center text-sm text-slate-500">Definí presupuestos en Categorías.</li>';
}

function renderChart(tendencia) {
  if (!window.Chart) return;
  const etiquetas = tendencia.map((t) => fecha(`${t.mes}-01`, { month: 'short', year: '2-digit' }));
  const valores = tendencia.map((t) => Number(t.total));
  const colores = tendencia.map((_, i) => (i === tendencia.length - 1 ? '#1e3a8a' : '#3b82f6'));

  if (state.chart) {
    state.chart.data.labels = etiquetas;
    state.chart.data.datasets[0].data = valores;
    state.chart.data.datasets[0].backgroundColor = colores;
    state.chart.update();
    return;
  }

  state.chart = new window.Chart($('#chart-tendencia'), {
    type: 'bar',
    data: {
      labels: etiquetas,
      datasets: [{ label: 'Gasto', data: valores, backgroundColor: colores, borderRadius: 6, maxBarThickness: 56 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          padding: 10,
          callbacks: {
            label: (ctx) => {
              const t = tendencia[ctx.dataIndex];
              return ` ${moneda(ctx.parsed.y)} · ${entero(t.facturas)} factura(s)`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748b', font: { family: 'Inter' } } },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: '#e2e8f0' },
          ticks: { color: '#64748b', font: { family: 'Inter' }, callback: (v) => monedaCorta(v) },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------
// Helpers de render
// ---------------------------------------------------------------------
function filaVacia(columnas, texto) {
  return `<tr><td colspan="${columnas}" class="px-6 py-12 text-center text-sm text-slate-500">${esc(texto)}</td></tr>`;
}

function botonesAccion(tipo, id, avisoEliminar = '') {
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
// Eventos
// ---------------------------------------------------------------------
function enlazarEventos() {
  window.addEventListener('hashchange', navegar);

  // Delegación para botones de editar/eliminar
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-accion]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    ({
      'editar-factura': editarFactura,
      'eliminar-factura': eliminarFactura,
      'editar-categoria': editarCategoria,
      'eliminar-categoria': eliminarCategoria,
    })[btn.dataset.accion]?.(id);
  });

  $('[data-action="nueva-factura"]').addEventListener('click', () => {
    resetFormFactura();
    setTimeout(() => $('#f-numero').focus(), 50);
  });
  $('#dash-refresh').addEventListener('click', cargarDashboard);

  // Formulario de factura
  const ff = $('#form-factura');
  ff.addEventListener('submit', guardarFactura);
  ff.elements.subtotal.addEventListener('input', recalcularTotal);
  ff.elements.impuestos.addEventListener('input', () => {
    $('#f-alicuota').value = 'manual';
    recalcularTotal();
  });
  $('#f-alicuota').addEventListener('change', recalcularTotal);
  // B, C y E no discriminan IVA; A y M sí.
  ff.elements.tipo_comprobante.addEventListener('change', (e) => {
    const discrimina = ['A', 'M'].includes(e.target.value);
    const actual = $('#f-alicuota').value;
    if (!discrimina) $('#f-alicuota').value = '0';
    else if (actual === '0') fijarAlicuota(state.config.iva);
    recalcularTotal();
  });
  ff.elements.cuit_proveedor.addEventListener('input', (e) => (e.target.value = formatearCuit(e.target.value)));
  $('#factura-cancelar').addEventListener('click', resetFormFactura);

  // Filtros
  const flt = $('#filtros-facturas');
  const aplicarFiltros = () => {
    state.facturas.filtros = Object.fromEntries(new FormData(flt));
    state.facturas.page = 1;
    cargarFacturas();
  };
  flt.addEventListener('submit', (e) => {
    e.preventDefault();
    aplicarFiltros();
  });
  flt.elements.q.addEventListener('input', debounce(aplicarFiltros, 350));
  ['categoria_id', 'estado', 'desde', 'hasta'].forEach((n) => flt.elements[n].addEventListener('change', aplicarFiltros));

  $('#pag-anterior').addEventListener('click', () => {
    state.facturas.page = Math.max(1, state.facturas.page - 1);
    cargarFacturas();
  });
  $('#pag-siguiente').addEventListener('click', () => {
    state.facturas.page++;
    cargarFacturas();
  });

  // Formulario de categoría
  $('#form-categoria').addEventListener('submit', guardarCategoria);
  $('#categoria-cancelar').addEventListener('click', resetFormCategoria);
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
async function iniciar() {
  try {
    const { data } = await api('/config');
    state.config = { ...state.config, ...data };
  } catch {
    /* se usan los valores por defecto */
  }
  fmtMoneda = new Intl.NumberFormat(state.config.locale, { style: 'currency', currency: state.config.currency });

  enlazarEventos();
  resetFormFactura();

  try {
    await cargarCategorias();
  } catch (err) {
    toast(`No se pudieron cargar las categorías: ${err.message}`, 'error');
  }
  resetFormFactura();
  navegar();
}

iniciar();
