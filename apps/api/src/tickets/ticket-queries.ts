import type { TicketAnalysisSummary, TicketSummary } from '@letfer/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../database/database.types.js';
import {
  ticketAnalyses,
  tickets,
  users,
  type TicketAnalysisRow,
  type TicketRow,
} from '../database/schema/index.js';
import { fullName } from '../projects/project-mappers.js';

/**
 * Consultas de tickets reutilizables (§110): funciones puras sobre `executor`, sin depender de
 * `TicketsService` ni de ningún módulo de Nest — así `BetsService` puede enriquecer el detalle
 * de una apuesta con sus tickets sin importar `TicketsModule` (evita un acoplamiento circular
 * entre `bets` y `tickets`; mismo patrón que `fullName` en `project-mappers.ts`).
 */

function toAnalysisSummary(
  row: TicketAnalysisRow,
  version: number,
  analyzedByName: string,
): TicketAnalysisSummary {
  return {
    id: row.id,
    ticketId: row.ticketId,
    version,
    status: row.status,
    provider: row.provider,
    model: row.model,
    extraction: row.extraction ?? {},
    confidenceByField: row.confidenceByField,
    errorMessage: row.errorMessage,
    analyzedBy: { id: row.analyzedBy, name: analyzedByName },
    analyzedAt: row.analyzedAt.toISOString(),
  };
}

function toTicketSummary(
  ticket: TicketRow,
  uploadedByName: string,
  lastAnalysis: TicketAnalysisSummary | null,
): TicketSummary {
  return {
    id: ticket.id,
    projectId: ticket.projectId,
    betId: ticket.betId,
    originalFileName: ticket.originalFileName,
    mimeType: ticket.mimeType,
    sizeBytes: ticket.sizeBytes,
    uploadedBy: { id: ticket.uploadedBy, name: uploadedByName },
    createdAt: ticket.createdAt.toISOString(),
    lastAnalysis,
  };
}

/** Todos los análisis de un ticket, más reciente primero; `version` es su posición (1º, 2º...). */
export async function analysesOfTicket(
  executor: DbExecutor,
  ticketId: string,
): Promise<TicketAnalysisSummary[]> {
  const rows = await executor
    .select()
    .from(ticketAnalyses)
    .where(eq(ticketAnalyses.ticketId, ticketId))
    .orderBy(asc(ticketAnalyses.analyzedAt));
  if (rows.length === 0) return [];
  const userIds = [...new Set(rows.map((r) => r.analyzedBy))];
  const userRows = await executor
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(inArray(users.id, userIds));
  const nameById = new Map(userRows.map((u) => [u.id, fullName(u)]));
  return rows
    .map((row, index) => toAnalysisSummary(row, index + 1, nameById.get(row.analyzedBy) ?? ''))
    .reverse();
}

/** Tickets de una o más apuestas, agrupados por `betId`, más recientes primero. */
export async function ticketsForBets(
  executor: DbExecutor,
  betIds: readonly string[],
): Promise<Map<string, TicketSummary[]>> {
  const result = new Map<string, TicketSummary[]>();
  const ids = [...new Set(betIds)].filter((id): id is string => id !== null && id !== undefined);
  if (ids.length === 0) return result;

  const ticketRows = await executor.select().from(tickets).where(inArray(tickets.betId, ids));
  if (ticketRows.length === 0) return result;

  const uploaderIds = [...new Set(ticketRows.map((t) => t.uploadedBy))];
  const uploaderRows = await executor
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(inArray(users.id, uploaderIds));
  const uploaderNameById = new Map(uploaderRows.map((u) => [u.id, fullName(u)]));

  const analysesByTicket = new Map<string, TicketAnalysisSummary[]>();
  for (const ticket of ticketRows) {
    analysesByTicket.set(ticket.id, await analysesOfTicket(executor, ticket.id));
  }

  const summaries = ticketRows
    .map((ticket) =>
      toTicketSummary(
        ticket,
        uploaderNameById.get(ticket.uploadedBy) ?? '',
        analysesByTicket.get(ticket.id)?.[0] ?? null,
      ),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  for (const summary of summaries) {
    if (!summary.betId) continue;
    const list = result.get(summary.betId) ?? [];
    list.push(summary);
    result.set(summary.betId, list);
  }
  return result;
}
