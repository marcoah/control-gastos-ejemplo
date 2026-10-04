import { HttpError, fromSupabaseError, json, noContent, readJson } from '../lib/http.js';
import { parseId, validarCategoria } from '../lib/validate.js';

export async function listarCategorias({ sb }) {
  const { data, error } = await sb.from('v_categorias').select('*').order('nombre');
  if (error) throw fromSupabaseError(error);
  return json({ data });
}

export async function crearCategoria({ sb, request }) {
  const datos = validarCategoria(await readJson(request));
  const { data, error } = await sb.from('categorias').insert(datos).select().single();
  if (error) throw fromSupabaseError(error);
  return json({ data }, 201);
}

export async function actualizarCategoria({ sb, request, params }) {
  const id = parseId(params[0]);
  const datos = validarCategoria(await readJson(request));
  const { data, error } = await sb.from('categorias').update(datos).eq('id', id).select().maybeSingle();
  if (error) throw fromSupabaseError(error);
  if (!data) throw new HttpError(404, 'Categoría no encontrada.');
  return json({ data });
}

export async function eliminarCategoria({ sb, params }) {
  const id = parseId(params[0]);
  const { count, error: errCount } = await sb
    .from('facturas')
    .select('id', { count: 'exact', head: true })
    .eq('categoria_id', id);
  if (errCount) throw fromSupabaseError(errCount);
  if (count > 0) {
    throw new HttpError(409, `No se puede eliminar: la categoría tiene ${count} factura(s). Desactivala o reasigná sus facturas.`);
  }
  const { data, error } = await sb.from('categorias').delete().eq('id', id).select('id').maybeSingle();
  if (error) throw fromSupabaseError(error, { contexto: 'eliminar' });
  if (!data) throw new HttpError(404, 'Categoría no encontrada.');
  return noContent();
}
