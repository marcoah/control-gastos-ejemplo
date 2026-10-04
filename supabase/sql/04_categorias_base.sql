-- =====================================================================
-- 04_categorias_base.sql  (opcional)
-- Catálogo inicial de categorías con presupuesto mensual en pesos (ARS).
-- No duplica si ya existen.
-- =====================================================================

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
