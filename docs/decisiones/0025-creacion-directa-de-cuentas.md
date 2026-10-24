# 0025. Creación directa de cuentas por el Administrador Global

- **Estado:** Aceptada e implementada.
- **Fecha:** 2026-10-24
- **Referencias:** especificación §84, §104.4, §105.1, §105.7, §111.3; ADR 0009-0012 (invitaciones),
  ADR 0018 (administración).

## Contexto

Hasta ahora la única forma de obtener una cuenta con contraseña propia era el registro por
invitación (§84, §105.7): alguien con `invitations.create` genera un enlace, la persona lo abre,
se registra eligiendo su propia contraseña y luego acepta unirse al proyecto. Es el camino correcto
cuando el futuro dueño de la cuenta puede abrir el enlace él mismo.

El dueño del producto pidió un segundo camino: poder crear él mismo la cuenta de un colaborador
—correo, nombre y una contraseña inicial que él elige— para comunicársela por fuera de LetFer,
sin que la persona tenga que pasar primero por un enlace de invitación.

## Decisión

1. **Nuevo permiso global `system.users.create`**, exclusivo del Administrador Global (como todo
   `system.*`, ADR 0016). No se añade a `USER` ni a ningún rol de proyecto.
2. **`POST /admin/users`** (`AdminUsersController`/`AdminUsersService`) crea la cuenta: nace
   **activa**, con el rol global `USER` (§105.1) — nunca se crea ya como Administrador Global desde
   aquí. Reutiliza `UsersService.create` (el mismo que usa el registro por invitación y el
   bootstrap del primer administrador) y la misma política de contraseñas
   (`passwordPolicyIssues`, §104.4: 10-128 caracteres, no puede contener la parte local del correo).
3. **La contraseña la escribe quien crea la cuenta, no su futuro dueño.** Es la diferencia de fondo
   con el registro por invitación. Por eso la ruta exige `@RequireRecentAuth()` (§39), igual que
   deshabilitar una cuenta o revocar sus sesiones: es una acción sensible porque la contraseña
   queda en conocimiento de un tercero hasta que su dueño la cambie.
4. **No hay generación automática ni cambio de contraseña obligatorio en el primer ingreso.** Se
   evaluó que el sistema generara una contraseña temporal mostrada una sola vez (como el enlace de
   invitación) con cambio forzoso al entrar, pero el dueño del producto prefirió escribirla él
   mismo; añadir un cambio forzoso habría exigido una columna nueva (`mustChangePassword` o
   similar) y tocar el flujo de login sin que se haya pedido. **Queda fuera de alcance**: puede
   revisitarse si en el futuro se decide pedirlo.
5. **No sustituye a las invitaciones.** Una cuenta creada así se invita a un proyecto exactamente
   igual que cualquier otra cuenta existente (inicia sesión y acepta el enlace, §105.7): no hace
   falta tocar `InvitationAcceptanceService` ni `RegistrationService`.
6. **Auditoría** (`admin.user.created`): actor, id de la cuenta creada y su correo; nunca la
   contraseña ni su hash.
7. **Web:** botón "Crear cuenta" en `AdminUsersPage` (visible solo con `system.users.create`), con
   el mismo patrón `useReauth`/`runWithReauth` que deshabilitar o revocar sesiones. Tras crear, se
   recarga la lista y se avisa que hay que comunicarle el correo y la contraseña a la persona por
   fuera de LetFer.

## Consecuencias

- Sin migración: el catálogo de permisos se sincroniza solo al arrancar (`reconcileRbac`); no hay
  columnas ni tablas nuevas.
- `AdminModule` pasa a importar `AuthModule` (para inyectar `PasswordHasher`).
- Límite conocido (D4 de esta decisión): nadie fuerza que la contraseña inicial se cambie. Si se
  decide exigirlo más adelante, es una fase aparte.
- **Pruebas:** `admin-users.e2e-spec.ts` (permiso, reautenticación, política de contraseñas, correo
  duplicado, auditoría sin la contraseña, y que la cuenta creada se puede invitar después como
  cualquier otra) y `AdminUsersPages.spec.tsx` (botón gateado por permiso, formulario, reautenticación,
  errores del servidor, cancelar).
