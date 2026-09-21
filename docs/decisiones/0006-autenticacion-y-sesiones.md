# 0006. Autenticación, sesiones y protección de la API

- **Estado:** Aceptada (Fase 1)
- **Fecha:** 2026-09-21
- **Referencias:** especificación §3, §39, §41, §84, §104

## Contexto

La web actual y la futura app móvil compartirán la API (§1). Las sesiones deben poder listarse y
revocarse (§3), el bloqueo por intentos es obligatorio (§41) y los permisos se validan en el
servidor (§39).

## Decisión

### Sesiones con token opaco (no JWT)

- Token aleatorio de 256 bits (`randomBytes(32)`, base64url, 43 caracteres). En la base de datos
  solo se guarda su **SHA-256** (`sessions.token_hash`): una filtración de la base de datos no
  permite suplantar sesiones. No lleva sal ni coste porque ya es de alta entropía.
- Se eligió una sesión con estado en lugar de JWT porque el §3 exige **revocación y listado**
  inmediatos; con JWT la revocación es un problema aparte.
- Expiración (§104.2): por inactividad (ventana deslizante) y absoluta, según el modo. Con
  "Mantener sesión": 30 días / 90 días. Sin ella: 1 hora / 12 horas. Los valores son
  configuración, no constantes.
- `last_seen_at` solo se escribe si pasó el intervalo mínimo (60 s) para no generar una
  escritura por petición.
- Una sesión solo vale si la cuenta está `ACTIVE`; desactivar o eliminar la cuenta **revoca sus
  sesiones** (si no, reactivarla las revivía).

### Cookie y CSRF

- La web recibe el token en una cookie `HttpOnly`, `SameSite=Lax`, `Path=/`; en producción
  `Secure` y con el prefijo `__Host-` (el navegador exige `Secure`, ruta `/` y sin `Domain`).
  Con "Mantener sesión" la cookie es persistente (90 días); si no, es de sesión del navegador. El
  token **nunca** va en el cuerpo de la respuesta, así que el JavaScript de la web no lo ve.
- La API acepta también `Authorization: Bearer` (base para la app móvil). Aún no existe un
  inicio de sesión que devuelva el token en el cuerpo: se añadirá con la app móvil.
- Protección CSRF: además de `SameSite=Lax`, las peticiones que modifican datos (`POST`, `PUT`,
  `PATCH`, `DELETE`) deben traer `Origin` igual al de la web configurada o, sin `Origin`,
  `Sec-Fetch-Site` en `same-origin`/`none`. Las peticiones con `Authorization: Bearer` no usan
  cookies y se omiten. No se habilita CORS (mismo origen; en desarrollo, proxy de Vite).

### Denegar por defecto

- `AuthGuard` global: toda ruta exige sesión salvo las marcadas con `@Public()` (hoy: health,
  login, recuperación de contraseña). `RecentAuthGuard` + `@RequireRecentAuth()` exigen una
  contraseña confirmada en los últimos 5 minutos (§104.5) y lo usarán retiros, restauraciones y
  otras acciones sensibles.
- Orden de guards: límite de tasa → origen → autenticación → reautenticación reciente.

### Bloqueo por intentos (§104.3) y respuestas uniformes

- Tabla `login_attempts` **por correo normalizado**, no por usuario, de modo que un correo
  inexistente se comporta igual que uno existente. 5 fallos en 15 minutos bloquean 15 minutos.
- Correo inexistente, contraseña incorrecta y cuentas `DISABLED`/`DELETED` devuelven la
  **misma respuesta** y hacen el mismo trabajo de hash (`verifyDummy`).
- Los intentos de un mismo correo se **serializan con un bloqueo asesor de PostgreSQL**, de modo
  que el conteo es exacto aunque lleguen en paralelo. Los intentos durante el bloqueo no se
  registran, por lo que no lo prolongan. Confirmar la contraseña desde una sesión abierta (cambiar
  contraseña o correo, reautenticar) comparte el mismo contador.
- "Después del último acceso correcto" se decide por una **secuencia de inserción**
  (`seq`), no por marcas de tiempo (ver Problemas).

### Límite de tasa por IP

`@nestjs/throttler`: limitador `default` para toda la API y `auth` (más estricto) para los
endpoints marcados con `@AuthRateLimit()`. Con un proxy inverso hay que fijar `TRUST_PROXY_HOPS`;
con 0 se ignora `X-Forwarded-For` para que nadie pueda falsear su IP.

## Problemas encontrados y resueltos

- **`AsyncLocalStorage` se perdía tras el analizador del cuerpo** si se abría antes con
  `app.use`; el contexto de petición se registra como middleware de módulo (posterior).
- **`THROTTLE_ENABLED` no se aplicaba**: el `skipIf` global se ignora en los limitadores que
  definen el suyo. El interruptor va ahora en cada `skipIf`.
- **El conteo de fallos comparaba marcas de tiempo con `>`**: con la misma marca (reloj congelado,
  y en teoría el mismo milisegundo) descartaba fallos. Se ordena por `seq`.
- `@Body(schema)` no valida en Nest 12: la forma correcta es `@Body({ schema })`.

## Consecuencias y pendientes

- El limitador de tasa está en memoria: válido para una instancia. Con varias habrá que usar un
  almacén compartido.
- `login_attempts` solo se depura al haber un acceso correcto: los correos que nunca acceden
  acumulan filas. Se necesita una tarea de purga periódica (Fase 8/11).
- Las sesiones expiradas o revocadas tampoco se purgan aún.
