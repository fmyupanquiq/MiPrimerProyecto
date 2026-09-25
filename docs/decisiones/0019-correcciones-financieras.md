# 0019. Correcciones financieras de apuestas liquidadas

- **Estado:** Aceptada (Fase 8.5). Especificación §112 aprobada; implementación en curso.
- **Fecha:** 2026-09-25
- **Referencias:** especificación §17, §21, §24, §25, §26, §27, §32, §73, §74, §76, §77, §78, §107
  (en especial §107.8 y §107.9), §108, §109.1, §109.2, §111; ADR 0004, 0008, 0013, 0014, 0015,
  0016. Especificación: §112.

## Contexto

Con la Fase 8 cerrada (`v0.8-administracion`), el modelo financiero tiene un hueco conocido: una
apuesta ya liquidada no se puede corregir (§107.9: cualquier cambio financiero responde 409) y el
retorno provisional del §77 no existe (liquidar `WON` exige el retorno oficial). Antes de operar
con dinero real o de importar histórico, la persona responsable del producto aprobó una Fase 8.5
que cierra esos puntos. Las decisiones D-A1 a D-A8 están aprobadas. D-B8 (redondeo) sigue
**pendiente** y no se decide aquí.

## Hallazgos de la línea base (8.5.0)

Verificados con `apps/api/test/bets-ledger-baseline.e2e-spec.ts` (pruebas de caracterización sobre
`main`, en verde: describen el comportamiento actual, no el deseado).

| # | Hallazgo | Gravedad | Se corrige en |
|---|---|---|---|
| F1 | Enviar a la papelera una apuesta liquidada no toca el ledger, pero el dashboard la excluye: saldo (519.00) y P/L (0) divergen. Restaurar tampoco genera nada. La verificación de integridad no lo detecta. | Alta (integridad) | 8.5.3 y 8.5.4 |
| F2 | Editar `placedAt` de una apuesta liquidada no mueve el `occurred_at` de su `BET_PLACEMENT`. | Media | 8.5.3 |
| F6 | (Nuevo) Se acepta una `placedAt` posterior a `settledAt`: nada valida colocación ≤ liquidación al editar. | Media | 8.5.3 |
| F3 | Liquidar guarda el monto calculado en `official_amount`; `amountSource` pasa a `CONFIRMED` sin que haya habido monto oficial (§76). | Media | 8.5.1 y 8.5.2 |
| F4 | No existe el retorno provisional (§77): `WON` exige el oficial. | Bloqueante funcional | 8.5.2 |
| F5 | Mover de etapa una apuesta liquidada deja sus filas del ledger con la etapa original. **Alcance verificado:** ningún cálculo depende de `financial_movements.stage_id` (solo se muestra en el listado de movimientos). Saldos y dashboard no se ven afectados. | Baja | Sin cambio (ver D-A9) |
| F7 | (Nuevo, menor) Sin apuestas liquidadas, el P/L del dashboard llega como `"0"` y no como `"0.00"`. | Baja | 8.5.4 |

## Decisiones aprobadas

- **D-A1. Reversión más re-registro con `REVERSAL` genérico.** Corregir una apuesta liquidada no
  edita ni borra el ledger (D2): inserta filas `REVERSAL` que anulan cada fila vigente y, después,
  las filas correctas. El tipo es genérico (no `BET_REVERSAL`) para que la futura anulación de
  lotes de importación (Fase 9) reutilice el mismo mecanismo.
- **D-A2. Fecha efectiva.** Cada `REVERSAL` conserva el `occurred_at` de la fila que revierte
  (retroactivo: la serie histórica de saldos queda verdadera). Las filas nuevas llevan las fechas
  correctas. `created_at` registra cuándo se escribió realmente la corrección.
- **D-A3. Retorno provisional (§77).** `WON` puede liquidarse sin retorno oficial: se guarda un
  retorno **calculado** (monto × cuota visible, política de redondeo vigente) marcado como no
  confirmado. `VOID` queda confirmado automáticamente (retorno = monto, §21.4). `CASHOUT` exige
  retorno oficial. `LOST` no tiene retorno (D-B2).
