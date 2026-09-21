# 0011. Invitaciones y registro por invitación

- **Estado:** Aceptada (Fase 2)
- **Fecha:** 2026-09-21
- **Referencias:** especificación §84, §98, §105.7, ADR 0007 (tokens)

## Contexto

Se entra a un proyecto por invitación (§84). El enlace es una credencial: quien lo tiene puede
ingresar. Hay que decidir cómo guardarlo, cuándo deja de servir, qué pasa con las carreras y qué
se revela a quien no está autorizado.

## Decisión

### Token y enlace

- 256 bits aleatorios (`randomBytes(32)`, base64url, 43 caracteres). En la base de datos **solo
  se guarda su hash SHA-256** (índice único): quien lea la base no puede aceptar invitaciones ni
  reconstruir enlaces.
- El enlace (`APP_BASE_URL/invite?token=…`) se devuelve **una sola vez**, en la respuesta de la
  creación. No se puede volver a mostrar y las listas no lo incluyen. Si se pierde, se crea otra.
- El token viaja en la URL (`?token=`, como el de recuperación de contraseña) para que abrir el
  enlace funcione en cualquier navegador. Para que no se filtre: `<meta name="referrer"
content="no-referrer">` en `index.html`, respuestas con `Cache-Control: no-store` y ni el token
  ni su hash aparecen jamás en la auditoría (el correo restringido se audita enmascarado).

### Parámetros

Vencimiento 24 horas, 7, 15 o 30 días, o sin vencimiento hasta deshabilitarla; un solo uso o
reutilizable; restricción opcional a un correo (normalizado). **Por defecto: un solo uso y 7 días**
(lo más prudente si la persona no elige). El rol de ingreso lo define quien invita, dentro del
límite de asignación (ADR 0009). Solo se crean en proyectos `ACTIVE`.

### Estado derivado

No se guarda: `DISABLED` > `ACCEPTED` (solo uso único ya consumido) > `EXPIRED` > `ACTIVE`, calculado
al consultar con el `Clock`. Deshabilitar es irreversible e idempotente.

### Integridad en la base de datos

`invitations` y `invitation_acceptances` no se eliminan; las aceptaciones son un registro
inmutable. Un disparador impide modificar lo que define la invitación (proyecto, rol, creador,
token, uso, vencimiento, correo) y revertir su consumo o deshabilitación. `CHECK`: el consumo solo
existe en las de un solo uso y con su usuario; deshabilitar exige fecha y responsable; el correo
restringido está normalizado.

### Aceptar (atómico e idempotente)

En una transacción se **bloquea la fila de la invitación** (`FOR UPDATE`) y se consume con
`UPDATE … WHERE consumed_at IS NULL`, de modo que dos personas no pueden usar a la vez un enlace de
un solo uso (una entra, la otra recibe `INVALID_TOKEN`). Reglas:

- Quien ya es miembro activo no duplica su membresía **ni cambia su rol**, y no consume el enlace.
- Quien había salido o fue expulsado y acepta una invitación **nueva** reactiva su misma
  membresía con el rol de la invitación.
- **Una persona solo usa una misma invitación una vez.** Si ya la usó y luego salió (o la
  expulsaron), el mismo enlace no la readmite: necesita una invitación nueva. Así una expulsión no
  se puede deshacer con un enlace reutilizable que la persona conserva.
- Rechazar solo se audita: no consume ni deshabilita el enlace.

### Cuándo deja de ser válida

Además de vencida, deshabilitada o consumida: si el proyecto no está `ACTIVE`, o si su **creador ya
no está autorizado** (su cuenta se desactivó, salió del proyecto, o ya no tiene `invitations.create`
o no puede asignar ese rol). Se evalúa al usar el enlace, no al crearlo. Si el creador recupera su
autorización, la invitación vuelve a servir (no se destruye).

### Qué se revela

Cualquier enlace inválido (mal formado, inexistente, usado, vencido, deshabilitado, de un proyecto
cerrado, de un creador no autorizado) responde **exactamente lo mismo**: 400 `INVALID_TOKEN`. La
vista previa (pública) solo muestra proyecto, rol, quién invita, vigencia y el correo restringido
enmascarado. Los tres endpoints usan el límite de tasa estricto. Una invitación restringida a otro
correo responde 403 genérico al aceptar o rechazar; la restricción siempre se valida en el
servidor.

### Registro por invitación (`POST /auth/register`)

Público, con límite estricto. Exige un enlace utilizable (validado antes de hashear nada y otra vez
dentro de la transacción), respeta la restricción por correo y la política de contraseña, y crea la
cuenta con rol global `USER` (el cuerpo no puede elegirlo) y **sesión abierta**, pero **no acepta la
invitación**: aceptarla o rechazarla es un paso posterior y explícito de la persona. Un correo ya
registrado responde 409 `EMAIL_IN_USE`: revela que la cuenta existe, pero solo a quien ya posee un
enlace válido (256 bits), y es lo que permite a la web sugerir "inicia sesión" en lugar de dejar a
la persona sin salida.

## Consecuencias

- Compartir un enlace reutilizable equivale a compartir la entrada: conviene fijar vencimiento y
  deshabilitarlo cuando ya no haga falta (la interfaz lo facilita).
- No hay correo automático de invitación: el enlace se copia y se envía por el canal que se prefiera.
  El envío por correo se puede añadir sobre `MailService` sin cambiar este modelo.
