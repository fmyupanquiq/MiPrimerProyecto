# 0018. Administración

- **Estado:** Aceptada (Fase 8)
- **Fecha:** 2026-09-24
- **Referencias:** especificación §4.1, §6, §8, §9, §10, §35, §36, §38, §67, §81, §87, §89, §102,
  §104.6, §104.7, §104.10, §111; ADR 0006, 0007, 0008, 0010, 0012, 0016, 0017

## Contexto

Con la Fase 7 cerrada (`v0.7-tickets-ia`), la Fase 8 construye "las interfaces y herramientas
completas de auditoría, papelera y administración, sobre la infraestructura construida desde la
Fase 1" (§67, §81, §102). La infraestructura ya existe (auditoría inmutable, borrado lógico,
restauración por API, `UsersService.setStatus`, transferencia de propiedad por API); faltaba su
superficie de lectura y gestión. Las decisiones D8-1 a D8-9 y la protección del último
Administrador Global las aprobó la persona responsable del producto tras el plan de la fase.

## Decisiones funcionales (confirmadas)

- **D8-1.** `audit_logs` no se purga en esta fase: la auditoría debe poder explicar la historia
  (§89, §103).
- **D8-2.** Visibilidad de la auditoría: el Administrador de Proyecto ve la de **su** proyecto
  (`audit.view`); el Administrador Global ve la global (`system.audit.view`). Colaborador y Lector
  no acceden. Aislamiento estricto entre proyectos.
- **D8-3.** Sin purga física de proyectos en esta fase: solo se muestra la elegibilidad
  (`purgeEligibleAt`) y se deja preparada la decisión futura. No se elimina ningún dato de
  negocio de forma irreversible (§89).
- **D8-4.** "Recalcular balances" (§38) queda cubierto por la arquitectura vigente (los saldos se
  calculan por consulta desde el ledger, D3) y por la verificación de integridad (§109.2). No se
  crea una reconstrucción de balances, que duplicaría lógica financiera.
- **D8-5.** Solicitud de eliminación de cuenta en una tabla propia, `account_deletion_requests`,
  con el patrón de `withdrawal_requests` (D5).
- **D8-6.** Un propietario de proyecto no puede ser deshabilitado ni eliminado hasta transferir la
  propiedad de todos sus proyectos.
- **D8-7.** Roles globales fuera de alcance: no se crean nuevos Administradores Globales.
- **D8-8.** Avatar: **queda fuera** (ver "Fuera de alcance").
- **D8-9.** Exportar la auditoría queda fuera de alcance.
- **D8-10 (protección).** El sistema nunca puede quedarse sin un Administrador Global activo:
  se impide deshabilitar o eliminar lógicamente al último, y todo intento bloqueado se audita.

## Decisiones técnicas

### Visor de auditoría (D8-1, D8-2)

- `GET /projects/:projectId/audit-logs` (`audit.view`, siempre filtrado por el proyecto de la
  ruta) y `GET /admin/audit-logs` (`system.audit.view`; filtros opcionales por `projectId` o
  `system=true` para las entradas sin proyecto).
- Filtros: rango de fechas, actor, acción (prefijo o exacta), tipo y id de entidad.
- **Paginación por cursor** sobre `(occurred_at, id)` descendente. El cursor lleva el instante
  con precisión de microsegundos (texto de PostgreSQL, no `Date` de JavaScript) para no perder ni
  repetir filas que compartan milisegundo. `limit` por defecto 50, máximo 100.
- Solo lectura. Al leer se vuelve a aplicar `redactSensitive` a los valores (defensa en profundidad:
  aunque una entrada antigua hubiera guardado algo indebido, no se devuelve).
- `audit.view` se concede solo a `PROJECT_ADMIN`. `system.audit.view` solo a `GLOBAL_ADMIN` (la
  matriz ya le otorga todos los permisos).

### Papelera (D8-3)

- `GET /projects/:projectId/trash`: apuestas y etapas en papelera del proyecto. Se reutilizan
  `bets.restore` y `stages.restore` (no se inventa un permiso nuevo): cada tipo solo aparece a
  quien puede restaurarlo; sin ninguno de los dos, 403. La restauración usa los endpoints
  existentes. Cada elemento muestra quién lo eliminó, cuándo, el motivo y `purgeEligibleAt`.
- La papelera global de proyectos ya existía (`GET /projects/trash`); solo se completa la web.
- Sin purga física: "elegible para purga" es una etiqueta informativa (§89).

### Usuarios y eliminación de cuenta (D8-5, D8-6, D8-10)

