# Hallazgos de la Fase 10

Registro vivo de todo lo que no sale como se esperaba durante las pruebas reales
(`docs/PLAN_FASE_10.md`). Se añade una fila por hallazgo y se actualiza su estado; nunca se borra
una fila, aunque se descarte.

## Cómo registrar un hallazgo

- **ID:** `H-nn`, correlativo.
- **Fecha:** cuándo se encontró (AAAA-MM-DD).
- **Escenario:** del plan (`A3`, `B7`, `C2`…) o `ENTORNO` si surge al preparar el entorno.
- **Hallazgo:** qué pasó frente a lo esperado. El detalle (pasos, capturas, datos) va en la sección
  "Detalle" con el mismo ID.
- **Severidad:**
  - **Bloqueante:** impide pasar a producción (sección 7 del plan).
  - **Alta:** error funcional o financiero con alternativa.
  - **Media:** comportamiento confuso o incompleto.
  - **Baja:** texto, estética o deuda sin efecto.
- **Estado:** `Abierto` · `En curso` · `Corregido` · `Aceptado` (se decide no corregirlo, con motivo)
  · `Descartado` (no era un problema).
- **Commit:** hash del commit que lo corrige (o `—`).

## Registro

| ID | Fecha | Escenario | Hallazgo | Severidad | Estado | Commit |
|---|---|---|---|---|---|---|
| H-01 | 2026-09-30 | ENTORNO | `pg_dump`/`pg_restore` no están instalados: ningún backup real puede completarse y las 2 pruebas reales de backup se omiten | Bloqueante | Corregido (10.2: herramientas instaladas y backup/restauración reales verificados) | — (entorno, sin código) |
| H-02 | 2026-09-30 | ENTORNO | `.env.example` no documenta las variables de backups, tickets, IA ni limitación de tasa que la API ya admite | Baja | Abierto | — |
| H-03 | 2026-09-30 | ENTORNO | `TAR_PATH` por defecto es `tar`: en Windows hay dos (`System32` y el de Git) y el de Git no admite rutas `C:\...` | Media | Abierto (confirmado en la 10.2; mitigado fijando `TAR_PATH`) | — |
| H-04 | 2026-09-30 | ENTORNO | `npm run db:reset` borra el clúster entero, también una base de ensayo que viva en él | Media | Abierto | — |
| H-05 | 2026-09-30 | ENTORNO | No existe ningún `.env` en esta máquina: `npm run dev` no arranca sin definir antes `DATABASE_URL` | Baja | Abierto | — |
| H-06 | 2026-09-30 | ENTORNO | El modelo de IA por defecto (`ANTHROPIC_MODEL=claude-sonnet-5`) no está verificado como identificador válido | Media | Resuelto (10.6) | Se cambió el valor por defecto a `claude-sonnet-5-5` |
| H-07 | 2026-09-30 | ENTORNO | El instalador de PostgreSQL 17 dejó además un **servidor** como servicio de Windows (`postgresql-x64-17`, automático, puerto 5433) | Media | Abierto | — |
| H-08 | 2026-09-30 | D1 | En Windows, los archivos de backup quedan legibles para otros usuarios locales (`rw-r--r--`): la protección 0600/0700 de `fs-security.ts` no tiene efecto en Windows | Media | Abierto | — |
| H-09 | 2026-09-30 | F-06 | Registrar una apuesta exige rellenar a mano fecha y hora, deporte y (fuera del alta) el resultado: no hay valores por defecto | Media | Corregido (10.3a; ampliado en 10.3b) | — (sin commit todavía) |
| H-10 | 2026-09-30 | F-06 | El stake no tiene atajos para los valores habituales (1 a 10) | Baja | Corregido (10.3a) | — (sin commit todavía) |
| H-11 | 2026-09-30 | F-05/F-06 | El formulario no muestra la apuesta calculada (stake × unidad de la etapa) antes de registrar | Media | Corregido (10.3a) | — (sin commit todavía) |
| H-12 | 2026-09-30 | F-06 | No se puede registrar una apuesta ya liquidada ni ver su retorno (A+G) y ganancia al registrarla: hay que registrar y después liquidar | Media | Corregido (10.3a) | — (sin commit todavía) |
| H-13 | 2026-09-30 | F-06 | No hay forma directa de ajustar la ganancia a la que muestra la casa al registrar | Media | Corregido (10.3a; decisión: ganancia = retorno oficial, la cuota visible no cambia) | — (sin commit todavía) |
| H-14 | 2026-09-30 | F-07 | El formulario "Liquidar" de una apuesta pendiente sigue pidiendo el retorno oficial: no muestra A+G ni ganancia calculadas ni permite escribir la ganancia, a diferencia del alta con resultado | Baja | Corregido (10.3c; unificado con el alta) | — (sin commit todavía) |
| H-15 | 2026-09-30 | F-06 | Los formularios de creación y de operación obligan a escribir la fecha y la hora aunque el sistema conoce el momento actual; la edición de una pendiente no permitía ver ni cambiar su fecha de colocación | Media | Corregido (10.3b; convención general de fecha y hora) | — (sin commit todavía) |
| H-16 | 2026-09-30 | F-06 | La lista de apuestas muestra la cuota visible junto a un retorno oficial que no cuadra con ella, sin indicar la cuota efectiva | Baja | Corregido (10.3b) | — (sin commit todavía) |
| H-17 | 2026-09-30 | F-06 | En el alta, una apuesta Anulada permitía escribir una ganancia distinta de 0 (se habría enviado como retorno oficial) | Media | Corregido (10.3c) | — (sin commit todavía) |
| H-18 | 2026-09-30 | F-06 | La tarjeta de cada apuesta acumula muchos botones grandes (Editar, Liquidar, Corregir, Reabrir, Historial, Mover, Papelera, Tickets) y no muestra el partido ni si tiene ticket | Media | Corregido (10.3d) | — (sin commit todavía) |
| H-19 | 2026-09-30 | F-10 | El dashboard mezclaba el estado al momento con el análisis filtrado y no mostraba apuestas recientes, pendientes, casas ni deportes; navegación por pestañas sin versión móvil | Media | Corregido (10.3e, rediseño) | — (sin commit todavía) |
| H-20 | 2026-09-30 | F-10 | Fechas en la zona del navegador en toda la web; los filtros «Desde/Hasta» de Reportes usaban además el día UTC (`T00:00:00.000Z`). El §93 pide la zona del proyecto | Media | Corregido (10.3g) | — (sin commit todavía) |
| H-21 | 2026-09-30 | F-02 | Configuración inicial: la banca total se sumaba con `Number()`/`toFixed` (coma flotante) para mostrarla | Baja | Corregido (10.3f) | — (sin commit todavía) |
| H-22 | 2026-09-30 | General | La web ocultaba el motivo de varios rechazos de la API (`CONFLICT`, `CORRECTION_CONFLICT`, validación de negocio) tras «No se pudo completar la operación» | Media | Corregido (10.3f) | — (sin commit todavía) |
| H-23 | 2026-09-30 | F-06 | Eliminar una apuesta pendiente la enviaba a la papelera sin confirmación | Baja | Corregido (10.3f) | — (sin commit todavía) |
| H-24 | 2026-09-30 | F-10 | El gráfico de evolución del capital podía quedar sin dibujar (animación de entrada de Recharts) | Baja | Corregido (10.3f) | — (sin commit todavía) |
| H-25 | 2026-09-30 | F-06 | Una apuesta con hora desconocida se mostraba con una hora concreta (p. ej. las 12:00 técnicas de una importación, §113.4) | Baja | Corregido (10.3g) | — (sin commit todavía) |

