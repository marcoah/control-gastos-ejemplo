-- =====================================================================
-- 02_vistas_funciones.sql
-- Vistas y funciones RPC que consume el Worker.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Vista: categorías con su número de facturas y gasto histórico
-- ---------------------------------------------------------------------
create or replace view public.v_categorias
with (security_invoker = true)
as
select
  c.id,
  c.nombre,
  c.descripcion,
  c.color,
  c.presupuesto_mensual,
  c.activa,
  c.created_at,
  c.updated_at,
  count(f.id)::int                                                   as facturas,
  coalesce(sum(f.total) filter (where f.estado <> 'cancelada'), 0)   as gasto_total
from public.categorias c
left join public.facturas f on f.categoria_id = c.id
group by c.id;

-- ---------------------------------------------------------------------
-- Vista: proveedores con su categoría, cantidad de facturas, gasto
-- histórico y fecha de la última factura
-- ---------------------------------------------------------------------
create or replace view public.v_proveedores
with (security_invoker = true)
as
select
  p.id,
  p.razon_social,
  p.cuit,
  p.condicion_iva,
  p.tipo_comprobante,
  p.categoria_id,
  c.nombre                                                           as categoria_nombre,
  p.email,
  p.telefono,
  p.notas,
  p.activo,
  p.created_at,
  p.updated_at,
  count(f.id)::int                                                   as facturas,
  coalesce(sum(f.total) filter (where f.estado <> 'cancelada'), 0)   as gasto_total,
  max(f.fecha)                                                       as ultima_factura
from public.proveedores p
left join public.categorias c on c.id = p.categoria_id
left join public.facturas   f on f.proveedor_id = p.id
group by p.id, c.nombre;

-- ---------------------------------------------------------------------
-- RPC: resumen para el tablero
--   p_hoy: fecha de corte (el Worker la envía en la zona horaria
--          configurada en APP_TIMEZONE para evitar desfases UTC).
-- Las facturas canceladas NO suman al gasto.
-- ---------------------------------------------------------------------
create or replace function public.dashboard_resumen(p_hoy date default current_date)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_ini_mes   date := date_trunc('month', p_hoy)::date;
  v_fin_mes   date := (date_trunc('month', p_hoy) + interval '1 month - 1 day')::date;
  v_ini_ant   date := (date_trunc('month', p_hoy) - interval '1 month')::date;
  v_hoy_ant   date := (p_hoy - interval '1 month')::date;  -- mismo día del mes anterior (ajusta 31 -> 30/28)
  v_resultado jsonb;
begin
  select jsonb_build_object(
    'fecha_corte',        p_hoy,
    'dia_actual',         extract(day from p_hoy)::int,
    'dias_mes',           extract(day from v_fin_mes)::int,

    'total_facturas',     (select count(*) from facturas),

    'facturas_mes',       (select count(*) from facturas
                            where fecha between v_ini_mes and p_hoy and estado <> 'cancelada'),

    'gasto_mes',          (select coalesce(sum(total), 0) from facturas
                            where fecha between v_ini_mes and p_hoy and estado <> 'cancelada'),

    'gasto_mes_anterior_mismo_periodo',
                          (select coalesce(sum(total), 0) from facturas
                            where fecha between v_ini_ant and v_hoy_ant and estado <> 'cancelada'),

    'gasto_mes_anterior_total',
                          (select coalesce(sum(total), 0) from facturas
                            where fecha >= v_ini_ant and fecha < v_ini_mes and estado <> 'cancelada'),

    'pendientes',         (select jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(total), 0))
                             from facturas where estado = 'pendiente'),

    'por_categoria',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.gasto desc, x.nombre), '[]'::jsonb)
                             from (
                               select c.id, c.nombre, c.color,
                                      c.presupuesto_mensual as presupuesto,
                                      coalesce(sum(f.total), 0) as gasto,
                                      count(f.id)::int          as facturas
                                 from categorias c
                                 left join facturas f
                                        on f.categoria_id = c.id
                                       and f.fecha between v_ini_mes and p_hoy
                                       and f.estado <> 'cancelada'
                                group by c.id
                               having c.activa or count(f.id) > 0
                             ) x),

    'tendencia',          (select coalesce(jsonb_agg(jsonb_build_object(
                                     'mes',   to_char(m.mes, 'YYYY-MM'),
                                     'total', coalesce(t.total, 0),
                                     'facturas', coalesce(t.n, 0)
                                   ) order by m.mes), '[]'::jsonb)
                             from generate_series(v_ini_mes - interval '5 months', v_ini_mes, interval '1 month') as m(mes)
                             left join lateral (
                               select sum(f.total) as total, count(*)::int as n
                                 from facturas f
                                where f.fecha >= m.mes::date
                                  and f.fecha <  (m.mes + interval '1 month')::date
                                  and f.fecha <= p_hoy
                                  and f.estado <> 'cancelada'
                             ) t on true),

    'top_proveedores',    (select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc), '[]'::jsonb)
                             from (
                               select p.id, p.razon_social as proveedor,
                                      sum(f.total) as total, count(*)::int as facturas
                                 from facturas f
                                 join proveedores p on p.id = f.proveedor_id
                                where f.fecha between v_ini_mes and p_hoy and f.estado <> 'cancelada'
                                group by p.id, p.razon_social
                                order by sum(f.total) desc
                                limit 5
                             ) x),

    'ultimas',            (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
                             from (
                               select f.id, f.tipo_comprobante, f.numero_comprobante, f.proveedor, f.fecha, f.total, f.estado, f.created_at,
                                      c.nombre as categoria, c.color as categoria_color
                                 from facturas f
                                 join categorias c on c.id = f.categoria_id
                                order by f.created_at desc
                                limit 5
                             ) x)
  )
  into v_resultado;

  return v_resultado;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: reinicia la base a cero (borra facturas, proveedores, categorías
-- y logs, y reinicia los contadores de id). Sólo la puede ejecutar
-- service_role.
-- Es SECURITY DEFINER porque RESTART IDENTITY exige ser dueño de las
-- secuencias (el dueño es postgres, no service_role). El permiso de
-- ejecución se restringe en 03_seguridad.sql.
-- ---------------------------------------------------------------------
create or replace function public.reset_datos()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate table public.facturas, public.proveedores, public.categorias, public.logs
    restart identity cascade;
end;
$$;
