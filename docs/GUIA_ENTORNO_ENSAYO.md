# Guía del entorno de ensayo (Fase 10)

Cómo preparar y usar, en la máquina local, un entorno de ensayo **separado** del de desarrollo
para las pruebas reales de la Fase 10 (`docs/PLAN_FASE_10.md`). No cambia código ni configuración
del proyecto: solo usa lo que ya existe.

Todos los comandos son para **PowerShell** en Windows, desde la raíz del repositorio.

## 1. Cómo está montado el entorno hoy

| Pieza | Situación |
|---|---|
| PostgreSQL | **17.10** local, del paquete `embedded-postgres` (`17.10.0-beta.17`). Un solo clúster en `.data/postgres`, puerto 5432, usuario `letfer` / contraseña `letfer_dev`. No hay ningún PostgreSQL instalado en el sistema. |
| Bases de datos | `letfer_dev` (desarrollo) y `letfer_test` (pruebas automáticas). Las pruebas de migraciones crean y borran sus propias bases temporales. |
| `scripts/dev-db.mjs` | `npm run db:start` crea el clúster si falta, lo arranca y crea las bases de `DB_NAMES` (por defecto `letfer_dev,letfer_test`); `db:stop`, `db:status`; **`db:reset` borra el clúster entero** (todas las bases). |
| Variables de entorno | La API, `drizzle-kit` y `bootstrap:admin` leen `.env` de `apps/api` o de la raíz, **sin sobrescribir** las variables ya definidas en la sesión. En esta máquina **no existe ningún `.env`**. `DATABASE_URL` es la única obligatoria. |
| Migraciones | `npm run db:migrate` (drizzle-kit) aplica `apps/api/drizzle/0000` a `0040` sobre `DATABASE_URL`. |
| Datos iniciales | No hay script de datos de ejemplo. El primer Administrador Global se crea con `npm run bootstrap:admin`; el resto de personas entra por invitación (el enlace se muestra una vez en la interfaz, así que no hace falta correo real). |
| Correo | Adaptador de desarrollo: escribe los mensajes como archivos en `MAIL_OUTBOX_DIR` (`.data/outbox`). |
| Backups | Tarea interna de la API (diaria, `BACKUP_SCHEDULE_HOUR_UTC`, por defecto 03:00 UTC) y botón manual del Administrador Global. `pg_dump -Fc` completo + `tar` del directorio de tickets, en `BACKUP_DIR` (`.data/backups`), con manifiesto propio y rotación de 30 generaciones. La restauración usa `pg_restore --clean --if-exists` con modo mantenimiento, reautenticación y confirmación escrita. **`pg_dump`/`pg_restore` no están instalados:** hoy todo backup real termina en `FAILED`. |
| Pruebas automáticas | Solo usan `letfer_test` (`TEST_DATABASE_URL`) y bases temporales: nunca tocan la base de ensayo. Las 2 pruebas reales de backup se ejecutan solo si `pg_dump` está en el `PATH`. |

## 2. Herramientas cliente de PostgreSQL 17 (una sola vez)

Hacen falta `pg_dump.exe` y `pg_restore.exe` de la **versión 17** (la misma que el servidor). No
hace falta instalar un servidor PostgreSQL; si el instalador lo añade, queda como un segundo servidor
(servicio de Windows) en otro puerto (hallazgo H-07).

> **En esta máquina (10.2):** están instaladas en `C:\Program Files\PostgreSQL\17\bin` (versión
> 17.11, en el `PATH` de usuario). El instalador dejó además el servicio `postgresql-x64-17` en el
> puerto 5433 (H-07). Los comandos de abajo con `C:\Herramientas\pgsql17\bin` se adaptan a esa ruta.

**Opción recomendada: binarios sin instalador (no crea ningún servicio).**