## Detalle

### H-01 — Sin herramientas de backup reales

`BackupsService` ejecuta `pg_dump -Fc` y `pg_restore --clean --if-exists` (rutas `PG_DUMP_PATH` y
`PG_RESTORE_PATH`). Sin los binarios, un backup manual queda `FAILED` con `spawn pg_dump ENOENT`, y
las pruebas `describe.runIf(await isBinaryAvailable('pg_dump'))` de `backups.e2e-spec.ts` se omiten.
El §67 y el §82 exigen un respaldo funcional antes de usar datos reales; D-X26 exige un backup
reciente para confirmar una importación real. **Solución prevista:** instalar las herramientas
cliente de PostgreSQL 17 (`docs/GUIA_ENTORNO_ENSAYO.md`, sección 2) y ejecutar la 10.2.

**Cierre (10.2, 2026-09-30):** instaladas en `C:\Program Files\PostgreSQL\17\bin` (`pg_dump` y
`pg_restore` 17.11, frente al servidor 17.10). Las 2 pruebas reales de `backups.e2e-spec.ts` pasan
(15 de 15, ninguna omitida) y el backup y la restauración reales se verificaron de punta a punta
(ver "Resultados de la 10.2"). Queda disponible para la API vía `PG_DUMP_PATH`/`PG_RESTORE_PATH`;
en la `PATH` de usuario, solo en terminales abiertas después de la instalación.

### H-02 — `.env.example` incompleto

Faltan `BACKUP_*`, `PG_DUMP_PATH`, `PG_RESTORE_PATH`, `TAR_PATH`, `TICKETS_DIR`, `ANTHROPIC_*`,
`AI_MAX_*` y `THROTTLE_*`, todas definidas en `apps/api/src/config/app-config.ts`. No afecta al
funcionamiento; confunde al preparar un entorno nuevo.

### H-03 — Qué `tar` usa el backup de tickets

`ticket-archive.ts` ejecuta `tar -czf <ruta> -C <dir> .`. Qué `tar` se usa depende del `PATH` de la
terminal que arranca la API: desde PowerShell suele ser `C:\Windows\System32\tar.exe` (bsdtar, admite
`C:\...`), desde Git Bash el de Git (GNU tar, interpreta `C:` como un host remoto y falla). Para el
ensayo se fija `TAR_PATH` explícitamente.

**Confirmado en la 10.2:** con rutas `C:\...`, el `tar` de Git falla (`Cannot connect to C: resolve
failed`, y fuera de Git Bash además `gzip: command not found`); `C:\Windows\System32\tar.exe` crea y
extrae el paquete sin problemas. Las pruebas automáticas pasan con cualquiera de los dos porque usan
rutas relativas. Mitigado en la guía (`TAR_PATH` explícito); una corrección de código (valor por
defecto según la plataforma, o un aviso al arrancar) queda para decidir.

### H-04 — `db:reset` y la base de ensayo

`scripts/dev-db.mjs reset` borra `.data/postgres` completo. La base `letfer_trial` vive en ese mismo
clúster: la guía avisa de no usarlo durante la Fase 10 y explica cómo reiniciar solo la base de
ensayo con `dropdb`.

### H-05 — Sin `.env`

`DATABASE_URL` es obligatoria (`app-config.ts`). La guía define las variables en la sesión de
PowerShell para no mezclar el ensayo con desarrollo.

### H-06 — Modelo de IA por defecto

Resuelto (Fase 10.6): el valor por defecto de `ANTHROPIC_MODEL` pasó de `claude-sonnet-5` a
`claude-sonnet-5-5` (identificador vigente). Sigue sin haber `ANTHROPIC_API_KEY` configurada en
esta máquina: la primera llamada real a Anthropic queda pendiente de que la persona responsable
del producto la defina (ver informe de la Fase 10.6).

