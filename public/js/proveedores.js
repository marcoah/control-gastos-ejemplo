// =====================================================================
// CRUD de proveedores + alta rápida desde el formulario de facturas
// =====================================================================
import {
  $,
  api,
  badgeActivo,
  botonesAccion,
  cargarProveedores,
  CONDICION_IVA_TEXTO,
  confirmar,
  debounce,
  entero,
  esCuitValido,
  esc,
  fecha,
  filaVacia,
  formatearCuit,
  limpiarErrores,
  llenarSelect,
  marcarError,
  moneda,
  mostrarErrores,
  state,
  toast,
  toastError,
} from './core.js';

let filtro = '';

function coincide(p, q) {
  if (!q) return true;
  const texto = `${p.razon_social} ${p.cuit ?? ''} ${formatearCuit(p.cuit)} ${p.categoria_nombre ?? ''}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((t) => texto.includes(t));
}

export function renderProveedores() {
  const tbody = $('#tabla-proveedores');
  const lista = state.proveedores.filter((p) => coincide(p, filtro));
  $('#proveedores-info').textContent = `${entero(lista.length)} de ${entero(state.proveedores.length)} proveedores`;
  if (!state.proveedores.length) {
    tbody.innerHTML = filaVacia(7, 'Todavía no hay proveedores. Cargá el primero con el formulario.');
    return;
  }
  if (!lista.length) {
    tbody.innerHTML = filaVacia(7, 'Ningún proveedor coincide con la búsqueda.');
    return;
  }
  tbody.innerHTML = lista
    .map(
      (p) => `
      <tr class="hover:bg-slate-50/70">
        <td class="px-6 py-3">
          <p class="font-medium text-slate-900">${esc(p.razon_social)}</p>
          <p class="font-mono text-xs text-slate-400">${p.cuit ? `CUIT ${esc(formatearCuit(p.cuit))}` : 'Sin CUIT'}</p>
        </td>
        <td class="px-3 py-3 text-slate-600">
          <p>${esc(CONDICION_IVA_TEXTO[p.condicion_iva] ?? p.condicion_iva)}</p>
          ${p.tipo_comprobante ? `<p class="text-xs text-slate-400">Factura ${esc(p.tipo_comprobante)} habitual</p>` : ''}
        </td>
        <td class="px-3 py-3 text-slate-600">${p.categoria_nombre ? esc(p.categoria_nombre) : '<span class="text-slate-400">—</span>'}</td>
        <td class="px-3 py-3 text-right tabular">
          ${p.facturas ? `<a href="#facturas?proveedor_id=${p.id}" class="font-medium text-blue-700 hover:underline" title="Ver sus facturas">${entero(p.facturas)}</a>` : '<span class="text-slate-400">0</span>'}
        </td>
        <td class="px-3 py-3 text-right tabular text-slate-700">
          ${moneda(p.gasto_total)}
          ${p.ultima_factura ? `<p class="text-xs text-slate-400">última ${fecha(p.ultima_factura)}</p>` : ''}
        </td>
        <td class="px-3 py-3">${badgeActivo(p.activo)}</td>
        <td class="whitespace-nowrap px-6 py-3 text-right">${botonesAccion('proveedor', p.id, p.facturas > 0 ? 'Tiene facturas asociadas' : '')}</td>
      </tr>`,
    )
    .join('');
}

function renderSelectCategoria() {
  const activas = state.categorias.filter((c) => c.activa);
  llenarSelect($('#p-categoria'), activas, { vacio: 'Sin categoría por defecto', valor: (c) => c.id, texto: (c) => c.nombre });
}

function datosDeFormulario(f) {
  return {
    razon_social: f.elements.razon_social.value,
    cuit: f.elements.cuit.value.replace(/\D/g, ''),
    condicion_iva: f.elements.condicion_iva.value,
    tipo_comprobante: f.elements.tipo_comprobante?.value || null,
    categoria_id: f.elements.categoria_id?.value || null,
    email: f.elements.email?.value ?? null,
    telefono: f.elements.telefono?.value ?? null,
    notas: f.elements.notas?.value ?? null,
    activo: f.elements.activo ? f.elements.activo.checked : true,
  };
}

// Validación rápida en el navegador (la API vuelve a validar todo)
function validarEnCliente(f, body) {
  limpiarErrores(f);
  let ok = true;
  if (body.razon_social.trim().length < 2) {
    marcarError(f, 'razon_social', 'Ingresá la razón social (mínimo 2 caracteres).');
    ok = false;
  }
  if (body.cuit && !esCuitValido(body.cuit)) {
    marcarError(f, 'cuit', 'CUIT inválido: revisá los 11 dígitos.');
    ok = false;
  }
  return ok;
}

function editar(id) {
  const p = state.proveedores.find((x) => x.id === id);
  if (!p) return;
  const f = $('#form-proveedor');
  limpiarErrores(f);
  f.elements.id.value = p.id;
  f.elements.razon_social.value = p.razon_social;
  f.elements.cuit.value = formatearCuit(p.cuit);
  f.elements.condicion_iva.value = p.condicion_iva;
  f.elements.tipo_comprobante.value = p.tipo_comprobante ?? '';
  llenarSelect(
    $('#p-categoria'),
    state.categorias.filter((c) => c.activa || c.id === p.categoria_id),
    { vacio: 'Sin categoría por defecto', valor: (c) => c.id, texto: (c) => c.nombre, incluir: p.categoria_id ?? '' },
  );
  f.elements.email.value = p.email ?? '';
  f.elements.telefono.value = p.telefono ?? '';
  f.elements.notas.value = p.notas ?? '';
  f.elements.activo.checked = p.activo;
  $('#proveedor-form-titulo').textContent = `Editar proveedor #${p.id}`;
  $('#proveedor-guardar').textContent = 'Actualizar proveedor';
  f.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  f.elements.razon_social.focus({ preventScroll: true });
}

