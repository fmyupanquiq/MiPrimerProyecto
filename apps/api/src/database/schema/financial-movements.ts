import { MOVEMENT_DIRECTIONS, MOVEMENT_TYPES } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { money, newId, primaryId, timestamptz } from './columns.js';
import { houses } from './houses.js';
import { projects } from './projects.js';
import { stages } from './stages.js';
import { users } from './users.js';

export const movementTypeEnum = pgEnum('movement_type', MOVEMENT_TYPES);
export const movementDirectionEnum = pgEnum('movement_direction', MOVEMENT_DIRECTIONS);

/**
 * Ledger financiero unificado (§16, §72). Representa los efectos monetarios de capital inicial,
 * depósitos, retiros aprobados, transferencias y extraordinarios; los saldos se reconstruyen
 * sumando estas filas (D3), nunca se guardan aparte. **Inmutable tras confirmarse (D2)**: no
 * hay `UPDATE` ni `DELETE` (disparador `prevent_modification`); una corrección se hace con un
 * movimiento nuevo, nunca editando uno existente.
 *
 * `operationId` identifica la operación de negocio (por defecto, un id propio; en un retiro
 * aprobado es el id de su `withdrawal_requests`), para poder correlacionar auditoría entre
 * entidades sin necesitar varias filas del ledger por operación.
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
          OR (${table.type} = 'WITHDRAWAL' AND ${table.direction} = 'DEBIT')
          OR (${table.type} = 'EXTRAORDINARY' AND ${table.direction} IN ('CREDIT', 'DEBIT'))
          OR (${table.type} = 'TRANSFER' AND ${table.direction} IS NULL)`,
    ),
    check(
      'financial_movements_reason_required',
      sql`${table.type} NOT IN ('WITHDRAWAL', 'EXTRAORDINARY')
          OR (${table.reason} IS NOT NULL AND length(btrim(${table.reason})) > 0)`,
    ),
  ],
);

export type FinancialMovementRow = typeof financialMovements.$inferSelect;
export type NewFinancialMovement = typeof financialMovements.$inferInsert;
