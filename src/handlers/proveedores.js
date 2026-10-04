import { HttpError, fromSupabaseError, json, noContent, readJson } from '../lib/http.js';
import { parseId, validarProveedor } from '../lib/validate.js';

export async function listarProveedores({ sb }) {
  const { data, error } = await sb.from('v_proveedores').select('*').order('razon_social');
  if (error) throw fromSupabaseError(error);
  return json({ data });
}

export async function obtenerProveedor({ sb, params }) {
  const id = parseId(params[0]);
  const { data, error } = await sb.from('v_proveedores').select('*').eq('id', id).maybeSingle();
  if (error) throw fromSupabaseError(error);
  if (!data) throw new HttpError(404, 'Proveedor no encontrado.');
  return json({ data });
}

export async function crearProveedor({ sb, request }) {
  const datos = validarProveedor(await readJson(request));
  const { data, error } = await sb.from('proveedores').insert(datos).select().single();
  if (error) throw fromSupabaseError(error);
  return json({ data }, 201);
}

export async function actualizarProveedor({ sb, request, params }) {
  const id = parseId(params[0]);
  const datos = validarProveedor(await readJson(request));
  const { data, error } = await sb.from('proveedores').update(datos).eq('id', id).select().maybeSingle();
  if (error) throw fromSupabaseError(error);
  if (!data) throw new HttpError(404, 'Proveedor no encontrado.');
  return json({ data });
}

export async function eliminarProveedor({ sb, params }) {
  const id = parseId(params[0]);
  const { count, error: errCount } = await sb
    .from('facturas')
    .select('id', { count: 'exact', head: true })
    .eq('proveedor_id', id);
  if (errCount) throw fromSupabaseError(errCount);
  if (count > 0) {
    throw new HttpError(409, `No se puede eliminar: el proveedor tiene ${count} factura(s). Podés desactivarlo para que no aparezca al cargar facturas.`);
  }
  const { data, error } = await sb.from('proveedores').delete().eq('id', id).select('id').maybeSingle();
  if (error) throw fromSupabaseError(error, { contexto: 'eliminar' });
  if (!data) throw new HttpError(404, 'Proveedor no encontrado.');
  return noContent();
}
