// =====================================================================
// Facturas: formulario de carga/edición y listado con filtros
// =====================================================================
import {
  $,
  $$,
  api,
  badgeEstado,
  botonesAccion,
  cargarCategorias,
  cargarProveedores,
  CONDICION_IVA_TEXTO,
  confirmar,
  debounce,
  entero,
  esc,
  fecha,
  filaVacia,
  formatearCuit,
  hoyLocal,
  importeInput,
  limpiarErrores,
  llenarSelect,
  marcarError,
  moneda,
  mostrarErrores,
  parsearMonto,
  state,
  toast,
  toastError,
} from './core.js';
import { abrirAltaRapida } from './proveedores.js';

const lista = { page: 1, pageSize: 15, total: 0, filtros: {}, filas: [] };
const ALICUOTAS = [0.21, 0.105, 0.27];
const form = () => $('#form-factura');

// ---------------------------------------------------------------------
// Selects de categorías y proveedores
// ---------------------------------------------------------------------
function renderSelectCategorias(incluirId) {
  const f = form();
  const actual = incluirId != null ? String(incluirId) : f.elements.categoria_id.value;
  llenarSelect(
    f.elements.categoria_id,
    state.categorias.filter((c) => c.activa || String(c.id) === actual),
    { vacio: 'Seleccioná…', valor: (c) => c.id, texto: (c) => (c.activa ? c.nombre : `${c.nombre} (inactiva)`), incluir: actual },
  );
  llenarSelect($('#flt-categoria'), state.categorias, { vacio: 'Todas las categorías', valor: (c) => c.id, texto: (c) => c.nombre });
}

function renderSelectProveedores(incluirId) {
  const f = form();
  const actual = incluirId != null ? String(incluirId) : f.elements.proveedor_id.value;
  llenarSelect(
    f.elements.proveedor_id,
    state.proveedores.filter((p) => p.activo || String(p.id) === actual),
    {
      vacio: state.proveedores.length ? 'Seleccioná un proveedor…' : 'No hay proveedores: creá uno con "+ Nuevo"',
      valor: (p) => p.id,
      texto: (p) => `${p.razon_social}${p.cuit ? ` — ${formatearCuit(p.cuit)}` : ''}${p.activo ? '' : ' (inactivo)'}`,
      incluir: actual,
    },
  );
  llenarSelect($('#flt-proveedor'), state.proveedores, { vacio: 'Todos los proveedores', valor: (p) => p.id, texto: (p) => p.razon_social });
  if (lista.filtros.proveedor_id) $('#flt-proveedor').value = lista.filtros.proveedor_id;
  mostrarInfoProveedor();
}

function mostrarInfoProveedor() {
  const id = Number(form().elements.proveedor_id.value);
  const p = state.proveedores.find((x) => x.id === id);
  $('#f-proveedor-info').textContent = p
    ? [p.cuit ? `CUIT ${formatearCuit(p.cuit)}` : 'Sin CUIT', CONDICION_IVA_TEXTO[p.condicion_iva]].filter(Boolean).join(' · ')
    : '';
}

// Al elegir proveedor en una factura nueva se sugieren su tipo de factura
// habitual y su categoría por defecto.
function alCambiarProveedor() {
  const f = form();
  mostrarInfoProveedor();
  if (f.elements.id.value) return;
  const p = state.proveedores.find((x) => x.id === Number(f.elements.proveedor_id.value));
  if (!p) return;
  if (p.tipo_comprobante) {
    f.elements.tipo_comprobante.value = p.tipo_comprobante;
    alCambiarTipo();
  }
  const cat = state.categorias.find((c) => c.id === p.categoria_id && c.activa);
  if (cat) f.elements.categoria_id.value = String(cat.id);
}

// ---------------------------------------------------------------------
// Importes, IVA y total
// ---------------------------------------------------------------------
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

function recalcularTotal() {
  const f = form();
  const subtotal = parsearMonto(f.elements.subtotal.value);
  const alicuota = $('#f-alicuota').value;
  if (alicuota !== 'manual') {
    const imp = Number.isFinite(subtotal) ? Math.round(subtotal * Number(alicuota) * 100) / 100 : NaN;
    f.elements.impuestos.value = Number.isFinite(imp) && f.elements.subtotal.value.trim() ? importeInput(imp) : '';
  }
  const impuestos = parsearMonto(f.elements.impuestos.value || '0');
  const total = (Number.isFinite(subtotal) ? subtotal : 0) + (Number.isFinite(impuestos) ? impuestos : 0);
  $('#f-total').textContent = moneda(total);
}

// B, C y E no discriminan IVA; A y M sí.
function alCambiarTipo() {
  const discrimina = ['A', 'M'].includes(form().elements.tipo_comprobante.value);
  const actual = $('#f-alicuota').value;
  if (!discrimina) $('#f-alicuota').value = '0';
  else if (actual === '0') fijarAlicuota(state.config.iva);
  recalcularTotal();
}

