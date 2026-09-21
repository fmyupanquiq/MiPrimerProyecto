# 0008. Auditoría, borrado lógico, concurrencia y base HTTP

- **Estado:** Aceptada (Fase 1)
- **Fecha:** 2026-09-21
- **Referencias:** especificación §10, §24, §35, §40, §57, §58, §81, §96, §102

## Contexto

El §102 exige que la infraestructura de auditoría, borrado lógico, seguridad y timestamps exista
desde la Fase 1, para que las fases siguientes la usen desde el primer día.

## Decisión

### Auditoría

- Tabla `audit_logs`: usuario, acción (`dominio.objeto.verbo`), tipo e id del registro afectado,
  valores anterior y nuevo (`jsonb`), IP, agente de usuario, sesión y petición.
- **Inmutable en la base de datos**: disparadores que rechazan `UPDATE`, `DELETE` y `TRUNCATE`
  (SQLSTATE `23001`). No depende de que la aplicación se porte bien.
- `AuditService.record(executor, entry)` recibe la **transacción de la operación auditada**: si la
  operación se revierte, la auditoría también (§57). Toma IP, agente, sesión y usuario del
  contexto de petición (`AsyncLocalStorage`).
- Defensa contra fugas: las claves con `password`, `secret`, `token`, `hash` o `pepper` se
  reemplazan por `[REDACTED]` aunque alguien las pase por error. `diffFields` produce las
  diferencias campo por campo (§24).
- `actor_user_id` referencia a `users`; `project_id` quedará sin clave foránea hasta que exista
  `projects` (Fase 2).

### Borrado lógico y estados

`DELETED` es un estado con `deleted_at`, motivo y autor; se restaura volviendo a `ACTIVE`. Los
ayudantes (`softDeleteValues`, `restoreValues`, `notDeleted`) están listos para etapas, apuestas y
proyectos. Los disparadores `prevent_delete` impiden el borrado físico donde el historial importa.

### Concurrencia (§40, §96)

- **Optimista** con `version`: `nextVersion` + `WHERE version = esperada` +
  `expectUpdated` → `ConcurrencyConflictError` (409 `CONCURRENCY_CONFLICT`).
- **Bloqueos asesores de PostgreSQL** (`lockByKey`) para serializar operaciones por recurso lógico
  (intentos de acceso de un correo, recuperación de un usuario, bootstrap).
- Las claves de idempotencia (§96) se difieren a la Fase 3, con su primer uso real.

### Base HTTP

- `helmet`; cuerpo JSON de 100 kB como máximo; sin CORS; `TRUST_PROXY_HOPS` configurable.
- **Validación con zod** en `@letfer/shared` (la misma en API y web) y el
  `StandardSchemaValidationPipe` de Nest 12 (`@Body({ schema })`), con errores `VALIDATION_FAILED`
  que incluyen el detalle por campo.
- **Error uniforme** `{ statusCode, code, message, details?, retryAfterSeconds? }` con códigos
  estables (`ErrorCode`); un error inesperado devuelve un 500 genérico y solo se registra en el
  servidor con el identificador de la petición.
- **Configuración** validada al arrancar con zod y `process.loadEnvFile`; los errores nombran la
  variable, nunca su valor. En producción se exige HTTPS y cookie `Secure`.

### Pruebas

PostgreSQL real (`letfer_test`, reconstruida con todas las migraciones en cada ejecución), reloj
falso (`Clock`/`FakeClock`) y correo en memoria. Las tablas de auditoría se vacían entre pruebas
con `session_replication_role = replica`, solo posible con un superusuario: **en producción el rol
de la aplicación no debe ser superusuario**.

## Consecuencias y pendientes

- `drizzle-kit` arrastra 4 vulnerabilidades moderadas (`esbuild` vía `@esbuild-kit`, que afecta
  al servidor de desarrollo de esbuild que no se usa). Es solo una herramienta de desarrollo; el
  "arreglo" propuesto por npm sería bajar a una versión 0.18, inaceptable. Se revisará al
  actualizar a Drizzle 1.0.
- Purga de tablas auxiliares (sesiones, intentos, tokens) y vistas de auditoría: Fase 8.
