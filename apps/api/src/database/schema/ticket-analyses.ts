import {
  TICKET_ANALYSIS_STATUSES,
  type TicketConfidenceByField,
  type TicketExtraction,
} from '@letfer/shared';
import { index, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from './columns.js';
import { projects } from './projects.js';
import { tickets } from './tickets.js';
import { users } from './users.js';

export const ticketAnalysisStatusEnum = pgEnum('ticket_analysis_status', TICKET_ANALYSIS_STATUSES);

/**
 * Histórico de análisis de un ticket por IA (§29, §30, §52, §53, §110). **Solo inserción**,
 * mismo espíritu de inmutabilidad que `reconciliation_checkpoints`/`integrity_check_runs`
 * (D2, D-C1): un reanálisis crea una fila nueva, nunca edita la anterior (disparador
 * `prevent_modification`). `projectId` se copia de `tickets.projectId` (igual que
 * `financial_movements.projectId` respecto a `houseId`/`stageId`) para contar los límites de la
 * §110.4 sin un `JOIN`. La posición (1º, 2º análisis...) se deriva en consulta por `analyzedAt`,
 * nunca se guarda (mismo principio que D3/D-B7/D-M10/D-C6).
 */
export const ticketAnalyses = pgTable(
  'ticket_analyses',
  {
    id: primaryId(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    analyzedBy: uuid('analyzed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    analyzedAt: timestamptz('analyzed_at').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: ticketAnalysisStatusEnum('status').notNull(),
    errorMessage: text('error_message'),
    /** Contrato del §53; `null` cuando `status = 'FAILED'` (no se extrajo nada). */
    extraction: jsonb('extraction').$type<TicketExtraction | null>(),
    /** Confianza 0-1 por campo (D-T6); `null` si el proveedor no la entrega o si falló. */
    confidenceByField: jsonb('confidence_by_field').$type<TicketConfidenceByField | null>(),
  },
  (table) => [
    index('ticket_analyses_ticket_idx').on(table.ticketId, table.analyzedAt),
    index('ticket_analyses_project_idx').on(table.projectId, table.analyzedAt),
  ],
);

export type TicketAnalysisRow = typeof ticketAnalyses.$inferSelect;
export type NewTicketAnalysis = typeof ticketAnalyses.$inferInsert;