// "3-12345" -> "00003-00012345"
function normalizarNumero(valor) {
  const m = String(valor).trim().match(/^(\d{1,5})\s*-\s*(\d{1,8})$/);
  return m ? `${m[1].padStart(5, '0')}-${m[2].padStart(8, '0')}` : String(valor).trim();
}

// ---------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------
export function resetFormFactura() {
  const f = form();
  f.reset();
  f.elements.id.value = '';
  f.elements.fecha.value = state.config.hoy || hoyLocal();
  fijarAlicuota(state.config.iva);
  limpiarErrores(f);
  renderSelectCategorias('');
  renderSelectProveedores('');
  recalcularTotal();
  $('#factura-form-titulo').textContent = 'Nueva factura';
  $('#factura-guardar').textContent = 'Guardar factura';
  $('#factura-editando').classList.add('hidden');
}

function editar(id) {
  const fac = lista.filas.find((x) => x.id === id);
  if (!fac) return;
  const f = form();
  limpiarErrores(f);
  f.elements.id.value = fac.id;
  f.elements.tipo_comprobante.value = fac.tipo_comprobante;
  f.elements.numero_comprobante.value = fac.numero_comprobante;
  f.elements.fecha.value = fac.fecha;
  renderSelectProveedores(fac.proveedor_id);
  renderSelectCategorias(fac.categoria_id);
  f.elements.subtotal.value = importeInput(fac.subtotal);
  f.elements.impuestos.value = importeInput(fac.impuestos);
  f.elements.metodo_pago.value = fac.metodo_pago;
  f.elements.notas.value = fac.notas ?? '';
  $$('input[name="estado"]', f).forEach((r) => (r.checked = r.value === fac.estado));
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

// Validación en el navegador: evita viajes a la API con datos incompletos
// y señala cada campo con su problema. La API vuelve a validar todo.
function leerYValidar(f) {
  limpiarErrores(f);
  const errores = {};
  const numero = normalizarNumero(f.elements.numero_comprobante.value);
  f.elements.numero_comprobante.value = numero;

  const subtotalTxt = f.elements.subtotal.value.trim();
  const impuestosTxt = f.elements.impuestos.value.trim();
  const subtotal = parsearMonto(subtotalTxt);
  const impuestos = impuestosTxt ? parsearMonto(impuestosTxt) : 0;

  if (!numero) errores.numero_comprobante = 'Ingresá el número de comprobante.';
  if (!f.elements.fecha.value) errores.fecha = 'Ingresá la fecha.';
  if (!f.elements.proveedor_id.value) errores.proveedor_id = 'Seleccioná un proveedor.';
  if (!f.elements.categoria_id.value) errores.categoria_id = 'Seleccioná una categoría.';
  if (!subtotalTxt) errores.subtotal = 'Ingresá el importe.';
  else if (!Number.isFinite(subtotal) || subtotal < 0) errores.subtotal = 'Importe inválido (ej. 12.345,67).';
  if (!Number.isFinite(impuestos) || impuestos < 0) errores.impuestos = 'Importe inválido (ej. 2.592,59).';

  if (Object.keys(errores).length) {
    for (const [campo, msg] of Object.entries(errores)) marcarError(f, campo, msg);
    f.elements[Object.keys(errores)[0]]?.focus();
    toast('Revisá los datos del formulario.', 'error');
    return null;
  }

  return {
    tipo_comprobante: f.elements.tipo_comprobante.value,
    numero_comprobante: numero,
    proveedor_id: Number(f.elements.proveedor_id.value),
    categoria_id: Number(f.elements.categoria_id.value),
    fecha: f.elements.fecha.value,
    subtotal: Math.round(subtotal * 100) / 100,
    impuestos: Math.round(impuestos * 100) / 100,
    metodo_pago: f.elements.metodo_pago.value,
    estado: f.querySelector('input[name="estado"]:checked')?.value || 'pagada',
    notas: f.elements.notas.value,
  };
}

let guardando = false;

async function guardar(e) {
  e.preventDefault();
  if (guardando) return; // evita doble envío (doble clic / Enter repetido)
  const f = e.currentTarget;
  const body = leerYValidar(f);
  if (!body) return;

  const id = f.elements.id.value;
  const btn = $('#factura-guardar');
  guardando = true;
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    const { data } = await api(id ? `/facturas/${id}` : '/facturas', { method: id ? 'PUT' : 'POST', body });
    toast(id ? 'Factura actualizada.' : `Factura ${data.tipo_comprobante} ${data.numero_comprobante} cargada.`);
    resetFormFactura();
    if (!id) lista.page = 1;
    await Promise.all([cargarFacturas(), cargarCategorias(), cargarProveedores()]);
  } catch (err) {
    mostrarErrores(f, err);
  } finally {
    guardando = false;
    btn.disabled = false;
    btn.textContent = f.elements.id.value ? 'Actualizar factura' : 'Guardar factura';
  }
}

