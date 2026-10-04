// =====================================================================
// Tablero: indicadores, gráfico mensual, presupuesto y rankings.
// =====================================================================
import { $, api, entero, esc, fecha, badgeEstado, moneda, monedaCorta, toastError } from './core.js';

let graficoTendencia = null;

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

export async function cargarDashboard() {
  try {
    const { data: d } = await api('/dashboard');
    renderDashboard(d);
  } catch (err) {
    $('#kpis').innerHTML = `<div class="rounded-2xl bg-red-50 p-6 text-sm text-red-700 ring-1 ring-red-200 sm:col-span-2 lg:col-span-3">No se pudo cargar el dashboard: ${esc(err.message)}</div>`;
    toastError(err);
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
            <a href="#facturas?proveedor_id=${p.id}" class="truncate font-medium text-slate-800 hover:text-blue-700 hover:underline">${esc(p.proveedor)}</a>
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

  if (graficoTendencia) {
    graficoTendencia.data.labels = etiquetas;
    graficoTendencia.data.datasets[0].data = valores;
    graficoTendencia.data.datasets[0].backgroundColor = colores;
    graficoTendencia.update();
    return;
  }

  graficoTendencia = new window.Chart($('#chart-tendencia'), {
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