- **D-A4. Reabrir.** Una apuesta liquidada puede volver a `PENDING`: se revierte todo su efecto
  en el ledger y vuelve a comprometer su monto (exige saldo disponible suficiente).
- **D-A5. Validación histórica (§74).** Antes de escribir se reproduce la línea de tiempo de cada
  casa afectada con los cambios propuestos. Si el saldo bruto queda negativo en algún punto, o el
  disponible actual queda negativo, responde **409 `CORRECTION_CONFLICT`** con los registros que
  originan el conflicto y no se escribe nada. El comprometido no tiene historia por fecha:
  se modela como un débito desde la colocación o solicitud de cada pendiente (ver notas de 8.5.3).
- **D-A6. Dashboard.** Los retornos no confirmados participan en P/L, ROI y Yield con su valor
  calculado, siempre con un aviso visible ("incluye N apuestas con retorno no confirmado") y el
  monto afectado. Nunca se confunde un calculado con un oficial (§77).
- **D-A7. Papelera.** Enviar a la papelera una apuesta liquidada genera la reversión completa de
  su efecto; restaurarla la re-registra con filas nuevas. Corrige F1 con el mismo motor.
- **D-A8. Permisos.**
  - `bets.correct`: corregir, reabrir, y enviar a la papelera o restaurar una apuesta liquidada.
    Exige reautenticación reciente, motivo obligatorio y `version`.
  - `bets.confirm_return`: confirmar el retorno oficial. **No disponible para el Colaborador.**
  - Ambos: `PROJECT_ADMIN` (y, por herencia, el propietario y el Administrador Global).

## Decisiones derivadas (aprobadas)

- **D-A9 (F5).** No se reescribe la etapa de las filas del ledger de una apuesta movida de etapa:
  el ledger es inmutable y ningún cálculo la usa. Se documenta que `stage_id` del movimiento es la
  etapa vigente cuando se registró. La etapa de la apuesta la define `bets.stage_id`.
- **D-A10 (F6).** Toda creación, edición o corrección valida `placedAt ≤ settledAt` cuando hay
  liquidación (400 `VALIDATION_FAILED`).
- **D-A11.** Enviar a la papelera o restaurar una apuesta **liquidada** exige `bets.correct`, motivo obligatorio y
  reautenticación, aunque el Colaborador tenga `bets.trash_own`: el Colaborador solo elimina sus
  apuestas `PENDING` (sin efecto en el ledger). Sin esto, un Colaborador podría generar
  reversiones financieras.
- **D-A12.** Confirmar el retorno oficial **sin diferencia** respecto del calculado no exige
  reautenticación (solo marca confirmado). Con diferencia exige `acknowledgeDifference` y
  reautenticación (D-A8).
- **D-A13 (F7).** Las cifras monetarias del dashboard se normalizan siempre a dos decimales.

## Decisiones técnicas

### Esquema (revisar cada migración a mano; aún no hay datos reales)

- `bets`: `calculated_realized_return numeric(…)` nulo; `amount_confirmed boolean not null`.
  `official_realized_return` solo se llena con un valor oficial. Retorno efectivo =
  `COALESCE(official, calculated)`. `bets_settlement_shape` acepta `WON`/`VOID` con oficial o
  calculado y `CASHOUT` solo con oficial.
- `financial_movements`: nuevo valor de enum `REVERSAL` (dirección libre, opuesta a la revertida);
  columnas nulas `reverses_movement_id` (FK a sí misma) y `correction_id`. `CHECK`: `reverses_movement_id`
  es obligatorio si y solo si el tipo es `REVERSAL`; motivo obligatorio en `REVERSAL`; índice único
  parcial sobre `reverses_movement_id` (una fila no se revierte dos veces); disparador que exige
  que la reversión coincida en proyecto, casa y monto, con dirección opuesta. `balances.ts` no
  cambia: suma por dirección.
- `bet_corrections` (nueva, inmutable con `prevent_modification`): `id`, `project_id`, `bet_id`,
  `kind` (`RETURN_CONFIRMATION`, `SETTLEMENT_CORRECTION`, `REOPEN`, `TRASH_REVERSAL`,
  `RESTORE_REPOST`), `before`/`after` (jsonb de los campos financieros), `reason`, `created_by`,
  `created_at`. Es el ancla de la auditoría y del historial.
