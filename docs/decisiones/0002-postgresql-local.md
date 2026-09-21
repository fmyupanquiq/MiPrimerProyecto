# 0002. PostgreSQL local de desarrollo y pruebas

- **Estado:** Aceptada (Fase 0)
- **Fecha:** 2026-09-21
- **Referencias:** especificación §41, §57, §100

## Contexto

La especificación pide una solución **reproducible y sencilla** para desarrollo local en Windows,
sin que condicione al proveedor de producción. Evaluación del entorno (Windows 11 Pro):

- Docker: no instalado; requeriría Docker Desktop y WSL2 (tampoco instalado), con reinicio.
- PostgreSQL nativo: no instalado (instalador externo y servicio del sistema).
- Puerto 5432 libre, 413 GB de disco libres, virtualización habilitada.

## Decisión

Usar el paquete npm **`embedded-postgres`** (MIT), que trae binarios reales de PostgreSQL para cada
plataforma como dependencia de desarrollo. Resultado: `npm install` basta para disponer del motor.

- **Versión:** PostgreSQL **17.10** (paquete `embedded-postgres@17.10.0-beta.17`; el sufijo
  `-beta` es del empaquetado del paquete npm, no de PostgreSQL). Se eligió la línea 17 por ser la
  de mayor soporte en proveedores administrados; producción puede usar una versión igual o superior.
- **Control:** `scripts/dev-db.mjs` invoca `initdb` y `pg_ctl` del paquete.
  - `npm run db:start` / `db:stop` / `db:status` / `db:reset`.
  - Servidor en segundo plano; datos en `.data/postgres` (ignorado por Git); registro en
    `.data/postgres.log`.
- **Bases creadas:** `letfer_dev` y `letfer_test` (esta última para pruebas de integración).
- **Seguridad local:** solo escucha en `localhost`, autenticación `scram-sha-256`. Las credenciales
  por defecto (`letfer` / `letfer_dev`) son solo de desarrollo y se documentan en `.env.example`.
- **Codificación/colación:** UTF-8, proveedor ICU (`und`), de modo que el orden de texto no depende
  del idioma de Windows.

## Por qué `pg_ctl` y no el arranque del paquete

PostgreSQL **se niega a ejecutarse con privilegios de administrador**. El método `start()` del
paquete lanza `postgres.exe` directamente y falla en un terminal elevado (error sin mensaje). En
Windows, `pg_ctl` inicia el servidor con un token restringido, por lo que funciona tanto en
terminales normales como elevados. Además permite arrancar en segundo plano y detenerlo con orden.

## Verificación realizada

Inicialización desde cero, arranque idempotente, conexión con cliente `pg`, rechazo de contraseña
incorrecta (`28P01`), persistencia de datos tras `stop`/`start` (incluido un `NUMERIC(20,2)` de
`9007199254740993.01`, valor que un `float` no representa), y `db:reset`.

## Alternativas

- **Docker Compose:** la más portable entre máquinas, pero exige instalar Docker Desktop + WSL2.
  Sigue siendo válida si el equipo la prefiere: solo cambia `DATABASE_URL`.
- **PostgreSQL nativo (instalador):** simple, pero instala un servicio del sistema, es menos
  reproducible y puede colisionar con el puerto 5432.

## Consecuencias y límites

- Es una herramienta **solo de desarrollo y pruebas**. Producción usará PostgreSQL administrado y
  la estrategia de respaldo/PITR del §82.
- Validado en Windows x64. Linux/macOS usan sus propios paquetes de binarios (el script los
  selecciona por plataforma) pero no se han probado en esta fase.
- Pruebas de integración (Fase 1 en adelante): se ejecutan contra `letfer_test`, nunca con la base
  de datos simulada, porque las reglas de integridad viven también en PostgreSQL (§58).
- Depender de un paquete de terceros para los binarios es un riesgo de cadena de suministro,
  aceptado por ser solo de desarrollo. No se ha auditado cómo se compilan esos binarios (el
  paquete no documenta su origen); por eso no deben usarse para datos reales ni en producción.
