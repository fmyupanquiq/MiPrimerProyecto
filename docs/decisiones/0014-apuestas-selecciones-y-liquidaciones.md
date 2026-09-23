# 0014. Apuestas, selecciones y liquidaciones

- **Estado:** Aceptada (Fase 4)
- **Fecha:** 2026-09-23
- **Referencias:** especificación §18 a §27, §71, §73 a §78, §90, §107

## Contexto

La Fase 4 introduce las apuestas: creación manual, selecciones (simple/creada/múltiple), cuotas,
stake, liquidación de resultados y su efecto en el ledger financiero unificado (§72, ADR 0013). No
modela tipsters ni señales externas (D-T1). Nueve decisiones (D-B1 a D-B12, con D-B9 como
consecuencia directa de la especificación) las tomó la persona responsable del producto y se
documentan aquí y en la especificación (§107).

## Decisiones funcionales (confirmadas)

- **D-T1.** Sin tabla de tipsters, señales ni campos de origen de la decisión.
- **D-B1.** "Anulada/Cancelada" es un único estado, `VOID`.
- **D-B2.** Una apuesta `LOST` no genera fila `BET_SETTLEMENT`; el `BET_PLACEMENT` ya representa
  la salida del dinero.
- **D-B3.** `eventGroup` (entero) agrupa selecciones del mismo evento dentro de una apuesta.
- **D-B4.** `placed_time_known`/`settled_time_known` marcan si la hora es conocida;
  `created_at`/`id` son el desempate estable.
- **D-B5.** Permisos `*_own`/`*_any` para acciones que dependen de la propiedad de la apuesta.
- **D-B6.** El límite diario de eliminaciones del Colaborador se cuenta desde `audit_logs`, sin
  tabla de contadores.
- **D-B7.** Monto y retorno calculados no se almacenan: se calculan en lectura, como los saldos de
  la Fase 3 (D3).
- **D-B8.** Redondeo/truncamiento real de las casas sigue pendiente de confirmar con tickets
  reales; el diseño queda preparado para ajustarlo sin romper nada.
- **D-B10.** Sin endpoint de papelera masiva.
- **D-B11.** Sin `ticketFileId` ni estructuras de ticket: eso es la Fase 7.
- **D-B12.** Sin cambios en `houses` para conciliación: eso es la Fase 6.

## Decisión técnica

### Por qué la reserva de una apuesta pendiente no toca el ledger

El ledger es inmutable tras confirmarse (D2, ADR 0013) y §17/§92 describen el "comprometido" de una
apuesta pendiente en los mismos términos que un retiro pendiente: una reserva, no todavía una salida
de dinero. Se aplica exactamente el mismo patrón que D5 (retiros): mientras la apuesta está
`PENDING`, su monto se suma al `committed` de la casa mediante una consulta en vivo sobre `bets`
(`balances.ts`), sin ninguna fila del ledger. Las filas `BET_PLACEMENT` (débito) y, si corresponde
(D-B2), `BET_SETTLEMENT` (crédito) se insertan **juntas** al liquidar, cada una con el `occurredAt`
real (`placedAt`/`settledAt`) aunque ambas se graben en ese instante — el mismo patrón ya usado para
movimientos con fecha retroactiva (§55: "esto permite importar historial sin falsear fechas").

Esto resuelve sin fricción la exigencia de §73 de que una corrección de unidad recalcule el monto de
apuestas pendientes sin monto oficial: como nada quedó guardado para esas apuestas, el monto
efectivo simplemente cambia en la siguiente lectura (D-B7). Lo que la Fase 4 **no** implementa es el
rechazo proactivo de la propia corrección de unidad cuando dejaría a una casa con comprometido
superior a su saldo (§73, último punto): esa situación sí se detecta en la siguiente creación o
liquidación de apuesta sobre esa casa (que revalida disponible bajo `.for('update')`), pero la
operación de corregir la unidad en sí no la anticipa. Queda como una decisión pendiente (§107.5),
no como un defecto silencioso.

### Esquema