- Filas re-registradas conservan su tipo (`BET_PLACEMENT`/`BET_SETTLEMENT`) y llevan `correction_id`.

### Motor de efecto financiero

Una única función (`finance/bet-ledger.ts`): calcula el efecto neto vigente de la apuesta (filas no
revertidas), lo compara con el efecto deseado y genera reversiones y filas nuevas. La usan
liquidar, confirmar, corregir, reabrir, papelera y restaurar. Corre en una transacción, con
`lockByKey('finance:<proyecto>')`, bloqueo de la fila de la apuesta y de las casas afectadas.
Sin cambio financiero real no genera filas. **Invariante:** el efecto neto en el ledger de una
apuesta liquidada es igual a su ganancia o pérdida derivada; una apuesta en papelera o `PENDING`
tiene efecto neto cero.

### Checkpoints (§74, §109.1.3, revisión)

La regla "checkpoint `MATCHED` con fecha ≥ `placed_at`" pasa a usar la **fecha mínima de todas las
filas afectadas** (revertidas y nuevas). Un cambio posterior al checkpoint no lo invalida; un
checkpoint `DISCREPANCY` no cambia. `invalidated_reason` nombra la corrección.

### Endpoints (`/projects/:projectId/bets/:betId`)

- `POST …/settle` (existente): `WON` sin `officialRealizedReturn` se liquida como provisional.
- `POST …/confirm-return` (`bets.confirm_return`): si el oficial difiere del calculado y falta
  `acknowledgeDifference`, responde 409 `RETURN_MISMATCH` con `{calculated, official, delta}` sin
  cambiar nada.
- `POST …/correct-settlement` (`bets.correct`, reautenticación, motivo, `version`): `status`,
  `officialAmount`, `officialRealizedReturn`, `settledAt`, `settledTimeKnown`, `placedAt`.
- `POST …/correct-settlement/preview`: mismo cuerpo, sin escribir; devuelve filas a generar, saldo
  antes y después por casa, checkpoints que se invalidarían y conflictos. Mismo código que la real.
- `POST …/reopen` (`bets.correct`): vuelve a `PENDING`.
- `trash`/`restore` (existentes): reversión y re-registro para las liquidadas (D-A7, D-A11).
- `GET …/ledger`; `GET /projects/:projectId/bets/unconfirmed-returns`;
  `GET /projects/:projectId/bets/return-differences` (evidencia para decidir D-B8).

### Auditoría

`bet.settled` (con marca de provisional), `bet.return_confirmed`, `bet.settlement_corrected`,
`bet.reopened`, y `bet.trashed`/`bet.restored` con metadatos de reversión. Todas con `oldValues`,
`newValues`, `correction_id` y motivo; nunca se guardan secretos.

### Verificación de integridad (§109.2, ampliada)

Sustituye la comprobación (b) ("una sola fila `BET_SETTLEMENT`") por: (b1) efecto neto del ledger
igual al P/L derivado para cada apuesta liquidada; (b2) neto cero para `PENDING` y papelera;
(b3) toda reversión apunta a una fila vigente y ninguna se revierte dos veces; (b4) cada
corrección tiene su `bet_corrections` y viceversa. Sigue siendo de solo lectura.

### Redondeo (D-B8, sin decidir)

Toda aritmética de retornos calculados pasa por una sola función. El retorno calculado se guarda al
liquidar, así que un cambio futuro de política no reescribe la historia. Las pruebas del redondeo
son una tabla de casos parametrizada (mitad hacia arriba y truncado). El reporte de diferencias
reúne los datos reales para decidir.

### Dashboard, ROI y Yield

P/L, Yield y ROI siguen saliendo de `bets` con el retorno efectivo (D-A6); ROI usa banca inicial más
depósitos netos y no lo afectan las correcciones. El filtro de periodo usa
`COALESCE(settled_at, placed_at)`: corregir `settled_at` puede mover una apuesta de periodo, y es
correcto. Criterio de aceptación: tras cualquier secuencia de operaciones, Σ P/L del dashboard sin
filtros = Σ efecto neto de apuestas en el ledger = variación de saldos.

## Fuera de alcance

