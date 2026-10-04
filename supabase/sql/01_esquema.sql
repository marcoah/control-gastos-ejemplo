-- =====================================================================
-- 01_esquema.sql
-- Tablas, restricciones, índices y triggers del control de gastos.
-- Ejecutar en el SQL Editor de Supabase (o con psql) en este orden:
--   01_esquema.sql -> 02_vistas_funciones.sql -> 03_seguridad.sql
--   (opcional) 04_categorias_base.sql
--
-- El script es idempotente: se puede volver a ejecutar sin romper nada.
-- Si ya tenías instalada una versión anterior (sin proveedores ni logs),
-- volvé a ejecutar 01 -> 02 -> 03 y la base se actualiza sola: crea las
-- tablas nuevas y migra los proveedores de las facturas existentes.
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
comment on column public.categorias.presupuesto_mensual is 'Presupuesto mensual opcional; se usa en el tablero.';

drop trigger if exists trg_categorias_updated_at on public.categorias;
create trigger trg_categorias_updated_at
  before update on public.categorias
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Proveedores
-- ---------------------------------------------------------------------
create table if not exists public.proveedores (
  id                bigint generated always as identity primary key,
  razon_social      text        not null,
  cuit              text,
  condicion_iva     text        not null default 'responsable_inscripto',
  tipo_comprobante  text,
  categoria_id      bigint      references public.categorias (id) on delete set null,
  email             text,
  telefono          text,
  notas             text,
  activo            boolean     not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint proveedores_razon_social_uk  unique (razon_social),
  constraint proveedores_cuit_uk          unique (cuit),
  constraint proveedores_razon_social_len check (char_length(btrim(razon_social)) between 2 and 150),
  constraint proveedores_cuit_valido      check (cuit is null or public.cuit_valido(cuit)),
  constraint proveedores_condicion_iva    check (condicion_iva in ('responsable_inscripto','monotributista','exento','no_alcanzado','exterior')),
  constraint proveedores_tipo             check (tipo_comprobante is null or tipo_comprobante in ('A','B','C','M','E')),
  constraint proveedores_email            check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint proveedores_telefono_len     check (telefono is null or char_length(telefono) <= 40),
  constraint proveedores_notas_len        check (notas is null or char_length(notas) <= 500)
);

comment on table  public.proveedores is 'Catálogo de proveedores (emisores de las facturas).';
comment on column public.proveedores.tipo_comprobante is 'Tipo de factura habitual; se preselecciona al cargar una factura.';
comment on column public.proveedores.categoria_id     is 'Categoría por defecto; se preselecciona al cargar una factura.';

create index if not exists proveedores_categoria_idx on public.proveedores (categoria_id);

drop trigger if exists trg_proveedores_updated_at on public.proveedores;
create trigger trg_proveedores_updated_at
  before update on public.proveedores
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Facturas
-- `proveedor` y `cuit_proveedor` guardan una copia de los datos del
-- emisor tal como figuraban al cargar la factura (el Worker los completa
-- a partir de `proveedor_id`).
-- ---------------------------------------------------------------------
create table if not exists public.facturas (
  id                  bigint generated always as identity primary key,
  tipo_comprobante    text          not null default 'A',
  numero_comprobante  text          not null,
  proveedor_id        bigint        not null references public.proveedores (id) on delete restrict,
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

  constraint facturas_comprobante_prov_uk unique (proveedor_id, tipo_comprobante, numero_comprobante),
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

-- ---------------------------------------------------------------------
-- Migración desde versiones anteriores (facturas sin proveedor_id).
-- En una instalación nueva estos pasos no hacen nada.
-- ---------------------------------------------------------------------
alter table public.facturas
  add column if not exists proveedor_id bigint references public.proveedores (id) on delete restrict;

-- Crea los proveedores a partir de las facturas existentes
insert into public.proveedores (razon_social, cuit)
select distinct on (f.proveedor) f.proveedor, f.cuit_proveedor
  from public.facturas f
 where f.proveedor_id is null
 order by f.proveedor, f.created_at desc
on conflict do nothing;

update public.facturas f
   set proveedor_id = p.id
  from public.proveedores p
 where f.proveedor_id is null
   and p.razon_social = f.proveedor;

update public.facturas f
   set proveedor_id = p.id
  from public.proveedores p
 where f.proveedor_id is null
   and f.cuit_proveedor is not null
   and p.cuit = f.cuit_proveedor;

alter table public.facturas alter column proveedor_id set not null;

-- El comprobante pasa a ser único por proveedor_id (antes era por nombre)
alter table public.facturas drop constraint if exists facturas_comprobante_uk;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'facturas_comprobante_prov_uk') then
    alter table public.facturas
      add constraint facturas_comprobante_prov_uk unique (proveedor_id, tipo_comprobante, numero_comprobante);
  end if;
end;
$$;

comment on table  public.facturas is 'Facturas / comprobantes de gasto.';
comment on column public.facturas.tipo_comprobante   is 'Letra de la factura (AFIP/ARCA): A, B, C, M o E.';
comment on column public.facturas.numero_comprobante is 'Punto de venta y número, ej. 00003-00012345.';
comment on column public.facturas.proveedor          is 'Razón social del emisor al momento de la carga.';
comment on column public.facturas.cuit_proveedor     is 'CUIT del emisor al momento de la carga, 11 dígitos sin guiones.';
comment on column public.facturas.impuestos          is 'IVA discriminado + percepciones (0 en facturas B/C).';
comment on column public.facturas.total              is 'Columna calculada: subtotal + impuestos.';
comment on column public.facturas.estado             is 'pagada | pendiente | cancelada (anulada; no suma al gasto).';

create index if not exists facturas_fecha_idx        on public.facturas (fecha desc);
create index if not exists facturas_categoria_idx    on public.facturas (categoria_id);
create index if not exists facturas_proveedor_idx    on public.facturas (proveedor_id);
create index if not exists facturas_estado_idx       on public.facturas (estado);
create index if not exists facturas_created_at_idx   on public.facturas (created_at desc);

drop trigger if exists trg_facturas_updated_at on public.facturas;
create trigger trg_facturas_updated_at
  before update on public.facturas
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Logs de errores (los escribe el Worker; se ven en Configuración)
-- ---------------------------------------------------------------------
create table if not exists public.logs (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  nivel       text        not null default 'error',
  origen      text        not null default 'api',
  mensaje     text        not null,
  detalle     jsonb,
  metodo      text,
  ruta        text,
  status      int,
  request_id  text,
  user_agent  text,

  constraint logs_nivel       check (nivel in ('error','warn','info')),
  constraint logs_origen      check (origen in ('api','frontend','sistema')),
  constraint logs_mensaje_len check (char_length(mensaje) <= 2000)
);

comment on table public.logs is 'Errores y advertencias de la API y del frontend.';

create index if not exists logs_created_at_idx on public.logs (created_at desc);
create index if not exists logs_nivel_idx      on public.logs (nivel);
create index if not exists logs_request_id_idx on public.logs (request_id);
