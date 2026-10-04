#!/usr/bin/env node
// =====================================================================
// Limpia la base de datos.
//   npm run db:reset                 -> borra TODO (facturas, proveedores, categorías y logs) y
//                                       reinicia los ids (pide confirmación)
//   npm run db:reset -- --yes        -> igual, sin preguntar
//   npm run db:reset:demo            -> sólo borra las facturas DEMO-* y los proveedores de prueba sin facturas
// La estructura de tablas no se toca.
// =====================================================================
import { createClient } from '@supabase/supabase-js';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('✖ Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY (revisá tu archivo .dev.vars).');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const soloPrueba = args.has('--solo-prueba');
const sinPreguntar = args.has('--yes') || args.has('-y');

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function confirmar(pregunta) {
  if (sinPreguntar) return true;
  const rl = createInterface({ input: stdin, output: stdout });
  const r = await rl.question(`${pregunta} Escribí "si" para continuar: `);
  rl.close();
  return ['si', 'sí', 's', 'yes', 'y'].includes(r.trim().toLowerCase());
}

async function main() {
  console.log(`→ Proyecto: ${SUPABASE_URL}`);

  if (soloPrueba) {
    if (!(await confirmar('Se borrarán las facturas de prueba (comprobantes DEMO-*).'))) return console.log('Cancelado.');
    const { data, error } = await sb.from('facturas').delete().like('numero_comprobante', 'DEMO-%').select('id');
    if (error) throw error;
    console.log(`✔ ${data.length} facturas de prueba eliminadas.`);

    // Proveedores de prueba que quedaron sin facturas
    const { data: provs, error: errProv } = await sb.from('v_proveedores').select('id').eq('notas', 'Proveedor de prueba').eq('facturas', 0);
    if (errProv) throw errProv;
    if (provs.length) {
      const { error: errDel } = await sb.from('proveedores').delete().in('id', provs.map((p) => p.id));
      if (errDel) throw errDel;
    }
    console.log(`✔ ${provs.length} proveedores de prueba eliminados.`);
    return;
  }

  if (!(await confirmar('⚠  Se borrarán TODAS las facturas, proveedores, categorías y logs.'))) return console.log('Cancelado.');

  const { error } = await sb.rpc('reset_datos');
  if (error) throw error;
  console.log('✔ Base de datos reiniciada a cero (ids reiniciados).');
}

main().catch((err) => {
  console.error('✖ Error al limpiar la base:', err.message || err);
  if (err.code === 'PGRST202') console.error('  No existe la función reset_datos(): ejecutá supabase/sql/02_vistas_funciones.sql');
  process.exit(1);
});
