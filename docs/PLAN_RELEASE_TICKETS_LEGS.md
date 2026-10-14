# Plan de release: estructura TICKET → LEG → CONDICIÓN y ticket digital

Estado: **preparado, NO ejecutado.** Nada se ha commiteado, publicado, desplegado ni aplicado a
`letfer_prod` (ADR 0022). Todo paso marcado ✋ se ejecuta solo con autorización explícita y por
separado. Los comandos son PowerShell (Windows) y usan variables que se fijan en el paso 0.

## Qué contiene el release

- Migraciones **0042** (columnas documentales nulas + `CHECK`), **0043** (regla de cuota por leg,
  `CONSTRAINT TRIGGER` diferido) **0044** (`bets.total_odds_source`, ADR 0023, por defecto `UNKNOWN`) y **0045** (`bet_drafts` y
  `bets.client_request_id`, ADR 0024). Aditivas; no reescriben datos.
- API: validación de estructura, validador determinista de IA, contrato `conditions[]`, errores de IA
  genéricos para el cliente.
- Web: asistente de tres pasos (Añadir, Verificar datos, Confirmar), borradores, `LegsEditor`, `AutoGrowTextarea`,
  `DigitalTicket`, "Ver apuesta", stake inicial vacío y resultado sin definir. **API y web se despliegan juntas** (mismo `@letfer/shared`).

## Evidencia previa (en desarrollo)

- `npm run check` en verde (ver informe de cierre). Migraciones 0000–0043 aplican sobre base vacía
  (44 migraciones) y sobre una base con datos de Simple/Creada/Múltiple (`migration-bet-legs.spec.ts`).
- QA visual en entorno aislado (`letfer_qa`, API en :3100, IA desactivada). Escritorio/móvil/claro/oscuro.

## 0. Descubrimiento de solo lectura ✋ (antes de nada, con tu visto bueno)

Fija estos valores mirando el sistema real, sin cambiar nada. Los marcados `?` hoy se desconocen:

```powershell
$Prod    = 'C:\LetFerProd'                    # clon de producción
$Repo    = "$Prod\app"                        # ? confirmar que es el clon git
$EnvFile = "$Prod\letfer.env"                 # cargado con node --env-file (NO imprimir su contenido)
$Backup  = "$Prod\backups"                    # ? o BACKUP_DIR del env
$Tickets = '<TICKETS_DIR del env>'            # ?
$PgBin   = '<carpeta bin de PostgreSQL 17>'   # ? pg_dump / pg_restore / psql
$Svc     = '<servicio o tarea programada>'    # ? cómo se (re)inicia la API hoy
$Tag     = 'release-tickets-legs-2026-10'     # etiqueta propuesta
```

Comprobaciones de solo lectura: `git -C $Repo status -sb`, `git -C $Repo log -1 --oneline`,
`Get-Service`/`Get-ScheduledTask` para localizar `$Svc`, `& $PgBin\psql --version`, espacio libre en
disco, y que la API responde `GET http://127.0.0.1:3000/api/health`.

## 1. Commit y push controlados ✋

1. `git status` / `git diff --stat` revisados; confirmar que NO entran: `.env`, `apps/api/test/ticket-eval/cases-local/`
   (tickets reales), `.data/`, claves. (`cases-local` ya está en `.gitignore`.)
2. `npm run check` en verde, con la máquina sin otras cargas.
3. Commits pequeños y temáticos en `fase-12/produccion` (modelo/migraciones → API/IA → web → docs/tests).
4. `git push origin fase-12/produccion`. **Sin merge a `main`** hasta tu confirmación; el despliegue
   puede hacerse desde la etiqueta: `git tag $Tag; git push origin $Tag`.