### H-07 — Servidor PostgreSQL instalado como servicio

El instalador de EDB (vía `winget`) instaló el servidor además de las herramientas cliente: servicio
`postgresql-x64-17`, en ejecución y con arranque automático, datos en
`C:\Program Files\PostgreSQL\17\data`, puerto **5433** (el 5432 ya lo usaba `embedded-postgres`).
No interfiere con el proyecto, pero consume recursos y es un segundo PostgreSQL con su propia
contraseña de superusuario. **Decisión pendiente de la persona usuaria:** detenerlo y ponerlo en
arranque manual (`Stop-Service postgresql-x64-17; Set-Service postgresql-x64-17 -StartupType Manual`,
como administrador) o desinstalar solo el servidor. No se ha tocado.

### H-08 — Permisos de los archivos de backup en Windows

Un volcado contiene la base entera (hashes de contraseñas y de sesiones, todo el ledger).
`fs-security.ts` aplica `chmod 0600/0700`, que en Windows no tiene efecto (limitación ya anotada en
el propio código): los archivos quedaron `rw-r--r--` y heredan los permisos de la carpeta. En el
ensayo, conviene que `BACKUP_DIR` esté dentro del perfil de la persona usuaria (p. ej.
`%USERPROFILE%\LetFerEnsayo\backups`) y no en `C:\LetFerEnsayo`, donde otros usuarios locales
pueden tener lectura. En producción (Fase 11) depende del sistema operativo elegido.

### H-09 a H-13 — Registro de apuestas (corrección 10.3a)

Encontrados al recorrer F-05/F-06 desde la interfaz. Corregidos sin cambiar reglas financieras; las
dos decisiones con impacto financiero se consultaron y aprobaron antes de programar:

- **H-13, ganancia ajustada:** recalcular la cuota chocaba con la regla crítica 6 (la cuota visible
  no se sustituye) y el §77. Se aprobó que **la ganancia escrita fija el retorno oficial** (monto +
  ganancia), que ya es la autoridad (regla 4). La cuota visible no cambia y se muestra la cuota
  efectiva como dato diagnóstico.
- **H-12, resultado al registrar:** se aprobó **registrar y liquidar en una sola transacción** en la
  API, en vez de dos llamadas desde la web.

Qué cambió:

- **Formulario "Registrar apuesta" (web):**
  - fecha y hora de colocación precargadas con el momento actual (editables);
  - deporte inicial "Fútbol" en cada selección;
  - "Resultado" con valor inicial "Pendiente", solo para quien tiene `bets.settle`;
  - atajos de stake del 1 al 10, además del campo manual y sus validaciones de siempre;
  - la **apuesta** se muestra calculada (stake × unidad de la etapa activa, o el monto oficial si
    se indica);
  - **A+G y ganancia**: "-" mientras está pendiente; con resultado, se calculan (ganada:
    monto × cuota visible; perdida: 0 y −monto; anulada: el monto y 0; cash out: exige la
    ganancia);
  - la ganancia es editable en ganada, anulada y cash out, y se envía como retorno oficial.
- **Cálculos sin duplicar reglas:** las cifras salen de `apps/web/src/pages/project/bet-draft.ts`,
  que solo combina las mismas funciones de `@letfer/shared` que usa la API (`multiplyMoney`,
  `calculateBetReturn` con la política provisional D-B8, `addMoney`, `subtractMoney`,
  `deriveEffectiveOdds`). La API vuelve a calcular y validar todo al registrar.
- **API:**
  - `createBetSchema` acepta un `settlement` opcional (estado, retorno oficial, fecha de
    liquidación), validado por la misma pieza que `settleBetSchema`;
  - `BetsService.create` lo aplica dentro de la misma transacción mediante `settleLocked`, el cuerpo
    de `settle` extraído sin cambios de comportamiento: mismas validaciones (fechas, saldo bruto,
    línea de tiempo), mismo motor de ledger (§112.1) y mismos eventos de auditoría (`bet.created` y
    `bet.settled`);
  - con resultado, exige además `bets.settle` (403 si falta, antes de escribir nada);
  - si la liquidación no es válida, no queda ni la apuesta;
  - editar no admite `settlement`.

Pruebas añadidas:

- **API (`bets.e2e-spec.ts`, 7 nuevas, con `assertFinancialInvariant`):**
  - ganada con retorno calculado;
  - ganancia ajustada como retorno oficial, con la cuota visible intacta;
  - perdida y anulada;
  - el Colaborador no puede registrar liquidada;
  - atomicidad ante una fecha de liquidación inválida;
  - validación del retorno según el estado;
  - editar ignora `settlement`.
- **Web:**
  - `bet-draft.spec.ts` (10 nuevas);
  - `BetsPage.spec.tsx` (7 nuevas): valores por defecto, atajos y stake manual, validación, alta
    ganada en una sola llamada, ganancia ajustada, perdida y Colaborador sin resultado.

Pendiente de volver a probar desde la interfaz (F-05 y F-06). La misma experiencia en el formulario
"Liquidar" de una pendiente queda abierta como H-14.

### Corrección 10.3b — Formulario "Añadir apuesta" y convención de fecha y hora

**Formulario rediseñado** (`apps/web/src/pages/project/NewBetForm.tsx`, nuevo):

- Encabezado "Añadir apuesta" con "← Volver".
- Fecha y Hora en dos campos contiguos, con el momento actual por defecto y editables.
- Casa a todo el ancho.
- Etapa: elegible con `bets.move_stage`; si no, se muestra la activa. Da la unidad de stake.
- Formato Simple / Múltiple / Creada.
- Una tarjeta por selección: partido, pronóstico, cuota, deporte (desplegable con "Otro…") y "Más
  detalles" (mercado).