- Cambiar casa, etapa, selecciones o cuota de una apuesta liquidada (se hace reabriendo).
- Decidir el redondeo (D-B8).
- Importación y `batch_id` (Fase 9). El `REVERSAL` genérico y `bet_corrections` están pensados
  para reutilizarse; no se añade ningún campo de lote ahora.
- Alimentar el retorno oficial desde la lectura de tickets con IA.
- Reconstrucción de balances (D8-4).

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Un error en las reversiones destruye la confianza en el ledger | Motor único, invariante por apuesta, disparador en base de datos, integridad ampliada |
| Validación histórica incompleta (comprometido sin historia) | D-A5 explícita, límite documentado, pruebas de secuencias imposibles |
| Correcciones y liquidaciones simultáneas | `lockByKey`, bloqueo de apuesta y casas, versión optimista (reintento idéntico → 409, sin duplicar filas) |
| Abuso de correcciones históricas | `bets.correct`, reautenticación, motivo, auditoría, historial visible |
| Falsa precisión con retornos calculados | Insignia, aviso en dashboard, reporte de diferencias |
| Complejidad de la interfaz de corrección | Vista previa obligatoria antes de aplicar |

## Notas de implementación

### 8.5.1 (motor y esquema)

- El motor solo escribe la **diferencia** entre las filas vigentes y el efecto deseado (refina D-A1:
  se revierten únicamente las filas afectadas). Lo que coincide no se toca.
- El validador de línea de tiempo evalúa el saldo bruto por instante (filas del mismo instante
  agrupadas, §107.6) y solo atribuye a la corrección los conflictos que ella introduce.

### 8.5.2 (retorno provisional y confirmación)

- **`amount_confirmed`** significa únicamente que un ticket, la casa o una persona confirmó el
  **monto** (§76); nunca que LetFer congeló su propio cálculo. Se marca al registrar, editar o
  liquidar con un monto indicado. Liquidar sin él congela el calculado en `official_amount` con
  `amount_confirmed = false`, y `amountSource` sale de esa columna. La confirmación del **retorno**
  no tiene columna propia: `official_realized_return IS NOT NULL` es "confirmado" y, si solo existe
  `calculated_realized_return`, el retorno es provisional (`returnSource`). Confirmar el retorno no
  confirma el monto.
- La migración `0031` rellena `amount_confirmed` solo en apuestas pendientes con monto oficial: en
  una ya liquidada no se puede saber si `official_amount` era indicado o congelado (no había datos
  reales), así que se trata como no confirmada.
- `WON` guarda siempre el retorno calculado (aunque llegue el oficial) para poder compararlos en
  `return-differences`. `VOID` sin retorno indicado usa el monto y queda confirmado. `CASHOUT`
  exige el oficial.
- La reautenticación condicional (D-A12) usa `RequireRecentAuthWhen(predicado)`, evaluado sobre el
  cuerpo crudo: solo puede endurecer la exigencia (un valor malformado igualmente falla después en
  la validación del esquema).
- Liquidar por primera vez ya usa el motor (`correctionId = null`) y, por tanto, también valida la
  línea de tiempo: una colocación fechada antes del saldo que la respalda se rechaza con 409
  `CORRECTION_CONFLICT`.
- El disparador `bump_bet_financial_timestamp` **no** se amplía todavía a los retornos: la
  comprobación (e) de integridad compara contra `placed_at` y daría falsos hallazgos. Se rehace en
  8.5.4 junto con la regla de invalidación por fecha mínima afectada.
- **Criterio de aceptación** (`test/support/financial-invariant.ts`): tras cualquier secuencia, saldo
  del ledger (filas crudas) = saldo del dashboard = saldo conciliable, y ledger = capital inicial +
  depósitos − retiros + extraordinarios + ganancia/pérdida de las apuestas. Se aplica en cada
  escenario de 8.5.2 y se ampliará en 8.5.3 con corregir, reabrir, papelera y restaurar.
### 8.5.3 (corregir, reabrir, papelera y restaurar)

