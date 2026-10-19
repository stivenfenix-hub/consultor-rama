# Consultor de Procesos (Rama Judicial)

Plataforma mínima donde un abogado registrado ingresa el **radicado** de su
proceso y la app lo consulta **en vivo** contra el API público de la Rama
Judicial (CPNU), guarda el proceso y sus actuaciones, y lo mantiene al día con
un **botón "Actualizar"** y un **cron de 24 h**.

No descarga lotes: cada proceso se consulta por demanda, por abogado.

## Stack

- **Next.js 15** (App Router, TypeScript) — frontend + API + server actions
- **Prisma + PostgreSQL** — persistencia
- **Cron** — Vercel Cron o worker local con `node-cron`

## Cómo corre la integración con la Rama

Toda consulta pasa por **tu backend** (`src/lib/rama.ts`), nunca desde el
navegador — el API de la Rama no permite CORS, usa el puerto `:448` y es lento.

Endpoints usados (base `https://consultaprocesos.ramajudicial.gov.co:448/api/v2`):

| Paso | Ruta |
|------|------|
| Buscar por radicado | `/Procesos/Consulta/NumeroRadicacion?numero={23}&SoloActivos=false&pagina=1` |
| Buscar por nombre | `/Procesos/Consulta/NombreRazonSocial?nombre={t}&tipoPersona={nat\|jur}&...` |
| Detalle | `/Proceso/Detalle/{idProceso}` |
| Actuaciones | `/Proceso/Actuaciones/{idProceso}?pagina={n}` |

> No existe consulta por cédula/documento en el API público.

El `idRegActuacion` de cada actuación es el identificador estable que usamos para
detectar **actuaciones nuevas** entre sincronizaciones.

## Puesta en marcha (local)

Requisitos: Node 18+ y Docker (o un Postgres propio).

```bash
# 1. Dependencias
npm install

# 2. Base de datos (opcion con Docker)
docker compose up -d

# 3. Variables de entorno
cp .env.example .env
#   - Genera SESSION_SECRET y CRON_SECRET:
#     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. Crear las tablas
npm run db:push

# 5. Arrancar
npm run dev
# abre http://localhost:3000
```

Ingresa con cualquier correo (demo), agrega un radicado de 23 dígitos (p. ej.
`11001020300020200000100`) y entra al proceso para ver sus actuaciones.

## Actualización automática cada 24 h

El endpoint `GET/POST /api/cron/refresh` refresca **todos** los procesos. Está
protegido con `CRON_SECRET` (header `Authorization: Bearer <CRON_SECRET>`).

Tres formas de dispararlo:

- **Vercel Cron** — ya configurado en `vercel.json` (07:00 diario). Vercel añade
  el header automáticamente si defines la env `CRON_SECRET`.
- **Worker local** — `npm run cron` (corre al arrancar y luego 07:00 diario).
- **Programador de tareas / curl**:
  ```bash
  curl -X POST http://localhost:3000/api/cron/refresh \
    -H "Authorization: Bearer <CRON_SECRET>"
  ```

El botón **"Actualizar"** en cada proceso hace lo mismo pero solo para ese caso.

### Notificación por correo

Cuando el cron detecta actuaciones nuevas, envía a cada abogado **un solo
correo-resumen** con todos sus procesos que cambiaron (asunto + lista de
actuaciones + enlace a cada proceso). Configúralo con SMTP en `.env`
(`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) y `APP_URL`
para los enlaces. Si no configuras SMTP, los correos se registran en consola
(modo desarrollo), así que puedes probar el flujo sin servidor de correo.

## Estructura

```
src/
  lib/
    rama.ts    ← cliente del API de la Rama (timeouts, reintentos, paginacion)
    sync.ts    ← agregar proceso, detectar actuaciones nuevas, refrescar todos
    auth.ts    ← sesion por cookie (DEMO: solo correo)
    db.ts      ← cliente Prisma
  app/
    actions.ts            ← server actions (login, agregar, refrescar, etc.)
    login/                ← pantalla de ingreso
    dashboard/            ← lista de procesos + agregar
    dashboard/[caseId]/   ← detalle del proceso + actuaciones
    api/cron/refresh/     ← endpoint del cron
scripts/cron-worker.ts    ← cron local opcional
prisma/schema.prisma      ← modelo de datos
```

## Antes de producción (pendientes)

- **Auth real**: el login actual es solo por correo sin verificación. Cámbialo a
  OTP por correo, magic-link o passkeys (better-auth / Auth.js / Clerk).
- **Rate limiting y reintentos**: el API de la Rama es lento e inestable; ajusta
  `DEFAULT_TIMEOUT_MS` / `MAX_RETRIES` en `rama.ts` y considera una cola.
- **Notificaciones**: ✅ ya envía correo-resumen desde el cron. Falta, si quieres,
  notificar también en el refresh manual y plantillas más pulidas.
- **Legal**: es data pública, pero revisa términos/condiciones de la Rama y
  límites de uso; para alto volumen consulta acceso oficial con el Consejo
  Superior de la Judicatura.
```