- Stake con atajos 1-10 y campo manual; unidad de stake y **monto apostado calculado**.
- Resultado: Pendiente, Ganada, Perdida, Anulada y Cash out (el estado que ya existía).
- A+G, ganancia (calculada y precargada, editable) y cuota.

Estilo adaptado al sistema visual actual (tema claro de LetFer): tarjetas con bordes redondeados,
controles más grandes, etiquetas pequeñas encima, acento violeta para lo seleccionado, verde para
Ganada y rojo para Perdida. No se cambió a un tema oscuro: toda la aplicación es clara y un
formulario oscuro aislado rompería la coherencia visual. Queda para decidir aparte.

**Decisiones dentro de las reglas vigentes** (sin migración ni cambio de modelo):

- **Cuota y ganancia ajustada (regla crítica 6, §77).** El modelo ya distingue la cuota visible (la
  de la casa, `visible_total_odds`) de la cuota efectiva (retorno ÷ monto, derivada con 6 decimales,
  `ODDS_SCALE`). Al ajustar la ganancia:
  - el formulario muestra **"Cuota efectiva"** en lugar de la visible, consistente con la ganancia
    (p. ej. 94.07 ÷ 60 = 1.567833), e indica cuál es la cuota que muestra la casa;
  - se guarda la cuota visible intacta y la ganancia como retorno oficial.

  La lista también muestra la cuota efectiva cuando el retorno oficial no cuadra con la visible
  (H-16), así ninguna pantalla deja una cuota que contradiga la ganancia.
- **Formato Simple / Múltiple / Creada (§90).** El tipo lo deriva la API de la estructura de las
  selecciones. El selector solo organiza las tarjetas para que el tipo derivado sea el elegido:
  - Simple: una selección, cuya cuota es la cuota total;
  - Múltiple: un evento por tarjeta y la cuota total aparte;
  - Creada: varias selecciones del mismo partido, que comparten partido y deporte.
- **Resultado a nivel de apuesta** (regla crítica 19: no hay resultado por selección).
- **Pronóstico visible en la tarjeta:** el modelo lo exige (`selection`), así que no se esconde en
  "Más detalles".

**Convención general de fecha y hora** (`apps/web/src/date-inputs.ts`, nuevo):

- Crear u operar: el momento actual por defecto.
- Editar: el valor guardado.
- Siempre en la hora local del navegador, **sin cambiar la política de zona horaria**. La limitación
  sigue abierta: el §93 pide presentar en la zona del proyecto (R7 del plan).

`toLocalInput` se trasladó a ese módulo desde `BetFinancialPanels.tsx`.

| Formulario | Tipo | Comportamiento |
|---|---|---|
| Añadir apuesta: fecha y hora de colocación | Creación | Momento actual (ya en 10.3a; ahora en dos campos) |
| Añadir apuesta: fecha y hora de liquidación | Operación | Momento actual |
| Liquidar una pendiente | Operación | Momento actual (**antes vacío**) |
| Editar una pendiente: fecha y hora de colocación | Edición | Valor guardado; **campo nuevo**, la API ya lo permitía; solo se envía si cambió |
| Editar una liquidada | Edición | Sin fecha editable: solo el motivo (regla de la Fase 8.5) |
| Corregir liquidación | Edición | Valores guardados (ya era así; ahora con prueba) |
| Depósito, transferencia, extraordinario, solicitud de retiro, conciliación, nueva etapa | — | **No tienen campo de fecha:** la API registra el momento actual. Los movimientos son inmutables, no se editan. Sin cambios |
| Filtros de fecha del dashboard | Filtro | **Excepción:** vacíos por diseño (sin filtro = todo el periodo) |
| Plan de etapas de la importación (fecha de inicio) | Datos históricos | **Excepción:** vacía por diseño; una etapa histórica no empieza "ahora" (D-X7) |

**Pruebas:**

- `BetsPage.spec.tsx`: 16 nuevas del formulario y 5 de fechas en edición, liquidación y lista. Las
  pruebas anteriores se adaptaron a las nuevas etiquetas, y se reescribieron las 7 de la 10.3a.
- `BetFinancialPanels.spec.tsx`: la corrección conserva las fechas guardadas.
- `date-inputs.spec.ts` (5).
- Se corrigió el `STAGE_ID` de las utilidades de prueba de la web: no era un UUID válido y el
  formulario ahora envía la etapa elegida.

### Corrección 10.3d — Tarjeta de apuesta: Ver ticket, Estado y menú ⋮ (H-18)

- **Tarjeta:**
  - información: fecha y hora, tipo y casa (y el aviso de retorno calculado); partido(s); cuota
    (y la efectiva si difiere); importe; A+G; ganancia; stake, etapa y autor;
  - a la derecha: **[Ver ticket] [Estado ▾] [⋮]**, que bajan de línea en pantallas estrechas.
- **Ver ticket:**
  - con ticket, abre el panel de tickets existente en **solo lectura** (nuevo `readOnly` de
    `TicketPanel`: sin subir, analizar ni aplicar campos);
  - sin ticket, "Sin ticket" deshabilitado.
  - Para saberlo sin cargar el detalle, `BetSummary` incluye `ticketCount` (y `events` para el
    partido): dos campos de solo lectura de la API, sin migración.
- **Estado:** no liquida nada. Abre el panel de siempre con el resultado elegido:

  | Estado actual | Elección | Panel | Permiso |
  |---|---|---|---|
  | Pendiente | un resultado | "Liquidar" | `bets.settle` |
  | Liquidada | otro resultado | "Corregir liquidación" (motivo, impacto y contraseña) | `bets.correct` |
  | Liquidada | "Pendiente (reabrir)" | "Reabrir" | `bets.correct` |

  Sin el permiso, el estado solo se muestra. Colores: Pendiente neutro, Ganada verde, Perdida roja,
  Anulada gris y Cash out azul.
