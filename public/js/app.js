// =====================================================================
// Control de Gastos — punto de entrada del frontend (JS vanilla, sin build)
// Habla exclusivamente con la API del Worker (/api/*).
// =====================================================================
import {
  $,
  $$,
  api,
  cargarCategorias,
  cargarProveedores,
  configurarFormato,
  instalarCapturaDeErrores,
  toastError,
} from './core.js';
import { cargarDashboard } from './dashboard.js';
import { aplicarFiltrosDesdeUrl, cargarFacturas, iniciarFacturas, resetFormFactura } from './facturas.js';
import { iniciarProveedores, renderProveedores } from './proveedores.js';
import { iniciarCategorias, renderCategorias } from './categorias.js';
import {
  cargarEstado,
  cargarLogs,
  iniciarConfiguracion,
  pausarConfiguracion,
  reanudarConfiguracion,
} from './configuracion.js';

instalarCapturaDeErrores();

const VISTAS = ['dashboard', 'facturas', 'proveedores', 'categorias', 'configuracion'];

function navegar() {
  const [nombre, query = ''] = location.hash.slice(1).split('?');
  const vista = VISTAS.includes(nombre) ? nombre : 'dashboard';

  $$('[data-view]').forEach((s) => s.classList.toggle('hidden', s.dataset.view !== vista));
  $$('[data-nav]').forEach((a) => {
    const activo = a.dataset.nav === vista;
    a.classList.toggle('bg-white', activo);
    a.classList.toggle('text-blue-900', activo);
    a.classList.toggle('shadow-sm', activo);
    a.classList.toggle('text-blue-100', !activo);
    a.classList.toggle('hover:bg-white/10', !activo);
    if (activo) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  if (vista !== 'configuracion') pausarConfiguracion();

  if (vista === 'dashboard') cargarDashboard();
  if (vista === 'facturas') {
    aplicarFiltrosDesdeUrl(new URLSearchParams(query));
    cargarFacturas();
  }
  if (vista === 'proveedores') renderProveedores();
  if (vista === 'categorias') renderCategorias();
  if (vista === 'configuracion') {
    cargarEstado();
    cargarLogs();
    reanudarConfiguracion();
  }
  window.scrollTo({ top: 0 });
}

async function iniciar() {
  try {
    const { data } = await api('/config');
    configurarFormato(data);
  } catch {
    configurarFormato({}); // valores por defecto (es-AR / ARS)
  }

  const acciones = {
    ...iniciarFacturas(),
    ...iniciarProveedores(),
    ...iniciarCategorias(),
  };
  iniciarConfiguracion();

  // Delegación para los botones de editar/eliminar de todas las tablas
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-accion]');
    if (!btn) return;
    acciones[btn.dataset.accion]?.(Number(btn.dataset.id));
  });

  $('[data-action="nueva-factura"]').addEventListener('click', () => {
    resetFormFactura();
    setTimeout(() => $('#f-numero').focus(), 50);
  });
  $('#dash-refresh').addEventListener('click', cargarDashboard);
  window.addEventListener('hashchange', navegar);

  const resultados = await Promise.allSettled([cargarCategorias(), cargarProveedores()]);
  const fallo = resultados.find((r) => r.status === 'rejected');
  if (fallo) toastError(fallo.reason, 'No se pudieron cargar los catálogos');

  resetFormFactura();
  navegar();
}

iniciar();
