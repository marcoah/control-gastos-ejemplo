export class HttpError extends Error {
  /**
   * @param {number} status   Código HTTP
   * @param {string} message  Mensaje para el usuario
   * @param {object|null} details  Errores por campo ({ campo: mensaje }) u otro detalle seguro de mostrar
   * @param {object} [causa]  Error original (sólo se guarda en el log, nunca se envía al cliente)
   */
  constructor(status, message, details = null, causa = undefined) {
    super(message);
    this.status = status;
    this.details = details;
    this.causa = causa;
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

const MAX_BODY = 64 * 1024;

export async function readJson(request) {
  const texto = await request.text();
  if (texto.length > MAX_BODY) throw new HttpError(413, 'El cuerpo de la petición es demasiado grande.');
  try {
    const body = JSON.parse(texto);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'El cuerpo de la petición debe ser un objeto JSON válido.');
  }
}

// Restricción de Postgres -> [campo del formulario, mensaje para el usuario]
const RESTRICCIONES = {
  categorias_nombre_uk: ['nombre', 'Ya existe una categoría con ese nombre.'],
  categorias_nombre_len: ['nombre', 'El nombre debe tener entre 2 y 80 caracteres.'],
  categorias_color_hex: ['color', 'Color inválido.'],
  categorias_presupuesto: ['presupuesto_mensual', 'El presupuesto no puede ser negativo.'],

  proveedores_razon_social_uk: ['razon_social', 'Ya existe un proveedor con esa razón social.'],
  proveedores_cuit_uk: ['cuit', 'Ya existe un proveedor con ese CUIT.'],
  proveedores_cuit_valido: ['cuit', 'CUIT inválido.'],
  proveedores_razon_social_len: ['razon_social', 'La razón social debe tener entre 2 y 150 caracteres.'],
  proveedores_email: ['email', 'Email inválido.'],
  proveedores_categoria_id_fkey: ['categoria_id', 'La categoría seleccionada no existe.'],

  facturas_comprobante_prov_uk: ['numero_comprobante', 'Ya cargaste un comprobante de ese tipo y número para este proveedor.'],
  facturas_proveedor_id_fkey: ['proveedor_id', 'El proveedor seleccionado no existe.'],
  facturas_categoria_id_fkey: ['categoria_id', 'La categoría seleccionada no existe.'],
  facturas_cuit_valido: ['proveedor_id', 'El CUIT del proveedor es inválido; corregilo en Proveedores.'],
  facturas_tipo: ['tipo_comprobante', 'Tipo de comprobante inválido.'],
  facturas_numero_len: ['numero_comprobante', 'El número de comprobante debe tener entre 1 y 40 caracteres.'],
  facturas_subtotal_pos: ['subtotal', 'El subtotal no puede ser negativo.'],
  facturas_impuestos_pos: ['impuestos', 'Los impuestos no pueden ser negativos.'],
  facturas_metodo_pago: ['metodo_pago', 'Medio de pago inválido.'],
  facturas_estado: ['estado', 'Estado inválido.'],
};

function restriccionDe(error) {
  const texto = `${error?.message ?? ''} ${error?.details ?? ''}`;
  return texto.match(/constraint "([^"]+)"/)?.[1] ?? null;
}

// Traduce los errores de PostgREST / Postgres a respuestas HTTP entendibles.
// El error original viaja en `causa` para quedar registrado en el log.
export function fromSupabaseError(error, { contexto } = {}) {
  const restriccion = restriccionDe(error);
  const conocida = restriccion && RESTRICCIONES[restriccion];

  switch (error?.code) {
    case '23505': // unique_violation
      return conocida
        ? new HttpError(409, conocida[1], { [conocida[0]]: conocida[1] }, error)
        : new HttpError(409, 'Ya existe un registro con esos datos (duplicado).', null, error);
    case '23503': // foreign_key_violation
      if (contexto === 'eliminar') {
        return new HttpError(409, 'No se puede eliminar: el registro está siendo usado por otros datos.', null, error);
      }
      return conocida
        ? new HttpError(422, conocida[1], { [conocida[0]]: conocida[1] }, error)
        : new HttpError(422, 'Alguna de las referencias seleccionadas no existe.', null, error);
    case '23514': // check_violation
    case '23502': // not_null_violation
      return conocida
        ? new HttpError(422, conocida[1], { [conocida[0]]: conocida[1] }, error)
        : new HttpError(422, 'Los datos no cumplen las reglas de validación de la base de datos.', null, error);
    case '22P02':
    case '22003':
      return new HttpError(400, 'Formato de dato inválido.', null, error);
    case 'PGRST116':
      return new HttpError(404, 'Registro no encontrado.', null, error);
    case 'PGRST205':
    case '42P01':
    case '42703':
    case 'PGRST202':
      return new HttpError(
        500,
        'La base de datos no tiene la estructura esperada. Ejecutá los scripts de supabase/sql (01 → 03).',
        null,
        error,
      );
    default:
      return new HttpError(500, 'Error al comunicarse con la base de datos.', null, error);
  }
}
