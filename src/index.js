import { HttpError, json } from './lib/http.js';
import { describirError, detalleSeguro, registrarLog } from './lib/logger.js';
import { getSupabase } from './lib/supabase.js';
import {
  actualizarCategoria,
  crearCategoria,
  eliminarCategoria,
  listarCategorias,
} from './handlers/categorias.js';
import {
  actualizarProveedor,
  crearProveedor,
  eliminarProveedor,
  listarProveedores,
  obtenerProveedor,
} from './handlers/proveedores.js';
import {
  actualizarFactura,
  crearFactura,
  eliminarFactura,
  listarFacturas,
  obtenerFactura,
} from './handlers/facturas.js';
import { crearLog, eliminarLogs, listarLogs } from './handlers/logs.js';
import { obtenerConfig, obtenerDashboard } from './handlers/dashboard.js';
import { obtenerEstado } from './handlers/sistema.js';

// [método, patrón, handler, requiereSupabase]
const RUTAS = [
  ['GET', /^\/api\/config$/, obtenerConfig, false],
  ['GET', /^\/api\/estado$/, obtenerEstado, false],
  ['GET', /^\/api\/dashboard$/, obtenerDashboard, true],

  ['GET', /^\/api\/categorias$/, listarCategorias, true],
  ['POST', /^\/api\/categorias$/, crearCategoria, true],
  ['PUT', /^\/api\/categorias\/(\d+)$/, actualizarCategoria, true],
  ['DELETE', /^\/api\/categorias\/(\d+)$/, eliminarCategoria, true],

  ['GET', /^\/api\/proveedores$/, listarProveedores, true],
  ['GET', /^\/api\/proveedores\/(\d+)$/, obtenerProveedor, true],
  ['POST', /^\/api\/proveedores$/, crearProveedor, true],
  ['PUT', /^\/api\/proveedores\/(\d+)$/, actualizarProveedor, true],
  ['DELETE', /^\/api\/proveedores\/(\d+)$/, eliminarProveedor, true],

  ['GET', /^\/api\/facturas$/, listarFacturas, true],
  ['GET', /^\/api\/facturas\/(\d+)$/, obtenerFactura, true],
  ['POST', /^\/api\/facturas$/, crearFactura, true],
  ['PUT', /^\/api\/facturas\/(\d+)$/, actualizarFactura, true],
  ['DELETE', /^\/api\/facturas\/(\d+)$/, eliminarFactura, true],

  ['GET', /^\/api\/logs$/, listarLogs, true],
  ['POST', /^\/api\/logs$/, crearLog, false],
  ['DELETE', /^\/api\/logs$/, eliminarLogs, true],
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

async function manejarApi(request, env, ctx, url, requestId) {
  const ruta = RUTAS.find(([metodo, patron]) => metodo === request.method && patron.test(url.pathname));
  if (!ruta) {
    const existe = RUTAS.some(([, patron]) => patron.test(url.pathname));
    throw new HttpError(existe ? 405 : 404, existe ? 'Método no permitido.' : 'Ruta no encontrada.');
  }
  const [, patron, handler, requiereSupabase] = ruta;
  const params = url.pathname.match(patron).slice(1);
  const sb = requiereSupabase ? getSupabase(env) : null;
  return handler({ request, env, ctx, url, params, sb, requestId });
}

// Copia del cuerpo enviado, para adjuntarla al log si la petición falla.
async function leerCuerpoParaLog(request) {
  if (!['POST', 'PUT', 'PATCH'].includes(request.method)) return undefined;
  try {
    const texto = await request.clone().text();
    try {
      return detalleSeguro(JSON.parse(texto), 4000);
    } catch {
      return texto.slice(0, 4000);
    }
  } catch {
    return undefined;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!autorizado(request, env)) {
      return new Response('Autenticación requerida', {
        status: 401,
        headers: { 'www-authenticate': 'Basic realm="Control de Gastos", charset="UTF-8"' },
      });
    }

    if (url.pathname.startsWith('/api/')) {
      const requestId = crypto.randomUUID().slice(0, 8);
      const cuerpo = leerCuerpoParaLog(request);
      let respuesta;
      try {
        respuesta = await manejarApi(request, env, ctx, url, requestId);
      } catch (err) {
        const esHttp = err instanceof HttpError;
        const status = esHttp ? err.status : 500;
        const mensaje = esHttp ? err.message : 'Error interno del servidor.';

        // Se registran todos los errores salvo 404 de rutas inexistentes.
        // 4xx = advertencia (datos inválidos, duplicados…), 5xx = error.
        if (status !== 404 || err.causa) {
          registrarLog(env, ctx, {
            nivel: status >= 500 ? 'error' : 'warn',
            origen: 'api',
            mensaje: esHttp ? err.message : `Excepción no controlada: ${err?.message ?? err}`,
            detalle: { error: describirError(err), cuerpo: await cuerpo, query: url.search || undefined },
            metodo: request.method,
            ruta: url.pathname,
            status,
            request_id: requestId,
            user_agent: request.headers.get('user-agent'),
          });
        }

        respuesta = json(
          { error: mensaje, details: esHttp ? err.details ?? null : null, request_id: requestId },
          status,
        );
      }
      const headers = new Headers(respuesta.headers);
      headers.set('x-request-id', requestId);
      return new Response(respuesta.body, { status: respuesta.status, headers });
    }

    const respuesta = await env.ASSETS.fetch(request);
    const headers = new Headers(respuesta.headers);
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'strict-origin-when-cross-origin');
    headers.set('x-frame-options', 'DENY');
    return new Response(respuesta.body, { status: respuesta.status, statusText: respuesta.statusText, headers });
  },
};
