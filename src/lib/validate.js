import { HttpError } from './http.js';

export const TIPOS_COMPROBANTE = ['A', 'B', 'C', 'M', 'E'];
export const METODOS_PAGO = ['transferencia', 'tarjeta_credito', 'tarjeta_debito', 'efectivo', 'cheque', 'billetera_virtual'];
export const ESTADOS = ['pagada', 'pendiente', 'cancelada'];

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function monto(valor, { campo, requerido = false }, errores) {
  if (valor === '' || valor == null) {
    if (requerido) errores[campo] = 'Campo obligatorio.';
    return null;
  }
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) {
    errores[campo] = 'Debe ser un número mayor o igual a 0.';
    return null;
  }
  if (n > 999_999_999_999.99) {
    errores[campo] = 'El monto es demasiado grande.';
    return null;
  }
  return Math.round(n * 100) / 100;
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

export function validarFactura(body) {
  const e = {};
  const cuit = normalizarCuit(body.cuit_proveedor) || null;
  const datos = {
    tipo_comprobante: String(body.tipo_comprobante || 'A').toUpperCase(),
    numero_comprobante: texto(body.numero_comprobante, { campo: 'numero_comprobante', requerido: true, max: 40 }, e),
    proveedor: texto(body.proveedor, { campo: 'proveedor', requerido: true, min: 2, max: 150 }, e),
    cuit_proveedor: cuit,
    fecha: typeof body.fecha === 'string' ? body.fecha : null,
    categoria_id: Number.parseInt(body.categoria_id, 10),
    subtotal: monto(body.subtotal, { campo: 'subtotal', requerido: true }, e),
    impuestos: monto(body.impuestos ?? 0, { campo: 'impuestos' }, e) ?? 0,
    metodo_pago: body.metodo_pago || 'transferencia',
    estado: body.estado || 'pagada',
    notas: texto(body.notas, { campo: 'notas', max: 500 }, e),
  };

  if (!TIPOS_COMPROBANTE.includes(datos.tipo_comprobante)) e.tipo_comprobante = 'Tipo de comprobante inválido.';
  if (cuit && !esCuitValido(cuit)) e.cuit_proveedor = 'CUIT inválido (11 dígitos, ej. 30-71234560-4).';
  if (!esFechaValida(datos.fecha)) e.fecha = 'Fecha inválida.';
  if (!Number.isInteger(datos.categoria_id) || datos.categoria_id <= 0) e.categoria_id = 'Seleccioná una categoría.';
  if (!METODOS_PAGO.includes(datos.metodo_pago)) e.metodo_pago = 'Medio de pago inválido.';
  if (!ESTADOS.includes(datos.estado)) e.estado = 'Estado inválido.';

  lanzarSiHayErrores(e);
  return datos;
}

export function parseId(valor) {
  const id = Number.parseInt(valor, 10);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Id inválido.');
  return id;
}