- `bets`: `id`, `projectId`, `stageId`, `houseId`, `createdBy`, `betType`
  (`SIMPLE`/`CREATED`/`MULTIPLE`), `stake` (`numeric(10,4)`, `CHECK > 0`), `officialAmount`
  (`money`, nullable, `CHECK` positivo si existe), `visibleTotalOdds` (`numeric(12,6)`,
  `CHECK > 0`), `officialPotentialReturn` (`money`, nullable), `officialRealizedReturn` (`money`,
  nullable), `status` (`PENDING`/`WON`/`LOST`/`VOID`/`CASHOUT`), `placedAt`/`placedTimeKnown`,
  `settledAt`/`settledTimeKnown`, `reason` (observaciones), `version`, columnas de papelera
  (`deletedAt`, `deletionReason`, `deletedBy`, `purgeEligibleAt`, mismo patrón que `stages`).
  `CHECK bets_settlement_shape` obliga a que `PENDING` no tenga `settledAt`/retorno, `LOST` tenga
  `settledAt` pero no retorno (D-B2), y `WON`/`VOID`/`CASHOUT` tengan ambos.
- `bet_selections`: `id`, `betId` (FK a `bets`, `onDelete: cascade`: es propiedad exclusiva de la
  apuesta, no una entidad referenciada desde fuera, a diferencia de las FK `restrict` del ledger),
  `eventGroup` (entero, D-B3), `position` (orden dentro del grupo/apuesta), `sport`, `event`,
  `market` (nullables: §19 los lista como opcionales), `selection` (obligatoria), `visibleOdds`
  (`numeric(12,6)`, `CHECK > 0`).
- `financial_movements`: se añaden `BET_PLACEMENT` (débito) y `BET_SETTLEMENT` (crédito) a
  `movement_type`; el `CHECK` de dirección se extiende con ambos; el de forma (casa única vs.
  transferencia) ya era genérico y no necesita cambios. `operationId` reutiliza el `id` de la
  apuesta (mismo patrón que un retiro aprobado, D5), así que no hace falta una columna `betId` en
  el ledger para correlacionar sus dos filas.
- `balances.ts`: `computeHouseBalances` suma al `committed` las apuestas `PENDING` (monto oficial o
  calculado con la unidad vigente de su etapa) además de los retiros pendientes.
- `stages.service.ts`: la vista previa de `correctUnit` cuenta ahora las apuestas `PENDING` sin
  monto oficial de la etapa como `affectedBets` real (antes siempre `0`, comentario ya lo
  anticipaba).

### Validación de `betType` (§90)

Se valida en el servicio, no en una restricción de base de datos: requiere agrupar y contar
`bet_selections` por `eventGroup`, algo que un `CHECK` de PostgreSQL no puede expresar entre tablas.
La base de datos protege la integridad fundamental (formato, signos, existencia); la estructura
Simple/Creada/Múltiple la valida el backend en la misma transacción que inserta la apuesta y sus
selecciones.

### Permisos (§107.7)

`bets.view`, `bets.create`, `bets.update_own`, `bets.update_any`, `bets.trash_own`,
`bets.trash_any`, `bets.restore`, `bets.move_stage`. Las rutas que dependen de la propiedad
(`PATCH`/`trash`) se protegen a nivel de ruta con `bets.view` (el mínimo común) y el servicio aplica
la regla real: `any` permite cualquier apuesta; sin `any`, hace falta `own` y ser quien la creó.
`bets.move_stage` y `bets.restore` no tienen variante `own`: la especificación exige administrador
en ambos casos (§25, §26) sin excepción para el propio autor.

### Alcance no cubierto en esta fase

Corregir campos financieros (`status`, `officialAmount`, `officialRealizedReturn`, `settledAt`) de
una apuesta **ya liquidada** queda fuera: eso es el flujo completo de §77 (comparar retorno
calculado vs. oficial, discrepancia, confirmación, recálculo de saldos y conciliaciones). Intentarlo
responde 409. Editar una apuesta `PENDING` (incluidas sus selecciones) está soportado sin
restricciones; una ya liquidada solo admite corregir `reason`, `placedAt` y `placedTimeKnown` —
tocar `selections` de una apuesta liquidada también responde 409, para no dejar una apuesta ya
resuelta con una estructura distinta de la que realmente se liquidó.

## Consecuencias

- El modelo permite calcular sin rediseño ROI, Yield, P/L acumulado y rendimiento por etapa, casa,
  deporte y mercado (Fase 5): todos son agregaciones sobre `bets`/`bet_selections`/`financial_movements`
  ya existentes.
- Cuando la Fase 7 añada tickets, `bets` necesitará una columna `ticketFileId` nueva (no reservada
  ahora, D-B11): una migración adicional, no un rediseño.
- Cuando la Fase 6 construya conciliación, marcar una casa como "requiere nueva conciliación" tras
  una corrección con efecto financiero (§74) necesitará una columna nueva en `houses` (D-B12).
