# 0010. Proyectos, membresías y ciclo de vida

- **Estado:** Aceptada (Fase 2)
- **Fecha:** 2026-09-21
- **Referencias:** especificación §5, §6, §9, §85, §87, §88, §89, §105.1, §105.4, §105.5, §105.6

## Contexto

El proyecto es la frontera de aislamiento de todo lo demás (equipos, banca, casas, etapas,
apuestas y auditoría). La Fase 2 crea los proyectos, sus miembros y su ciclo de vida. Cuatro
decisiones funcionales (F1 a F4) las tomó la persona responsable del producto y se documentan aquí
y en la especificación (§105).

## Decisiones funcionales (confirmadas)

- **F1.** Cualquier usuario activo con rol global `USER` puede crear proyectos (no es exclusivo del
  Administrador Global). Quien crea es el **propietario** y recibe su membresía de Administrador de
  Proyecto. El Administrador Global conserva el acceso global.
- **F2.** La Fase 2 solo crea el proyecto, el propietario y su membresía. Etapa 1, unidad de
  participación, capital inicial y casas de apuestas los completa la Fase 3.
- **F3.** Cerrar: propietario, Administrador de Proyecto y Global. Reabrir, enviar a la papelera y
  restaurar: propietario y Global (un Administrador de Proyecto solo con un permiso explícito de un
  rol personalizado). Las cuatro acciones exigen reautenticación y se auditan.
- **F4.** Solo el Administrador Global transfiere la propiedad (API ahora, interfaz en la Fase 8),
  con reautenticación y auditoría. El propietario anterior sigue como Administrador de Proyecto.

## Decisión técnica

### Integridad en la base de datos

- `projects` y `project_members` no se eliminan (`prevent_delete`); `updated_at` automático.
- **El propietario siempre es un miembro activo con rol Administrador de Proyecto.** Dos
  disparadores lo garantizan aunque alguien escriba SQL a mano: `protect_owner_membership` (antes
  de insertar o actualizar la membresía del propietario impide quitarla o degradarla) y una
  restricción diferida `projects_owner_membership` (al confirmar la transacción, el propietario
  debe cumplir lo anterior). El disparador diferido permite crear el proyecto y su membresía, o
  transferir la propiedad, dentro de una misma transacción en cualquier orden.
- `CHECK` de coherencia de la papelera: `TRASHED` ⇔ `deleted_at`, `previous_status` y
  `purge_eligible_at` presentes; `previous_status` solo `ACTIVE` o `CLOSED`.
- Moneda `PEN` con `CHECK` (no modificable, §105.6); zona horaria por defecto `America/Lima`,
  editable y auditada; formato de fecha por defecto `DD/MM/YYYY`.

### Membresías

Una fila por (proyecto, usuario), con estados `ACTIVE`, `LEFT` y `REMOVED`. Salir, ser expulsado y
volver **reutiliza la misma fila** (`addOrReactivate`): la historia queda ligada a la identidad
(§2, §105.4). Los correos de los miembros solo los ve quien puede gestionar roles; los listados de
quienes salieron o fueron expulsados también. El propietario no puede salir ni ser expulsado ni
cambiar de rol (`OWNER_PROTECTED`); nadie se expulsa a sí mismo (para eso está "Salir").

### Ciclo de vida

`ACTIVE ⇄ CLOSED`, y `ACTIVE`/`CLOSED` → `TRASHED` → estado anterior. Cada transición bloquea la
fila del proyecto (`SELECT … FOR UPDATE`) y valida el estado sobre la fila bloqueada: dos peticiones
simultáneas no se pisan (una gana; la otra recibe 409 `INVALID_STATE`). La papelera guarda el estado
anterior, fecha, autor y motivo, y fija `purge_eligible_at = ahora + 90 días`. **No hay purga
automática** (§105.5): la fecha solo indica hasta cuándo el proyecto queda garantizado como
restaurable. Un proyecto en la papelera es invisible (404) salvo para propietario y Global, y solo
en las rutas que lo admiten (`allowTrashed`). Editar un proyecto cerrado sigue permitido: la
especificación no lo prohíbe y no se inventó la regla.

### Transferencia de la propiedad

`POST /projects/:id/transfer-ownership` exige el permiso **global** `projects.transfer_ownership`
(por eso el propietario recibe 403), reautenticación y un destinatario que sea miembro activo con
cuenta activa. En una transacción: bloquea proyecto y membresía, asciende al destinatario a
Administrador de Proyecto si no lo era, cambia `owner_id` y audita (`project.ownership_transferred`
y, si hubo ascenso, `member.role_changed`).

### Auditoría

`project.created|updated|closed|reopened|trashed|restored|ownership_transferred`,
`member.role_changed|removed|left`. Todas con `project_id` (ahora con clave foránea), actor, valores
anterior y nuevo, en la misma transacción que la operación: si esta falla, no queda nada a medias.

## Consecuencias

- Reordenación del plan: las tablas de proyectos (T4) se hicieron antes que los guards de
  autorización de proyecto (T3), porque estos necesitan la tabla para existir.
- Cuando la Fase 3 cree la Etapa 1 y el resto de la configuración inicial, lo hará sobre proyectos
  que ya existen y cumplen estos invariantes.
- La purga física de proyectos (si algún día se decide) deberá respetar `purge_eligible_at` y la
  inmutabilidad de la auditoría (§35): queda fuera de la Fase 2.