- **Menú ⋮**, las mismas acciones y permisos de antes: Editar, Confirmar retorno oficial, Corregir
  liquidación, Reabrir, Mover de etapa, Adjuntar o analizar ticket, Historial financiero y Eliminar
  (antes "Papelera": borrado lógico, con las confirmaciones de siempre). No se eliminó ninguna
  acción. "Restaurar" sigue directo en la vista de papelera.
- **Pruebas:**
  - API: `events` y `ticketCount` en la lista (`bets.e2e-spec.ts`, `tickets.e2e-spec.ts`);
  - web: 12 nuevas de la tarjeta;
  - las pruebas existentes se adaptaron al menú con `openRowAction`, `chooseRowStatus` y
    `rowActionNames` (`test-utils.tsx`).

### Corrección 10.3c — Anulada con ganancia fija y "Liquidar" unificado (H-17, H-14)

- **H-17, anulada.**
  - `allowsProfitOverride` solo admite la ganada y el cash out.
  - `betDraftFigures` devuelve para una anulada A+G = monto y ganancia 0.00, e ignora cualquier
    ganancia escrita.
  - El formulario muestra la ganancia como texto, sin campo editable, y no envía retorno oficial:
    la API guarda como retorno el monto (§21.4), igual que antes.
  - Al pasar de ganada a anulada, la ganancia escrita se descarta.
- **H-14, "Liquidar".** La sección de resultado del alta se extrajo a
  `apps/web/src/pages/project/BetSettlementFields.tsx` (`SettlementSection`, más los estilos y
  `DateTimeFields`) y la usan el alta y "Liquidar", con el mismo módulo de cálculo
  (`bet-draft.ts`). Al liquidar una pendiente:
  - se proponen Ganada y el momento actual;
  - se muestran el monto de la apuesta (`effectiveAmount` de la API), la cuota visible guardada,
    A+G y la ganancia calculada;
  - la ganancia es editable en ganada y cash out: ajustada, pasa a ser el retorno oficial y se
    muestra la cuota efectiva. La cuota visible no se envía ni cambia;
  - sin tocar la ganancia, la ganada se liquida con el **retorno calculado** (provisional; se
    confirma después con "Confirmar retorno oficial", flujo que no cambia);
  - perdida y anulada tienen la ganancia fija;
  - el cash out sigue exigiendo el retorno (la validación compartida `settleBetSchema`).

  La API no cambió: mismo endpoint, permiso (`bets.settle`, sin reautenticación, como antes),
  validaciones, motor de ledger y auditoría.
- **Pruebas:**
  - `BetsPage.spec.tsx`:
    - "Liquidar" (7): fecha actual; ganada con el retorno calculado; ganancia ajustada, cuota
      efectiva y cuota visible conservada; perdida; anulada; cash out obligatorio; rechazo de la
      API;
    - alta: anulada con ganancia fija y envío coherente, y una ganancia de ganada que no se
      arrastra a anulada.
  - `bet-draft.spec.ts`: anulada fija aunque llegue una ganancia escrita.
  - `bets.e2e-spec.ts`: liquidar como lo envía la web (calculado, oficial ajustado 60 / 1.56 /
    94.07 → cuota efectiva 1.567833, perdida y anulada) terminando con `assertFinancialInvariant`.

### H-14 — Análisis (10.3b; sin cambios de comportamiento)

El formulario "Liquidar" de una pendiente:

- propone ahora el momento actual como fecha (convención de operación);
- pero sigue pidiendo el **retorno oficial**: para una ganada obliga a escribirlo, porque el campo
  vacío no pasa la validación del formulario (la API sí aceptaría liquidar sin él, con el retorno
  calculado);
- no muestra A+G ni la ganancia calculadas.

El alta con resultado, en cambio, propone la ganancia calculada, deja liquidar con el retorno
calculado (provisional, que luego se confirma con "Confirmar retorno oficial") y convierte una
ganancia ajustada en retorno oficial.

Unificarlo cambiaría el uso habitual de "Liquidar": una ganada podría liquidarse sin retorno
oficial, quedando con el retorno calculado y el aviso "sin confirmar". La API ya lo admite, así que
no es un cambio de regla, pero sí de flujo. **Se deja para tu decisión.**

### H-19 — Rediseño del dashboard y del marco de la aplicación (10.3e)

**Problema.** El "Resumen" del proyecto era una sola columna:
- datos del proyecto, estado financiero, análisis con filtros y dos gráficos;
- sin apuestas recientes ni pendientes, sin casas, sin deportes y sin accesos directos;
- la navegación eran pestañas que no se adaptaban al móvil.

**Cambio (solo interfaz; sin reglas financieras nuevas):**
- **Marco** (`AppShell.tsx`, `ProjectLayout.tsx`, `shell-slots.ts`, `icons.tsx`):
  - barra lateral oscura con la navegación principal y la del proyecto, filtrada por permisos
    (Retornos, Importaciones, Reportes, Eliminados y Auditoría solo con su permiso);
  - el proyecto actual al pie;
  - en móvil, cajón con botón "Abrir menú" que se cierra con Escape, el fondo o al navegar;
  - barra superior con proyecto, estado, etapa, rol, iniciales, nombre, correo y "Cerrar sesión";
  - no hay buscador ni notificaciones, porque no existen en el sistema.
- **Dashboard** (`DashboardPage.tsx`, `dashboard/*`) con estos bloques:
  - capital actual, disponible, comprometido y ganancia total con Yield y ROI;
  - evolución del capital (periodos 7D/30D/3M/1A/Todo);
  - estado de apuestas (donut);
  - recientes (6);
  - casas;
  - deportes más jugados;
  - pendientes;
  - acciones rápidas;
  - "Sobre el proyecto", con los datos que mostraba el Resumen.

  Cada sección tiene su esqueleto de carga (nunca un "0" provisional), su estado vacío y su
  propio error.