## 2. Backup completo ✋ (antes de tocar producción)

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory "$Backup\pre-$Tag-$stamp" | Out-Null
# Base: formato custom. La contraseña viene de PGPASSWORD en la sesión, nunca en el comando.
& "$PgBin\pg_dump.exe" -Fc -h 127.0.0.1 -U <usuario> -d letfer_prod -f "$Backup\pre-$Tag-$stamp\letfer_prod.dump"
# Imágenes de tickets y copia del env (solo lectura sobre origen)
Copy-Item -Recurse $Tickets "$Backup\pre-$Tag-$stamp\tickets"
Copy-Item $EnvFile "$Backup\pre-$Tag-$stamp\letfer.env.bak"
# Hashes para verificar integridad de la copia
Get-ChildItem -Recurse "$Backup\pre-$Tag-$stamp" -File | Get-FileHash -Algorithm SHA256 |
  Export-Csv "$Backup\pre-$Tag-$stamp\SHA256.csv" -NoTypeInformation
```

Además: copiar el directorio del backup **fuera de este equipo/disco** (una copia en el mismo disco
no cuenta, ADR 0021). Registrar antes de migrar las cifras de control (paso 4).

## 3. Prueba de restauración (base temporal, nunca prod) ✋

```powershell
& "$PgBin\createdb.exe" -h 127.0.0.1 -U <usuario> letfer_restore_check
& "$PgBin\pg_restore.exe" -h 127.0.0.1 -U <usuario> -d letfer_restore_check --no-owner "$Backup\pre-$Tag-$stamp\letfer_prod.dump"
```

Con `DATABASE_URL` apuntando a `letfer_restore_check` (en una sesión aparte, `NODE_ENV` distinto de
producción para esta prueba): ejecutar `node apps/api/dist/cli/migrate.js` (aplica 0042 a 0045 sobre la
copia), repetir las cifras de control y la verificación de integridad financiera de la API. Si todo
coincide, anotar el resultado y **borrar solo `letfer_restore_check`** (con tu permiso).

## 4. Cifras de control (antes y después; deben coincidir salvo lo nuevo)

```sql
SELECT count(*) AS apuestas FROM bets;
SELECT count(*) AS selecciones FROM bet_selections;
SELECT count(*) AS movimientos, sum(amount) AS suma FROM financial_movements;
SELECT count(*) AS tickets FROM tickets;
SELECT house_id, sum(amount) FROM financial_movements GROUP BY house_id ORDER BY house_id;
-- Tras migrar: toda apuesta anterior debe quedar con procedencia UNKNOWN y la misma cuota:
-- SELECT total_odds_source, count(*) FROM bets GROUP BY 1;   -- solo UNKNOWN hasta registrar nuevas
-- Control específico de la regla nueva (debe dar 0 antes de migrar):
SELECT count(*) FROM bet_selections s JOIN bets b ON b.id = s.bet_id
 WHERE s.visible_odds IS NULL AND b.batch_id IS NULL AND b.bet_type = 'MULTIPLE';
