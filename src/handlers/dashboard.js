import { fromSupabaseError, json } from '../lib/http.js';

const TZ_DEFECTO = 'America/Argentina/Buenos_Aires';

// Fecha de hoy (AAAA-MM-DD) en la zona horaria configurada.
export function hoyEn(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function obtenerDashboard({ sb, env }) {
  const { data, error } = await sb.rpc('dashboard_resumen', {
    p_hoy: hoyEn(env.APP_TIMEZONE || TZ_DEFECTO),
  });
  if (error) throw fromSupabaseError(error);
  return json({ data });
}

export function obtenerConfig({ env }) {
  return json({
    data: {
      timezone: env.APP_TIMEZONE || TZ_DEFECTO,
      locale: env.APP_LOCALE || 'es-AR',
      currency: env.APP_CURRENCY || 'ARS',
      iva: Number(env.APP_IVA ?? 0.21),
      hoy: hoyEn(env.APP_TIMEZONE || TZ_DEFECTO),
    },
  });
}