- **Reportes** (`ReportsPage.tsx`, ruta nueva `/projects/:id/reports`): el análisis filtrado y la
  curva de rendimiento con drawdown se movieron sin cambios de lógica.
- **Apuestas:** `?nueva=1` abre el formulario de alta (lo usan "Añadir apuesta" del dashboard).
- **Estilos compartidos** (`ui.tsx`, `bet-status-style.ts`): botón primario violeta, tarjetas
  redondeadas y colores de estado comunes. Es solo visual.
- **Rendimiento:** Dashboard y Reportes se cargan de forma diferida. Recharts (343 kB, 100 kB
  gzip) ya no va en el paquete inicial.

**Datos utilizados (todos existentes):**
- `GET /dashboard/status`: capital, disponible, comprometido, casas, conteos y retornos por
  confirmar;
- `GET /dashboard/analysis` sin filtros: ganancia, Yield, ROI y desglose por deporte;
- `GET /dashboard/bankroll-chart`: evolución del capital;
- `GET /projects/:id/bets`: recientes y pendientes.

Una petición de cada una.

**Único cambio de backend:** `BetSummary` incluye `sports` (los deportes distintos de sus
selecciones), igual que ya incluía `events`. Es de solo lectura y no toca el ledger, los saldos ni
los permisos.

**Límites conocidos (sin decisión de negocio, documentados):**
- **Apuestas recientes y pendientes** se derivan de la lista completa de apuestas, porque la API no
  tiene `limit`. Con miles de apuestas convendría un parámetro de límite (decisión técnica futura).
- **Periodos del gráfico:**
  - eligen el tramo de la serie real; no se inventan puntos;
  - si el periodo no tiene movimientos, se dice y se muestra el capital vigente;
  - la variación se calcula contra el último saldo real anterior al periodo;
  - "3M" son 91 días.
- **Porcentajes de estados y de deportes** son solo visuales (cantidad ÷ total).
- **"Deportes más jugados"** cuenta las apuestas liquidadas, como el análisis (§108.5): una
  pendiente no aparece hasta liquidarse. Una múltiple con deportes distintos cuenta como "Mixto".
- **"Comprometido"** incluye los retiros por aprobar, como el estado financiero (§33). El texto de
  la tarjeta lo indica.

**Pruebas:**
- `DashboardPage.spec.tsx` (21):
  - métricas, carga sin ceros y errores aislados;
  - setup pendiente;
  - periodos del gráfico, periodo vacío y gráfico sin movimientos;
  - donut con porcentajes y estado vacío;
  - recientes (datos, máximo 6), pendientes (orden) y estados vacíos;
  - casas (orden y vacío) y deportes (porcentajes y vacío);
  - acciones rápidas según permisos;
  - navegación a Apuestas, con el formulario abierto.
- `ReportsPage.spec.tsx` (6): las pruebas de análisis y drawdown que estaban en el dashboard, más
  el acceso desde la barra lateral.
- `AppShell.spec.tsx` (7): barra lateral por permisos, enlace activo, proyecto actual, barra
  superior, cajón móvil.
- Ajustados `ProjectPages.spec.tsx` y `ReturnsAndNotices.spec.tsx` a los nuevos nombres.
- `bets.e2e-spec.ts` comprueba `sports` en la lista.

### H-20 y H-25 — Zona horaria del proyecto (10.3g)

**Qué dice la especificación (es explícita, no hace falta decidir nada):**
- **§93:** «Cada proyecto tiene una zona horaria IANA configurada. Los instantes conocidos con hora
  se almacenan de forma no ambigua (preferentemente UTC en persistencia) y **se presentan en la
  zona del proyecto**. Si solo se conoce una fecha sin hora, no se inventará una hora como si
  fuese oficial.»
- **§108.7 y ADR 0015 (D-M7):** el rendimiento por periodo se agrupa por `settled_at` en la zona
  del proyecto.
- **§88:** el límite diario del Colaborador se cuenta en la zona del proyecto.
- **ADR 0005:** `timestamptz` en UTC y «la presentación en la zona del proyecto».
- **§113.4:** una fecha importada sin hora es el mediodía del proyecto (`noonInTimeZone`).

**Qué se encontró:**
- **La API ya cumplía.** Guarda en UTC; recibe `from`/`to` como instantes con desfase
  (`z.iso.datetime({ offset: true })`); y agrupa, cuenta el límite diario y resuelve las fechas
  importadas con `project.timezone`.
- **La web no cumplía** (riesgo R7 del plan):
  - mostraba y leía las fechas en la zona del **navegador**;
  - los filtros «Desde/Hasta» de Reportes enviaban `AAAA-MM-DDT00:00:00.000Z`, el día **UTC**,
    que no es ni la del proyecto ni la del navegador.

  Consecuencia: en Lima, una apuesta liquidada el 1 de junio a las 20:00 la agrupaba la API en el
  día 1, pero el filtro «hasta el 1 de junio» la dejaba fuera.
- **H-25:** las listas mostraban la hora de una apuesta con `placedTimeKnown = false`; en una
  importada era la de las 12:00 técnicas.

**Corrección (solo web; sin migración ni cambios de API o esquema):**
- `time-zone.ts` replica la técnica de `apps/api/src/common/timezone.ts`: `Intl` sin librerías,
  dos pasadas para los cambios de horario.
- La zona de presentación es la del proyecto (`ProjectLayout`) o la del navegador fuera de un
  proyecto (`AppShell`).
