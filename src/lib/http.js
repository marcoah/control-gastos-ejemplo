export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function noContent() {
  return new Response(null, { status: 204 });
}

export async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'El cuerpo de la petición debe ser un objeto JSON válido.');
  }
}

// Traduce los errores de PostgREST / Postgres a respuestas HTTP entendibles.
export function fromSupabaseError(error) {
  switch (error?.code) {
    case '23505':
      return new HttpError(409, 'Ya existe un registro con esos datos (duplicado).', error.details);
    case '23503':
      return new HttpError(409, 'El registro está relacionado con otros datos: no se puede eliminar o la referencia no existe.', error.details);
    case '23514':
      return new HttpError(400, 'Los datos no cumplen las reglas de validación de la base de datos.', error.message);
    case '22P02':
      return new HttpError(400, 'Formato de dato inválido.', error.message);
    case 'PGRST116':
      return new HttpError(404, 'Registro no encontrado.');
    default:
      console.error('Supabase error', error);
      return new HttpError(500, 'Error al comunicarse con la base de datos.', error?.message);
  }
}
