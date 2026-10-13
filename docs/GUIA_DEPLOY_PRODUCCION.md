# Guía de despliegue en producción

> **No se ha ejecutado nada de esta guía.** Es la preparación del futuro despliegue (ADR 0021).
> Todo lo marcado **[PENDIENTE DE DEFINIR]** depende de una decisión que aún no se ha tomado.
> Los comandos de **LetFer** salen de los scripts reales del repositorio; los de **sistema
> operativo** (usuarios, paquetes, systemd) son los habituales en Linux y deben confirmarse con la
> distribución elegida **[PENDIENTE DE DEFINIR]**.

## 1. Objetivo

Desplegar LetFer en un VPS Linux de forma reproducible, con HTTPS, PostgreSQL persistente, tickets
en disco persistente y backups fuera del servidor, para empezar a registrar datos reales.

### Entornos

| Entorno | Base de datos | Para qué | Comandos |
| --- | --- | --- | --- |
| DESARROLLO | `letfer_dev` | programar | `npm run dev`, `npm run db:start`, `npm run db:migrate` |
| PRUEBAS | `letfer_test` | `npm test` | automático |
| ENSAYO | `letfer_trial` | pruebas manuales con datos ficticios | (`docs/GUIA_ENTORNO_ENSAYO.md`) |
| STAGING | base propia, nombre [PENDIENTE DE DEFINIR] | ensayo general del despliegue en un servidor igual al real | prueba de humo local `scripts/staging-smoke.mjs`, **no versionada** y pendiente de incorporar (**nunca** contra producción) |
| PRODUCCIÓN | base propia, p. ej. `letfer_prod` [PENDIENTE DE DEFINIR] | datos reales | esta guía |

Los datos de ensayo **no se migran** a producción. En producción la API se niega a arrancar si la
base se llama `letfer_dev`, `letfer_test` o `letfer_trial`.

## 2. Arquitectura

```text
Internet → Caddy (80/443, HTTPS automático)
             ├─ /api/*  → API NestJS en 127.0.0.1:3000 (systemd, una instancia)
             └─ resto   → archivos estáticos de apps/web/dist
API → PostgreSQL 17 (localhost)  ·  /var/lib/letfer/tickets  ·  /var/lib/letfer/backups
```

Web y API comparten origen: sin CORS. La web no necesita variables de entorno.

## 3. Requisitos del servidor

- Linux con systemd [PENDIENTE DE DEFINIR: proveedor y distribución]. 2 GB de RAM y 40 GB de
  disco como punto de partida.
- Node.js `>=24.15 <25` y npm `>=11` (`engines` con `engine-strict`).
- PostgreSQL 17 y sus herramientas cliente (`pg_dump`, `pg_restore`), `tar`, Caddy.
- Un dominio con registro A (y AAAA si hay IPv6) hacia el servidor [PENDIENTE DE DEFINIR].

## 4. Preparación del sistema

Cortafuegos con solo 22, 80 y 443; SSH solo con clave; actualizaciones de seguridad automáticas;
PostgreSQL escuchando solo en localhost. Instalar Node 24, PostgreSQL 17 (con
`postgresql-client-17`), Caddy y `git`.

## 5. Usuario de servicio

Un usuario sin login, `letfer`, dueño de los datos y de la ejecución de la API (la unidad
`deploy/letfer-api.service` usa `User=letfer`, `Group=letfer`).

## 6. Directorios

| Ruta | Contenido |
| --- | --- |
| `/opt/letfer/app` | el repositorio (la unidad y el Caddyfile suponen esta ruta) |
| `/etc/letfer/letfer.env` | configuración y secretos, `root:letfer`, 0640 |
| `/var/lib/letfer/tickets` | `TICKETS_DIR` |
| `/var/lib/letfer/backups` | `BACKUP_DIR` |
| `/var/log/caddy` | log de acceso |

La unidad solo puede escribir en `/var/lib/letfer` (`ReadWritePaths`): no muevas `TICKETS_DIR` ni
`BACKUP_DIR` fuera de ahí sin ajustarla. Nunca debe existir un `.env` dentro de `/opt/letfer/app`
(la API lo cargaría sin sobrescribir lo que ya trae `EnvironmentFile`).

## 7. PostgreSQL

Crear una base de producción y un usuario propios, que sea **dueño** de la base (las migraciones
crean tablas, funciones y disparadores; no usan extensiones ni requieren superusuario, y la
restauración de backups con `pg_restore --clean` necesita ser dueño de los objetos). Nombres y
contraseña [PENDIENTE DE DEFINIR]. Nunca reutilizar `letfer_dev`, `letfer_test` ni `letfer_trial`,
ni restaurar en ella un backup de ensayo.