- `date-inputs.ts` lee y escribe fecha y hora en esa zona, con la misma convención: crear → ahora;
  editar → lo guardado; operar (liquidar) → ahora. Lo usan:
  - Añadir, Editar y Liquidar apuesta;
  - Corregir liquidación (`datetime-local`);
  - el plan de etapas de una importación;
  - los filtros de Auditoría y de Reportes. En Reportes, «Desde/Hasta» envían el primer y el
    último instante del día del proyecto; «Últimos 7 días» = hoy y los 6 anteriores.
- `formatDateTime`, `formatDate` y las fechas de los gráficos presentan en esa zona.
  `formatMoment` muestra solo la fecha y «(hora desconocida)» cuando la hora no se conoce (H-25).
- Los campos de fecha y hora indican «Hora del proyecto (zona)», y Reportes indica en qué zona se
  cuentan los días.

**Pruebas:**
- `time-zone.spec.ts`: conversiones Lima, Tokio y Madrid con cambio de horario; fechas
  imposibles; Desde/Hasta; crear y editar; presentación; hora desconocida.
- `ReportsPage.spec.tsx`: Desde/Hasta en Lima y en Tokio, y «Últimos 7 días».
- `BetsPage.spec.tsx`: lista, alta y edición con un proyecto en Tokio; hora desconocida.
- `AppShell.spec.tsx`: la zona vuelve a la del navegador fuera del proyecto.

Las pruebas web corren en `America/Lima`: usar proyectos en Tokio demuestra que ya no se depende
de la zona del navegador.

### H-20 a H-24 — Segunda pasada de diseño y UX (10.3f)

**Contexto.** Rediseño de toda la interfaz:
- tema oscuro principal, más claro y del sistema;
- sistema de diseño común en `ui.tsx` y glosario de conceptos en `glossary.tsx`;
- primeros pasos en el Dashboard;
- formularios por pasos;
- recorrido guiado de importación.

No cambia reglas financieras, permisos ni endpoints. Al revisar cada pantalla salieron estos
puntos:

- **H-20.** Ver «H-20 y H-25 — Zona horaria del proyecto (10.3g)», más abajo.
- **H-21 (corregido).** La configuración inicial mostraba la banca total sumando con `Number()`.
  Ahora usa `sumMoney` de `@letfer/shared` y avisa de los montos con formato no válido. Lo
  enviado a la API no cambia.
- **H-22 (corregido).** `describeApiError` reducía `CONFLICT`, `CORRECTION_CONFLICT`,
  `PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE` y `UNAUTHENTICATED` a un texto genérico, y la
  validación a «Revisa los datos ingresados.» sin decir qué.
  - Ahora muestra el mensaje de la API, que ya está redactado para el usuario (`AppError`), y los
    campos inválidos con su nombre legible.
  - Nunca se muestra un código técnico.
  - Prueba: `api/errors.spec.ts`.
- **H-23 (corregido).** «Eliminar» en una pendiente llamaba a la API sin confirmar. Ahora pide
  confirmación con «Eliminar apuesta» y explica que libera el importe reservado y que se puede
  restaurar. El permiso y el endpoint son los mismos.
- **H-24 (corregido).** Recharts animaba el área del capital y, en algunos navegadores, la
  primera pintura quedaba vacía. Las animaciones de los gráficos quedan desactivadas, igual que en
  el donut, para no tener animaciones de presentación.

**Límites conocidos de la pasada:**
- **Tablas largas en móvil.** Las de Finanzas, Importaciones y Auditoría conservan el
  desplazamiento horizontal dentro de su tarjeta. Las listas principales (Apuestas, Dashboard) ya
  son tarjetas.
- **Comprobación visual.** Se hizo con capturas de un banco de pruebas temporal con datos
  simulados, ya eliminado; no se tocó ninguna base de datos.

## Resultados de la 10.2 (backups reales)

**Fecha:** 2026-09-30. **Escenarios:** D1 (backup manual real) y D2 (restauración real), más las 2
pruebas automáticas que estaban omitidas.

1. **Base de ensayo.** `letfer_trial` creada en el clúster local (`DB_NAMES=...,letfer_trial npm run
   db:start`) con las 41 migraciones (0000 a 0040), 27 tablas y **ningún usuario**: queda limpia para
   el Administrador Global de la persona usuaria. Carpetas `C:\LetFerEnsayo\{backups,tickets,outbox}`
   creadas.
2. **Pruebas automáticas reales.** Con `pg_dump` en el `PATH`, `backups.e2e-spec.ts`: 15 de 15, sin
   omitidas. Se ejecutaron de verdad "crea un volcado completo, restaurable, con checksum y tamaño
   correctos" y "round-trip completo: respalda, cambia datos, restaura y confirma que vuelven".
3. **Backup manual real (D1).** API compilada (`node dist/main.js`) sobre una base temporal de
   validación con datos sintéticos creados por HTTP:
   - un proyecto con dos casas, una transferencia y tres apuestas (ganada, perdida y pendiente);
   - un ticket PNG;
   - un lote de importación con un `.xlsx` sintético con el formato de Betsafe, nunca el archivo
     real.

   `POST /api/admin/backups` → generación `COMPLETED`, con un volcado de 163.648 bytes y un paquete
   de tickets de 266 bytes. El manifiesto (`manifest.json`, fuera de la base) registra la generación,
   y **los SHA-256 recalculados de ambos archivos coinciden con el manifiesto**. `pg_restore --list`:
   326 entradas y 28 tablas con datos (las 27 de `public`, con `import_batches`, `tickets`,
   `financial_movements`, `bets`, `users` y `audit_logs`, más `drizzle.__drizzle_migrations`). El
   paquete de tickets contiene el PNG.