- Permisos nuevos globales: `system.users.view`, `system.users.manage`,
  `system.account_deletions.decide`.
- `GET /admin/users` (filtros por estado y búsqueda; paginación por `limit`/`offset`),
  `GET /admin/users/:id`, `POST /admin/users/:id/disable|enable` (reautenticación, con `version`).
  Reutilizan `UsersService.setStatus`.
- **`account_deletion_requests`**: `PENDING`/`APPROVED`/`REJECTED`/`CANCELLED`, con un `CHECK` de
  forma por estado (como `withdrawal_requests`) e índice único parcial: una sola `PENDING` por
  usuario. El usuario solicita, consulta y cancela la suya (`/users/me/deletion-request`); el
  Administrador Global aprueba (reautenticación) o rechaza. Aprobar: bloquea la solicitud y al
  usuario, valida D8-6 y D8-10 y ejecuta `setStatus('DELETED')`, todo en una transacción.
- **D8-6.** Deshabilitar o eliminar a quien es propietario de cualquier proyecto (incluso en
  papelera) responde 409 `OWNS_PROJECTS` con la lista de proyectos. Transferir primero.
- **D8-10.** La protección tiene dos capas: (1) el servicio serializa con un bloqueo por clave
  lógica (`users:global-admins`) y responde 409 `LAST_GLOBAL_ADMIN` con un mensaje claro; (2) un
  disparador de PostgreSQL rechaza cualquier `UPDATE` que deje al sistema sin Administrador Global
  activo (defensa en profundidad, también frente a dos administradores que se deshabilitan a la vez
  o a escrituras fuera de la API). El intento bloqueado se audita **fuera** de la transacción que
  se revierte (`admin.last_global_admin.blocked`, con la acción intentada).
- Consecuencia sobre la Fase 3: `hasOtherEligibleApprover` (autoaprobación de retiros, §79) ya
  no cuenta a miembros cuya cuenta no está `ACTIVE`; un administrador deshabilitado o eliminado no
  puede aprobar nada, así que no debe impedir la autoaprobación de otro.

### Administración de proyectos y sesiones

- La lista global de proyectos (`GET /projects?scope=all`) y la transferencia de propiedad
  (`POST /projects/:id/transfer-ownership`) ya existen: se añade su interfaz.
- Sesiones: `GET /users/me/sessions`, `DELETE /users/me/sessions/:id`,
  `POST /users/me/sessions/revoke-others`, y `POST /admin/users/:id/revoke-sessions`
  (`system.users.manage`, reautenticación). Se apoyan en `SessionService`.

### Mantenimiento y purga auxiliar

- Tabla `maintenance_runs` (inmutable, mismo espíritu que `integrity_check_runs`): quién o qué
  (`MANUAL`/`SCHEDULED`), cuándo, resultado y filas purgadas por tabla.
- Se purgan **solo** tablas auxiliares y solo lo caducado: sesiones expiradas o revocadas,
  intentos de acceso y tokens de recuperación usados, invalidados o vencidos, todo con más de
  `MAINTENANCE_RETENTION_DAYS` (30 por defecto). Nunca tablas de negocio, ledger, auditoría ni
  invitaciones.
- Tarea programada interna (una vez al día, mismo patrón que los backups: sin cron externo) más
  `POST /admin/maintenance/purge` bajo demanda (`system.maintenance.run`). Cada ejecución se audita.

## Fuera de alcance (esta fase)

- **Avatar.** La infraestructura de archivos existente (`FileStorage`) está construida para
  tickets, con la clave por proyecto y el respaldo de `TICKETS_DIR`. Reutilizarla para avatares
  obligaría a ampliar almacenamiento, backups y servido de archivos; se deja fuera por decisión
  (D8-8). El campo `avatarRef` sigue sin uso.
- Purga física de proyectos, etapas, apuestas, movimientos o `audit_logs` (D8-1, D8-3).
- Nuevos Administradores Globales, roles personalizados y su interfaz (D8-7, §4.5).
- Exportación de la auditoría (D8-9).
- Reconstrucción de balances (D8-4).

## Consecuencias

- Aparecen 5 permisos globales y 1 de proyecto; `reconcileRbac` los sincroniza al arrancar.
- Tres migraciones nuevas: tabla de solicitudes de eliminación, disparador de último
  Administrador Global y tabla de ejecuciones de mantenimiento.
- La papelera de tickets sigue sin existir (ADR 0017): un ticket sigue el ciclo de su apuesta.
