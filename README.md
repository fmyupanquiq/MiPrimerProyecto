# LetFer

Sistema privado para administrar y analizar la actividad de apuestas de un
pequeño equipo: proyectos, usuarios, banca, casas de apuestas, etapas,
apuestas, tickets, conciliaciones, auditoría y análisis.

> El repositorio remoto se llama `MiPrimerProyecto`; el nombre del producto es **LetFer**.

## Fuente de verdad

Todo el comportamiento funcional y técnico está definido en
[`docs/ESPECIFICACION_LETFER_V1_1.md`](docs/ESPECIFICACION_LETFER_V1_1.md).
Si una regla cambia, primero se actualiza la especificación y luego el código.
Las decisiones técnicas están en [`docs/decisiones/`](docs/decisiones/).

## Estructura

```text
LetFer/
├── apps/
│   ├── api/        # NestJS 12 (API REST, ESM) + Drizzle ORM + migraciones SQL
│   └── web/        # React 19 + Vite 8 + Tailwind CSS 4
├── packages/
│   └── shared/     # Código compartido: esquemas zod, tipos y códigos de error
├── docs/
│   ├── ESPECIFICACION_LETFER_V1_1.md
│   └── decisiones/ # Registros de decisiones técnicas (ADR 0001-0008)
├── scripts/        # Herramientas de desarrollo (PostgreSQL local)
└── ...
```

## Requisitos

- Node.js 24 (ver `.node-version`) y npm 11.
- Nada más: PostgreSQL de desarrollo se obtiene con `npm install` (ver más abajo).
- El monorepo usa **npm workspaces** (no pnpm ni yarn).

## Puesta en marcha

```bash
npm install
cp .env.example .env     # ajusta lo que necesites (los valores por defecto sirven para desarrollo)
npm run db:start         # PostgreSQL local en segundo plano
npm run db:migrate       # aplica las migraciones a letfer_dev
```

Primer Administrador Global (spec §83; no hay registro público):

1. Añade a tu `.env` (no versionado): `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`,
   `BOOTSTRAP_ADMIN_FIRST_NAME` y `BOOTSTRAP_ADMIN_LAST_NAME`.
2. `npm run bootstrap:admin` (idempotente).
3. Borra esas variables del `.env`.

Después:

```bash
npm run dev              # API en :3000 y web en :5173
```

- Web: <http://localhost:5173>
- Salud de la API: <http://localhost:3000/api/health>
- Los correos de recuperación de contraseña **no se envían** en desarrollo: se guardan como JSON en
  `.data/outbox/` (ahí está el enlace de restablecimiento).

## Scripts (desde la raíz)

| Script                            | Descripción                                                             |
| --------------------------------- | ----------------------------------------------------------------------- |
| `npm run dev`                     | Levanta API y web en paralelo.                                          |
| `npm run build`                   | Compila todos los workspaces (`shared` primero).                        |
| `npm run typecheck`               | Verifica tipos en todos los workspaces.                                 |
| `npm run lint`                    | ESLint (con reglas que usan información de tipos).                      |
| `npm test`                        | Pruebas de todos los workspaces (arranca PostgreSQL si hace falta).     |
| `npm run format` / `format:check` | Aplica / comprueba el formato con Prettier.                             |
| `npm run check`                   | Formato, lint, tipos, pruebas y build: la verificación completa.        |
| `npm run db:start` / `db:stop`    | Inicia / detiene PostgreSQL 17 local.                                   |
| `npm run db:status` / `db:reset`  | Estado / borra los datos locales y reinicia desde cero.                 |
| `npm run db:generate`             | Genera una migración SQL a partir del esquema de Drizzle.               |
| `npm run db:migrate`              | Aplica las migraciones pendientes a la base de datos de `DATABASE_URL`. |
| `npm run bootstrap:admin`         | Crea el primer Administrador Global (lee `BOOTSTRAP_ADMIN_*`).          |

## API (Fase 1)

Todo bajo `/api`. Toda ruta exige sesión salvo las marcadas como públicas (P).

| Método y ruta                       | Descripción                                                          |
| ----------------------------------- | -------------------------------------------------------------------- |
| `GET /health` (P)                   | Estado del servicio y de PostgreSQL.                                 |
| `POST /auth/login` (P)              | Inicia sesión (cookie HttpOnly); `keepSignedIn` = "Mantener sesión". |
| `POST /auth/logout`                 | Cierra la sesión actual.                                             |
| `GET /auth/me`                      | Usuario y sesión actuales.                                           |
| `GET /auth/sessions`                | Sesiones abiertas del usuario.                                       |
| `DELETE /auth/sessions/:id`         | Revoca una sesión propia.                                            |
| `POST /auth/sessions/revoke-others` | Cierra todas las sesiones menos la actual.                           |
| `POST /auth/reauth`                 | Confirma la contraseña (vale 5 minutos para acciones sensibles).     |
| `POST /auth/password/change`        | Cambia la contraseña (cierra las demás sesiones).                    |
| `POST /auth/password/forgot` (P)    | Solicita el enlace de recuperación (respuesta siempre igual).        |
| `POST /auth/password/reset` (P)     | Restablece la contraseña con el token del correo.                    |
| `PATCH /users/me`                   | Edita nombre y apellido (con `version`, control optimista).          |
| `POST /users/me/email`              | Cambia el correo confirmando la contraseña.                          |

## Base de datos

PostgreSQL 17 local con binarios reales vía `embedded-postgres`, controlado con
`scripts/dev-db.mjs` (sin Docker ni instalación). Crea `letfer_dev` y `letfer_test`, escucha solo en
`localhost:5432` y guarda los datos en `.data/` (ignorado por Git). Las credenciales por defecto son
solo de desarrollo (ver `.env.example`). Detalles en
[`docs/decisiones/0002-postgresql-local.md`](docs/decisiones/0002-postgresql-local.md).

El esquema se define en `apps/api/src/database/schema/` (Drizzle) y las migraciones SQL en
`apps/api/drizzle/`. Flujo: editar el esquema → `npm run db:generate` → revisar el SQL →
`npm run db:migrate`. Nunca se edita una migración ya aplicada.

## Estado

**Fase 0 (preparación): completada. Fase 1 (base de datos, usuarios y autenticación): completada,
pendiente de revisión.** Siguiente: Fase 2 (proyectos, miembros, roles e invitaciones). Ver la
sección 67 de la especificación.
