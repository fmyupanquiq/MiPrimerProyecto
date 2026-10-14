import type { BetDraftPayload } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, softDeleteColumns, timestamps, versionColumn } from './columns.js';
import { projects } from './projects.js';
import { tickets } from './tickets.js';
import { users } from './users.js';

/**
 * Borradores de "Añadir apuesta" (ADR 0024): el estado del formulario guardado para retomarlo. No es
 * una apuesta: sin movimientos, sin reserva de saldo, fuera de todo informe. Pertenecen a quien los
 * creó dentro de un proyecto; nadie más los ve. Borrado lógico (una vez registrada la apuesta o al
 * descartarlo). El `payload` son textos del formulario, nunca cifras ya interpretadas.
 */
export const betDrafts = pgTable(
  'bet_drafts',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Ticket ya subido que acompaña al borrador (sin vincular a ninguna apuesta todavía). */
    ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'restrict' }),
    summary: text('summary').notNull().default(''),
    payload: jsonb('payload').$type<BetDraftPayload>().notNull(),
    version: versionColumn(),
    ...timestamps(),
    ...softDeleteColumns(),
  },
  (table) => [
    index('bet_drafts_owner_idx')
      .on(table.projectId, table.createdBy, table.updatedAt)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export type BetDraftRow = typeof betDrafts.$inferSelect;
