import { MOVEMENT_DIRECTIONS, MOVEMENT_TYPES } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { betCorrections } from './bet-corrections.js';
import { money, newId, primaryId, timestamptz } from './columns.js';
import { houses } from './houses.js';
import { projects } from './projects.js';
import { stages } from './stages.js';
import { users } from './users.js';

export const movementTypeEnum = pgEnum('movement_type', MOVEMENT_TYPES);
export const movementDirectionEnum = pgEnum('movement_direction', MOVEMENT_DIRECTIONS);

/**
 * Ledger financiero unificado (§16, §72). Representa los efectos monetarios de capital inicial,
 * depósitos, retiros aprobados, transferencias, extraordinarios y, desde la Fase 4, la colocación
 * y liquidación de apuestas; los saldos se reconstruyen sumando estas filas (D3), nunca se
 * guardan aparte. **Inmutable tras confirmarse (D2)**: no hay `UPDATE` ni `DELETE` (disparador
 * `prevent_modification`); una corrección se hace con un movimiento nuevo, nunca editando uno
 * existente.
 *
 * `operationId` identifica la operación de negocio (por defecto, un id propio; en un retiro
 * aprobado o en una apuesta liquidada es el id de esa entidad — `withdrawal_requests` o `bets`),
 * para poder correlacionar auditoría entre entidades sin necesitar varias filas del ledger por
 * operación. Una apuesta liquidada genera hasta dos filas (`BET_PLACEMENT` y, si corresponde,
 * `BET_SETTLEMENT`) que comparten el `id` de la apuesta como `operationId` (§107.3): se insertan
 * juntas al liquidar, no al crear, mientras está `PENDING` su monto solo se refleja en el
 * comprometido de la casa mediante una consulta en vivo (D-B7), igual que un retiro pendiente.
 */
export const financialMovements = pgTable(
  'financial_movements',
  {
    id: primaryId(),
    operationId: uuid('operation_id')
      .notNull()
      .$defaultFn(() => newId()),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => stages.id, { onDelete: 'restrict' }),
    type: movementTypeEnum('type').notNull(),
    /** `null` únicamente en `TRANSFER` (su efecto lo define el par origen/destino). */
    direction: movementDirectionEnum('direction'),
    /** Casa única afectada; `null` únicamente en `TRANSFER`. */
    houseId: uuid('house_id').references(() => houses.id, { onDelete: 'restrict' }),
    /** Solo en `TRANSFER`: casa de origen (se debita). */
    fromHouseId: uuid('from_house_id').references(() => houses.id, { onDelete: 'restrict' }),
    /** Solo en `TRANSFER`: casa de destino (se acredita). */
    toHouseId: uuid('to_house_id').references(() => houses.id, { onDelete: 'restrict' }),
    amount: money('amount').notNull(),
    reason: text('reason'),
    /**
     * Solo en `REVERSAL` (§112.1): la fila que anula. Una fila se anula una sola vez (índice
     * único parcial) y un disparador exige que coincidan proyecto, casa, monto, etapa, operación y
     * fecha efectiva, con dirección opuesta.
     */
    reversesMovementId: uuid('reverses_movement_id').references(
      (): AnyPgColumn => financialMovements.id,
      { onDelete: 'restrict' },
    ),
    /** Corrección de apuesta que originó la fila (reversión o re-registro); `null` en el resto. */
    correctionId: uuid('correction_id').references(() => betCorrections.id, {
      onDelete: 'restrict',
    }),
    /** Cuándo ocurrió el efecto financiero (§16); por defecto, al registrarlo. */
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (table) => [
    index('financial_movements_project_idx').on(table.projectId, table.occurredAt),
    index('financial_movements_stage_idx').on(table.stageId),
    index('financial_movements_house_idx').on(table.houseId),
    index('financial_movements_from_house_idx').on(table.fromHouseId),
    index('financial_movements_to_house_idx').on(table.toHouseId),
    index('financial_movements_operation_idx').on(table.operationId),
    uniqueIndex('financial_movements_one_reversal_per_row')
      .on(table.reversesMovementId)
      .where(sql`${table.reversesMovementId} IS NOT NULL`),
    index('financial_movements_correction_idx').on(table.correctionId),
    check('financial_movements_amount_positive', sql`${table.amount} > 0`),
    check(
      'financial_movements_house_shape',
      sql`(${table.type} = 'TRANSFER'
            AND ${table.houseId} IS NULL
            AND ${table.fromHouseId} IS NOT NULL
            AND ${table.toHouseId} IS NOT NULL
            AND ${table.fromHouseId} <> ${table.toHouseId})
          OR (${table.type} <> 'TRANSFER'
            AND ${table.houseId} IS NOT NULL
            AND ${table.fromHouseId} IS NULL
            AND ${table.toHouseId} IS NULL)`,
    ),
    check(
      'financial_movements_direction_shape',
      sql`(${table.type} IN ('INITIAL_CAPITAL', 'DEPOSIT') AND ${table.direction} = 'CREDIT')
          OR (${table.type} IN ('WITHDRAWAL', 'BET_PLACEMENT') AND ${table.direction} = 'DEBIT')
          OR (${table.type} = 'BET_SETTLEMENT' AND ${table.direction} = 'CREDIT')
          OR (${table.type} IN ('EXTRAORDINARY', 'REVERSAL')
            AND ${table.direction} IN ('CREDIT', 'DEBIT'))
          OR (${table.type} = 'TRANSFER' AND ${table.direction} IS NULL)`,
    ),
    check(
      'financial_movements_reversal_shape',
      sql`(${table.type} = 'REVERSAL') = (${table.reversesMovementId} IS NOT NULL)`,
    ),
    check(
      'financial_movements_reason_required',
      sql`${table.type} NOT IN ('WITHDRAWAL', 'EXTRAORDINARY', 'REVERSAL')
          OR (${table.reason} IS NOT NULL AND length(btrim(${table.reason})) > 0)`,
    ),
  ],
);

export type FinancialMovementRow = typeof financialMovements.$inferSelect;
export type NewFinancialMovement = typeof financialMovements.$inferInsert;
