// =====================================================================
// Configuración: estado del sistema y visor de logs de errores
// =====================================================================
import { $, api, confirmar, debounce, entero, esc, fechaHora, filaVacia, toast, toastError } from './core.js';

const visor = { page: 1, pageSize: 25, total: 0, filtros: {}, filas: [], abiertos: new Set(), timer: null };

const NIVEL_BADGE = {
  error: 'bg-red-50 text-red-700 ring-red-600/20',
  warn: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  info: 'bg-blue-50 text-blue-700 ring-blue-600/20',
};
const NIVEL_TEXTO = { error: 'Error', warn: 'Advertencia', info: 'Info' };
const ORIGEN_TEXTO = { api: 'API', frontend: 'Navegador', sistema: 'Sistema' };
const TABLA_TEXTO = { categorias: 'Categorías', proveedores: 'Proveedores', facturas: 'Facturas', logs: 'Logs' };

// ---------------------------------------------------------------------
// Estado del sistema
// ---------------------------------------------------------------------
const check = (ok) =>
  ok
    ? '<span class="inline-flex items-center gap-1 text-blue-700"><svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>Configurada</span>'
    : '<span class="inline-flex items-center gap-1 text-red-600"><svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>Falta</span>';

export async function cargarEstado() {
  const cont = $('#estado-sistema');
  cont.innerHTML = '<p class="text-sm text-slate-500">Verificando…</p>';
  try {
    const { data: d } = await api('/estado');
    const sb = d.supabase;
    cont.innerHTML = `
      <div class="flex items-start gap-3 rounded-xl p-4 ring-1 ring-inset ${sb.ok ? 'bg-blue-50 ring-blue-200' : 'bg-red-50 ring-red-200'}">
        <span class="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${sb.ok ? 'bg-blue-600' : 'bg-red-600'}"></span>
        <div class="min-w-0 text-sm">
          <p class="font-semibold ${sb.ok ? 'text-blue-900' : 'text-red-800'}">Supabase: ${sb.ok ? 'conectado' : 'con problemas'}${sb.latencia_ms != null ? ` · ${sb.latencia_ms} ms` : ''}</p>
          <p class="mt-0.5 ${sb.ok ? 'text-blue-800' : 'text-red-700'}">${esc(sb.mensaje)}</p>
        </div>
      </div>
      <dl class="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        ${Object.entries(sb.tablas)
          .map(([t, n]) => `<div><dt class="text-slate-500">${esc(TABLA_TEXTO[t] ?? t)}</dt><dd class="font-semibold tabular text-slate-900">${entero(n)}</dd></div>`)
          .join('')}
      </dl>
      <div class="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">Variables secretas</h3>
          <dl class="mt-2 divide-y divide-slate-100 text-sm">
            <div class="flex justify-between py-2"><dt class="font-mono text-slate-600">SUPABASE_URL</dt><dd>${check(d.variables.SUPABASE_URL)}</dd></div>
            <div class="flex justify-between py-2"><dt class="font-mono text-slate-600">SUPABASE_SERVICE_ROLE_KEY</dt><dd>${check(d.variables.SUPABASE_SERVICE_ROLE_KEY)}</dd></div>
            <div class="flex justify-between py-2"><dt class="font-mono text-slate-600">BASIC_AUTH</dt><dd>${
              d.variables.BASIC_AUTH ? check(true) : '<span class="text-amber-600">Desactivada</span>'
            }</dd></div>
          </dl>
          <p class="mt-2 text-xs text-slate-400">Por seguridad sólo se indica si están definidas, nunca su valor.</p>
        </div>
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">Regional</h3>
          <dl class="mt-2 divide-y divide-slate-100 text-sm">
            <div class="flex justify-between gap-4 py-2"><dt class="text-slate-600">Zona horaria</dt><dd class="font-mono text-slate-900">${esc(d.config.timezone)}</dd></div>
            <div class="flex justify-between gap-4 py-2"><dt class="text-slate-600">Moneda / formato</dt><dd class="font-mono text-slate-900">${esc(d.config.currency)} · ${esc(d.config.locale)}</dd></div>
            <div class="flex justify-between gap-4 py-2"><dt class="text-slate-600">IVA por defecto</dt><dd class="font-mono text-slate-900">${(d.config.iva * 100).toLocaleString('es-AR')} %</dd></div>
            <div class="flex justify-between gap-4 py-2"><dt class="text-slate-600">Fecha del servidor</dt><dd class="font-mono text-slate-900">${esc(d.hoy)}</dd></div>
            <div class="flex justify-between gap-4 py-2"><dt class="text-slate-600">Versión</dt><dd class="font-mono text-slate-900">${esc(d.version)}</dd></div>
          </dl>
          <p class="mt-2 text-xs text-slate-400">Se cambian en <span class="font-mono">wrangler.toml</span> (sección <span class="font-mono">[vars]</span>).</p>
        </div>
      </div>`;
  } catch (err) {
    cont.innerHTML = `<p class="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">No se pudo consultar el estado: ${esc(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------------
// Visor de logs
// ---------------------------------------------------------------------
export async function cargarLogs({ silencioso = false } = {}) {
  const params = new URLSearchParams({ page: visor.page, page_size: visor.pageSize });
  for (const [k, v] of Object.entries(visor.filtros)) if (v) params.set(k, v);
  if (!silencioso) $('#tabla-logs').innerHTML = filaVacia(6, 'Cargando…');
  try {
    const res = await api(`/logs?${params}`);
    visor.total = res.total;
    visor.filas = res.data;
    $('#logs-errores-24h').textContent = entero(res.resumen_24h.error);
    $('#logs-avisos-24h').textContent = entero(res.resumen_24h.warn);
    $('#logs-total').textContent = entero(res.total);
    renderLogs();
  } catch (err) {
    $('#tabla-logs').innerHTML = filaVacia(6, `No se pudieron cargar los logs: ${err.message}`);
    if (!silencioso) toastError(err);
  }
}

function renderLogs() {
  const { page, pageSize, total, filas } = visor;
  $('#tabla-logs').innerHTML = filas.length
    ? filas
        .map((l) => {
          const abierto = visor.abiertos.has(l.id);
          return `
      <tr class="cursor-pointer align-top hover:bg-slate-50/70" data-log="${l.id}" aria-expanded="${abierto}">
        <td class="whitespace-nowrap px-6 py-3 font-mono text-xs text-slate-600">${fechaHora(l.created_at)}</td>
        <td class="px-3 py-3"><span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${NIVEL_BADGE[l.nivel] || ''}">${NIVEL_TEXTO[l.nivel] || esc(l.nivel)}</span></td>
        <td class="px-3 py-3 text-xs text-slate-600">${ORIGEN_TEXTO[l.origen] || esc(l.origen)}</td>
        <td class="px-3 py-3 text-sm text-slate-800"><p class="${abierto ? '' : 'line-clamp-2'} break-words">${esc(l.mensaje)}</p></td>
        <td class="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-600">
          ${l.metodo ? `${esc(l.metodo)} ` : ''}${esc(l.ruta ?? '')}
          ${l.status ? `<span class="ml-1 rounded bg-slate-100 px-1 py-0.5 ${l.status >= 500 ? 'text-red-700' : 'text-amber-700'}">${l.status}</span>` : ''}
        </td>
        <td class="whitespace-nowrap px-6 py-3 font-mono text-xs text-slate-500">${esc(l.request_id ?? '')}</td>
      </tr>
      ${
        abierto
          ? `<tr class="bg-slate-50"><td colspan="6" class="px-6 pb-4 pt-1">
              <pre class="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">${esc(JSON.stringify(l.detalle ?? {}, null, 2))}</pre>
              ${l.user_agent ? `<p class="mt-2 break-all font-mono text-[11px] text-slate-400">${esc(l.user_agent)}</p>` : ''}
            </td></tr>`
          : ''
      }`;
        })
        .join('')
    : filaVacia(6, 'No hay registros. ¡Todo en orden!');

  const desde = total ? (page - 1) * pageSize + 1 : 0;
  const hasta = Math.min(page * pageSize, total);
  $('#logs-info').textContent = `Mostrando ${entero(desde)}–${entero(hasta)} de ${entero(total)}`;
  $('#logs-anterior').disabled = page <= 1;
  $('#logs-siguiente').disabled = hasta >= total;
}

async function borrarLogs(todo) {
  const ok = await confirmar(
    todo ? 'Vaciar registro' : 'Borrar logs antiguos',
    todo ? 'Se eliminarán TODOS los registros de errores.' : 'Se eliminarán los registros de más de 30 días.',
    todo ? 'Vaciar' : 'Borrar',
  );
  if (!ok) return;
  try {
    const res = await api(`/logs?${todo ? 'todo=1' : 'antiguedad_dias=30'}`, { method: 'DELETE' });
    toast(`${entero(res.eliminados)} registro(s) eliminado(s).`);
    visor.page = 1;
    visor.abiertos.clear();
    cargarLogs();
  } catch (err) {
    toastError(err);
  }
}

async function eventoDePrueba() {
  try {
    await api('/logs', {
      method: 'POST',
      body: { nivel: 'info', mensaje: 'Evento de prueba generado desde Configuración', ruta: '#configuracion' },
    });
    toast('Evento de prueba registrado.');
    visor.page = 1;
    cargarLogs();
  } catch (err) {
    toastError(err);
  }
}

function autoActualizar(activo) {
  clearInterval(visor.timer);
  visor.timer = activo ? setInterval(() => cargarLogs({ silencioso: true }), 15_000) : null;
}

/** Se llama al salir de la vista para no seguir consultando en segundo plano. */
export function pausarConfiguracion() {
  autoActualizar(false);
}

export function reanudarConfiguracion() {
  autoActualizar($('#logs-auto').checked);
}

export function iniciarConfiguracion() {
  $('#estado-refrescar').addEventListener('click', cargarEstado);
  $('#logs-refrescar').addEventListener('click', () => cargarLogs());
  $('#logs-purgar').addEventListener('click', () => borrarLogs(false));
  $('#logs-vaciar').addEventListener('click', () => borrarLogs(true));
  $('#logs-prueba').addEventListener('click', eventoDePrueba);
  $('#logs-auto').addEventListener('change', (e) => autoActualizar(e.target.checked));

  const flt = $('#filtros-logs');
  const aplicar = () => {
    visor.filtros = Object.fromEntries(new FormData(flt));
    visor.page = 1;
    cargarLogs();
  };
  flt.addEventListener('submit', (e) => {
    e.preventDefault();
    aplicar();
  });
  flt.elements.q.addEventListener('input', debounce(aplicar, 350));
  ['nivel', 'origen'].forEach((n) => flt.elements[n].addEventListener('change', aplicar));

  $('#logs-anterior').addEventListener('click', () => {
    visor.page = Math.max(1, visor.page - 1);
    cargarLogs();
  });
  $('#logs-siguiente').addEventListener('click', () => {
    visor.page++;
    cargarLogs();
  });

  // Expandir / contraer el detalle de un log
  $('#tabla-logs').addEventListener('click', (e) => {
    const fila = e.target.closest('[data-log]');
    if (!fila || window.getSelection()?.toString()) return;
    const id = Number(fila.dataset.log);
    if (visor.abiertos.has(id)) visor.abiertos.delete(id);
    else visor.abiertos.add(id);
    renderLogs();
  });
}