```

(Ajustar nombres de columna al esquema real si difieren.) Los ficheros de `$Tickets` deben tener el
mismo número y hashes que en la copia.

## 5. Despliegue coordinado ✋ (ventana corta)

1. Avisar a los usuarios; la API se detiene primero porque `nest build` borra `dist/`.
2. Detener la API con el mecanismo existente (`$Svc`) y comprobar que el puerto 3000 queda libre.
3. `git -C $Repo fetch --tags; git -C $Repo checkout $Tag` (o `pull --ff-only` si se despliega rama).
4. `npm ci` y `npm run build` (raíz: shared → api → web). Si falla, **no se migra**: volver al paso 7.
5. `node apps\api\dist\cli\migrate.js` con el entorno de producción (aplica **solo** 0042 a 0045).
6. Arrancar la API con `$Svc`; comprobar `GET /api/health` y que `apps\web\dist` es el servido por Caddy
   (recargar sin caché). API y web cambian en el mismo paso.

## 6. Reinicio y arranque automático

- Reiniciar solo mediante el mecanismo que ya usa producción (`$Svc`); no lanzar `node` a mano.
- Comprobar el arranque automático: tipo de inicio del servicio/tarea (`Automatic` / "al iniciar
  sesión/equipo") y, en una ventana acordada, un reinicio del servicio (no del equipo) y su vuelta sola.
- `AI_TICKETS_ENABLED` se mantiene **tal como está hoy** en producción; este release no activa la IA.

## 7. Smoke tests (sin gastar tokens)

- `GET /api/health` = 200; login con una cuenta real (la tuya, tú escribes la contraseña).
- "Apuestas" lista las apuestas históricas; abrir "Ver apuesta" en una Simple, una Creada y una
  Múltiple antiguas: estructura, cuotas, importes y tickets idénticos a antes.
- Repetir las cifras de control del paso 4: mismas cifras (apuestas, selecciones, movimientos, saldos).
- Imágenes: abrir el ticket original de 2–3 apuestas antiguas.
- Registrar manualmente **una** apuesta de prueba pequeña con un leg creado en una casa/etapa acordada
  y comprobar que genera un solo movimiento; se corrige/elimina según tus reglas (no se purga nada).
- La IA no se invoca en el smoke (apagada o sin pulsar "Leer ticket con IA").

## 8. Primera comprobación real ✋

Solo con tu autorización expresa: una única lectura con IA de un ticket real tuyo, revisión del ticket
reconstruido frente al original en Confirmar, registro y "Ver apuesta". Comprobar importe oficial y un
solo movimiento. Cualquier discrepancia se anota como caso para el arnés de evaluación (no cambia la
precisión declarada hasta evaluar con casos reales).

## 9. Rollback

| Situación | Acción |
| --- | --- |
| Falla `build` o antes de migrar | Reiniciar la versión anterior (`git checkout <etiqueta anterior>`, `npm run build`, `$Svc`). No hay nada que revertir en la base. |
| Migró pero la app falla, **sin** apuestas nuevas | Detener la API, volver a la etiqueta anterior; 0042/0043 son aditivas y la versión anterior las tolera (columnas nulas, regla relajada). |
| Se registraron apuestas con legs creados | **No** revertir la migración (el disparador anterior rechazaría esas filas). Restaurar el dump del paso 2 (se pierde lo posterior) o dejar la versión nueva y corregir hacia delante. |
| Datos dañados | Detener la API, `pg_restore --clean` del dump verificado (probado en el paso 3), restaurar `$Tickets` desde la copia, comprobar hashes y cifras de control. |

Revertir el esquema por SQL (restaurar funciones de 0041 y quitar los disparadores) está descrito en
la cabecera de `0043_bet_leg_odds_rule.sql`; solo es seguro mientras la consulta de control del paso 4
dé 0.

## Rollback de 0045

`DROP TABLE bet_drafts;` y `DROP INDEX bets_client_request_unique; ALTER TABLE bets DROP COLUMN client_request_id;`
(solo se pierden borradores y claves de idempotencia; ninguna apuesta ni movimiento cambia).

## Límites y riesgos conocidos

- **Cuota total (resuelto en desarrollo, ADR 0023):** la procedencia se guarda en `total_odds_source`. Las apuestas
  ya registradas en producción quedarán `UNKNOWN` ("Cuota total — origen no verificado"): no se sabe si fueron
  oficiales; corregirlo a mano apuesta por apuesta es opcional. Rollback de 0044: `DROP COLUMN` + `DROP TYPE`.
- El nombre impreso del bloque de una Creada y las cuotas por condición no se persisten.
- `BetDetail.tickets` solo se devuelve con `tickets.view` (comprobado en el backend con pruebas).
- Las pruebas automáticas no pueden llamar a Anthropic (`test/support/block-real-ai.ts`). En el QA manual, arrancar
  siempre la API con `AI_TICKETS_ENABLED=false`.
- Precisión real de la IA con la estructura jerárquica: **sin medir** (solo mocks y fixtures).
