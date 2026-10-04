#!/usr/bin/env node
// =====================================================================
// Inserta datos de prueba en Supabase.
//   npm run db:seed              -> 100 facturas
//   npm run db:seed -- 250       -> 250 facturas
// Lee SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de .dev.vars
// (o de variables de entorno). Los números de comprobante llevan el prefijo DEMO-
// para poder borrarlos después con `npm run db:reset:demo`.
// Las fechas se calculan en la zona horaria de Buenos Aires.
// =====================================================================
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('✖ Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY (revisá tu archivo .dev.vars).');
  process.exit(1);
}

const TOTAL = Math.max(1, Math.min(5000, Number.parseInt(process.argv[2], 10) || 100));
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CATEGORIAS = [
  { nombre: 'Librería y oficina', descripcion: 'Artículos de librería, insumos y mobiliario menor', color: '#1d4ed8', presupuesto_mensual: 800000 },
  { nombre: 'Servicios públicos', descripcion: 'Luz, agua y gas', color: '#0369a1', presupuesto_mensual: 700000 },
  { nombre: 'Telecomunicaciones', descripcion: 'Internet, telefonía fija y celular', color: '#0e7490', presupuesto_mensual: 350000 },
  { nombre: 'Software y suscripciones', descripcion: 'Licencias, hosting, dominios y SaaS', color: '#4338ca', presupuesto_mensual: 900000 },
  { nombre: 'Viáticos y viajes', descripcion: 'Pasajes, hotelería, remises y peajes', color: '#1e40af', presupuesto_mensual: 2000000 },
  { nombre: 'Alimentos', descripcion: 'Comidas de trabajo y cafetería', color: '#2563eb', presupuesto_mensual: 450000 },
  { nombre: 'Mantenimiento', descripcion: 'Reparaciones, ferretería y limpieza', color: '#334155', presupuesto_mensual: 700000 },
  { nombre: 'Publicidad y marketing', descripcion: 'Pauta digital, diseño e imprenta', color: '#3b82f6', presupuesto_mensual: 1800000 },
  { nombre: 'Honorarios profesionales', descripcion: 'Contador, abogados y consultoría', color: '#1e3a8a', presupuesto_mensual: 3000000 },
  { nombre: 'Combustible', descripcion: 'Nafta y gasoil de vehículos', color: '#475569', presupuesto_mensual: 600000 },
];

// Proveedores y CUIT FICTICIOS (dígito verificador válido, no son contribuyentes reales).
// [proveedor, cuit, categoría, tipo de factura, alícuota IVA, monto mínimo, monto máximo] — montos en ARS
// Las facturas B y C no discriminan IVA (alícuota 0).
const PROVEEDORES = [
  ['Librería Comercial Del Plata SRL', '30712345604', 'Librería y oficina', 'A', 0.21, 15000, 350000],
  ['Insumos de Oficina Rivadavia SA', '30712722912', 'Librería y oficina', 'A', 0.21, 25000, 480000],
  ['Distribuidora Eléctrica Metropolitana SA', '30713100222', 'Servicios públicos', 'A', 0.27, 80000, 420000],
  ['Aguas del Río Sur SA', '33713477538', 'Servicios públicos', 'A', 0.27, 25000, 110000],
  ['Gas Pampeano Distribuidora SA', '30713854847', 'Servicios públicos', 'A', 0.27, 30000, 180000],
  ['Telecomunicaciones Australes SA', '30714986771', 'Telecomunicaciones', 'A', 0.27, 45000, 160000],
  ['Conecta Fibra SRL', '30715364081', 'Telecomunicaciones', 'A', 0.27, 35000, 120000],
  ['Nube Austral Hosting SA', '30716496011', 'Software y suscripciones', 'A', 0.21, 40000, 650000],
  ['Software Andino SAS', '33716873329', 'Software y suscripciones', 'A', 0.21, 20000, 300000],
  ['Gestión Contable Online SA', '30717250636', 'Software y suscripciones', 'A', 0.21, 30000, 180000],
  ['Aerolíneas del Cono Sur SA', '30718382560', 'Viáticos y viajes', 'A', 0.105, 180000, 950000],
  ['Hotel Plaza de Mayo SA', '30718759877', 'Viáticos y viajes', 'A', 0.21, 90000, 450000],
  ['Remises San Telmo', '20714232151', 'Viáticos y viajes', 'C', 0, 8000, 45000],
  ['Café Palermo Viejo SRL', '30719137187', 'Alimentos', 'B', 0, 6000, 60000],
  ['Parrilla La Esquina SRL', '33719514494', 'Alimentos', 'B', 0, 25000, 220000],
  ['Limpieza Integral Belgrano SRL', '30719891809', 'Mantenimiento', 'A', 0.21, 90000, 450000],
  ['Ferretería Caballito SA', '30721023733', 'Mantenimiento', 'A', 0.21, 10000, 280000],
  ['Agencia Digital Obelisco SAS', '30721401045', 'Publicidad y marketing', 'A', 0.21, 150000, 1200000],
  ['Imprenta Gráfica Barracas SRL', '30721778351', 'Publicidad y marketing', 'A', 0.21, 60000, 520000],
  ['Diseño Gráfico M. López', '27718005251', 'Publicidad y marketing', 'C', 0, 80000, 400000],
  ['Estudio Contable Fernández', '27714609462', 'Honorarios profesionales', 'C', 0, 350000, 1400000],
  ['Estudio Jurídico Gómez & Asoc.', '33722155667', 'Honorarios profesionales', 'A', 0.21, 400000, 1800000],
  ['Estación de Servicio Avenida SA', '30722532976', 'Combustible', 'A', 0.21, 40000, 180000],
];

