import { TICKET_MAX_FILE_SIZE_BYTES, TICKET_MIME_TYPES } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { bets } from './bets.js';
import { primaryId, timestamps } from './columns.js';
import { projects } from './projects.js';
import { users } from './users.js';

export const ticketMimeTypeEnum = pgEnum('ticket_mime_type', TICKET_MIME_TYPES);

/**
 * Tickets (§28-§31, §42, §110). Un archivo puede subirse antes de que la apuesta exista
 * (`betId` nulo) o sobre una ya registrada; se vincula dentro de la misma transacción que
 * `POST/PATCH .../bets` (§110.3), nunca desde este módulo. Sin URL pública (§42): el archivo
 * real vive en `FileStorage` bajo `storageKey`, servido siempre por una ruta autenticada. Sin
 * borrado propio en esta fase (§110, "fuera de alcance"): sigue la retención de su apuesta
 * (§36).
 */
export const tickets = pgTable(
  'tickets',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    betId: uuid('bet_id').references(() => bets.id, { onDelete: 'restrict' }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Clave dentro de `FileStorage` (D-T2); nunca una ruta absoluta ni una URL. */
    storageKey: text('storage_key').notNull(),
    originalFileName: text('original_file_name').notNull(),
    mimeType: ticketMimeTypeEnum('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** SHA-256 del archivo, mismo propósito que en los backups (§109.3). */
    checksum: text('checksum').notNull(),
    ...timestamps(),
  },
  (table) => [
    index('tickets_project_idx').on(table.projectId),
    index('tickets_bet_idx').on(table.betId),
    index('tickets_uploaded_by_idx').on(table.uploadedBy),
    check('tickets_size_positive', sql`${table.sizeBytes} > 0`),
    // `sql.raw` inserta el literal directamente (D-T3: debe coincidir con
    // TICKET_MAX_FILE_SIZE_BYTES en @letfer/shared); un valor interpolado normal generaría un
    // parámetro de consulta ($1), inválido dentro de un CHECK.
    check(
      'tickets_size_within_limit',
      sql`${table.sizeBytes} <= ${sql.raw(String(TICKET_MAX_FILE_SIZE_BYTES))}`,
    ),
  ],
);

export type TicketRow = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
