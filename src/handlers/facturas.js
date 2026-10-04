import { HttpError, fromSupabaseError, json, noContent, readJson } from '../lib/http.js';
import { ESTADOS, esFechaValida, normalizarCuit, parseId, validarFactura } from '../lib/validate.js';

const SELECT = '*, categoria:categorias(id, nombre, color), emisor:proveedores(id, razon_social, cuit, condicion_iva, activo)';

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

  const proveedor = Number.parseInt(p.get('proveedor_id'), 10);
  if (Number.isInteger(proveedor) && proveedor > 0) query = query.eq('proveedor_id', proveedor);

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

/**
 * Verifica proveedor y categoría antes de escribir, para devolver un error
 * claro por campo en vez de un error genérico de la base de datos.
 * Completa la razón social y el CUIT del emisor a partir del proveedor.
 * `actual` es la factura existente (al editar): se permite conservar un
 * proveedor o una categoría que luego fueron desactivados.
 */
async function prepararFactura(sb, datos, actual = null) {
  const [prov, cat] = await Promise.all([
    sb.from('proveedores').select('id, razon_social, cuit, activo').eq('id', datos.proveedor_id).maybeSingle(),
    sb.from('categorias').select('id, activa').eq('id', datos.categoria_id).maybeSingle(),
  ]);
  if (prov.error) throw fromSupabaseError(prov.error);
  if (cat.error) throw fromSupabaseError(cat.error);

  const errores = {};
  if (!prov.data) errores.proveedor_id = 'El proveedor seleccionado no existe.';
  else if (!prov.data.activo && actual?.proveedor_id !== prov.data.id) errores.proveedor_id = 'El proveedor está inactivo. Activalo en Proveedores para usarlo.';
  if (!cat.data) errores.categoria_id = 'La categoría seleccionada no existe.';
  else if (!cat.data.activa && actual?.categoria_id !== cat.data.id) errores.categoria_id = 'La categoría está inactiva. Activala en Categorías para usarla.';
  if (Object.keys(errores).length) throw new HttpError(422, 'Revisá los datos del formulario.', errores);

  // Al editar sin cambiar de proveedor se conserva la copia histórica del emisor.
  if (actual && actual.proveedor_id === prov.data.id) {
    return { ...datos, proveedor: actual.proveedor, cuit_proveedor: actual.cuit_proveedor };
  }
  return { ...datos, proveedor: prov.data.razon_social, cuit_proveedor: prov.data.cuit };
}

export async function crearFactura({ sb, request }) {
  const datos = await prepararFactura(sb, validarFactura(await readJson(request)));
  const { data, error } = await sb.from('facturas').insert(datos).select(SELECT).single();
  if (error) throw fromSupabaseError(error);
  return json({ data }, 201);
}

export async function actualizarFactura({ sb, request, params }) {
  const id = parseId(params[0]);
  const body = validarFactura(await readJson(request));

  const { data: actual, error: errActual } = await sb
    .from('facturas')
    .select('id, proveedor_id, proveedor, cuit_proveedor, categoria_id')
    .eq('id', id)
    .maybeSingle();
  if (errActual) throw fromSupabaseError(errActual);
  if (!actual) throw new HttpError(404, 'Factura no encontrada.');

  const datos = await prepararFactura(sb, body, actual);
  const { data, error } = await sb.from('facturas').update(datos).eq('id', id).select(SELECT).maybeSingle();
  if (error) throw fromSupabaseError(error);
  if (!data) throw new HttpError(404, 'Factura no encontrada.');
  return json({ data });
}

export async function eliminarFactura({ sb, params }) {
  const id = parseId(params[0]);
  const { data, error } = await sb.from('facturas').delete().eq('id', id).select('id').maybeSingle();
  if (error) throw fromSupabaseError(error, { contexto: 'eliminar' });
  if (!data) throw new HttpError(404, 'Factura no encontrada.');
  return noContent();
}
