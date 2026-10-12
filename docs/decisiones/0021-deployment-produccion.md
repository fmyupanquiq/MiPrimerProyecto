# 0021. Despliegue de producción (primera versión)

- **Estado:** Propuesta (Fase 12, subfase 2A). Lo marcado **PENDIENTE** no está decidido.
- **Fecha:** 2026-10-12
- **Referencias:** especificación §37, §41, §82, §84, §109.3; ADR 0002, 0016, 0017, 0018;
  `docs/GUIA_DEPLOY_PRODUCCION.md`; `deploy/`

## Contexto

LetFer funciona hasta ahora solo en desarrollo y ensayo (`letfer_dev`, `letfer_test`,
`letfer_trial`). Para registrar datos reales hace falta un despliegue reproducible. Este ADR
fija la arquitectura inicial y deja explícito qué falta decidir. **No se ha desplegado nada.**

## Decisiones (basadas en el código y la configuración ya existentes)

### Arquitectura

Un VPS Linux con tres procesos: **PostgreSQL 17**, la **API NestJS** (systemd, una sola
instancia) y **Caddy**. Caddy termina HTTPS, sirve la web compilada (`apps/web/dist`) y reenvía
`/api/*` a `127.0.0.1:3000`. Web y API comparten origen, por lo que no hay CORS.
Es adecuada para un equipo pequeño. Límites asumidos: un único punto de fallo y **una sola
instancia de la API** (el limitador de tasa vive en memoria y los backups y el mantenimiento
diarios se programan dentro del propio proceso).

### Build y artefactos

`npm run build` (raíz) construye, en este orden, `packages/shared` → `packages/shared/dist`,
`apps/api` (`nest build`) → `apps/api/dist` (con `dist/main.js` y `dist/cli/*.js`) y `apps/web`
(`vite build`) → `apps/web/dist`. La API consume `shared` ya compilado. Las migraciones SQL se
leen de `apps/api/drizzle` (no se compilan). Node `>=24.15 <25` y npm `>=11` (`engines`,
`engine-strict`). Las dependencias están fijadas sin `^`.

### Migraciones y bootstrap desde `dist/`

- `npm run migrate` (raíz, equivale a `node apps/api/dist/cli/migrate.js`) aplica las migraciones
  pendientes sobre `DATABASE_URL`. Es idempotente y nunca borra datos. No usa `drizzle-kit`, que
  es de desarrollo (`db:migrate` queda solo para desarrollo).
- `npm run bootstrap:admin:built` (nuevo en 2A) ejecuta `dist/cli/bootstrap-admin.js` **sin
  recompilar**. `npm run bootstrap:admin` (con `nest build`) se conserva para desarrollo. La lógica
  del bootstrap no cambió. Carga la configuración completa de la API, por lo que necesita el
  entorno de producción completo, no solo `DATABASE_URL`.
- Orden definido: **BUILD → MIGRATE → BOOTSTRAP (solo la primera vez) → START**.
- No hay seeds. El RBAC se sincroniza al arrancar la API (`reconcileRbac`).

### Configuración y separación de entornos

Un archivo fuera del repositorio, `/etc/letfer/letfer.env` (`root:letfer`, 0640), cargado por
systemd con `EnvironmentFile`. Plantilla: `deploy/production.env.example`. La API valida todo al
arrancar y falla nombrando la variable, nunca su valor. La web no tiene variables en ejecución.

| Entorno | Base | Observaciones |
| --- | --- | --- |
| Desarrollo | `letfer_dev` | `npm run dev`, PostgreSQL embebido, correo a archivos |
| Pruebas | `letfer_test` | solo `npm test` |
| Ensayo | `letfer_trial` | datos de prueba; **no se migran a producción** |
| Producción | base propia, p. ej. `letfer_prod` (nombre **PENDIENTE**) | usuario propio |

**Salvaguarda (Fase 1):** con `NODE_ENV=production` la API rechaza `DATABASE_URL` si la base se
llama exactamente `letfer_dev`, `letfer_test` o `letfer_trial`. Limitación conocida: `npm run
migrate` y el bootstrap de la CLI no consultan `NODE_ENV`; el bootstrap sí pasa por esa
validación porque carga la configuración completa, `migrate` no.

### IA de tickets

`AI_TICKETS_ENABLED` ausente → activa en desarrollo/pruebas y **desactivada en producción**.
`false` → desactivada, sin clave. `true` → activa y **exige** `ANTHROPIC_API_KEY` (sin ella la API
no arranca). La clave solo existe en el servidor. Con la IA apagada, "Leer ticket con IA"
responde 409 `INVALID_STATE` sin registrar intento. Llamada a Anthropic: `AI_TIMEOUT_SECONDS=60`,
`AI_MAX_RETRIES=1`. Activar la IA es una fase posterior.

### Correo

SMTP por nodemailer (`SMTP_HOST`, `MAIL_FROM` obligatorios en producción; STARTTLS obligatorio
salvo `SMTP_SECURE=true`). Correos que envía LetFer: recuperación de contraseña y aviso al correo
anterior al cambiar el email. Las invitaciones no envían correo (el enlace se muestra una vez).
**PENDIENTE:** elegir proveedor, dominio de envío y SPF/DKIM/DMARC; probar el flujo real.

### Tickets y backups

Los tickets viven en `TICKETS_DIR` (ruta absoluta obligatoria en producción) con permisos
0700/0600. Los backups (`pg_dump -Fc` + `tar` de tickets, diarios 03:00 UTC, 30 generaciones) se
escriben en `BACKUP_DIR`, necesitan `pg_dump`/`pg_restore` 17 y `tar`. **Un backup solo en el mismo
VPS no se considera suficiente.** Debe protegerse como mínimo PostgreSQL y los tickets fuera del
servidor.
**PENDIENTE:** destino externo, cifrado, frecuencia, alerta de fallo y la prueba de restauración
(fase posterior). La restauración usa `pg_restore --clean` con el usuario de la aplicación, que
debe ser dueño de los objetos: sin verificar.

### Logs y salud

Logger de Nest a stdout (journald bajo systemd) y log de acceso de Caddy, que elimina `?token=`.
No hay logs estructurados ni alertas. `GET /api/health` comprueba la base (`SELECT 1`) y está
exento del modo mantenimiento. **PENDIENTE:** chequeo externo y alertas (disco, backups, 5xx).

### Actualización y rollback

Procedimiento propuesto (a validar en staging): backup previo → detener la API → traer la versión
etiquetada → `npm ci` → `npm run build` → `npm run migrate` → arrancar → comprobar `/api/health`.
Se detiene la API antes de compilar porque `nest build` borra `dist/`. El código se revierte
volviendo a la etiqueta anterior; **las migraciones solo avanzan**, así que, si una migración nueva
ya se aplicó, la vuelta atrás real es restaurar el backup previo (pierde lo posterior).
**PENDIENTE:** despliegue sin tiempo de parada (directorios por versión) si hace falta.

## PENDIENTE de decidir

Proveedor de VPS y sistema operativo; dominio; proveedor SMTP; destino y política del backup
externo; nombre definitivo de la base y del usuario de producción; monitorización; si se compila
en el servidor o en otra máquina; entorno de staging (existe un script local de prueba de humo,
`scripts/staging-smoke.mjs`, que **no está versionado** y queda pendiente de incorporarse al
repositorio); verificación del correo nuevo al cambiar el email (ver informe de la Fase 1).

## Consecuencias

El software ya puede desplegarse de forma reproducible desde `dist/`. Falta toda la
infraestructura, el correo real, los backups externos y su prueba de restauración antes de
introducir datos reales.