## 8. Variables de entorno

Copiar `deploy/production.env.example` a `/etc/letfer/letfer.env`, rellenar y proteger
(`chown root:letfer`, `chmod 0640`). Obligatorias en producción: `NODE_ENV=production`,
`APP_BASE_URL` (HTTPS, igual al dominio del Caddyfile), `DATABASE_URL`, `TICKETS_DIR` y
`BACKUP_DIR` (absolutas). SMTP es opcional. `TRUST_PROXY_HOPS=1` (Caddy).

**IA de tickets** (`AI_TICKETS_ENABLED`):

| En producción | Resultado |
| --- | --- |
| ausente | IA desactivada, sin clave |
| `false` | IA desactivada, sin clave |
| `true` + `ANTHROPIC_API_KEY` | IA activa |
| `true` sin clave | la API **no arranca** |

No dejes variables vacías (`VAR=`): cuentan como inválidas; borra la línea.

## 9. Instalación de dependencias

Como `letfer`, desde `/opt/letfer/app`, con la versión etiquetada: `npm ci`. Se instalan también
las dependencias de desarrollo porque `npm run build` las necesita (TypeScript, Nest CLI, Vite).
Recortarlas después (`npm prune --omit=dev`) o compilar en otra máquina y subir solo los
artefactos queda **[PENDIENTE DE DEFINIR]** y sin verificar.

Dependencias de la API en ejecución: `@nestjs/*`, `drizzle-orm`, `pg`, `nodemailer`,
`@anthropic-ai/sdk`, `exceljs`, `helmet`, `uuid`, `zod`, `rxjs`, `reflect-metadata` y
`@letfer/shared` (este último necesita su `dist/`).

## 10. Build

`npm run build` (raíz) compila, en orden, `packages/shared/dist`, `apps/api/dist` y `apps/web/dist`.
`nest build` **borra** `apps/api/dist` antes de compilar: detén la API antes de volver a compilar.

## 11. Migraciones

`npm run migrate` (raíz) → `node apps/api/dist/cli/migrate.js`. Lee `DATABASE_URL`, aplica las
pendientes (42 hoy en `apps/api/drizzle`), es idempotente y solo imprime el nombre de la base. No
carga `NODE_ENV`, así que **comprueba tú el nombre de la base** antes de ejecutarlo. Con el
entorno de producción: `node --env-file=/etc/letfer/letfer.env apps/api/dist/cli/migrate.js`
ejecutado como `letfer` [PENDIENTE DE VERIFICAR en staging]. `db:migrate` (drizzle-kit) es solo
para desarrollo.

## 12. Bootstrap inicial

Solo la primera vez, tras migrar. Crea el primer Administrador Global (idempotente: si ya existe,
no cambia nada). Necesita `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`,
`BOOTSTRAP_ADMIN_FIRST_NAME` y `BOOTSTRAP_ADMIN_LAST_NAME` **y el entorno de producción
completo**, porque arranca la configuración de la API. En producción usa el artefacto compilado,
sin Nest CLI: `npm run bootstrap:admin:built` (equivale a `node dist/cli/bootstrap-admin.js`
desde `apps/api`). `npm run bootstrap:admin` (con `nest build`) es solo para desarrollo.

Pasa las cuatro variables **por el entorno del proceso, sin guardarlas en `letfer.env` ni en el
historial de la shell** (p. ej. con `read -rs`). Con `node --env-file=/etc/letfer/letfer.env` las
variables del proceso tienen prioridad sobre las del archivo. El mecanismo exacto con `sudo -u
letfer` [PENDIENTE DE VERIFICAR en staging]. Después, inicia sesión y cambia la contraseña.

## 13. API

`deploy/letfer-api.service` → `/etc/systemd/system/letfer-api.service`; ejecuta
`node dist/main.js` con `WorkingDirectory=/opt/letfer/app/apps/api` y
`EnvironmentFile=/etc/letfer/letfer.env`; `Restart=on-failure`. Es compatible con el build actual.
Activar con `systemctl daemon-reload && systemctl enable --now letfer-api`; reiniciar con
`systemctl restart letfer-api`; logs con `journalctl -u letfer-api`. Una sola instancia: no
escalar horizontalmente (limitador en memoria y programadores internos).

## 14. Frontend

Es estático: `apps/web/dist` (de `npm run build`). Lo sirve Caddy; no hay proceso de Node para la
web ni variables de entorno.

## 15. Caddy

