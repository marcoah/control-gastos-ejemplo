import { HttpError, fromSupabaseError, json, noContent, readJson } from '../lib/http.js';
import { ESTADOS, esFechaValida, normalizarCuit, parseId, validarFactura } from '../lib/validate.js';

const SELECT = '*, categoria:categorias(id, nombre, color)';

// Quita caracteres con significado especial en los filtros de PostgREST.
const limpiarBusqueda = (q) => q.replace(/[,()*%\\:"']/g, ' ').trim().slice(0, 80);

export async function listarFacturas({ sb, url }) {
  const p = url.searchParams;
  const page = Math.max(1, Number.parseInt(p.get('page'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(p.get('page_size'), 10) || 15));
  const from = (page - 1) * pageSize;

  let query = sb
    .from('facturas')
    .select(SELECT, { count: 'exact' })
    .order('fecha', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + pageSize - 1);

  const q = limpiarBusqueda(p.get('q') || '');
  if (q) {
    const filtros = [`proveedor.ilike.*${q}*`, `numero_comprobante.ilike.*${q}*`];
    const cuit = normalizarCuit(q);
    if (/^\d{2,11}$/.test(cuit)) filtros.push(`cuit_proveedor.like.*${cuit}*`);
    query = query.or(filtros.join(','));
  }

  const categoria = Number.parseInt(p.get('categoria_id'), 10);
  if (Number.isInteger(categoria) && categoria > 0) query = query.eq('categoria_id', categoria);

  const estado = p.get('estado');
  if (estado && ESTADOS.includes(estado)) query = query.eq('estado', estado);

  const desde = p.get('desde');
  if (desde && esFechaValida(desde)) query = query.gte('fecha', desde);
  const hasta = p.get('hasta');
  if (hasta && esFechaValida(hasta)) query = query.lte('fecha', hasta);

  const { data, count, error } = await query;
  if (error) throw fromSupabaseError(error);
  return json({ data, total: count ?? 0, page, page_size: pageSize });
}

export async function obtenerFactura({ sb, params }) {
  const id = parseId(params[0]);
  const { data, error } = await sb.from('facturas').select(SELECT).eq('id', id).maybeSingle();
  if (error) throw fromSupabaseError(error);
  if (!data) throw new HttpError(404, 'Factura no encontrada.');
  return json({ data });
}

export async function crearFactura({ sb, request }) {
  const datos = validarFactura(await readJson(request));
  const { data, error } = await sb.from('facturas').insert(datos).select(SELECT).single();
  if (error) throw fromSupabaseError(error);
  return json({ data }, 201);
}

export async function actualizarFactura({ sb, request, params }) {
  const id = parseId(params[0]);
  const datos = validarFactura(await readJson(request));
  const { data, error } = await sb.from('facturas').update(datos).eq('id', id).select(SELECT).maybeSingle();
  if (error) throw fromSupabaseError(error);
  if (!data) throw new HttpError(404, 'Factura no encontrada.');
  return json({ data });
}

export async function eliminarFactura({ sb, params }) {
  const id = parseId(params[0]);
  const { data, error } = await sb.from('facturas').delete().eq('id', id).select('id').maybeSingle();
  if (error) throw fromSupabaseError(error);
  if (!data) throw new HttpError(404, 'Factura no encontrada.');
  return noContent();
}
