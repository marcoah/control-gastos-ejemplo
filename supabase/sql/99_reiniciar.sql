-- =====================================================================
-- 99_reiniciar.sql
-- ⚠️  BORRA TODOS LOS DATOS (facturas y categorías) y reinicia los ids.
-- La estructura (tablas, vistas, funciones, RLS) se conserva.
-- Equivalente SQL de `npm run db:reset`.
-- =====================================================================

truncate table public.facturas, public.categorias restart identity cascade;

-- Si sólo querés borrar los datos de prueba, usá en su lugar:
--   delete from public.facturas where numero_comprobante like 'DEMO-%';

-- Si además querés eliminar TODA la estructura (para reinstalar desde
-- 01_esquema.sql), descomentá lo siguiente:
-- drop view     if exists public.v_categorias;
-- drop function if exists public.dashboard_resumen(date);
-- drop function if exists public.reset_datos();
-- drop table    if exists public.facturas;
-- drop table    if exists public.categorias;
-- drop function if exists public.set_updated_at();
-- drop function if exists public.cuit_valido(text);
