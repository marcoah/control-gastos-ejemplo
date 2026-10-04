// =====================================================================
// CRUD de categorías
// =====================================================================
import {
  $,
  api,
  badgeActivo,
  botonesAccion,
  cargarCategorias,
  confirmar,
  entero,
  esc,
  filaVacia,
  importeInput,
  limpiarErrores,
  moneda,
  mostrarErrores,
  parsearMonto,
  state,
  toast,
  toastError,
} from './core.js';

export function renderCategorias() {
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
            <span class="h-3 w-3 shrink-0 rounded-full" style="background:${esc(c.color)}"></span>
            <div class="min-w-0">
              <p class="font-medium text-slate-900">${esc(c.nombre)}</p>
              ${c.descripcion ? `<p class="truncate text-xs text-slate-500">${esc(c.descripcion)}</p>` : ''}
            </div>
          </div>
        </td>
        <td class="px-3 py-3 text-right tabular text-slate-700">${c.presupuesto_mensual != null ? moneda(c.presupuesto_mensual) : '<span class="text-slate-400">—</span>'}</td>
        <td class="px-3 py-3 text-right tabular text-slate-700">${entero(c.facturas)}</td>
        <td class="px-3 py-3 text-right tabular text-slate-700">${moneda(c.gasto_total)}</td>
        <td class="px-3 py-3">${badgeActivo(c.activa, 'Activa', 'Inactiva')}</td>
        <td class="whitespace-nowrap px-6 py-3 text-right">${botonesAccion('categoria', c.id, c.facturas > 0 ? 'Tiene facturas asociadas' : '')}</td>
      </tr>`,
    )
    .join('');
}

function editar(id) {
  const c = state.categorias.find((x) => x.id === id);
  if (!c) return;
  const f = $('#form-categoria');
  limpiarErrores(f);
  f.elements.id.value = c.id;
  f.elements.nombre.value = c.nombre;
  f.elements.descripcion.value = c.descripcion ?? '';
  f.elements.presupuesto_mensual.value = importeInput(c.presupuesto_mensual);
  f.elements.color.value = c.color;
  f.elements.activa.checked = c.activa;
  $('#categoria-form-titulo').textContent = `Editar categoría #${c.id}`;
  $('#categoria-guardar').textContent = 'Actualizar categoría';
  f.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  f.elements.nombre.focus({ preventScroll: true });
}

function resetForm() {
  const f = $('#form-categoria');
  f.reset();
  f.elements.id.value = '';
  limpiarErrores(f);
  $('#categoria-form-titulo').textContent = 'Nueva categoría';
  $('#categoria-guardar').textContent = 'Guardar categoría';
}

async function guardar(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const id = f.elements.id.value;
  const presupuesto = f.elements.presupuesto_mensual.value.trim();
  const body = {
    nombre: f.elements.nombre.value,
    descripcion: f.elements.descripcion.value,
    presupuesto_mensual: presupuesto ? parsearMonto(presupuesto) : null,
    color: f.elements.color.value,
    activa: f.elements.activa.checked,
  };
  if (presupuesto && !Number.isFinite(body.presupuesto_mensual)) {
    mostrarErrores(f, { message: 'Revisá los datos del formulario.', details: { presupuesto_mensual: 'Importe inválido.' } });
    return;
  }
  const btn = $('#categoria-guardar');
  btn.disabled = true;
  try {
    await api(id ? `/categorias/${id}` : '/categorias', { method: id ? 'PUT' : 'POST', body });
    toast(id ? 'Categoría actualizada.' : 'Categoría creada.');
    resetForm();
    await cargarCategorias();
  } catch (err) {
    mostrarErrores(f, err);
  } finally {
    btn.disabled = false;
  }
}

async function eliminar(id) {
  const c = state.categorias.find((x) => x.id === id);
  if (!c) return;
  const ok = await confirmar('Eliminar categoría', `Se eliminará "${c.nombre}". Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await api(`/categorias/${id}`, { method: 'DELETE' });
    toast('Categoría eliminada.');
    if ($('#form-categoria').elements.id.value === String(id)) resetForm();
    await cargarCategorias();
  } catch (err) {
    toastError(err);
  }
}

export function iniciarCategorias() {
  $('#form-categoria').addEventListener('submit', guardar);
  $('#categoria-cancelar').addEventListener('click', resetForm);
  const presupuesto = $('#form-categoria').elements.presupuesto_mensual;
  presupuesto.addEventListener('blur', () => {
    const n = parsearMonto(presupuesto.value);
    if (Number.isFinite(n)) presupuesto.value = importeInput(n);
  });
  document.addEventListener('datos:categorias', renderCategorias);
  return { 'editar-categoria': editar, 'eliminar-categoria': eliminar };
}
