import { createClient } from '@supabase/supabase-js';
import { HttpError } from './http.js';

export function getSupabase(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(500, 'Configuración incompleta: faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.');
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // Evita que una petición quede colgada si Supabase no responde.
    global: {
      fetch: (input, init = {}) => fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(10_000) }),
    },
  });
}