1. Descargar el ZIP de binarios de PostgreSQL 17 para Windows x64 de EDB
   (<https://www.enterprisedb.com/download-postgresql-binaries>).
2. Descomprimirlo, por ejemplo, en `C:\Herramientas\pgsql17`.
3. Comprobarlo:

   ```powershell
   C:\Herramientas\pgsql17\bin\pg_dump.exe --version     # pg_dump (PostgreSQL) 17.x
   C:\Herramientas\pgsql17\bin\pg_restore.exe --version
   ```

**Alternativa con `winget`: instalador de EDB solo con las herramientas de línea de comandos.**
Comprueba antes, con `winget show PostgreSQL.PostgreSQL.17`, que la versión y las opciones son las
que se esperan:

```powershell
winget install -e --id PostgreSQL.PostgreSQL.17 --override "--mode unattended --disable-components server,pgAdmin,stackbuilder"
# Quedan en C:\Program Files\PostgreSQL\17\bin
```

**Para que las pruebas automáticas de backup reales se ejecuten**, `pg_dump` debe estar además en el
`PATH` (esas pruebas lo buscan por nombre):

```powershell
$env:Path = "C:\Herramientas\pgsql17\bin;$env:Path"   # solo en esta sesión
```

## 3. Variables del entorno de ensayo

El ensayo usa **su propia base (`letfer_trial`) y sus propias carpetas**, fuera del repositorio, para
que ni las pruebas automáticas ni un `db:reset` accidental las confundan con desarrollo. Como las
variables de la sesión tienen prioridad sobre `.env`, basta con definirlas en la terminal antes de
cada comando:

```powershell
$env:DATABASE_URL   = "postgresql://letfer:letfer_dev@localhost:5432/letfer_trial"
$env:BACKUP_DIR     = "C:\LetFerEnsayo\backups"
$env:TICKETS_DIR    = "C:\LetFerEnsayo\tickets"
$env:MAIL_OUTBOX_DIR = "C:\LetFerEnsayo\outbox"
$env:PG_DUMP_PATH   = "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"      # ruta de esta máquina
$env:PG_RESTORE_PATH = "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe"
$env:TAR_PATH       = "C:\Windows\System32\tar.exe"
# Opcional, solo para probar tickets con IA:
# $env:ANTHROPIC_API_KEY = "..."      # nunca en un archivo versionado
# $env:ANTHROPIC_MODEL   = "..."      # verificar antes que el identificador existe (hallazgo H-06)
```

- **`TAR_PATH` explícito:** en esta máquina hay dos `tar` (`C:\Windows\System32\tar.exe` y el de Git).
  El de Git (GNU tar) trata una ruta como `C:\...` como un host remoto; el de Windows no.
- **Permisos (H-08):** en Windows los archivos de backup no quedan restringidos a la persona usuaria
  (contienen la base entera). Si otras personas usan esta máquina, es mejor poner `BACKUP_DIR` dentro
  del perfil (`$env:USERPROFILE\LetFerEnsayo\backups`) en lugar de `C:\LetFerEnsayo`.
- Crea las carpetas una vez (ya creadas en la 10.2):
  `New-Item -ItemType Directory -Force C:\LetFerEnsayo\backups, C:\LetFerEnsayo\tickets, C:\LetFerEnsayo\outbox`.
- Si se prefiere no repetirlas en cada sesión, pueden ir en un `.env` en la raíz (no se versiona),
  pero entonces **desarrollo también apuntaría a la base de ensayo** mientras exista ese archivo.

## 4. Crear la base de ensayo y aplicar las migraciones

```powershell
# 1. Arrancar PostgreSQL y crear letfer_trial (además de las de siempre)
$env:DB_NAMES = "letfer_dev,letfer_test,letfer_trial"
npm run db:start

# 2. Migraciones sobre la base de ensayo (con las variables de la sección 3 ya definidas)
npm run db:migrate

# 3. Comprobarlo: la API arranca sin errores de configuración
npm run build:shared
npm run dev          # API en http://localhost:3000, web en http://localhost:5173
```

## 5. Datos iniciales

1. **Administrador Global** (una vez por base). Se pasan los datos por variables de la sesión, no
   por un archivo:

   ```powershell
   $env:BOOTSTRAP_ADMIN_EMAIL = "..."
   $env:BOOTSTRAP_ADMIN_PASSWORD = "..."
   $env:BOOTSTRAP_ADMIN_FIRST_NAME = "..."
   $env:BOOTSTRAP_ADMIN_LAST_NAME = "..."
   npm run bootstrap:admin
   Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD
   ```

2. **Resto de personas:** desde la interfaz, crear el proyecto y generar una invitación por rol
   (Administrador de Proyecto, Colaborador, Lector). El enlace aparece una sola vez: abrirlo en
   otra ventana privada o en otro navegador para registrar a cada persona. Una cuenta más, sin
   invitación a ese proyecto, sirve como persona ajena (escenario C2).
3. **Proyectos:**
   - uno **operativo de ensayo** para el flujo financiero (10.3);
   - uno **de importación** (D-X1: nunca sobre uno operativo), con las casas en `0` y la unidad de
     la primera ronda (D-X22).

   No se cargan datos de ejemplo: los datos los introduce la persona durante las pruebas.

## 6. Pruebas manuales

- Seguir los escenarios del plan (`docs/PLAN_FASE_10.md`, sección 5) en el orden de las subfases.
- Tras cada escenario, comprobar dentro de la aplicación:
  - la verificación de integridad del proyecto, sin hallazgos;
  - el dashboard;
  - la auditoría;
  - la conciliación, si hay saldo oficial.
- Todo lo que no salga como se esperaba se anota en `docs/HALLAZGOS_FASE_10.md`, con los pasos para
  reproducirlo.
- Antes de un escenario que pueda estropear datos, hacer un **backup manual** desde la interfaz
  (cuando las herramientas de la sección 2 estén instaladas).

## 7. Reiniciar o destruir el ensayo

- **Solo la base de ensayo** (sin tocar desarrollo ni pruebas):

  ```powershell
  # Con PostgreSQL en marcha y la API detenida; usa el cliente de la sección 2 (pide la contraseña: letfer_dev)
  C:\Herramientas\pgsql17\bin\dropdb.exe -h localhost -U letfer --force letfer_trial
  $env:DB_NAMES = "letfer_dev,letfer_test,letfer_trial"; npm run db:start   # la vuelve a crear vacía
  npm run db:migrate
  ```

  Y vaciar a mano `C:\LetFerEnsayo\tickets`, `backups` y `outbox` si se quiere empezar de cero.
- **Cuidado con `npm run db:reset`:** borra el clúster completo, **también `letfer_trial`**. No se usa
  durante la Fase 10 salvo que se quiera perder el ensayo (o se tenga un backup para restaurarlo).