const METODOS = ['transferencia', 'transferencia', 'tarjeta_credito', 'tarjeta_debito', 'efectivo', 'cheque', 'billetera_virtual'];
const NOTAS = [null, null, 'Registro de prueba', 'Pago recurrente', 'Proyecto interno', 'Gasto de cliente', 'Reintegrable'];

const azar = (min, max) => min + Math.random() * (max - min);
const elegir = (arr) => arr[Math.floor(Math.random() * arr.length)];
const redondear = (n) => Math.round(n * 100) / 100;
const TZ = process.env.APP_TIMEZONE || 'America/Argentina/Buenos_Aires';
const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

// "Hoy" en Buenos Aires, como fecha UTC a medianoche (evita desfases de zona horaria).
function hoyEnZona() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date())
    .split('-')
    .map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// ~25% en el mes en curso (hasta hoy) y el resto en los 5 meses previos.
function fechaAleatoria(i) {
  const hoy = hoyEnZona();
  const anio = hoy.getUTCFullYear();
  const mes = hoy.getUTCMonth();
  if (i < Math.round(TOTAL * 0.25)) {
    return iso(new Date(Date.UTC(anio, mes, 1 + Math.floor(Math.random() * hoy.getUTCDate()))));
  }
  // Día 0 del mes = último día del mes anterior; se retrocede hasta ~150 días.
  return iso(new Date(Date.UTC(anio, mes, 0 - Math.floor(Math.random() * 150))));
}

function estadoAleatorio() {
  const r = Math.random();
  return r < 0.8 ? 'pagada' : r < 0.95 ? 'pendiente' : 'cancelada';
}

async function main() {
  console.log(`→ Conectando a ${SUPABASE_URL}`);

  // 1) Categorías (no duplica si ya existen)
  const { error: errCat } = await sb.from('categorias').upsert(CATEGORIAS, { onConflict: 'nombre', ignoreDuplicates: true });
  if (errCat) throw errCat;

  const { data: categorias, error: errLista } = await sb.from('categorias').select('id, nombre');
  if (errLista) throw errLista;
  const idPorNombre = Object.fromEntries(categorias.map((c) => [c.nombre, c.id]));
  console.log(`✔ ${categorias.length} categorías disponibles`);

  // 2) Facturas
  const usados = new Set();
  const facturas = Array.from({ length: TOTAL }, (_, i) => {
    const [proveedor, cuit, categoria, tipo, alicuota, min, max] = elegir(PROVEEDORES);
    let numero;
    do {
      const puntoVenta = String(1 + Math.floor(Math.random() * 5)).padStart(5, '0');
      const nro = String(1 + Math.floor(Math.random() * 99_999_999)).padStart(8, '0');
      numero = `DEMO-${puntoVenta}-${nro}`;
    } while (usados.has(proveedor + tipo + numero));
    usados.add(proveedor + tipo + numero);

    const subtotal = redondear(azar(min, max));
    return {
      tipo_comprobante: tipo,
      numero_comprobante: numero,
      proveedor,
      cuit_proveedor: cuit,
      fecha: fechaAleatoria(i),
      categoria_id: idPorNombre[categoria],
      subtotal,
      impuestos: redondear(subtotal * alicuota),
      metodo_pago: elegir(METODOS),
      estado: estadoAleatorio(),
      notas: elegir(NOTAS),
    };
  }).filter((f) => f.categoria_id);

  let insertadas = 0;
  for (let i = 0; i < facturas.length; i += 500) {
    const lote = facturas.slice(i, i + 500);
    const { data, error } = await sb
      .from('facturas')
      .upsert(lote, { onConflict: 'proveedor,tipo_comprobante,numero_comprobante', ignoreDuplicates: true })
      .select('id');
    if (error) throw error;
    insertadas += data.length;
  }

  const total = facturas.reduce((s, f) => s + f.subtotal + f.impuestos, 0);
  console.log(`✔ ${insertadas} facturas de prueba insertadas (≈ ${total.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })})`);
  console.log('Listo. Abrí la app y mirá el tablero.');
}

main().catch((err) => {
  console.error('✖ Error al insertar datos de prueba:', err.message || err);
  if (err.code === '42P01' || err.code === 'PGRST205') {
    console.error('  ¿Ya ejecutaste los SQL de supabase/sql en tu proyecto?');
  }
  process.exit(1);
});
