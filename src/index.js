import { HttpError, json } from './lib/http.js';
import { getSupabase } from './lib/supabase.js';
import {
  actualizarCategoria,
  crearCategoria,
  eliminarCategoria,
  listarCategorias,
} from './handlers/categorias.js';
import {
  actualizarFactura,
  crearFactura,
  eliminarFactura,
  listarFacturas,
  obtenerFactura,
} from './handlers/facturas.js';
import { obtenerConfig, obtenerDashboard } from './handlers/dashboard.js';

// [método, patrón, handler, requiereSupabase]
const RUTAS = [
  ['GET', /^\/api\/config$/, obtenerConfig, false],
  ['GET', /^\/api\/dashboard$/, obtenerDashboard, true],

  ['GET', /^\/api\/categorias$/, listarCategorias, true],
  ['POST', /^\/api\/categorias$/, crearCategoria, true],
  ['PUT', /^\/api\/categorias\/(\d+)$/, actualizarCategoria, true],
  ['DELETE', /^\/api\/categorias\/(\d+)$/, eliminarCategoria, true],

  ['GET', /^\/api\/facturas$/, listarFacturas, true],
  ['GET', /^\/api\/facturas\/(\d+)$/, obtenerFactura, true],
  ['POST', /^\/api\/facturas$/, crearFactura, true],
  ['PUT', /^\/api\/facturas\/(\d+)$/, actualizarFactura, true],
  ['DELETE', /^\/api\/facturas\/(\d+)$/, eliminarFactura, true],
];

const encoder = new TextEncoder();

function iguales(a, b) {
  const ba = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ba.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ba, bb);
}

// HTTP Basic Auth opcional: sólo se activa si existen ambas variables.
function autorizado(request, env) {
  if (!env.BASIC_AUTH_USER || !env.BASIC_AUTH_PASS) return true;
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  let decodificado;
  try {
    decodificado = atob(header.slice(6));
  } catch {
    return false;
  }
  const i = decodificado.indexOf(':');
  if (i < 0) return false;
  const usuario = decodificado.slice(0, i);
  const clave = decodificado.slice(i + 1);
  // Se evalúan ambas comparaciones para no filtrar cuál falló.
  const okUsuario = iguales(usuario, env.BASIC_AUTH_USER);
  const okClave = iguales(clave, env.BASIC_AUTH_PASS);
  return okUsuario && okClave;
}

async function manejarApi(request, env, url) {
  const ruta = RUTAS.find(([metodo, patron]) => metodo === request.method && patron.test(url.pathname));
  if (!ruta) {
    const existe = RUTAS.some(([, patron]) => patron.test(url.pathname));
    throw new HttpError(existe ? 405 : 404, existe ? 'Método no permitido.' : 'Ruta no encontrada.');
  }
  const [, patron, handler, requiereSupabase] = ruta;
  const params = url.pathname.match(patron).slice(1);
  const sb = requiereSupabase ? getSupabase(env) : null;
  return handler({ request, env, url, params, sb });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!autorizado(request, env)) {
      return new Response('Autenticación requerida', {
        status: 401,
        headers: { 'www-authenticate': 'Basic realm="Control de Gastos", charset="UTF-8"' },
      });
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        return await manejarApi(request, env, url);
      } catch (err) {
        if (err instanceof HttpError) {
          return json({ error: err.message, details: err.details ?? null }, err.status);
        }
        console.error(err);
        return json({ error: 'Error interno del servidor.' }, 500);
      }
    }

    const respuesta = await env.ASSETS.fetch(request);
    const headers = new Headers(respuesta.headers);
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'strict-origin-when-cross-origin');
    headers.set('x-frame-options', 'DENY');
    return new Response(respuesta.body, { status: respuesta.status, statusText: respuesta.statusText, headers });
  },
};
