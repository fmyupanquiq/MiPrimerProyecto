# 0009. Roles y permisos (RBAC)

- **Estado:** Aceptada (Fase 2)
- **Fecha:** 2026-09-21
- **Referencias:** especificación §4.5, §39, §47, §84, §98, §105.2, §105.3

## Contexto

La Fase 1 tenía un único rol global guardado como texto (`users.system_role`). La Fase 2 añade
proyectos, miembros e invitaciones y exige permisos por proyecto, aislamiento entre proyectos y un
límite para que nadie pueda dar más permisos de los que tiene (§98, §105.2). La especificación
también pide que el modelo admita roles personalizados sin que la Fase 2 incluya su interfaz.

## Decisión

### El catálogo vive en el código y se sincroniza con la base de datos

- `@letfer/shared` (`permissions.ts`) es la **única fuente** del catálogo de permisos y de la
  matriz de los roles de sistema (`SYSTEM_ROLE_DEFINITIONS`). API y web la comparten.
- Las tablas `permissions`, `roles` y `role_permissions` existen para poder relacionar y, en el
  futuro, personalizar. Al arrancar, `reconcileRbac` (idempotente, con bloqueo asesor) inserta o
  actualiza permisos y roles de sistema por su `key` y deja los permisos de cada rol de sistema
  **exactamente** como el catálogo. Añadir un permiso o retocar la matriz es un cambio de código,
  no una migración de datos. Las pruebas reconstruyen `letfer_test` con las migraciones y ejecutan
  la misma sincronización.
- Roles de sistema: `GLOBAL_ADMIN` y `USER` (globales); `PROJECT_OWNER` (implícito), `PROJECT_ADMIN`,
  `COLLABORATOR` y `READER` (de proyecto). Los roles personalizados (`key` nula, `project_id`
  propio) están soportados por el modelo y la evaluación, pero no tienen API ni interfaz todavía.

### Permisos efectivos

`permisos = unión(rol global, rol de la membresía activa, rol de propietario si lo es)`. Se evalúan
**en cada petición** con consultas a la base de datos: sin caché, así un cambio de rol, una
expulsión o una degradación surten efecto de inmediato (una caché por proceso rompería el
aislamiento al escalar y no aporta a esta escala). El Administrador Global tiene todos los
permisos y por eso accede a cualquier proyecto sin ser miembro.

### Aislamiento: 404 antes que 403

Quien no tiene acceso a un proyecto (ajeno, inexistente, en papelera sin permiso, `projectId` mal
formado) recibe siempre el **mismo 404**: no se revela si existe (§105.3). Quien sí tiene acceso
pero le falta el permiso recibe 403. Orden de los guards globales: origen (CSRF) → autenticación →
permiso global (`@RequireGlobalPermission`) → acceso al proyecto (`@ProjectRoute`, que además
inyecta el `ProjectAccess`) → reautenticación reciente (`@RequireRecentAuth`). El acceso va antes
que la reautenticación para no pedir la contraseña ante un 404.

### Límite de asignación (§98, §105.2)

Un rol solo se puede asignar (al invitar o cambiar de rol) si **es de proyecto, asignable (nunca
`PROJECT_OWNER` ni globales), pertenece al sistema o a ese proyecto y sus permisos son un
subconjunto de los del actor** (`isPermissionSubset`). Además, nadie gestiona (cambia de rol o
expulsa) a un miembro cuyo rol actual tenga permisos que el actor no tiene. Es lo que hace segura
la futura personalización de roles: un gestor con un rol reducido no puede escalar privilegios ni
degradar a alguien superior.

### Migración del rol global existente (3 pasos)

`drizzle-kit generate` es interactivo cuando cambia una columna de forma ambigua, así que el
cambio `system_role` → `global_role_id` se hizo en tres migraciones que se pueden revisar y
ejecutar sin intervención:

1. `0009`: tablas RBAC y `users.global_role_id` **nulable**.
2. `0010` (SQL personalizado): siembra los seis roles de sistema y rellena `global_role_id` desde
   `system_role`, sin tocar `updated_at` (se desactiva el disparador solo para el relleno).
3. `0011`: `global_role_id NOT NULL`, clave foránea y eliminación de `system_role`.

`migration-from-phase1.spec.ts` parte de un estado real de la Fase 1 (usuarios con sus roles,
sesiones y auditoría) y comprueba que todo se conserva.

## Consecuencias

- Una consulta o dos más por petición autenticada a proyectos (aceptable; se puede cachear por
  petición más adelante si hiciera falta).
- Añadir un permiso nuevo exige actualizar el catálogo y la matriz; la prueba de
  `permissions.spec.ts` y el sincronizador impiden que se desincronicen.
- La interfaz de roles personalizados (crear, editar, asignar) queda para una fase posterior; el
  modelo, la evaluación y el límite de asignación ya están probados.
