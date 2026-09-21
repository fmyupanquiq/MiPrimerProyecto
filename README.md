# LetFer

Sistema privado para administrar y analizar la actividad de apuestas de un
pequeño equipo: proyectos, usuarios, banca, casas de apuestas, etapas,
apuestas, tickets, conciliaciones, auditoría y análisis.

> El repositorio remoto se llama `MiPrimerProyecto`; el nombre del producto es **LetFer**.

## Fuente de verdad

Todo el comportamiento funcional y técnico está definido en
[`docs/ESPECIFICACION_LETFER_V1_1.md`](docs/ESPECIFICACION_LETFER_V1_1.md).
Si una regla cambia, primero se actualiza la especificación y luego el código.

## Estructura

```text
LetFer/
├── apps/
│   ├── api/        # NestJS (API REST)
│   └── web/        # React + Vite + Tailwind CSS
├── packages/
│   └── shared/     # Código compartido (TypeScript, ESM)
├── docs/           # Especificación y decisiones técnicas
└── ...
```

## Requisitos

- Node.js 24 (ver `.node-version`) y npm 11.
- No se usa pnpm ni yarn: el monorepo funciona con **npm workspaces**.

## Puesta en marcha

```bash
npm install
```

## Scripts (desde la raíz)

| Script                 | Descripción                                                     |
| ---------------------- | --------------------------------------------------------------- |
| `npm run build`        | Compila todos los workspaces (`shared` primero).                |
| `npm run typecheck`    | Verifica tipos en todos los workspaces.                         |
| `npm test`             | Ejecuta las pruebas de todos los workspaces.                    |
| `npm run format:check` | Comprueba el formato con Prettier (`npm run format` lo aplica). |

## Estado

Fase 0 (preparación) en curso. Ver la sección 67 de la especificación.
