import { HttpError, fromSupabaseError, json, readJson } from '../lib/http.js';
import { registrarLog } from '../lib/logger.js';
import { NIVELES_LOG, ORIGENES_LOG, validarLogCliente } from '../lib/validate.js';

const limpiarBusqueda = (q) => q.replace(/[,()*%\\:"']/g, ' ').trim().slice(0, 80);

export async function listarLogs({ sb, url }) {
  const p = url.searchParams;
  const page = Math.max(1, Number.parseInt(p.get('page'), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(p.get('page_size'), 10) || 25));
  const from = (page - 1) * pageSize;

  let query = sb
    .from('logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + pageSize - 1);

  const nivel = p.get('nivel');
  if (nivel && NIVELES_LOG.includes(nivel)) query = query.eq('nivel', nivel);
  const origen = p.get('origen');
  if (origen && ORIGENES_LOG.includes(origen)) query = query.eq('origen', origen);
  const q = limpiarBusqueda(p.get('q') || '');
  if (q) query = query.or(`mensaje.ilike.*${q}*,ruta.ilike.*${q}*,request_id.ilike.*${q}*`);

  const { data, count, error } = await query;
  if (error) throw fromSupabaseError(error);

  // Resumen de las últimas 24 h para las tarjetas del visor
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const contar = (n) =>
    sb.from('logs').select('id', { count: 'exact', head: true }).eq('nivel', n).gte('created_at', desde);
  const [errores, avisos] = await Promise.all([contar('error'), contar('warn')]);

  return json({
    data,
    total: count ?? 0,
    page,
    page_size: pageSize,
    resumen_24h: { error: errores.count ?? 0, warn: avisos.count ?? 0 },
  });
}

// Errores del navegador (excepciones de JS, fallas de red, etc.)
export async function crearLog({ request, env, ctx, requestId }) {
  const datos = validarLogCliente(await readJson(request));
  await registrarLog(env, ctx, {
    ...datos,
    origen: 'frontend',
    metodo: null,
    request_id: requestId,
    user_agent: request.headers.get('user-agent'),
  });
  return json({ ok: true }, 201);
}

// DELETE /api/logs?antiguedad_dias=30  -> borra los de más de N días
// DELETE /api/logs?todo=1              -> vacía la tabla
export async function eliminarLogs({ sb, url }) {
  const dias = Number.parseInt(url.searchParams.get('antiguedad_dias'), 10);
  const todo = url.searchParams.get('todo') === '1';

  let query = sb.from('logs').delete({ count: 'exact' });
  if (todo) query = query.gte('id', 0);
  else if (Number.isInteger(dias) && dias >= 0) {
    query = query.lt('created_at', new Date(Date.now() - dias * 86400 * 1000).toISOString());
  } else {
    throw new HttpError(400, 'Indicá antiguedad_dias=N o todo=1.');
  }

  const { count, error } = await query;
  if (error) throw fromSupabaseError(error);
  return json({ eliminados: count ?? 0 });
}
