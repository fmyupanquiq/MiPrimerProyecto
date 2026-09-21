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
│   ├── api/        # NestJS 12 (API REST, ESM)
│   └── web/        # React 19 + Vite 8 + Tailwind CSS 4
├── packages/
│   └── shared/     # Código compartido (TypeScript, ESM)
├── docs/
│   ├── ESPECIFICACION_LETFER_V1_1.md
│   └── decisiones/ # Registros de decisiones técnicas (ADR)
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
cp .env.example .env    # opcional en la Fase 0
npm run db:start        # PostgreSQL local en segundo plano
npm run dev             # API en :3000 y web en :5173
```

- Web: <http://localhost:5173>
- Salud de la API: <http://localhost:3000/api/health> (también vía el proxy de la web en `/api/health`)

## Scripts (desde la raíz)

| Script                            | Descripción                                                      |
| --------------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                     | Levanta API y web en paralelo.                                   |
| `npm run build`                   | Compila todos los workspaces (`shared` primero).                 |
| `npm run typecheck`               | Verifica tipos en todos los workspaces.                          |
| `npm run lint`                    | ESLint (con reglas que usan información de tipos).               |
| `npm test`                        | Ejecuta las pruebas de todos los workspaces (Vitest).            |
| `npm run format` / `format:check` | Aplica / comprueba el formato con Prettier.                      |
| `npm run check`                   | Formato, lint, tipos, pruebas y build: la verificación completa. |
| `npm run db:start` / `db:stop`    | Inicia / detiene PostgreSQL 17 local.                            |
| `npm run db:status` / `db:reset`  | Estado / borra los datos locales y reinicia desde cero.          |

## Base de datos local

PostgreSQL 17 con binarios reales vía el paquete `embedded-postgres`, controlado con
`scripts/dev-db.mjs` (no requiere Docker ni instalar PostgreSQL). Crea `letfer_dev` y
`letfer_test`, escucha solo en `localhost:5432` y guarda los datos en `.data/` (ignorado por Git).
Las credenciales por defecto son solo de desarrollo (ver `.env.example`). Detalles y límites en
[`docs/decisiones/0002-postgresql-local.md`](docs/decisiones/0002-postgresql-local.md).

## Estado

**Fase 0 (preparación): completada**, pendiente de revisión. Siguiente: Fase 1 (PostgreSQL,
usuarios y autenticación). Ver la sección 67 de la especificación.
