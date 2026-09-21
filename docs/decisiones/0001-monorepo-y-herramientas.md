# 0001. Monorepo y herramientas de desarrollo

- **Estado:** Aceptada (Fase 0)
- **Fecha:** 2026-09-21
- **Referencias:** especificación §44, §45, §46

## Contexto

La especificación exige React + TypeScript, NestJS, monorepo y "versiones estables y
compatibles" elegidas al iniciar. El usuario decidió usar **npm workspaces** (sin pnpm ni yarn).

## Decisión

| Ámbito                  | Elección                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------- |
| Gestor de paquetes      | npm 11 con workspaces (`packages/shared`, `apps/api`, `apps/web`), versiones exactas    |
| Runtime                 | Node.js 24 (`engines`: `>=24.15.0 <25`)                                                 |
| Lenguaje                | TypeScript **6.0.3**, `strict` + `noUncheckedIndexedAccess`                             |
| API                     | NestJS **12.0.4** (Express 5), prefijo global `/api`                                    |
| Web                     | React 19.3.0, Vite 8.3.0, `@vitejs/plugin-react` 6.1.1, Tailwind CSS 4.3.3              |
| Pruebas                 | Vitest 5.0.1 en los tres workspaces; supertest (e2e de la API); Testing Library + jsdom |
| Calidad                 | ESLint 10 (config plana) + typescript-eslint 8.70.1 con reglas que usan tipos; Prettier |
| Módulos                 | Todo ESM (`"type": "module"`, `NodeNext` en `api` y `shared`, imports con `.js`)        |
| Dependencias compartidas| `packages/shared` se compila a `dist/` y los demás workspaces lo consumen compilado     |

Las versiones se fijan **sin `^`** (`.npmrc` con `save-exact=true`) y `package-lock.json` se versiona.

## Por qué estas versiones

- **TypeScript 6.0.3, no 7.x.** La 7.0.2 es la última publicada, pero `typescript-eslint` exige
  `typescript <6.1.0`. Los generadores oficiales de NestJS 12 también usan TypeScript `^6.0.2`.
  Revisar cuando `typescript-eslint` soporte TypeScript 7.
- **API en ESM y Vitest en lugar de Jest.** NestJS 12 se publica solo como ESM
  (`"type": "module"`). Jest en ESM exige `--experimental-vm-modules`; su plantilla oficial ESM usa
  Vitest. Se verificó que la inyección de dependencias por metadatos de decoradores funciona en
  compilación (`nest build`) y en pruebas (`Vitest`).
- **Node 24.** Vitest 5 requiere Node 22.12+/24+ y jsdom 30 exige `^24.15`.
- **`packages/shared` compilado.** Evita configurar alias de código fuente en tres herramientas
  distintas. Los scripts de la raíz (`build`, `typecheck`, `lint`, `test`, `dev`) lo construyen
  primero; el orden de `workspaces` en el `package.json` raíz también lo pone primero.

## Alternativas descartadas

- **pnpm / yarn:** descartadas por el usuario.
- **Jest** para la API: obliga a flags experimentales con dependencias ESM.
- **oxlint** (usado en las plantillas de Nest): ESLint tiene un ecosistema más amplio y las reglas
  con información de tipos que se quieren (`no-floating-promises`).

## Consecuencias

- Los imports relativos en `apps/api` y `packages/shared` deben terminar en `.js`.
- Comando único de verificación: `npm run check` (formato, lint, tipos, pruebas y build).
- npm 11 avisa de `postinstall` no aprobados (`allow-scripts`). El de
  `@embedded-postgres/windows-x64` es un no-op en Windows y **no se aprobó**. En Linux/macOS
  podría requerir `npm approve-scripts` (relevante al configurar una CI en Fase 11).
- No hay CI en la Fase 0; se puede añadir sin cambiar esta decisión.
