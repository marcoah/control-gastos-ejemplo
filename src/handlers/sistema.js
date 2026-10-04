import { json } from '../lib/http.js';
import { getSupabase } from '../lib/supabase.js';
import { hoyEn } from './dashboard.js';

export const VERSION = '1.1.0';

// Estado del sistema para la pantalla de Configuración.
// Nunca devuelve el valor de los secretos: sólo si están definidos.
export async function obtenerEstado({ env }) {
  const variables = {
    SUPABASE_URL: Boolean(env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    BASIC_AUTH: Boolean(env.BASIC_AUTH_USER && env.BASIC_AUTH_PASS),
  };

  const base = { ok: false, latencia_ms: null, mensaje: null, tablas: {} };
  if (!variables.SUPABASE_URL || !variables.SUPABASE_SERVICE_ROLE_KEY) {
    base.mensaje = 'Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY. En local van en .dev.vars; en producción, con `wrangler secret put`.';
  } else {
    const sb = getSupabase(env);
    const inicio = Date.now();
    const tablas = ['categorias', 'proveedores', 'facturas', 'logs'];
    const resultados = await Promise.all(
      tablas.map((t) => sb.from(t).select('id', { count: 'exact', head: true })),
    );
    base.latencia_ms = Date.now() - inicio;
    const fallas = [];
    resultados.forEach((r, i) => {
      if (r.error) fallas.push(`${tablas[i]}: ${r.error.message || r.error.code || 'error'}`);
      else base.tablas[tablas[i]] = r.count ?? 0;
    });
    base.ok = fallas.length === 0;
    base.mensaje = base.ok
      ? 'Conexión correcta.'
      : `Hay problemas con la base de datos (${fallas.join('; ')}). Revisá que hayas ejecutado los SQL 01 → 03.`;
  }

  const timezone = env.APP_TIMEZONE || 'America/Argentina/Buenos_Aires';
  return json({
    data: {
      version: VERSION,
      hoy: hoyEn(timezone),
      config: {
        timezone,
        locale: env.APP_LOCALE || 'es-AR',
        currency: env.APP_CURRENCY || 'ARS',
        iva: Number(env.APP_IVA ?? 0.21),
      },
      variables,
      supabase: base,
    },
  });
}
