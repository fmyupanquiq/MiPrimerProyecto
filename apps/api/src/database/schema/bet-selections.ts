import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { odds, primaryId } from './columns.js';
import { bets } from './bets.js';

/**
 * Selecciones de una apuesta (§19, §20, D-B3). Propiedad exclusiva de la apuesta (se editan
 * junto con ella, nunca de forma independiente): a diferencia de las FK `restrict` del ledger,
 * aquí `onDelete: 'cascade'` es una protección técnica que en la práctica nunca se ejecuta,
 * porque `bets` nunca se elimina físicamente (`prevent_delete`).
 *
 * `eventGroup` agrupa las selecciones del mismo evento: una apuesta Simple tiene un único grupo
 * con una selección; Creada, un único grupo con varias; Múltiple, más de un grupo (§107.4).
 */
export const betSelections = pgTable(
  'bet_selections',
  {
    id: primaryId(),
    betId: uuid('bet_id')
      .notNull()
      .references(() => bets.id, { onDelete: 'cascade' }),
    eventGroup: integer('event_group').notNull(),
    position: integer('position').notNull(),
    sport: text('sport'),
    event: text('event').notNull(),
    market: text('market'),
    selection: text('selection').notNull(),
    visibleOdds: odds('visible_odds').notNull(),
  },
  (table) => [
    index('bet_selections_bet_idx').on(table.betId, table.eventGroup, table.position),
    check('bet_selections_event_group_nonneg', sql`${table.eventGroup} >= 0`),
    check('bet_selections_position_nonneg', sql`${table.position} >= 0`),
    check('bet_selections_event_not_blank', sql`length(btrim(${table.event})) > 0`),
    check('bet_selections_selection_not_blank', sql`length(btrim(${table.selection})) > 0`),
    check('bet_selections_odds_positive', sql`${table.visibleOdds} > 0`),
  ],
);

export type BetSelectionRow = typeof betSelections.$inferSelect;
export type NewBetSelection = typeof betSelections.$inferInsert;
