import { HttpError } from './http.js';

export const TIPOS_COMPROBANTE = ['A', 'B', 'C', 'M', 'E'];
export const METODOS_PAGO = ['transferencia', 'tarjeta_credito', 'tarjeta_debito', 'efectivo', 'cheque', 'billetera_virtual'];
export const ESTADOS = ['pagada', 'pendiente', 'cancelada'];
export const CONDICIONES_IVA = ['responsable_inscripto', 'monotributista', 'exento', 'no_alcanzado', 'exterior'];
export const NIVELES_LOG = ['error', 'warn', 'info'];
export const ORIGENES_LOG = ['api', 'frontend', 'sistema'];

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function texto(valor, { campo, requerido = false, min = 0, max }, errores) {
  const v = typeof valor === 'string' ? valor.trim() : valor == null ? '' : String(valor).trim();
  if (!v) {
    if (requerido) errores[campo] = 'Campo obligatorio.';
    return null;
  }
  if (v.length < min) errores[campo] = `Debe tener al menos ${min} caracteres.`;
  else if (max && v.length > max) errores[campo] = `Máximo ${max} caracteres.`;
  return v;
}

/**
 * Convierte un importe a número. Acepta números o textos en formato
 * argentino ("1.234,56") o con punto decimal ("1234.56").
 */