- **Un solo camino** (`BetCorrectionsService`): bloquear proyecto y apuesta, cambiar la apuesta,
  calcular con el motor qué filas revertir y añadir, validar la línea de tiempo y el disponible,
  registrar la corrección, invalidar checkpoints y auditar. La vista previa ejecuta ese mismo camino
  y lo revierte (rollback), así que no puede diferir de lo que se aplicaría; una corrección imposible
  se previsualiza como `valid: false` (200) y al aplicarla responde 409 `CORRECTION_CONFLICT`.
- **Comprometido histórico** (revisión explícita pedida). El comprometido no tiene línea temporal
  propia: se calcula en vivo. Para validar el pasado, cada apuesta pendiente y cada retiro pendiente
  se modela como un **débito desde su fecha de colocación o solicitud** (`BetHold`), tanto en la
  línea de tiempo actual como en la simulada; la propia apuesta se trata igual antes y después del
  cambio (al reabrir, su reserva pasa a ser una reserva; al liquidar, la reserva se sustituye por su
  colocación real). Así reabrir o restaurar no "libera" retroactivamente dinero que estaba comprometido
  cuando se hicieron retiros posteriores, algo que ni el saldo bruto ni el disponible de hoy detectan.
  Límite conocido: una reserva se modela desde su fecha hasta hoy; no se conoce en qué instante exacto
  dejó de existir una reserva ya resuelta más allá de lo que dice el ledger. El conflicto informa las
  apuestas y retiros pendientes que pesan en él (`pendingIds`).
- **Reabrir conserva la historia**: la fila de la apuesta limpia el retorno y la fecha de liquidación
  (una pendiente no tiene retorno; lo exige `bets_settlement_shape`), pero `bet_corrections.before`, la
  auditoría (`oldValues`) y las filas anuladas del ledger conservan el retorno calculado y el oficial
  anteriores y el resto de valores. La nueva liquidación genera valores nuevos. Un monto que era solo
  el calculado congelado vuelve a seguir la unidad de la etapa; uno confirmado se conserva.
- **Eliminar o restaurar una liquidada** exige `bets.correct`, reautenticación y motivo (D-A11): la
  reautenticación depende del estado de la apuesta, así que la comprueba el servicio con
  `assertRecentAuth` (compartido con el guard). Una pendiente conserva sus permisos.
- **Fechas (D-A10)**: la colocación no puede ser posterior a la liquidación al corregir, y la
  liquidación no puede ser anterior a la colocación al liquidar. Editar directamente la fecha de
  colocación de una liquidada (que movía la fecha de la apuesta sin mover el ledger, F2) ya no se
  permite: se corrige con la corrección de liquidación.
- **Checkpoints**: se invalidan los `MATCHED` de las casas afectadas de fecha igual o posterior a la
  fecha más antigua de las filas anuladas y nuevas, y solo si el ledger cambia (§112.5).
- **Historial**: `GET bets/:id/ledger` muestra las filas del ledger (vigentes, anuladas y reversiones)
  y las correcciones con sus valores anteriores.
- **Criterio de aceptación ampliado**: además de los escenarios paso a paso, una secuencia
  pseudoaleatoria determinista (semilla fija) de liquidar, corregir, reabrir, eliminar, restaurar y
  confirmar, con operaciones rechazadas incluidas, comprueba tras cada paso saldo del ledger = saldo
  del dashboard = saldo conciliable, y al final que el efecto neto de cada apuesta es su ganancia.

## Plan de subfases

8.5.0 línea base y documentación · 8.5.1 migraciones, motor y validador ·
8.5.2 liquidación provisional, `confirm-return` y reporte · 8.5.3 corregir, reabrir, papelera y
restaurar, y checkpoints · 8.5.4 integridad, dashboard y equivalencia · 8.5.5 web · 8.5.6 revisión
final, integración y tag `v0.8.5-correcciones-financieras`.

## Consecuencias previstas

- Aparecen 2 permisos de proyecto (`bets.correct`, `bets.confirm_return`).
- Migraciones nuevas (columnas de `bets`, tipo y columnas de `financial_movements`, `bet_corrections`).
- Cambian pruebas actuales que fijan el 409 de §107.9 y la exigencia del retorno oficial al liquidar
  `WON`; las pruebas de caracterización de 8.5.0 se invierten en la subfase que corrige cada hallazgo.