4. **Restauración en una base limpia (D2).** `createdb` + `pg_restore --exit-on-error` en una base
   nueva, sin errores; tickets extraídos con `tar` en una carpeta vacía. La API arrancada sobre la base
   restaurada acepta el inicio de sesión del usuario restaurado y devuelve **exactamente el mismo
   estado** que antes del backup:
   - saldos por casa: Betsafe 1054.00; Betano 450.00, con 10.00 comprometidos;
   - apuestas, movimientos y dashboard;
   - estado del lote;
   - SHA-256 del ticket y del archivo original de la importación; este último coincide también con
     el `sourceSha256` que guardó el lote.
5. **Integridad financiera.** Verificación de integridad `OK`, sin hallazgos, antes del backup y
   después de restaurar.
6. **Limpieza.** Las dos bases temporales de validación se borraron; solo quedan `letfer_dev`,
   `letfer_test` y `letfer_trial`. Los archivos de la validación quedaron fuera del repositorio, en
   la carpeta temporal de la sesión.

**No cubierto todavía** (sigue en el escenario D del plan):
- **D3:** el backup programado real, varios días seguidos, y la rotación de 30 generaciones.
- **D4:** la restauración en una máquina limpia siguiendo solo la documentación.
- La restauración desde la propia interfaz (`POST /admin/backups/restore`, con modo mantenimiento).
  Se probó con el `pg_restore` real solo en la prueba automática de ida y vuelta, no a mano.

## Escenarios de la 10.3 (flujo financiero)

Se recorren desde la interfaz sobre `letfer_trial`, siguiendo `docs/GUIA_PRUEBA_MANUAL_10_3.md`.

**Columna "Resultado":**
- `Pendiente` hasta probarlo;
- `OK` si coincide con lo esperado;
- el ID del hallazgo (`H-nn`) si no.

**Después de cada escenario**, comprueba:
- la verificación de integridad del proyecto, sin hallazgos;
- que el Dashboard (y Reportes) son coherentes con lo registrado;
- el evento correspondiente en la auditoría.

**Preparación** (antes del primer escenario):
- Administrador Global creado con `C:\LetFerEnsayo\crear-admin.ps1`;
- entorno arrancado con `C:\LetFerEnsayo\iniciar-ensayo.ps1`;
- un backup manual inicial.

| ID | Área | Qué probar | Resultado esperado | Resultado | Fecha |
|---|---|---|---|---|---|
| F-01 | Creación de proyecto | "Nuevo proyecto" con nombre y zona horaria | Proyecto `ACTIVE`, quien lo crea es propietario y Administrador de Proyecto; aviso de configuración pendiente; ninguna operación financiera antes del setup | Pendiente | |
| F-02 | Configuración inicial | Completar la configuración: unidad de la Etapa 1 y casas con monto inicial | Etapa 1 activa con su unidad; cada casa con su saldo; banca inicial en el historial de movimientos; no se puede repetir el setup | Pendiente | |
| F-03 | Casas | "Nueva casa" con y sin saldo; desactivar y reactivar | La casa nunca se borra; una desactivada no admite operaciones nuevas y sigue en el historial | Pendiente | |
| F-04 | Movimientos | Depósito, transferencia entre casas, retiro (solicitud y aprobación), extraordinario | Saldos correctos por casa; la transferencia no cuenta como depósito, retiro ni ganancia; el disponible nunca es negativo; aprobar el retiro y el extraordinario piden contraseña | Pendiente | |
| F-05 | Etapas | "Nueva etapa" con otra unidad; cerrar; corregir la unidad | Una sola etapa activa; cambiar de etapa no reinicia la banca; corregir la unidad pide contraseña y queda auditado | H-11, H-20 (corregidos; volver a probar) — guía §7 | 2026-09-30 |
| F-06 | Apuestas | Registrar simples y múltiples (con varias selecciones); una sin saldo suficiente; también ya liquidadas (resultado al registrar) | La pendiente compromete saldo al instante; sin disponible, la API la rechaza con un mensaje claro; el tipo se deriva de las selecciones; con resultado, se registra y liquida a la vez | H-09 a H-18, H-20, H-23, H-25 (corregidos; volver a probar) — guía §7 | 2026-09-30 |
| F-07 | Liquidaciones | Liquidar ganada, perdida, anulada y cash out | Saldos y ledger correctos; el retorno calculado se muestra como provisional; el Colaborador solo liquida lo que su rol permite | Pendiente | |
| F-08 | Retorno oficial | Confirmar el retorno oficial igual y distinto del calculado | Igual: solo se marca confirmado; distinto: pide confirmar la diferencia y la contraseña, y el oficial manda | Pendiente | |
| F-09 | Correcciones | Corregir una liquidación, reabrirla, moverla de etapa, eliminarla y restaurarla | Siempre se ve el impacto antes de aplicar; la corrección genera reversiones, nunca ediciones; motivo y contraseña obligatorios; integridad sin hallazgos | Pendiente | |
| F-10 | Dashboard y Reportes | Revisar el Dashboard (métricas, evolución del capital, estado de apuestas, recientes, casas, deportes, pendientes) y Reportes (análisis filtrado y drawdown) tras F-06 a F-09 | Ganancia/pérdida, Yield y ROI coherentes con las apuestas; los filtros no cambian la realidad financiera; las transferencias no cuentan como resultado | Pendiente | |
| F-11 | Conciliación | Conciliar cada casa contra su saldo "oficial"; después corregir una apuesta ya conciliada | Coincide: `MATCHED`; si no, una discrepancia sin ajustes falsos; una corrección posterior invalida el checkpoint afectado | Pendiente | |
| F-12 | Concurrencia | Dos personas editan o liquidan la misma apuesta a la vez | Una lo consigue y la otra recibe un conflicto claro; sin dobles registros ni saldos negativos | Pendiente | |
