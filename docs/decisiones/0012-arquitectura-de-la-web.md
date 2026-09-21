# 0012. Arquitectura de la web (Fase 2)

- **Estado:** Aceptada (Fase 2)
- **Fecha:** 2026-09-21
- **Referencias:** especificación §39, §58, §62, §105; ADR 0006, 0009, 0011

## Contexto

La Fase 2 convierte la web en una aplicación con varias pantallas, permisos y flujos sensibles
(reautenticación, invitaciones por enlace). El diseño visual definitivo llega más adelante (§62):
aquí se fija la estructura, no la estética.

## Decisión

- **Capa de API por dominio** (`src/api/*.ts`) sobre un único `apiFetch` que envía la cookie de
  sesión HttpOnly. Los tipos y esquemas vienen de `@letfer/shared`: web y API validan igual.
- **La interfaz solo mejora la experiencia; la autoridad es la API.** `useAuth().can(permiso)`
  (permisos globales, de `GET /auth/me`) y `useProject().can(permiso)` (permisos efectivos del
  proyecto, de `GET /projects/:id`) muestran u ocultan acciones, pero toda operación se valida en
  el servidor y los errores 403/404 se muestran de forma comprensible.
- **Rutas.** Autenticadas dentro de un marco con navegación: `/` (Mis proyectos y alta),
  `/projects/trash`, `/projects/:projectId` (Resumen, `members`, `settings`). `/invite?token=` es
  **pública** (quien recibe el enlace puede no tener cuenta). Un proyecto ajeno o inexistente
  muestra el mismo "no encontrado". La cabecera del proyecto muestra "Etapa: sin etapa activa"
  hasta que la Fase 3 cree las etapas.
- **Volver tras iniciar sesión.** `RequireAuth` redirige a `/login?next=<ruta>`; `safeNextPath`
  solo admite rutas internas (rechaza URLs absolutas, `//host` y `/\host`) para que el parámetro no
  sea una redirección abierta.
- **Acciones sensibles: `runWithReauth`.** Si la API responde `REAUTH_REQUIRED`, se abre un cuadro
  de contraseña, se confirma con `POST /auth/reauth` y la acción se reintenta **una vez**. Cancelar
  no ejecuta la acción ni muestra error. Se usa en cerrar, reabrir, papelera y restaurar.
- **Confirmaciones en línea**, no `window.confirm` ni `<dialog>` nativo: son accesibles, se pueden
  probar y funcionan igual en todos los navegadores. El cuadro de contraseña es un
  `role="dialog" aria-modal`.
- **Carga de datos: `useLoad(clave, cargador)`.** Recarga al cambiar la clave, conserva los datos
  previos mientras recarga y solo cambia estado desde callbacks asíncronos (compatible con las
  reglas de `react-hooks`). Tras una escritura que falla por versión obsoleta se recarga la lista.
- **El enlace de invitación se ve una sola vez** (panel de miembros → "Nueva invitación"): vive
  solo en el estado del componente, con "Copiar enlace" y, si el navegador no permite el
  portapapeles, el texto queda seleccionado. Al cerrarlo o salir de la pantalla desaparece.
- **Página de invitación.** Vista previa; sin sesión, formularios de "Crear cuenta" e "Ya tengo
  cuenta" en la misma página (el token no se pierde); con sesión, "Aceptar", "Rechazar" y "Usar
  otra cuenta". Crear la cuenta no acepta la invitación y la página lo dice. `index.html` declara
  `referrer: no-referrer`.
- **No se ofrece** la transferencia de propiedad (F4: interfaz en la Fase 8), la gestión de roles
  personalizados ni el envío de invitaciones por correo.

## Pruebas

Testing Library con un simulador de `fetch` (`stubApi`) que falla ante cualquier petición no
prevista. Cubren cada pantalla, los permisos por rol, la reautenticación (éxito, contraseña
incorrecta y cancelación), los conflictos de versión y todo el recorrido de la invitación.

## Consecuencias

- Al llegar el diseño visual se sustituyen clases y componentes de `ui.tsx`/`AuthLayout.tsx` sin
  tocar la lógica.
- Los permisos de la interfaz pueden quedar desactualizados unos segundos si otra persona cambia
  un rol; la API siempre decide y la pantalla se corrige al recargar.
