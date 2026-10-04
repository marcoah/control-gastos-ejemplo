# Control de Gastos

Aplicación web para llevar el control de gastos a partir de facturas, con un CRUD de categorías y un tablero de indicadores.
Corre en **Cloudflare Workers** (API + frontend estático) y guarda los datos en **Supabase** (PostgreSQL).

Viene configurada para **Argentina**: pesos (ARS), formato `es-AR`, hora de Buenos Aires, CUIT, facturas A/B/C/M/E y alícuotas de IVA del 21 %, 10,5 % y 27 %.

- **Facturas**: formulario de carga con tipo y número de comprobante, CUIT validado, cálculo automático de IVA y total; listado con búsqueda, filtros y paginación; edición y eliminación.
- **Categorías**: CRUD completo con color, presupuesto mensual y estado activa/inactiva.
- **Tablero**: total de facturas cargadas, gasto del mes a la fecha y otros indicadores (ver [Indicadores](#indicadores-del-tablero)).
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
12. [API REST](#api-rest)
13. [Seguridad](#seguridad)
14. [Personalización](#personalización)
15. [Solución de problemas](#solución-de-problemas)

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
│   └── app.js                  # Lógica del frontend (SPA con rutas por hash)
├── src/                        # Código del Worker
│   ├── index.js                # Entrada: router, Basic Auth y entrega de assets
│   ├── handlers/
│   │   ├── categorias.js       # CRUD de categorías
│   │   ├── facturas.js         # CRUD y listado filtrado de facturas
│   │   └── dashboard.js        # Resumen del tablero y /api/config
│   └── lib/
│       ├── http.js             # Respuestas JSON y traducción de errores de Postgres
│       ├── supabase.js         # Cliente de Supabase
│       └── validate.js         # Validación de datos (incluye CUIT)
├── supabase/sql/               # Scripts SQL (ejecutar en orden)
│   ├── 01_esquema.sql          # Tablas, restricciones, índices, triggers y cuit_valido()
│   ├── 02_vistas_funciones.sql # Vista v_categorias, RPC dashboard_resumen y reset_datos
│   ├── 03_seguridad.sql        # RLS y permisos
│   ├── 04_categorias_base.sql  # (opcional) 10 categorías iniciales con presupuesto en ARS
│   ├── 90_datos_prueba.sql     # (opcional) 100 facturas de prueba en SQL puro
│   └── 99_reiniciar.sql        # Borra todos los datos y reinicia los ids
├── scripts/
│   ├── seed.mjs                # Carga facturas de prueba (100 por defecto)
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
| Node | `npm run db:seed` | Crea las 10 categorías base si no existen y carga **100 facturas** |
| Node | `npm run db:seed -- 300` | Igual, pero con 300 facturas (máximo 5000) |
| SQL | `supabase/sql/90_datos_prueba.sql` | Lo mismo, en SQL puro |

Cómo se generan los datos:

- 23 proveedores **ficticios** con CUIT inventados. Los CUIT tienen dígito verificador válido, pero no corresponden a contribuyentes reales.
- Montos en pesos, con un rango propio para cada proveedor.
- Mezcla de **facturas A** (IVA 21 %, 27 % en servicios públicos y telecomunicaciones, 10,5 % en pasajes), **B** (gastronomía) y **C** (monotributistas). Las B y C no discriminan IVA.
- Alrededor del 25 % cae en el **mes en curso** (hora de Buenos Aires) y el resto en los 5 meses anteriores, para que el tablero y el gráfico tengan datos.
- 80 % pagadas, 15 % pendientes y 5 % anuladas.
- Todos los números de comprobante empiezan con **`DEMO-`** (por ejemplo, `DEMO-00003-00012345`), así se pueden borrar solo los datos de prueba.

Podés correr el seed varias veces: cada corrida agrega más facturas.

### Limpiar la base de datos

| Opción | Comando / archivo | Qué hace |
| --- | --- | --- |
| Node | `npm run db:reset` | ⚠️ Borra **todas** las facturas y categorías y reinicia los ids. Pide que escribas `si` para confirmar |
| Node | `npm run db:reset -- --yes` | Igual, sin pedir confirmación (útil en CI) |
| Node | `npm run db:reset:demo` | Borra **solo** las facturas `DEMO-*` y conserva las tuyas |
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

Para ver los logs en vivo: `npx wrangler tail`. La observabilidad ya viene activada en `wrangler.toml`.

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

### `facturas`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | bigint identity | PK |
| `tipo_comprobante` | text | `A`, `B`, `C`, `M` o `E` |
| `numero_comprobante` | text | Punto de venta y número, por ejemplo `00003-00012345` |
| `proveedor` | text | Razón social, de 2 a 150 caracteres |
| `cuit_proveedor` | text | Opcional. 11 dígitos sin guiones, con dígito verificador validado por `cuit_valido()` |
| `fecha` | date | Fecha de emisión |
| `categoria_id` | bigint | FK a `categorias` con `ON DELETE RESTRICT` |
| `subtotal` | numeric(14,2) | Neto gravado (o el importe total en facturas B/C) |
| `impuestos` | numeric(14,2) | IVA discriminado más percepciones |
| `total` | numeric(14,2) | **Columna generada**: `subtotal + impuestos` |
| `metodo_pago` | text | `transferencia`, `tarjeta_credito`, `tarjeta_debito`, `efectivo`, `cheque` (incluye eCheq) o `billetera_virtual` |
| `estado` | text | `pagada`, `pendiente` o `cancelada` (anulada) |
| `notas` | text | Opcional, ≤ 500 caracteres |

Restricción de unicidad: `(proveedor, tipo_comprobante, numero_comprobante)`. Evita cargar dos veces el mismo comprobante.

### Objetos adicionales

- **`cuit_valido(text)`**: valida el CUIT/CUIL (11 dígitos + dígito verificador módulo 11).
- **`v_categorias`** (vista): categorías con su número de facturas y gasto histórico.
- **`dashboard_resumen(p_hoy date)`** (RPC): devuelve en un solo JSON todos los datos del tablero.
- **`reset_datos()`** (RPC): vacía las tablas y reinicia los ids. Solo la puede ejecutar `service_role`.

---

## Facturas, IVA y CUIT

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

## API REST

Todas las rutas devuelven JSON. Si activás Basic Auth, también la requieren.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/config` | Moneda, locale, zona horaria, alícuota de IVA y fecha de hoy |
| `GET` | `/api/dashboard` | Resumen del tablero |
| `GET` | `/api/categorias` | Lista de categorías (incluye `facturas` y `gasto_total`) |
| `POST` | `/api/categorias` | Crea una categoría |
| `PUT` | `/api/categorias/:id` | Actualiza una categoría |
| `DELETE` | `/api/categorias/:id` | Elimina una categoría (responde `409` si tiene facturas) |
| `GET` | `/api/facturas` | Lista paginada con filtros |
| `GET` | `/api/facturas/:id` | Detalle de una factura |
| `POST` | `/api/facturas` | Crea una factura |
| `PUT` | `/api/facturas/:id` | Actualiza una factura |
| `DELETE` | `/api/facturas/:id` | Elimina una factura |

**Filtros de `GET /api/facturas`:** `q` (busca en proveedor, número de comprobante o CUIT, con o sin guiones), `categoria_id`, `estado`, `desde`, `hasta` (`AAAA-MM-DD`), `page` (por defecto 1) y `page_size` (por defecto 15, máximo 100).

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
    "proveedor": "Librería Comercial Del Plata SRL",
    "cuit_proveedor": "30-71234560-4",
    "fecha": "2026-10-04",
    "categoria_id": 1,
    "subtotal": 100000,
    "impuestos": 21000,
    "metodo_pago": "transferencia",
    "estado": "pagada",
    "notas": "Resmas y tóner"
  }'
```

**Errores:** `{ "error": "mensaje", "details": … }`

| Código | Cuándo |
|---|---|
| `400` | JSON inválido o id mal formado |
| `401` | Falta Basic Auth o es incorrecta |
| `404` | Ruta o registro inexistente |
| `405` | Método no permitido en esa ruta |
| `409` | Comprobante duplicado (mismo proveedor, tipo y número), nombre de categoría repetido o categoría con facturas |
| `422` | Validación fallida (por ejemplo, CUIT inválido). `details` trae el mensaje de cada campo |
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
- **Alícuotas de IVA:** las opciones del selector están en `#f-alicuota` (`public/index.html`) y en `ALICUOTAS` (`public/app.js`).
- **Colores:** el frontend usa la paleta `blue`/`slate` de Tailwind. Cambiando `blue-700`/`blue-900` en `public/index.html` y `public/app.js` modificás el tono principal.
- **Tailwind en producción:** se usa el *Play CDN* para no necesitar build, por eso aparece un aviso en la consola del navegador. Si querés CSS optimizado, compilalo con la CLI de Tailwind (`npx tailwindcss -o public/styles.css --minify`, con `content: ['./public/**/*.{html,js}']` y el plugin `@tailwindcss/forms`) y reemplazá el `<script src="https://cdn.tailwindcss.com…">` por `<link rel="stylesheet" href="/styles.css">`.
- **Más campos en facturas:** agregá la columna en `01_esquema.sql`, la validación en `validarFactura()` y el input en el formulario de `index.html` y en `guardarFactura()`/`editarFactura()` de `app.js`.

---

## Solución de problemas

| Síntoma | Causa probable / solución |
|---|---|
| `Configuración incompleta: faltan SUPABASE_URL…` | Falta `.dev.vars` en local o no ejecutaste `wrangler secret put` en producción |
| `Could not find the table 'public.facturas'` / `PGRST205` | No ejecutaste los SQL, o Supabase todavía no recargó el esquema. En el SQL Editor corré `notify pgrst, 'reload schema';` |
| `column "numero_comprobante" does not exist` | La tabla se creó con una versión anterior del esquema. Ejecutá `99_reiniciar.sql` con la sección de `drop` descomentada y volvé a correr los SQL desde `01` |
| `permission denied for table …` | Estás usando la llave pública (`anon` / `sb_publishable_…`) en lugar de la secreta |
| `node: .dev.vars: not found` al correr `db:seed` | Creá `.dev.vars` (ver [paso 2](#2-configurar-el-proyecto-en-local)) o actualizá Node a ≥ 20.6 |
| "CUIT inválido" con un CUIT real | Revisá que tenga 11 dígitos. El dígito verificador se calcula con el algoritmo módulo 11 de AFIP/ARCA |
| No se puede eliminar una categoría | Tiene facturas asociadas: desactivala o reasigná sus facturas |
| El gasto del mes no incluye una factura de hoy | Revisá que `APP_TIMEZONE` sea `America/Argentina/Buenos_Aires` y que la factura no esté anulada |
| El navegador pide usuario y contraseña | Definiste `BASIC_AUTH_USER`/`BASIC_AUTH_PASS`. Para quitarlos: `npx wrangler secret delete …` |

---

## Licencia

Ver [LICENSE](LICENSE).