export function parsearMonto(valor) {
  if (typeof valor === 'number') return valor;
  let s = String(valor ?? '').trim().replace(/[$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

function monto(valor, { campo, requerido = false }, errores) {
  if (valor === '' || valor == null) {
    if (requerido) errores[campo] = 'Campo obligatorio.';
    return null;
  }
  const n = parsearMonto(valor);
  if (!Number.isFinite(n) || n < 0) {
    errores[campo] = 'Debe ser un importe mayor o igual a 0.';
    return null;
  }
  if (n > 999_999_999_999.99) {
    errores[campo] = 'El importe es demasiado grande.';
    return null;
  }
  return Math.round(n * 100) / 100;
}

function idOpcional(valor, campo, errores) {
  if (valor === '' || valor == null) return null;
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) {
    errores[campo] = 'Valor inválido.';
    return null;
  }
  return id;
}

export function esFechaValida(s) {
  if (typeof s !== 'string' || !FECHA_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// CUIT/CUIL: 11 dígitos con dígito verificador (módulo 11).
// Acepta guiones, puntos o espacios y devuelve sólo los dígitos.
export function normalizarCuit(valor) {
  return String(valor ?? '').replace(/[\s.-]/g, '');
}

export function esCuitValido(cuit) {
  if (!/^\d{11}$/.test(cuit)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(cuit[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) return false;
  return dv === Number(cuit[10]);
}

function lanzarSiHayErrores(errores) {
  if (Object.keys(errores).length) {
    throw new HttpError(422, 'Revisá los datos del formulario.', errores);
  }
}

export function validarCategoria(body) {
  const e = {};
  const datos = {
    nombre: texto(body.nombre, { campo: 'nombre', requerido: true, min: 2, max: 80 }, e),
    descripcion: texto(body.descripcion, { campo: 'descripcion', max: 300 }, e),
    color: texto(body.color, { campo: 'color' }, e) ?? '#1d4ed8',
    presupuesto_mensual: monto(body.presupuesto_mensual, { campo: 'presupuesto_mensual' }, e),
    activa: body.activa === undefined ? true : Boolean(body.activa),
  };
  if (!COLOR_RE.test(datos.color)) e.color = 'Color inválido; usá el formato #RRGGBB.';
  lanzarSiHayErrores(e);
  return datos;
}

export function validarProveedor(body) {
  const e = {};
  const cuit = normalizarCuit(body.cuit) || null;
  const datos = {
    razon_social: texto(body.razon_social, { campo: 'razon_social', requerido: true, min: 2, max: 150 }, e),
    cuit,
    condicion_iva: body.condicion_iva || 'responsable_inscripto',
    tipo_comprobante: body.tipo_comprobante ? String(body.tipo_comprobante).toUpperCase() : null,
    categoria_id: idOpcional(body.categoria_id, 'categoria_id', e),
    email: texto(body.email, { campo: 'email', max: 150 }, e)?.toLowerCase() ?? null,
    telefono: texto(body.telefono, { campo: 'telefono', max: 40 }, e),
    notas: texto(body.notas, { campo: 'notas', max: 500 }, e),
    activo: body.activo === undefined ? true : Boolean(body.activo),
  };
  if (cuit && !esCuitValido(cuit)) e.cuit = 'CUIT inválido (11 dígitos, ej. 30-71234560-4).';
  if (!CONDICIONES_IVA.includes(datos.condicion_iva)) e.condicion_iva = 'Condición frente al IVA inválida.';
  if (datos.tipo_comprobante && !TIPOS_COMPROBANTE.includes(datos.tipo_comprobante)) e.tipo_comprobante = 'Tipo de comprobante inválido.';
  if (datos.email && !EMAIL_RE.test(datos.email)) e.email = 'Email inválido.';
  lanzarSiHayErrores(e);
  return datos;
}

// Valida lo que envía el cliente. Los datos del emisor (razón social y
// CUIT) no se aceptan del cliente: el handler los toma del proveedor.
export function validarFactura(body) {
  const e = {};
  const datos = {
    tipo_comprobante: String(body.tipo_comprobante || 'A').toUpperCase(),
    numero_comprobante: texto(body.numero_comprobante, { campo: 'numero_comprobante', requerido: true, max: 40 }, e),
    proveedor_id: idOpcional(body.proveedor_id, 'proveedor_id', e),
    fecha: typeof body.fecha === 'string' ? body.fecha : null,
    categoria_id: idOpcional(body.categoria_id, 'categoria_id', e),
    subtotal: monto(body.subtotal, { campo: 'subtotal', requerido: true }, e),
    impuestos: monto(body.impuestos === '' ? 0 : body.impuestos ?? 0, { campo: 'impuestos' }, e) ?? 0,
    metodo_pago: body.metodo_pago || 'transferencia',
    estado: body.estado || 'pagada',
    notas: texto(body.notas, { campo: 'notas', max: 500 }, e),
  };

  if (!TIPOS_COMPROBANTE.includes(datos.tipo_comprobante)) e.tipo_comprobante = 'Tipo de comprobante inválido.';
  if (!datos.proveedor_id && !e.proveedor_id) e.proveedor_id = 'Seleccioná un proveedor.';
  if (!datos.categoria_id && !e.categoria_id) e.categoria_id = 'Seleccioná una categoría.';
  if (!esFechaValida(datos.fecha)) e.fecha = 'Fecha inválida.';
  else if (datos.fecha < '2000-01-01') e.fecha = 'La fecha es demasiado antigua.';
  if (!METODOS_PAGO.includes(datos.metodo_pago)) e.metodo_pago = 'Medio de pago inválido.';
  if (!ESTADOS.includes(datos.estado)) e.estado = 'Estado inválido.';

  lanzarSiHayErrores(e);
  return datos;
}

// Logs enviados por el frontend: se aceptan con límites estrictos.
export function validarLogCliente(body) {
  const mensaje = texto(body.mensaje, { campo: 'mensaje', max: 2000 }, {}) ?? '';
  if (!mensaje) throw new HttpError(422, 'El log necesita un mensaje.');
  return {
    nivel: NIVELES_LOG.includes(body.nivel) ? body.nivel : 'error',
    mensaje: mensaje.slice(0, 2000),
    detalle: body.detalle ?? null,
    ruta: typeof body.ruta === 'string' ? body.ruta.slice(0, 500) : null,
  };
}

export function parseId(valor) {
  const id = Number.parseInt(valor, 10);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Id inválido.');
  return id;
}
