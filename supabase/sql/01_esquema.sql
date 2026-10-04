-- =====================================================================
-- 01_esquema.sql
-- Tablas, restricciones, índices y triggers del control de gastos.
-- Ejecutar en el SQL Editor de Supabase (o con psql) en este orden:
--   01_esquema.sql -> 02_vistas_funciones.sql -> 03_seguridad.sql
--   (opcional) 04_categorias_base.sql
-- El script es idempotente: se puede volver a ejecutar sin romper nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Función genérica para mantener updated_at
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Validación de CUIT/CUIL (11 dígitos + dígito verificador módulo 11)
-- ---------------------------------------------------------------------
create or replace function public.cuit_valido(p_cuit text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_pesos int[] := array[5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  v_suma  int   := 0;
  v_dv    int;
begin
  if p_cuit is null or p_cuit !~ '^[0-9]{11}$' then
    return false;
  end if;
  for i in 1..10 loop
    v_suma := v_suma + substr(p_cuit, i, 1)::int * v_pesos[i];
  end loop;
  v_dv := 11 - (v_suma % 11);
  if v_dv = 11 then
    v_dv := 0;
  elsif v_dv = 10 then
    return false;
  end if;
  return v_dv = substr(p_cuit, 11, 1)::int;
end;
$$;

-- ---------------------------------------------------------------------
-- Categorías de gasto
-- ---------------------------------------------------------------------
create table if not exists public.categorias (
  id                  bigint generated always as identity primary key,
  nombre              text        not null,
  descripcion         text,
  color               text        not null default '#1d4ed8',
  presupuesto_mensual numeric(14,2),
  activa              boolean     not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint categorias_nombre_uk     unique (nombre),
  constraint categorias_nombre_len    check (char_length(btrim(nombre)) between 2 and 80),
  constraint categorias_desc_len      check (descripcion is null or char_length(descripcion) <= 300),
  constraint categorias_color_hex     check (color ~ '^#[0-9a-fA-F]{6}$'),
  constraint categorias_presupuesto   check (presupuesto_mensual is null or presupuesto_mensual >= 0)
);

comment on table  public.categorias is 'Catálogo de categorías de gasto.';
comment on column public.categorias.presupuesto_mensual is 'Presupuesto mensual opcional; se usa en el dashboard.';

drop trigger if exists trg_categorias_updated_at on public.categorias;
create trigger trg_categorias_updated_at
  before update on public.categorias
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Facturas
-- ---------------------------------------------------------------------
create table if not exists public.facturas (
  id                  bigint generated always as identity primary key,
  tipo_comprobante    text          not null default 'A',
  numero_comprobante  text          not null,
  proveedor           text          not null,
  cuit_proveedor      text,
  fecha               date          not null,
  categoria_id        bigint        not null references public.categorias (id) on delete restrict,
  subtotal            numeric(14,2) not null default 0,
  impuestos           numeric(14,2) not null default 0,
  total               numeric(14,2) generated always as (subtotal + impuestos) stored,
  metodo_pago         text          not null default 'transferencia',
  estado              text          not null default 'pagada',
  notas               text,
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now(),

  constraint facturas_comprobante_uk unique (proveedor, tipo_comprobante, numero_comprobante),
  constraint facturas_tipo           check (tipo_comprobante in ('A','B','C','M','E')),
  constraint facturas_numero_len     check (char_length(btrim(numero_comprobante)) between 1 and 40),
  constraint facturas_proveedor_len  check (char_length(btrim(proveedor)) between 2 and 150),
  constraint facturas_cuit_valido    check (cuit_proveedor is null or public.cuit_valido(cuit_proveedor)),
  constraint facturas_subtotal_pos   check (subtotal >= 0),
  constraint facturas_impuestos_pos  check (impuestos >= 0),
  constraint facturas_metodo_pago    check (metodo_pago in ('transferencia','tarjeta_credito','tarjeta_debito','efectivo','cheque','billetera_virtual')),
  constraint facturas_estado         check (estado in ('pagada','pendiente','cancelada')),
  constraint facturas_notas_len      check (notas is null or char_length(notas) <= 500)
);

comment on table  public.facturas is 'Facturas / comprobantes de gasto.';
comment on column public.facturas.tipo_comprobante   is 'Letra de la factura (AFIP): A, B, C, M o E.';
comment on column public.facturas.numero_comprobante is 'Punto de venta y número, ej. 00003-00012345.';
comment on column public.facturas.cuit_proveedor     is 'CUIT del emisor, 11 dígitos sin guiones.';
comment on column public.facturas.impuestos          is 'IVA discriminado + percepciones (0 en facturas B/C).';
comment on column public.facturas.total              is 'Columna calculada: subtotal + impuestos.';
comment on column public.facturas.estado is 'pagada | pendiente | cancelada (las canceladas no suman al gasto).';

create index if not exists facturas_fecha_idx        on public.facturas (fecha desc);
create index if not exists facturas_categoria_idx    on public.facturas (categoria_id);
create index if not exists facturas_estado_idx       on public.facturas (estado);
create index if not exists facturas_created_at_idx   on public.facturas (created_at desc);

drop trigger if exists trg_facturas_updated_at on public.facturas;
create trigger trg_facturas_updated_at
  before update on public.facturas
  for each row execute function public.set_updated_at();