async function eliminar(id) {
  const fac = lista.filas.find((x) => x.id === id);
  const ok = await confirmar(
    'Eliminar factura',
    fac
      ? `Se eliminará la factura ${fac.tipo_comprobante} ${fac.numero_comprobante} de ${fac.proveedor} por ${moneda(fac.total)}.`
      : 'Se eliminará la factura.',
  );
  if (!ok) return;
  try {
    await api(`/facturas/${id}`, { method: 'DELETE' });
    toast('Factura eliminada.');
    if (form().elements.id.value === String(id)) resetFormFactura();
    if (lista.filas.length === 1 && lista.page > 1) lista.page--;
    await Promise.all([cargarFacturas(), cargarCategorias(), cargarProveedores()]);
  } catch (err) {
    toastError(err);
  }
}

// ---------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------
export async function cargarFacturas() {
  const params = new URLSearchParams({ page: lista.page, page_size: lista.pageSize });
  for (const [k, v] of Object.entries(lista.filtros)) if (v) params.set(k, v);

  $('#tabla-facturas').innerHTML = filaVacia(7, 'Cargando…');
  try {
    const res = await api(`/facturas?${params}`);
    lista.total = res.total;
    lista.filas = res.data;
    renderFacturas();
  } catch (err) {
    $('#tabla-facturas').innerHTML = filaVacia(7, `No se pudieron cargar las facturas: ${err.message}`);
    toastError(err);
  }
}

function renderFacturas() {
  const { page, pageSize, total, filas } = lista;
  $('#tabla-facturas').innerHTML = filas.length
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

  const desde = total ? (page - 1) * pageSize + 1 : 0;
  const hasta = Math.min(page * pageSize, total);
  $('#facturas-info').textContent = `Mostrando ${entero(desde)}–${entero(hasta)} de ${entero(total)} facturas`;
  $('#pag-anterior').disabled = page <= 1;
  $('#pag-siguiente').disabled = hasta >= total;
}

/** Permite abrir el listado filtrado desde otras vistas (#facturas?proveedor_id=3). */
export function aplicarFiltrosDesdeUrl(params) {
  const flt = $('#filtros-facturas');
  const proveedor = params.get('proveedor_id') || '';
  if (proveedor !== (lista.filtros.proveedor_id || '')) {
    flt.reset();
    flt.elements.proveedor_id.value = proveedor;
    lista.filtros = proveedor ? { proveedor_id: proveedor } : {};
    lista.page = 1;
  }
}

// ---------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------
export function iniciarFacturas() {
  const f = form();
  f.addEventListener('submit', guardar);
  f.elements.subtotal.addEventListener('input', recalcularTotal);
  f.elements.impuestos.addEventListener('input', () => {
    $('#f-alicuota').value = 'manual';
    recalcularTotal();
  });
  for (const campo of [f.elements.subtotal, f.elements.impuestos]) {
    campo.addEventListener('blur', () => {
      const n = parsearMonto(campo.value);
      if (campo.value.trim() && Number.isFinite(n)) campo.value = importeInput(n);
      recalcularTotal();
    });
  }
  $('#f-alicuota').addEventListener('change', recalcularTotal);
  f.elements.tipo_comprobante.addEventListener('change', alCambiarTipo);
  f.elements.proveedor_id.addEventListener('change', alCambiarProveedor);
  f.elements.numero_comprobante.addEventListener('blur', (e) => (e.target.value = normalizarNumero(e.target.value)));
  $('#factura-cancelar').addEventListener('click', resetFormFactura);
  $('#btn-nuevo-proveedor').addEventListener('click', () =>
    abrirAltaRapida((nuevo) => {
      renderSelectProveedores(nuevo.id);
      alCambiarProveedor();
      f.elements.categoria_id.focus();
    }),
  );

  // Filtros
  const flt = $('#filtros-facturas');
  const aplicar = () => {
    lista.filtros = Object.fromEntries(new FormData(flt));
    lista.page = 1;
    if (!lista.filtros.proveedor_id && location.hash.includes('?')) history.replaceState(null, '', '#facturas');
    cargarFacturas();
  };
  flt.addEventListener('submit', (e) => {
    e.preventDefault();
    aplicar();
  });
  flt.elements.q.addEventListener('input', debounce(aplicar, 350));
  ['categoria_id', 'proveedor_id', 'estado', 'desde', 'hasta'].forEach((n) => flt.elements[n].addEventListener('change', aplicar));

  $('#pag-anterior').addEventListener('click', () => {
    lista.page = Math.max(1, lista.page - 1);
    cargarFacturas();
  });
  $('#pag-siguiente').addEventListener('click', () => {
    lista.page++;
    cargarFacturas();
  });

  document.addEventListener('datos:categorias', () => renderSelectCategorias());
  document.addEventListener('datos:proveedores', () => renderSelectProveedores());
  return { 'editar-factura': editar, 'eliminar-factura': eliminar };
}
