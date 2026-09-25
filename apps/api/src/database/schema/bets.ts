import { BET_STATUSES, BET_TYPES } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import { boolean, check, index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import {
  money,
  odds,
  primaryId,
  softDeleteColumns,
  stake,
  timestamps,
  timestamptz,
  versionColumn,
} from './columns.js';
import { houses } from './houses.js';
import { projects } from './projects.js';
import { stages } from './stages.js';
import { users } from './users.js';

export const betTypeEnum = pgEnum('bet_type', BET_TYPES);
export const betStatusEnum = pgEnum('bet_status', BET_STATUSES);

/**
 * Apuestas (§18-§27, §90, §107). El monto/retorno calculados y la ganancia/pérdida derivada
 * **no se guardan** (D-B7): se calculan en cada lectura, igual que los saldos de casa (D3).
 * Mientras está `PENDING`, su monto se refleja en el comprometido de la casa mediante una
 * consulta en vivo (§107.3), sin ninguna fila del ledger todavía: `BET_PLACEMENT` y (si
 * corresponde, D-B2) `BET_SETTLEMENT` se insertan juntos al liquidar, no al crear.
 */
export const bets = pgTable(
  'bets',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => stages.id, { onDelete: 'restrict' }),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    betType: betTypeEnum('bet_type').notNull(),
    stakeAmount: stake('stake').notNull(),
    /** Monto oficial confirmado (ticket/casa); `null` mientras solo hay un monto calculado. */
    officialAmount: money('official_amount'),
    visibleTotalOdds: odds('visible_total_odds').notNull(),
    officialPotentialReturn: money('official_potential_return'),
    /**
     * Retorno oficial realizado (ticket/casa). `null` en `PENDING`, en `LOST` (D-B2) y en una
     * `WON` provisional (§112.2); obligatorio en `VOID`/`CASHOUT`.
     */
    officialRealizedReturn: money('official_realized_return'),
    /**
     * Retorno calculado no confirmado (`monto × cuota visible`, §77, §112.2): solo en `WON`. Se
     * conserva tras confirmar el oficial para poder comparar ambos (reporte de diferencias). El
     * retorno efectivo es `COALESCE(official_realized_return, calculated_realized_return)`.
     */
    calculatedRealizedReturn: money('calculated_realized_return'),
    /**
     * `true` cuando `official_amount` es un monto confirmado (ticket o persona); `false` cuando
     * es el monto calculado congelado al liquidar (§76, §112.2). Sin monto oficial es siempre `false`.
     */
    amountConfirmed: boolean('amount_confirmed').notNull().default(false),
    status: betStatusEnum('status').notNull().default('PENDING'),
    placedAt: timestamptz('placed_at').notNull(),
    placedTimeKnown: boolean('placed_time_known').notNull().default(true),
    settledAt: timestamptz('settled_at'),
    settledTimeKnown: boolean('settled_time_known').notNull().default(true),
    reason: text('reason'),
    ...timestamps(),
    /**
     * Último instante en que cambió un campo con efecto financiero real (casa, etapa, stake,
     * monto oficial, estado, borrado lógico; §109.1.3, M1 de la revisión de arquitectura previa
     * a integrar la Fase 5.5). Lo mantiene el disparador `bump_bet_financial_timestamp`, nunca
     * la aplicación: a diferencia de `updated_at` (que cambia con cualquier edición, incluida
     * una simple corrección del motivo, §107.9), esta columna es la que usa la verificación de
     * integridad para distinguir un cambio relevante para la conciliación de uno administrativo.
     */
    financialFieldsUpdatedAt: timestamptz('financial_fields_updated_at').notNull().defaultNow(),
    version: versionColumn(),
    ...softDeleteColumns(),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'restrict' }),
    purgeEligibleAt: timestamptz('purge_eligible_at'),
  },
  (table) => [
    index('bets_project_idx').on(table.projectId, table.placedAt),
    index('bets_stage_idx').on(table.stageId),
    index('bets_house_idx').on(table.houseId),
    index('bets_created_by_idx').on(table.createdBy),
    check('bets_stake_positive', sql`${table.stakeAmount} > 0`),
    check(
      'bets_official_amount_positive',
      sql`${table.officialAmount} IS NULL OR ${table.officialAmount} > 0`,
    ),
    check('bets_visible_odds_positive', sql`${table.visibleTotalOdds} > 0`),
    check(
      'bets_official_potential_return_nonneg',
      sql`${table.officialPotentialReturn} IS NULL OR ${table.officialPotentialReturn} >= 0`,
    ),
    check(
      'bets_settlement_shape',
      sql`(${table.status} = 'PENDING'
            AND ${table.settledAt} IS NULL
            AND ${table.officialRealizedReturn} IS NULL
            AND ${table.calculatedRealizedReturn} IS NULL)
          OR (${table.status} = 'LOST'
            AND ${table.settledAt} IS NOT NULL
            AND ${table.officialRealizedReturn} IS NULL
            AND ${table.calculatedRealizedReturn} IS NULL)
          OR (${table.status} = 'WON'
            AND ${table.settledAt} IS NOT NULL
            AND (${table.officialRealizedReturn} IS NOT NULL
                 OR ${table.calculatedRealizedReturn} IS NOT NULL))
          OR (${table.status} IN ('VOID', 'CASHOUT')
            AND ${table.settledAt} IS NOT NULL
            AND ${table.officialRealizedReturn} IS NOT NULL
            AND ${table.calculatedRealizedReturn} IS NULL)`,
    ),
    check(
      'bets_returns_nonneg',
      sql`(${table.officialRealizedReturn} IS NULL OR ${table.officialRealizedReturn} >= 0)
          AND (${table.calculatedRealizedReturn} IS NULL OR ${table.calculatedRealizedReturn} >= 0)`,
    ),
    check(
      'bets_amount_confirmed_requires_official',
      sql`NOT ${table.amountConfirmed} OR ${table.officialAmount} IS NOT NULL`,
    ),
    check(
      'bets_trash_consistency',
      sql`(${table.deletedAt} IS NOT NULL) = (${table.purgeEligibleAt} IS NOT NULL)`,
    ),
  ],
);

export type BetRow = typeof bets.$inferSelect;
export type NewBet = typeof bets.$inferInsert;
