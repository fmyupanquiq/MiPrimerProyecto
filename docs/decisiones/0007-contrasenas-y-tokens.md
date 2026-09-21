# 0007. Contraseñas, tokens de recuperación y correo

- **Estado:** Aceptada (Fase 1)
- **Fecha:** 2026-09-21
- **Referencias:** especificación §41, §83, §84, §104.4, §104.9

## Contexto

El §41 exige un hash seguro de contraseñas y el §84 tokens de un solo uso guardados como hash y un
correo desacoplado del proveedor. ADR 0001 dejó la elección del algoritmo a la Fase 1.

## Decisión

### Hash de contraseñas: `argon2id` de `node:crypto`

- Node 24 incluye `crypto.argon2` (verificado en 24.19). No añade dependencias ni scripts de
  instalación (a diferencia de un paquete nativo, que npm 11 pide aprobar).
- Parámetros por defecto de OWASP: memoria 19 456 KiB, 2 pasadas, paralelismo 1 (~45 ms).
  Configurables (`ARGON2_*`); en las pruebas se bajan.
- Formato PHC (`$argon2id$v=19$m=…,t=…,p=…$sal$hash`): el hash lleva sus parámetros, así que se
  pueden endurecer después. `needsRehash` detecta hashes con parámetros distintos y el inicio de
  sesión los actualiza aprovechando que conoce la contraseña. Al leer un hash se validan límites
  de cordura para no ejecutar parámetros absurdos de datos corruptos.
- Sal aleatoria de 16 bytes por hash; comparación en tiempo constante; **NFKC** antes de hashear
  (la misma contraseña con distinta composición Unicode da el mismo resultado).

### Política de contraseñas (§104.4)

10 a 128 caracteres Unicode, sin reglas de composición, sin la parte local del correo. La
comprobación vive en `@letfer/shared` (ayuda en la web) y la repite la API (autoridad).
**Refinamiento técnico:** la parte local solo se compara cuando tiene 3 o más caracteres, porque
con 1 o 2 la regla vetaría casi cualquier contraseña.

### Recuperación de contraseña

- Token de 256 bits; en la base de datos solo su SHA-256. Válido 1 hora, **de un solo uso** con
  consumo atómico (`UPDATE … WHERE used_at IS NULL … RETURNING`): dos usos simultáneos, uno solo
  prospera. Un enlace nuevo invalida los anteriores; máximo 3 solicitudes por hora por usuario,
  serializadas por usuario.
- La solicitud responde igual exista o no el correo y el correo se envía **sin esperarlo**, para
  que la duración de la respuesta tampoco lo delate. Una contraseña que incumple la política no
  consume el token.
- Restablecer cierra todas las sesiones y levanta el bloqueo por intentos.

### Correo

`MailService` es un puerto (clase abstracta). El adaptador de desarrollo, `FileOutboxMailService`,
escribe cada mensaje como JSON en `.data/outbox/` (ignorado por Git) y solo registra el asunto: el
cuerpo contiene el enlace con el token. El proveedor real se elige al desplegar (Fase 11).
El cambio de correo (§104.9) avisa al correo anterior con la dirección nueva enmascarada
(`a***@dominio`); un fallo del envío no revierte el cambio.

### Bootstrap del Administrador Global (§83)

`npm run bootstrap:admin` lee `BOOTSTRAP_ADMIN_*` del entorno, es idempotente y seguro ante
ejecuciones simultáneas (bloqueo asesor), nunca sobrescribe una contraseña ni asciende a un
usuario existente, y no imprime la contraseña.

## Consecuencias

- Pendiente: un adaptador de correo real y las plantillas definitivas (Fase 11).
- Pendiente: purga de tokens de recuperación caducados (con las demás purgas, Fase 8/11).
