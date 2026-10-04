# Control de Gastos

Aplicación web para llevar el control de gastos a partir de facturas, con CRUD de proveedores y categorías, un tablero de indicadores y un registro de errores.
Corre en **Cloudflare Workers** (API + frontend estático) y guarda los datos en **Supabase** (PostgreSQL).

Viene configurada para **Argentina**: pesos (ARS), formato `es-AR`, hora de Buenos Aires, CUIT, facturas A/B/C/M/E y alícuotas de IVA del 21 %, 10,5 % y 27 %.

- **Facturas**: formulario de carga con proveedor, tipo y número de comprobante, cálculo automático de IVA y total, importes en formato argentino (`1.234,56`) y validación en el navegador y en el servidor; listado con búsqueda, filtros y paginación; edición y eliminación.
- **Proveedores**: CRUD con razón social, CUIT validado, condición frente al IVA, tipo de factura habitual y categoría por defecto (se sugieren al cargar una factura). También se pueden crear al vuelo desde el formulario de facturas.
- **Categorías**: CRUD completo con color, presupuesto mensual y estado activa/inactiva.
- **Tablero**: total de facturas cargadas, gasto del mes a la fecha y otros indicadores (ver [Indicadores](#indicadores-del-tablero)).
- **Configuración**: estado del sistema (conexión con Supabase, variables configuradas, datos regionales) y un **visor de logs** con los errores de la API y del navegador (ver [Configuración y registro de errores](#configuración-y-registro-de-errores)).
- Interfaz en tonos azul y blanco hecha con Tailwind CSS. No necesita build: es HTML + JS vanilla.

---

## Tabla de contenido

1. [Arquitectura](#arquitectura)
2. [Estructura del proyecto](#estructura-del-proyecto)
3. [Requisitos](#requisitos)
4. [1. Configurar Supabase](#1-configurar-supabase)
5. [2. Configurar el proyecto en local](#2-configurar-el-proyecto-en-local)
6. [3. Datos de prueba y reinicio de la BD](#3-datos-de-prueba-y-reinicio-de-la-bd)
7. [4. Desplegar en Cloudflare Workers](#4-desplegar-en-cloudflare-workers)
8. [Variables de configuración](#variables-de-configuración)
9. [Modelo de datos](#modelo-de-datos)
10. [Facturas, IVA y CUIT](#facturas-iva-y-cuit)
11. [Indicadores del tablero](#indicadores-del-tablero)
12. [Configuración y registro de errores](#configuración-y-registro-de-errores)
13. [API REST](#api-rest)
14. [Seguridad](#seguridad)
15. [Personalización](#personalización)
16. [Solución de problemas](#solución-de-problemas)

---

## Arquitectura

```
┌──────────────┐   HTTPS    ┌───────────────────────────────┐   HTTPS (llave secreta)   ┌──────────────┐
│  Navegador   │ ─────────► │  Cloudflare Worker            │ ─────────────────────────► │   Supabase   │
│ (HTML + JS)  │ ◄───────── │  • /api/*  → API REST (Node)  │ ◄───────────────────────── │  PostgreSQL  │
└──────────────┘            │  • /*      → public/ (assets) │                            └──────────────┘
                            └───────────────────────────────┘
```

- El **navegador nunca se conecta directo a Supabase**: todas las operaciones pasan por la API del Worker.
- El Worker usa la **llave secreta** de Supabase (`sb_secret_…` o la `service_role` legacy), guardada como *secret* de Cloudflare.
- Las tablas tienen **RLS activado sin políticas**: aunque alguien consiga la llave pública, no puede leer ni escribir nada.
- Si definís `BASIC_AUTH_USER` y `BASIC_AUTH_PASS`, el Worker protege **toda** la app (frontend y API) con usuario y contraseña.

**Stack:** Cloudflare Workers con Static Assets · `@supabase/supabase-js` v2 · Tailwind CSS (Play CDN) · Chart.js · JavaScript ES Modules · Wrangler 4.

---

## Estructura del proyecto

```
control-gastos-ejemplo/
├── public/                     # Frontend estático (lo sirve el Worker)
│   ├── index.html              # Layout, vistas y formularios (Tailwind)
│   └── js/                     # Módulos ES del frontend (sin build)
│       ├── app.js              # Arranque y navegación por hash
│       ├── core.js             # Estado, API, formato es-AR, toasts y captura de errores
│       ├── dashboard.js        # Tablero
│       ├── facturas.js         # Formulario y listado de facturas
│       ├── proveedores.js      # CRUD de proveedores y alta rápida
│       ├── categorias.js       # CRUD de categorías
│       └── configuracion.js    # Estado del sistema y visor de logs
├── src/                        # Código del Worker
│   ├── index.js                # Entrada: router, Basic Auth, request id y registro de errores
│   ├── handlers/
│   │   ├── categorias.js       # CRUD de categorías
│   │   ├── proveedores.js      # CRUD de proveedores
│   │   ├── facturas.js         # CRUD y listado filtrado de facturas
│   │   ├── logs.js             # Consulta, alta (desde el navegador) y limpieza de logs
│   │   ├── sistema.js          # Estado del sistema (/api/estado)
│   │   └── dashboard.js        # Resumen del tablero y /api/config
│   └── lib/
│       ├── http.js             # Respuestas JSON y traducción de errores de Postgres por campo
│       ├── logger.js           # Escritura de logs en Supabase (sin bloquear la respuesta)
│       ├── supabase.js         # Cliente de Supabase
│       └── validate.js         # Validación de datos (incluye CUIT e importes es-AR)
├── supabase/sql/               # Scripts SQL (ejecutar en orden)
│   ├── 01_esquema.sql          # Tablas, restricciones, índices, triggers, cuit_valido() y migración
│   ├── 02_vistas_funciones.sql # Vistas v_categorias/v_proveedores, RPC dashboard_resumen y reset_datos
│   ├── 03_seguridad.sql        # RLS y permisos
│   ├── 04_categorias_base.sql  # (opcional) 10 categorías iniciales con presupuesto en ARS
│   ├── 90_datos_prueba.sql     # (opcional) 23 proveedores y 100 facturas de prueba en SQL puro
│   └── 99_reiniciar.sql        # Borra todos los datos y reinicia los ids
├── scripts/
│   ├── seed.mjs                # Carga proveedores y facturas de prueba (100 por defecto)
│   └── reset.mjs               # Limpia la base de datos
├── .dev.vars.example           # Plantilla de variables locales y secretas (sin valores reales)
├── wrangler.toml               # Configuración del Worker (sin secretos)
└── package.json
```

---

## Requisitos

| Herramienta | Versión | Para qué |
|---|---|---|
| [Node.js](https://nodejs.org) | **20.6 o superior** (se usa `--env-file`) | Wrangler y scripts |
| Cuenta de [Supabase](https://supabase.com) | alcanza con el plan gratuito | Base de datos |
| Cuenta de [Cloudflare](https://dash.cloudflare.com) | alcanza con el plan gratuito | Hosting del Worker |

Instalá las dependencias:

```bash
npm install
```

> Si usás npm 11 o superior y te avisa que bloqueó *install scripts* de `esbuild` o `workerd`, normalmente no pasa nada: los binarios vienen en paquetes opcionales. Si `wrangler dev` falla, aprobalos (`npm install-scripts approve esbuild workerd` o el equivalente de tu versión de npm) y reinstalá.

---

## 1. Configurar Supabase

1. Creá un proyecto nuevo en <https://supabase.com/dashboard>. Te conviene elegir la región **São Paulo (sa-east-1)**, que es la más cercana a Buenos Aires.
2. Abrí **SQL Editor → New query** y ejecutá, **en este orden**, el contenido de:
   1. `supabase/sql/01_esquema.sql`
   2. `supabase/sql/02_vistas_funciones.sql`
   3. `supabase/sql/03_seguridad.sql`
   4. *(opcional)* `supabase/sql/04_categorias_base.sql`, para arrancar con 10 categorías

   Los scripts se pueden volver a ejecutar sin problema (usan `if not exists`, `create or replace` y `on conflict`).

   > **¿Ya tenías instalada una versión anterior?** Volvé a ejecutar `01 → 02 → 03`. El script `01` detecta la estructura vieja y la actualiza solo: crea las tablas `proveedores` y `logs`, genera un proveedor por cada razón social distinta de tus facturas existentes, las vincula y ajusta la restricción de comprobante duplicado. No se pierde ningún dato.

   Con `psql` también funciona:

   ```bash
   psql "$DATABASE_URL" -f supabase/sql/01_esquema.sql \
                        -f supabase/sql/02_vistas_funciones.sql \
                        -f supabase/sql/03_seguridad.sql \
                        -f supabase/sql/04_categorias_base.sql
   ```

3. Copiá las credenciales:
   - **Project URL**: *Project Settings → Data API* (`https://xxxx.supabase.co`).
   - **Llave secreta**: *Project Settings → API Keys*. Usá la **secret key** (`sb_secret_…`) o, en proyectos con llaves *legacy*, la `service_role`.

> ⚠️ La llave secreta tiene acceso total a la base de datos. **Nunca** la pongas en el frontend ni la subas al repositorio.

---

## 2. Configurar el proyecto en local

1. Creá el archivo de variables locales a partir de la plantilla:

   ```bash
   cp .dev.vars.example .dev.vars
   ```

2. Completá `.dev.vars`:

   ```ini
   SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxxxxxxxxxxxxxx
   # Opcional: protege la app con usuario/contraseña
   BASIC_AUTH_USER=admin
   BASIC_AUTH_PASS=una-contraseña-larga
   ```

   `.dev.vars` está en `.gitignore`. Lo usan tanto `wrangler dev` como los scripts de datos.

3. Levantá el servidor de desarrollo:

   ```bash
   npm run dev
   ```

   Abrí <http://localhost:8787>.

Para comprobar que el Worker compila sin desplegarlo:

```bash
npm run check     # wrangler deploy --dry-run
```

---

## 3. Datos de prueba y reinicio de la BD

Hay dos opciones equivalentes: scripts de Node (usan `.dev.vars`) o SQL para pegar en el SQL Editor.

### Cargar datos de prueba

| Opción | Comando / archivo | Qué hace |
| --- | --- | --- |
| Node | `npm run db:seed` | Crea las 10 categorías base y los 23 proveedores de prueba si no existen, y carga **100 facturas** |
| Node | `npm run db:seed -- 300` | Igual, pero con 300 facturas (máximo 5000) |
| SQL | `supabase/sql/90_datos_prueba.sql` | Lo mismo, en SQL puro |

Cómo se generan los datos:

- 23 proveedores **ficticios** con CUIT inventados (marcados con la nota "Proveedor de prueba"), con su condición frente al IVA, tipo de factura y categoría por defecto. Los CUIT tienen dígito verificador válido, pero no corresponden a contribuyentes reales.
- Montos en pesos, con un rango propio para cada proveedor.
- Mezcla de **facturas A** (IVA 21 %, 27 % en servicios públicos y telecomunicaciones, 10,5 % en pasajes), **B** (gastronomía) y **C** (monotributistas). Las B y C no discriminan IVA.
- Alrededor del 25 % cae en el **mes en curso** (hora de Buenos Aires) y el resto en los 5 meses anteriores, para que el tablero y el gráfico tengan datos.
- 80 % pagadas, 15 % pendientes y 5 % anuladas.
- Todos los números de comprobante empiezan con **`DEMO-`** (por ejemplo, `DEMO-00003-00012345`), así se pueden borrar solo los datos de prueba.

Podés correr el seed varias veces: cada corrida agrega más facturas.

### Limpiar la base de datos

| Opción | Comando / archivo | Qué hace |
| --- | --- | --- |
| Node | `npm run db:reset` | ⚠️ Borra **todas** las facturas, proveedores, categorías y logs, y reinicia los ids. Pide que escribas `si` para confirmar |
| Node | `npm run db:reset -- --yes` | Igual, sin pedir confirmación (útil en CI) |
| Node | `npm run db:reset:demo` | Borra **solo** las facturas `DEMO-*` y los proveedores de prueba que quedaron sin facturas; conserva lo tuyo |
| SQL | `supabase/sql/99_reiniciar.sql` | `TRUNCATE … RESTART IDENTITY`. Trae comentado cómo eliminar también la estructura |

El reset no toca la estructura (tablas, vistas, funciones ni RLS): después podés volver a correr `db:seed` o empezar a cargar desde cero.

---

## 4. Desplegar en Cloudflare Workers

1. Iniciá sesión en Cloudflare:

   ```bash
   npx wrangler login
   ```

2. Cargá los secretos de producción (te pide cada valor por consola, así no quedan en ningún archivo):

   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   # Opcionales (recomendados):
   npx wrangler secret put BASIC_AUTH_USER
   npx wrangler secret put BASIC_AUTH_PASS
   ```

3. Desplegá:

   ```bash
   npm run deploy
   ```

   Wrangler te devuelve la URL, del tipo `https://control-gastos.<tu-subdominio>.workers.dev`.

4. *(Opcional)* Para usar un dominio propio: en el panel de Cloudflare andá a **Workers & Pages → control-gastos → Settings → Domains & Routes → Add Custom Domain**.

Los errores quedan en **Configuración → Registro de errores**. Si Supabase no responde (y por lo tanto no se pueden guardar ahí), igual se ven en vivo con `npx wrangler tail`; la observabilidad ya viene activada en `wrangler.toml`.

### Despliegue continuo (opcional)

Podés conectar el repo en **Workers & Pages → Create → Import a repository** (Workers Builds), con el comando de build vacío y `npx wrangler deploy` como comando de despliegue. Los secretos se configuran una sola vez en el panel.

---

## Variables de configuración

| Variable | Tipo | Dónde se define | Valor por defecto | Descripción |
|---|---|---|---|---|
| `SUPABASE_URL` | secreto | `.dev.vars` / `wrangler secret` | — | URL del proyecto de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | secreto | `.dev.vars` / `wrangler secret` | — | Llave secreta de Supabase |
| `BASIC_AUTH_USER` | secreto | `.dev.vars` / `wrangler secret` | vacío | Usuario de Basic Auth (opcional) |
| `BASIC_AUTH_PASS` | secreto | `.dev.vars` / `wrangler secret` | vacío | Contraseña de Basic Auth (opcional) |
| `APP_TIMEZONE` | var | `wrangler.toml` | `America/Argentina/Buenos_Aires` | Zona horaria con la que se calcula "hoy" y el mes en curso |
| `APP_LOCALE` | var | `wrangler.toml` | `es-AR` | Formato de números (`$ 1.234,56`) y fechas (`dd/mm/aaaa`) |
| `APP_CURRENCY` | var | `wrangler.toml` | `ARS` | Moneda (código ISO 4217) |
| `APP_IVA` | var | `wrangler.toml` | `0.21` | Alícuota de IVA preseleccionada en el formulario |

> En `wrangler.toml` solo hay valores públicos. Los secretos **nunca** van en ese archivo: se cargan con `wrangler secret put` o en `.dev.vars`, que está ignorado por git.

---

## Modelo de datos

### `categorias`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | bigint identity | PK |
| `nombre` | text | Único, de 2 a 80 caracteres |
| `descripcion` | text | Opcional, ≤ 300 caracteres |
| `color` | text | Hex `#RRGGBB` |
| `presupuesto_mensual` | numeric(14,2) | Opcional, ≥ 0, en pesos |
| `activa` | boolean | Las inactivas no aparecen al cargar facturas |
| `created_at` / `updated_at` | timestamptz | `updated_at` lo mantiene un trigger |

### `proveedores`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | bigint identity | PK |
| `razon_social` | text | Única, de 2 a 150 caracteres |
| `cuit` | text | Opcional y único. 11 dígitos sin guiones, validado por `cuit_valido()` |
| `condicion_iva` | text | `responsable_inscripto`, `monotributista`, `exento`, `no_alcanzado` o `exterior` |
| `tipo_comprobante` | text | Factura habitual (`A`…`E`), opcional. Se preselecciona al cargar una factura |
| `categoria_id` | bigint | Categoría por defecto, opcional (FK con `ON DELETE SET NULL`) |
| `email`, `telefono`, `notas` | text | Opcionales |
| `activo` | boolean | Los inactivos no aparecen al cargar facturas nuevas |

### `facturas`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | bigint identity | PK |
| `tipo_comprobante` | text | `A`, `B`, `C`, `M` o `E` |
| `numero_comprobante` | text | Punto de venta y número, por ejemplo `00003-00012345` |
| `proveedor_id` | bigint | FK a `proveedores` con `ON DELETE RESTRICT` |
| `proveedor`, `cuit_proveedor` | text | Copia de la razón social y el CUIT del emisor **al momento de la carga** (los completa el Worker; si después editás el proveedor, la factura conserva los datos con que se emitió) |
| `fecha` | date | Fecha de emisión |
| `categoria_id` | bigint | FK a `categorias` con `ON DELETE RESTRICT` |
| `subtotal` | numeric(14,2) | Neto gravado (o el importe total en facturas B/C) |
| `impuestos` | numeric(14,2) | IVA discriminado más percepciones |
| `total` | numeric(14,2) | **Columna generada**: `subtotal + impuestos` |
| `metodo_pago` | text | `transferencia`, `tarjeta_credito`, `tarjeta_debito`, `efectivo`, `cheque` (incluye eCheq) o `billetera_virtual` |
| `estado` | text | `pagada`, `pendiente` o `cancelada` (anulada) |
| `notas` | text | Opcional, ≤ 500 caracteres |

Restricción de unicidad: `(proveedor_id, tipo_comprobante, numero_comprobante)`. Evita cargar dos veces el mismo comprobante.

### `logs`

| Columna | Tipo | Notas |
|---|---|---|
| `created_at` | timestamptz | Momento del error |
| `nivel` | text | `error` (5xx, excepciones), `warn` (datos inválidos, duplicados) o `info` |
| `origen` | text | `api` (Worker), `frontend` (navegador) o `sistema` |
| `mensaje` | text | Mensaje legible |
| `detalle` | jsonb | Error original de Postgres (código, detalle, hint), stack y el cuerpo enviado |
| `metodo`, `ruta`, `status` | | Petición que falló |
| `request_id` | text | Código de seguimiento; es el mismo que ve el usuario en el aviso de error |
| `user_agent` | text | Navegador |

### Objetos adicionales

- **`cuit_valido(text)`**: valida el CUIT/CUIL (11 dígitos + dígito verificador módulo 11).
- **`v_categorias`** / **`v_proveedores`** (vistas): con su número de facturas, gasto histórico y (en proveedores) la fecha de la última factura.
- **`dashboard_resumen(p_hoy date)`** (RPC): devuelve en un solo JSON todos los datos del tablero.
- **`reset_datos()`** (RPC): vacía las tablas y reinicia los ids. Solo la puede ejecutar `service_role`.

---

## Facturas, IVA y CUIT

- **Proveedor**: se elige de la lista (o se crea con **+ Nuevo proveedor** sin salir del formulario). En una factura nueva, el formulario sugiere el tipo de factura habitual y la categoría por defecto del proveedor.
- **Número de comprobante**: si escribís `3-12345` se completa a `00003-00012345`.
- **Importes**: se escriben como en Argentina (`150.000,50`); también se acepta el punto decimal (`150000.50`). Al salir del campo se formatean.
- **Validación**: el navegador marca cada campo con problemas antes de enviar; el Worker vuelve a validar todo y, si la base rechaza algo (por ejemplo, un comprobante duplicado), el error vuelve **asociado al campo** correspondiente. El botón de guardar se bloquea mientras se envía, para evitar cargas dobles.

- **Tipo de comprobante**: al elegir **A** o **M**, el formulario calcula el IVA con la alícuota seleccionada. Con **B**, **C** o **E**, el IVA pasa a "Exento / no discrimina" (impuestos en 0) y el importe completo va en *subtotal*.
- **Alícuota**: 21 % (por defecto), 10,5 %, 27 %, exento o **manual**. Si editás el campo de impuestos a mano (por ejemplo, para sumar percepciones de IVA o IIBB), la alícuota pasa sola a "Manual" y deja de recalcularse.
- **CUIT**: se puede escribir con o sin guiones (`30-71234560-4` o `30712345604`). Se guarda sin guiones y se valida el dígito verificador en el frontend, en el Worker y en la base de datos.
- Al editar una factura, el formulario deduce la alícuota a partir de los importes guardados. Si no coincide con ninguna, queda en "Manual".

---

## Indicadores del tablero

Ningún monto incluye las facturas anuladas (estado `cancelada`). El "mes en curso" se calcula con la hora de Buenos Aires (`APP_TIMEZONE`).

| Indicador | Cálculo |
|---|---|
| **Facturas registradas** | Total histórico de facturas y cuántas van en el mes |
| **Gasto del mes a la fecha** | Suma de `total` del día 1 a hoy. Muestra la variación % contra el **mismo período del mes anterior** (del 1 al mismo día) para comparar en igualdad de condiciones |
| **Proyección al cierre del mes** | `gasto a la fecha ÷ días transcurridos × días del mes`, comparado contra el total del mes anterior |
| **Pendientes de pago** | Monto y cantidad de facturas en estado `pendiente` (de cualquier fecha) |
| **Ticket promedio del mes** | Gasto del mes ÷ facturas del mes |
| **Categoría con mayor gasto** | La categoría que más gastó en el mes y qué % del total representa |
| **Gráfico de gasto mensual** | Barras de los últimos 6 meses. El mes actual va resaltado y llega solo hasta hoy |
| **Presupuesto por categoría** | Barra de avance gasto/presupuesto: azul < 80 %, ámbar 80–100 %, rojo si se pasa del presupuesto |
| **Top proveedores del mes** | Los 5 proveedores con más gasto en el mes |
| **Últimas facturas cargadas** | Las 5 más recientes por fecha de carga |

Como el contexto es inflacionario, conviene leer las comparaciones contra el mes anterior teniendo en cuenta la variación de precios. Ajustá los presupuestos de las categorías cada tanto.

---

## Configuración y registro de errores

La opción **Configuración** del menú tiene dos paneles:

**Estado del sistema**
- Conexión con Supabase y latencia, con la cantidad de registros de cada tabla. Si falta ejecutar algún SQL, lo indica.
- Si las variables secretas están definidas (nunca muestra su valor) y si Basic Auth está activa.
- Zona horaria, moneda, formato, IVA por defecto y versión.

**Registro de errores (visor de logs)**
- Lista los errores de la **API** (todas las respuestas 4xx y 5xx, salvo rutas inexistentes) y del **navegador** (excepciones de JavaScript y fallas de red).
- Tarjetas con los errores y advertencias de las últimas 24 h; filtros por nivel, origen y texto (mensaje, ruta o código).
- Al hacer clic en una fila se ve el detalle técnico: el error original de Postgres, el stack y **los datos que se intentaron guardar**. Así se puede diagnosticar, por ejemplo, por qué falló la carga de una factura.
- Actualización automática cada 15 s (opcional), botón para registrar un evento de prueba, borrar los registros de más de 30 días o vaciar todo.
- Cada respuesta de error de la API trae un `request_id`. Los errores 5xx lo muestran en el aviso ("Código a1b2c3d4"); buscándolo en el visor encontrás el detalle exacto.

Los logs se escriben **sin demorar la respuesta** (`ctx.waitUntil`). El navegador limita sus envíos a 10 por minuto e ignora repetidos.

---

## API REST

Todas las rutas devuelven JSON. Si activás Basic Auth, también la requieren.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/config` | Moneda, locale, zona horaria, alícuota de IVA y fecha de hoy |
| `GET` | `/api/estado` | Estado del sistema (conexión, variables definidas, conteos) |
| `GET` | `/api/dashboard` | Resumen del tablero |
| `GET` | `/api/categorias` | Lista de categorías (incluye `facturas` y `gasto_total`) |
| `POST` | `/api/categorias` | Crea una categoría |
| `PUT` | `/api/categorias/:id` | Actualiza una categoría |
| `DELETE` | `/api/categorias/:id` | Elimina una categoría (responde `409` si tiene facturas) |
| `GET` | `/api/proveedores` | Lista de proveedores (incluye `facturas`, `gasto_total`, `ultima_factura`) |
| `GET` | `/api/proveedores/:id` | Detalle de un proveedor |
| `POST` | `/api/proveedores` | Crea un proveedor |
| `PUT` | `/api/proveedores/:id` | Actualiza un proveedor |
| `DELETE` | `/api/proveedores/:id` | Elimina un proveedor (responde `409` si tiene facturas) |
| `GET` | `/api/facturas` | Lista paginada con filtros |
| `GET` | `/api/facturas/:id` | Detalle de una factura |
| `POST` | `/api/facturas` | Crea una factura |
| `PUT` | `/api/facturas/:id` | Actualiza una factura |
| `DELETE` | `/api/facturas/:id` | Elimina una factura |
| `GET` | `/api/logs` | Logs paginados. Filtros: `nivel`, `origen`, `q`, `page`, `page_size` (máx. 200) |
| `POST` | `/api/logs` | Registra un error del navegador (`{ nivel, mensaje, detalle, ruta }`) |
| `DELETE` | `/api/logs?antiguedad_dias=30` | Borra los logs de más de N días (`?todo=1` vacía la tabla) |

**Filtros de `GET /api/facturas`:** `q` (busca en proveedor, número de comprobante o CUIT, con o sin guiones), `proveedor_id`, `categoria_id`, `estado`, `desde`, `hasta` (`AAAA-MM-DD`), `page` (por defecto 1) y `page_size` (por defecto 15, máximo 100).

Respuesta:

```json
{ "data": [ { "id": 1, "tipo_comprobante": "A", "numero_comprobante": "00003-00012345", "total": 121000,
              "categoria": { "id": 1, "nombre": "Librería y oficina", "color": "#1d4ed8" }, "…": "…" } ],
  "total": 100, "page": 1, "page_size": 15 }
```

**Ejemplo para cargar una factura:**

```bash
curl -X POST https://control-gastos.<subdominio>.workers.dev/api/facturas \
  -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASS" \
  -H "content-type: application/json" \
  -d '{
    "tipo_comprobante": "A",
    "numero_comprobante": "00003-00012345",
    "proveedor_id": 1,
    "fecha": "2026-10-04",
    "categoria_id": 1,
    "subtotal": 100000,
    "impuestos": 21000,
    "metodo_pago": "transferencia",
    "estado": "pagada",
    "notas": "Resmas y tóner"
  }'
```

La razón social y el CUIT del emisor no se envían: el Worker los toma del proveedor. Los importes pueden ir como número (`100000.5`) o como texto en formato argentino (`"100.000,50"`).

**Errores:** `{ "error": "mensaje", "details": { "campo": "mensaje" } | null, "request_id": "a1b2c3d4" }` (el `request_id` también viaja en el encabezado `X-Request-Id`).

| Código | Cuándo |
|---|---|
| `400` | JSON inválido o id mal formado |
| `401` | Falta Basic Auth o es incorrecta |
| `404` | Ruta o registro inexistente |
| `405` | Método no permitido en esa ruta |
| `409` | Comprobante duplicado (mismo proveedor, tipo y número), razón social/CUIT/nombre de categoría repetido, o proveedor/categoría con facturas |
| `413` | Cuerpo de la petición de más de 64 KB |
| `422` | Validación fallida (CUIT inválido, proveedor inexistente o inactivo, importe inválido…). `details` trae el mensaje de cada campo |
| `500` | Error de configuración o de la base de datos |

---

## Seguridad

Este repositorio es **público** y **no contiene credenciales**:

- `wrangler.toml` solo tiene valores no sensibles (zona horaria, moneda, locale, IVA).
- `.dev.vars.example` tiene únicamente marcadores (`xxxx`). El `.dev.vars` real está en `.gitignore`, igual que `.env*`, `.wrangler/` y `dist/`.
- En producción, los secretos se cargan con `wrangler secret put` y viven cifrados en Cloudflare.
- Los proveedores y CUIT de los datos de prueba son ficticios.

> Antes de cada commit, revisá con `git status` que no aparezca `.dev.vars`. Si alguna vez subís una llave por error, **rotala de inmediato** en Supabase (*Project Settings → API Keys*): borrarla del historial no alcanza.

Además:

- **Llave secreta solo en el servidor:** nunca llega al navegador.
- **RLS activado sin políticas**, con permisos revocados a `anon` y `authenticated`.
- **Validación doble:** en el Worker (`src/lib/validate.js`) y con restricciones `CHECK` en Postgres (incluido el CUIT).
- **Basic Auth opcional** con comparación en tiempo constante. **Activala en producción**: sin ella, cualquiera que tenga la URL puede ver y modificar los datos.
- El frontend escapa todo el contenido dinámico (contra XSS), y el Worker agrega los encabezados `X-Content-Type-Options`, `X-Frame-Options` y `Referrer-Policy`.
- Para varios usuarios con permisos distintos, el siguiente paso sería poner **Cloudflare Access** (Zero Trust) delante del Worker, o usar Supabase Auth con políticas RLS por usuario.

---

## Personalización

- **Otro país o moneda:** cambiá `APP_CURRENCY`, `APP_LOCALE`, `APP_TIMEZONE` y `APP_IVA` en `wrangler.toml`. Si no usás CUIT, quitá la restricción `facturas_cuit_valido` en SQL y la validación `esCuitValido` en `src/lib/validate.js`. Los tipos de comprobante están en `TIPOS_COMPROBANTE` y en la restricción `facturas_tipo`.
- **Alícuotas de IVA:** las opciones del selector están en `#f-alicuota` (`public/index.html`) y en `ALICUOTAS` (`public/js/facturas.js`).
- **Colores:** el frontend usa la paleta `blue`/`slate` de Tailwind. Cambiando `blue-700`/`blue-900` en `public/index.html` y `public/js/*.js` modificás el tono principal.
- **Tailwind en producción:** se usa el *Play CDN* para no necesitar build, por eso aparece un aviso en la consola del navegador. Si querés CSS optimizado, compilalo con la CLI de Tailwind (`npx tailwindcss -o public/styles.css --minify`, con `content: ['./public/**/*.{html,js}']` y el plugin `@tailwindcss/forms`) y reemplazá el `<script src="https://cdn.tailwindcss.com…">` por `<link rel="stylesheet" href="/styles.css">`.
- **Más campos en facturas:** agregá la columna en `01_esquema.sql`, la validación en `validarFactura()` (`src/lib/validate.js`), el input en el formulario de `index.html` y su lectura en `leerYValidar()`/`editar()` de `public/js/facturas.js`.

---

## Solución de problemas

| Síntoma | Causa probable / solución |
|---|---|
| `Configuración incompleta: faltan SUPABASE_URL…` | Falta `.dev.vars` en local o no ejecutaste `wrangler secret put` en producción |
| `Could not find the table 'public.facturas'` / `PGRST205` | No ejecutaste los SQL, o Supabase todavía no recargó el esquema. En el SQL Editor corré `notify pgrst, 'reload schema';` |
| `La base de datos no tiene la estructura esperada…` o `column … does not exist` | El esquema es de una versión anterior. Volvé a ejecutar `01 → 02 → 03` (se actualiza sin perder datos). Si la tabla viene de la versión con RFC/folio (México), ejecutá `99_reiniciar.sql` con la sección de `drop` descomentada y reinstalá desde `01` |
| No puedo guardar una factura | Mirá el campo marcado en rojo. Si el aviso trae un código, buscalo en **Configuración → Registro de errores**: el detalle muestra el error exacto y los datos enviados |
| El proveedor no aparece al cargar una factura | Está inactivo: activalo en **Proveedores** |
| `permission denied for table …` | Estás usando la llave pública (`anon` / `sb_publishable_…`) en lugar de la secreta |
| `node: .dev.vars: not found` al correr `db:seed` | Creá `.dev.vars` (ver [paso 2](#2-configurar-el-proyecto-en-local)) o actualizá Node a ≥ 20.6 |
| "CUIT inválido" con un CUIT real | Revisá que tenga 11 dígitos. El dígito verificador se calcula con el algoritmo módulo 11 de AFIP/ARCA |
| No se puede eliminar una categoría o un proveedor | Tiene facturas asociadas: desactivalo o reasigná sus facturas |
| El gasto del mes no incluye una factura de hoy | Revisá que `APP_TIMEZONE` sea `America/Argentina/Buenos_Aires` y que la factura no esté anulada |
| El navegador pide usuario y contraseña | Definiste `BASIC_AUTH_USER`/`BASIC_AUTH_PASS`. Para quitarlos: `npx wrangler secret delete …` |

---

## Licencia

Ver [LICENSE](LICENSE).
