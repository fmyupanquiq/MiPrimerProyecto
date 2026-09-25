import { BET_CORRECTION_KINDS } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { bets } from './bets.js';
import { primaryId, timestamptz } from './columns.js';
import { projects } from './projects.js';
import { users } from './users.js';

export const betCorrectionKindEnum = pgEnum('bet_correction_kind', BET_CORRECTION_KINDS);

/**
 * Correcciones financieras de una apuesta (§112, ADR 0019). Cada fila es el registro inmutable de
 * una corrección ya aplicada (disparador `prevent_modification`): qué tipo fue, los campos
 * financieros de la apuesta antes y después, quién la hizo, cuándo y por qué. Las filas del ledger
 * que la corrección generó (reversiones y re-registros) apuntan a ella con `correction_id`.
 * El motivo es obligatorio salvo al confirmar el retorno oficial (§112.2), donde es opcional.
 */
export const betCorrections = pgTable(
  'bet_corrections',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    betId: uuid('bet_id')
      .notNull()
      .references(() => bets.id, { onDelete: 'restrict' }),
    kind: betCorrectionKindEnum('kind').notNull(),
    /** Campos financieros de la apuesta antes de la corrección (sin secretos). */
    before: jsonb('before').notNull().$type<Record<string, unknown>>(),
    /** Campos financieros de la apuesta después de la corrección. */
    after: jsonb('after').notNull().$type<Record<string, unknown>>(),
    reason: text('reason'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('bet_corrections_bet_idx').on(table.betId, table.createdAt),
    index('bet_corrections_project_idx').on(table.projectId, table.createdAt),
    check(
      'bet_corrections_reason_required',
      sql`${table.kind} = 'RETURN_CONFIRMATION'
          OR (${table.reason} IS NOT NULL AND length(btrim(${table.reason})) > 0)`,
    ),
  ],
);

export type BetCorrectionRow = typeof betCorrections.$inferSelect;
export type NewBetCorrection = typeof betCorrections.$inferInsert;
