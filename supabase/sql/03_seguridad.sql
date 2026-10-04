-- =====================================================================
-- 03_seguridad.sql
-- Row Level Security y permisos.
--
-- Modelo de seguridad: el navegador NUNCA habla directo con Supabase.
-- Todas las peticiones pasan por el Cloudflare Worker, que usa la llave
-- secreta (service_role / sb_secret_...), la cual ignora RLS.
-- Por eso habilitamos RLS SIN políticas: los roles anon y authenticated
-- (llave pública) no pueden leer ni escribir nada.
-- =====================================================================

alter table public.categorias enable row level security;
alter table public.facturas   enable row level security;
alter table public.proveedores enable row level security;
alter table public.logs       enable row level security;

-- Por si en algún momento se crearon políticas abiertas, se eliminan.
drop policy if exists "acceso publico categorias" on public.categorias;
drop policy if exists "acceso publico facturas"   on public.facturas;

-- Quitar privilegios directos a los roles públicos
revoke all on table public.categorias from anon, authenticated;
revoke all on table public.facturas   from anon, authenticated;
revoke all on table public.proveedores from anon, authenticated;
revoke all on table public.logs       from anon, authenticated;
revoke all on table public.v_categorias  from anon, authenticated;
revoke all on table public.v_proveedores from anon, authenticated;

-- Las funciones RPC sólo para service_role
revoke execute on function public.dashboard_resumen(date) from public, anon, authenticated;
revoke execute on function public.reset_datos()          from public, anon, authenticated;

grant execute on function public.dashboard_resumen(date) to service_role;
grant execute on function public.reset_datos()          to service_role;

grant select, insert, update, delete, truncate on table public.categorias to service_role;
grant select, insert, update, delete, truncate on table public.facturas   to service_role;
grant select, insert, update, delete, truncate on table public.proveedores to service_role;
grant select, insert, update, delete, truncate on table public.logs        to service_role;
grant select on table public.v_categorias  to service_role;
grant select on table public.v_proveedores to service_role;
