# LetFer: guía para Claude Code

## Fuente de verdad

`docs/ESPECIFICACION_LETFER_V1_1.md` es la **única** fuente de verdad funcional y técnica.
Léela completa antes de implementar funcionalidad. La adenda (§71–§103) prevalece sobre el
cuerpo si ambos difieren. Si una regla debe cambiar: primero se actualiza la especificación
(con aprobación del usuario) y luego el código.

## Forma de trabajo (§68, §103)

- Trabaja solo dentro del alcance de la fase o tarea solicitada. No construyas fases futuras.
- No inventes ni cambies reglas de negocio ni decisiones financieras sin aprobación.
- Si hay una decisión funcional pendiente, detente y consulta antes de continuar.
- Ciclo por fase: implementar → probar → corregir → confirmar → siguiente fase.
- Commits pequeños y claros. No se integra a `main` sin confirmación del usuario.
- Al terminar informa: archivos creados/modificados, migraciones, pruebas y problemas.

## Reglas críticas de dominio (resumen; ante duda manda la especificación)

- Nunca `float`/`number` para dinero o cuotas: `NUMERIC` en PostgreSQL y una librería decimal
  en TypeScript; los decimales viajan por la API como cadenas.
- Un solo ledger financiero; los saldos se reconstruyen desde registros canónicos y las cachés
  no son fuente de verdad.
- Nunca saldo disponible negativo; no se crea dinero sin movimiento válido; sin ajustes falsos.
- Los valores oficiales confirmados de la casa prevalecen sobre cálculos teóricos.
- La IA propone, el humano confirma, el backend valida y recién entonces se registra.
- Permisos y reglas se validan siempre en el backend. Eliminaciones ordinarias: lógicas.
- Operaciones financieras críticas: transaccionales, auditadas, con control de concurrencia
  e idempotencia.

## Repositorio

- Monorepo con **npm workspaces** (no pnpm ni yarn): `apps/api` (NestJS), `apps/web`
  (React + Vite + Tailwind), `packages/shared`.
- Todo el código es TypeScript ESM (NestJS 12 es solo ESM): en `api` y `shared` los imports
  relativos llevan extensión `.js`.
- `packages/shared` se compila a `dist/`; los demás workspaces lo consumen ya compilado, por
  eso los scripts de la raíz lo construyen primero.
- Versiones de dependencias fijadas sin `^` (ver `.npmrc`). No subas `.env` ni secretos.
- Decisiones técnicas registradas en `docs/decisiones/` (léelas antes de cambiar herramientas).
- ORM: **Drizzle** (ADR 0003). Dinero/cuotas: `numeric` y decimales como cadena, nunca `number`;
  `CHECK`/índices únicos parciales en el esquema; `.for('update')` al gastar saldo; acceso a datos
  solo desde repositorios/servicios, nunca en controladores.
- PostgreSQL local de desarrollo: `npm run db:start` (PostgreSQL 17 vía `embedded-postgres`,
  bases `letfer_dev` y `letfer_test`). Las pruebas de integración usan `letfer_test`, sin simular
  la base de datos.
- TypeScript se mantiene en 6.0.x mientras `typescript-eslint` no soporte la 7 (ADR 0001).

## Comandos (desde la raíz)

- `npm run check`: formato, lint, tipos, pruebas y build (ejecútalo antes de dar algo por hecho).
- Por separado: `npm run build` · `npm run typecheck` · `npm run lint` · `npm test` ·
  `npm run format:check`.
- `npm run dev` levanta API (:3000) y web (:5173). `npm run db:start|stop|status|reset` gestiona
  PostgreSQL local.