function resetForm() {
  const f = $('#form-proveedor');
  f.reset();
  f.elements.id.value = '';
  limpiarErrores(f);
  renderSelectCategoria();
  $('#proveedor-form-titulo').textContent = 'Nuevo proveedor';
  $('#proveedor-guardar').textContent = 'Guardar proveedor';
}

async function guardar(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const id = f.elements.id.value;
  const body = datosDeFormulario(f);
  if (!validarEnCliente(f, body)) return;
  const btn = $('#proveedor-guardar');
  btn.disabled = true;
  try {
    await api(id ? `/proveedores/${id}` : '/proveedores', { method: id ? 'PUT' : 'POST', body });
    toast(id ? 'Proveedor actualizado.' : 'Proveedor creado.');
    resetForm();
    await cargarProveedores();
  } catch (err) {
    mostrarErrores(f, err);
  } finally {
    btn.disabled = false;
  }
}

async function eliminar(id) {
  const p = state.proveedores.find((x) => x.id === id);
  if (!p) return;
  const ok = await confirmar('Eliminar proveedor', `Se eliminará "${p.razon_social}". Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await api(`/proveedores/${id}`, { method: 'DELETE' });
    toast('Proveedor eliminado.');
    if ($('#form-proveedor').elements.id.value === String(id)) resetForm();
    await cargarProveedores();
  } catch (err) {
    toastError(err);
  }
}

// ---------------------------------------------------------------------
// Alta rápida (modal) desde el formulario de facturas
// ---------------------------------------------------------------------
let alCrearRapido = null;

export function abrirAltaRapida(onCreado) {
  alCrearRapido = onCreado;
  const f = $('#form-proveedor-rapido');
  f.reset();
  limpiarErrores(f);
  $('#modal-proveedor').classList.remove('hidden');
  setTimeout(() => f.elements.razon_social.focus(), 30);
}

function cerrarAltaRapida() {
  $('#modal-proveedor').classList.add('hidden');
  alCrearRapido = null;
}

async function guardarRapido(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const body = datosDeFormulario(f);
  if (!validarEnCliente(f, body)) return;
  const btn = $('#proveedor-rapido-guardar');
  btn.disabled = true;
  try {
    const { data } = await api('/proveedores', { method: 'POST', body });
    await cargarProveedores();
    toast(`Proveedor "${data.razon_social}" creado.`);
    const cb = alCrearRapido;
    cerrarAltaRapida();
    cb?.(data);
  } catch (err) {
    mostrarErrores(f, err);
  } finally {
    btn.disabled = false;
  }
}

export function iniciarProveedores() {
  $('#form-proveedor').addEventListener('submit', guardar);
  $('#proveedor-cancelar').addEventListener('click', resetForm);
  $('#buscar-proveedor').addEventListener(
    'input',
    debounce((e) => {
      filtro = e.target.value.trim();
      renderProveedores();
    }, 150),
  );
  for (const sel of ['#p-cuit', '#pr-cuit']) {
    $(sel).addEventListener('input', (e) => (e.target.value = formatearCuit(e.target.value)));
  }

  $('#form-proveedor-rapido').addEventListener('submit', guardarRapido);
  document.querySelectorAll('[data-cerrar-proveedor]').forEach((b) => b.addEventListener('click', cerrarAltaRapida));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal-proveedor').classList.contains('hidden')) cerrarAltaRapida();
  });

  document.addEventListener('datos:proveedores', renderProveedores);
  document.addEventListener('datos:categorias', () => {
    if (!$('#form-proveedor').elements.id.value) renderSelectCategoria();
  });
  return { 'editar-proveedor': editar, 'eliminar-proveedor': eliminar };
}
