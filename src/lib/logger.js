import { getSupabase } from './supabase.js';

const recortar = (texto, max) => (texto == null ? null : String(texto).slice(0, max));

// Serializa un objeto para el log limitando su tamaño (~8 KB).
export function detalleSeguro(valor, max = 8000) {
  if (valor == null) return null;
  try {
    const texto = JSON.stringify(valor);
    if (texto.length <= max) return JSON.parse(texto);
    return { truncado: true, contenido: texto.slice(0, max) };
  } catch {
    return { contenido: recortar(String(valor), max) };
  }
}

// Describe un error (HttpError, error de Supabase o excepción) para el log.
export function describirError(err) {
  if (!err) return null;
  const causa = err.causa;
  return detalleSeguro({
    nombre: err.name,
    mensaje: err.message,
    detalles: err.details ?? undefined,
    causa: causa
      ? {
          code: causa.code,
          message: causa.message,
          details: causa.details,
          hint: causa.hint,
          name: causa.name,
        }
      : undefined,
    stack: err.stack ? String(err.stack).split('\n').slice(0, 8).join('\n') : undefined,
  });
}

/**
 * Guarda una entrada en la tabla `logs` sin bloquear la respuesta.
 * Si Supabase no está disponible, el error queda al menos en la consola
 * (visible con `wrangler tail` o en el panel de Cloudflare).
 */
export function registrarLog(env, ctx, entrada) {
  const fila = {
    nivel: entrada.nivel ?? 'error',
    origen: entrada.origen ?? 'api',
    mensaje: recortar(entrada.mensaje || 'Error sin mensaje', 2000),
    detalle: detalleSeguro(entrada.detalle),
    metodo: recortar(entrada.metodo, 10),
    ruta: recortar(entrada.ruta, 500),
    status: Number.isInteger(entrada.status) ? entrada.status : null,
    request_id: recortar(entrada.request_id, 64),
    user_agent: recortar(entrada.user_agent, 300),
  };

  const log = fila.nivel === 'error' ? console.error : console.warn;
  log(`[${fila.origen}] ${fila.status ?? ''} ${fila.metodo ?? ''} ${fila.ruta ?? ''} ${fila.mensaje}`, fila.detalle ?? '');

  const tarea = (async () => {
    try {
      const sb = getSupabase(env);
      const { error } = await sb.from('logs').insert(fila);
      if (error) console.error('No se pudo guardar el log en Supabase:', error.message);
    } catch (e) {
      console.error('No se pudo guardar el log en Supabase:', e.message);
    }
  })();

  if (ctx?.waitUntil) ctx.waitUntil(tarea);
  return tarea;
}
