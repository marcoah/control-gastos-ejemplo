-- =====================================================================
-- 90_datos_prueba.sql
-- Inserta 100 facturas de prueba (número de comprobante con prefijo DEMO-).
--   * ~25 facturas en el mes en curso y ~75 repartidas en los 5 meses previos
--   * 80% pagadas, 15% pendientes, 5% canceladas
--   * Montos en pesos (ARS); IVA 21%, 27% (servicios) o 10,5% (pasajes);
--     las facturas B y C no discriminan IVA (impuestos = 0)
-- Los proveedores y CUIT son FICTICIOS (los CUIT tienen dígito
-- verificador válido, pero no corresponden a contribuyentes reales).
-- Equivalente SQL de `npm run db:seed`. Se puede ejecutar varias veces.
-- =====================================================================

-- Garantiza que existan las categorías base
insert into public.categorias (nombre, descripcion, color, presupuesto_mensual) values
  ('Librería y oficina',        'Artículos de librería, insumos y mobiliario menor', '#1d4ed8',  800000),
  ('Servicios públicos',        'Luz, agua y gas',                                   '#0369a1',  700000),
  ('Telecomunicaciones',        'Internet, telefonía fija y celular',                '#0e7490',  350000),
  ('Software y suscripciones',  'Licencias, hosting, dominios y SaaS',               '#4338ca',  900000),
  ('Viáticos y viajes',         'Pasajes, hotelería, remises y peajes',              '#1e40af', 2000000),
  ('Alimentos',                 'Comidas de trabajo y cafetería',                    '#2563eb',  450000),
  ('Mantenimiento',             'Reparaciones, ferretería y limpieza',               '#334155',  700000),
  ('Publicidad y marketing',    'Pauta digital, diseño e imprenta',                  '#3b82f6', 1800000),
  ('Honorarios profesionales',  'Contador, abogados y consultoría',                  '#1e3a8a', 3000000),
  ('Combustible',               'Nafta y gasoil de vehículos',                       '#475569',  600000)
on conflict (nombre) do nothing;

with prov as (
  select row_number() over () as idx, v.*
  from (values
    -- proveedor,                                cuit,          categoría,                  tipo, alícuota, mín,     máx
    ('Librería Comercial Del Plata SRL',         '30712345604', 'Librería y oficina',       'A', 0.21,   15000,  350000),
    ('Insumos de Oficina Rivadavia SA',          '30712722912', 'Librería y oficina',       'A', 0.21,   25000,  480000),
    ('Distribuidora Eléctrica Metropolitana SA', '30713100222', 'Servicios públicos',       'A', 0.27,   80000,  420000),
    ('Aguas del Río Sur SA',                     '33713477538', 'Servicios públicos',       'A', 0.27,   25000,  110000),
    ('Gas Pampeano Distribuidora SA',            '30713854847', 'Servicios públicos',       'A', 0.27,   30000,  180000),
    ('Telecomunicaciones Australes SA',          '30714986771', 'Telecomunicaciones',       'A', 0.27,   45000,  160000),
    ('Conecta Fibra SRL',                        '30715364081', 'Telecomunicaciones',       'A', 0.27,   35000,  120000),
    ('Nube Austral Hosting SA',                  '30716496011', 'Software y suscripciones', 'A', 0.21,   40000,  650000),
    ('Software Andino SAS',                      '33716873329', 'Software y suscripciones', 'A', 0.21,   20000,  300000),
    ('Gestión Contable Online SA',               '30717250636', 'Software y suscripciones', 'A', 0.21,   30000,  180000),
    ('Aerolíneas del Cono Sur SA',               '30718382560', 'Viáticos y viajes',        'A', 0.105, 180000,  950000),
    ('Hotel Plaza de Mayo SA',                   '30718759877', 'Viáticos y viajes',        'A', 0.21,   90000,  450000),
    ('Remises San Telmo',                        '20714232151', 'Viáticos y viajes',        'C', 0,       8000,   45000),
    ('Café Palermo Viejo SRL',                   '30719137187', 'Alimentos',                'B', 0,       6000,   60000),
    ('Parrilla La Esquina SRL',                  '33719514494', 'Alimentos',                'B', 0,      25000,  220000),
    ('Limpieza Integral Belgrano SRL',           '30719891809', 'Mantenimiento',            'A', 0.21,   90000,  450000),
    ('Ferretería Caballito SA',                  '30721023733', 'Mantenimiento',            'A', 0.21,   10000,  280000),
    ('Agencia Digital Obelisco SAS',             '30721401045', 'Publicidad y marketing',   'A', 0.21,  150000, 1200000),
    ('Imprenta Gráfica Barracas SRL',            '30721778351', 'Publicidad y marketing',   'A', 0.21,   60000,  520000),
    ('Diseño Gráfico M. López',                  '27718005251', 'Publicidad y marketing',   'C', 0,      80000,  400000),
    ('Estudio Contable Fernández',               '27714609462', 'Honorarios profesionales', 'C', 0,     350000, 1400000),
    ('Estudio Jurídico Gómez & Asoc.',           '33722155667', 'Honorarios profesionales', 'A', 0.21,  400000, 1800000),
    ('Estación de Servicio Avenida SA',          '30722532976', 'Combustible',              'A', 0.21,   40000,  180000)
  ) as v(proveedor, cuit, categoria, tipo, alicuota, min_monto, max_monto)
),
gen as (
  select
    g,
    1 + floor(random() * (select count(*) from prov))::int as pick,
    case
      when g <= 25 then date_trunc('month', current_date)::date
                        + floor(random() * extract(day from current_date))::int
      else current_date - (extract(day from current_date)::int + floor(random() * 150)::int)
    end as fecha,
    random() as r_monto,
    random() as r_estado,
    random() as r_metodo,
    lpad((1 + floor(random() * 5))::int::text, 5, '0')          as punto_venta,
    lpad((1 + floor(random() * 99999999))::int::text, 8, '0')   as numero
  from generate_series(1, 100) as g
),
filas as (
  select
    gen.*,
    p.proveedor, p.cuit, p.categoria, p.tipo, p.alicuota,
    round((p.min_monto + gen.r_monto * (p.max_monto - p.min_monto))::numeric, 2) as subtotal
  from gen
  join prov p on p.idx = gen.pick
)
insert into public.facturas
  (tipo_comprobante, numero_comprobante, proveedor, cuit_proveedor, fecha, categoria_id,
   subtotal, impuestos, metodo_pago, estado, notas)
select
  f.tipo,
  'DEMO-' || f.punto_venta || '-' || f.numero,
  f.proveedor,
  f.cuit,
  f.fecha,
  c.id,
  f.subtotal,
  round(f.subtotal * f.alicuota, 2),
  (array['transferencia','transferencia','tarjeta_credito','tarjeta_debito','efectivo','cheque','billetera_virtual'])[1 + floor(f.r_metodo * 7)::int],
  case when f.r_estado < 0.80 then 'pagada'
       when f.r_estado < 0.95 then 'pendiente'
       else 'cancelada' end,
  'Registro de prueba'
from filas f
join public.categorias c on c.nombre = f.categoria
on conflict (proveedor, tipo_comprobante, numero_comprobante) do nothing;

select count(*) as facturas_demo from public.facturas where numero_comprobante like 'DEMO-%';
