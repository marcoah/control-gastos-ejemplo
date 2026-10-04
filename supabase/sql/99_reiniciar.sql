-- =====================================================================
-- 99_reiniciar.sql
-- ⚠️  BORRA TODOS LOS DATOS (facturas, proveedores, categorías y logs)
--     y reinicia los ids.
-- La estructura (tablas, vistas, funciones, RLS) se conserva.
-- Equivalente SQL de `npm run db:reset`.
-- =====================================================================

truncate table public.facturas, public.proveedores, public.categorias, public.logs
  restart identity cascade;

-- Si sólo querés borrar los datos de prueba, usá en su lugar:
--   delete from public.facturas where numero_comprobante like 'DEMO-%';
--   delete from public.proveedores p where p.notas = 'Proveedor de prueba'
--     and not exists (select 1 from public.facturas f where f.proveedor_id = p.id);

-- Si además querés eliminar TODA la estructura (para reinstalar desde
-- 01_esquema.sql), descomentá lo siguiente:
-- drop view     if exists public.v_categorias;
-- drop view     if exists public.v_proveedores;
-- drop function if exists public.dashboard_resumen(date);
-- drop function if exists public.reset_datos();
-- drop table    if exists public.logs;
-- drop table    if exists public.facturas;
-- drop table    if exists public.proveedores;
-- drop table    if exists public.categorias;
-- drop function if exists public.set_updated_at();
-- drop function if exists public.cuit_valido(text);