`deploy/Caddyfile` → `/etc/caddy/Caddyfile`, sustituyendo `letfer.example.com` por el dominio real
[PENDIENTE DE DEFINIR]. Valida con `caddy validate --config /etc/caddy/Caddyfile`. Sirve
`/opt/letfer/app/apps/web/dist`, devuelve `index.html` para las rutas de React Router, reenvía
`/api/*` a `127.0.0.1:3000`, añade las cabeceras de seguridad y una CSP, y oculta `?token=` en su
log. La CSP hay que comprobarla con la aplicación real.

## 16. HTTPS

Automático con Let's Encrypt si el dominio apunta al servidor y los puertos 80 y 443 están
abiertos. `APP_BASE_URL` debe coincidir exactamente con el dominio (sin barra final). Con
`NODE_ENV=production` la cookie de sesión es `Secure` y `__Host-`.

## 17. SMTP

**Opcional.** Sin SMTP la API arranca y la recuperación de contraseña por correo responde "no
disponible"; las cuentas se crean por invitación (el enlace se muestra una vez, sin correo). Si se
activa: `SMTP_HOST`, `SMTP_PORT` (587 por defecto), `SMTP_SECURE` (`true` solo para TLS directo, puerto
465; si no, STARTTLS obligatorio), `SMTP_USER` y `SMTP_PASSWORD` (las dos o ninguna) y `MAIL_FROM`
de un dominio verificado. Proveedor, dominio y SPF/DKIM/DMARC [PENDIENTE DE DEFINIR]. Probar la
recuperación de contraseña antes de abrir al equipo. Las invitaciones no envían correo.

## 18. Tickets / almacenamiento

`TICKETS_DIR=/var/lib/letfer/tickets`, de `letfer`, con permisos 0700 (la API los aplica).
Sobreviven a reinicios. Se incluyen en cada backup. Con la IA desactivada los tickets se suben y
se ven igual; solo "Leer ticket con IA" responde que no está disponible.

## 19. Backups

La API genera cada día (03:00 UTC) una generación (`pg_dump -Fc` + `tar` de tickets) en
`BACKUP_DIR` con 30 de retención; también hay un botón manual para el Administrador Global. Requiere
`PG_DUMP_PATH`, `PG_RESTORE_PATH` y `TAR_PATH` válidos. **Esto no basta:** un backup que solo está
en el mismo VPS se pierde con él. Producción debe proteger como mínimo **PostgreSQL** y **los
archivos de tickets** en un destino externo y cifrado. Destino, cifrado, alertas y prueba de
restauración [PENDIENTE DE DEFINIR] (fase posterior). No introduzcas datos reales hasta haber
restaurado un backup en una base distinta y haber comprobado el resultado.

## 20. Health check

`GET /api/health` → `{"status":"ok","service":…,"database":"up"}`, o 503 si la base no responde. Es
público y no revela secretos. Comprueba también, [PENDIENTE DE DEFINIR] con qué herramienta:
espacio en disco, antigüedad del último backup `COMPLETED` y errores 5xx.

## 21. Actualizaciones

1. Backup manual y comprobar que está `COMPLETED` (y copiado fuera).
2. `systemctl stop letfer-api`.
3. Traer la versión etiquetada (`git fetch` y checkout de la etiqueta) [PENDIENTE DE DEFINIR:
   política de etiquetas].
4. `npm ci` y `npm run build`.
5. `npm run migrate`.
6. `systemctl start letfer-api` y comprobar `/api/health`.

Hay una breve parada. Despliegue sin parada [PENDIENTE DE DEFINIR].

## 22. Rollback

El código se revierte volviendo a la etiqueta anterior (pasos 2 a 6). **Las migraciones solo
avanzan**: si la versión fallida ya aplicó una, el código viejo puede no funcionar con el esquema
nuevo y la vuelta atrás real es restaurar el backup del paso 1 (se pierde lo escrito después). La
restauración de la aplicación exige reautenticación y confirmación escrita, y hace antes un backup
preventivo.

## 23. Checklist final

- [ ] Repositorio comiteado y publicado; versión etiquetada.
- [ ] Servidor, usuario `letfer`, directorios y permisos.
- [ ] Base de producción propia (no dev/test/trial) y usuario dueño.
- [ ] `/etc/letfer/letfer.env` completo, 0640, sin valores vacíos; `AI_TICKETS_ENABLED` decidido.
- [ ] `npm ci`, `npm run build`, `npm run migrate`, bootstrap del administrador.
- [ ] Unidad systemd activa; Caddy con el dominio real y HTTPS válido.
- [ ] (Solo si se activa SMTP) recuperación de contraseña probada con correo real.
- [ ] Ticket de prueba subido, servidor reiniciado, ticket y datos intactos.
- [ ] Backup externo funcionando y **restauración probada** en otra base.
- [ ] Verificación de integridad de la aplicación sin hallazgos; `/api/health` vigilado.
- [ ] Solo entonces, la primera apuesta real.
