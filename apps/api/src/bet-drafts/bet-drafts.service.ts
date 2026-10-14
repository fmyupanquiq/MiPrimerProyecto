import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type BetDraftDetail,
  type BetDraftSummary,
  type SaveBetDraftInput,
  type UpdateBetDraftInput,
} from '@letfer/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { AppError } from '../common/app-error.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { betDrafts, tickets, type BetDraftRow, type UserRow } from '../database/schema/index.js';
import { assertFinanceReady } from '../finance/finance-errors.js';

/** Límite razonable de borradores vivos por persona y proyecto (evita acumular basura). */
export const MAX_DRAFTS_PER_USER = 25;
/** Tamaño máximo del contenido serializado (el formulario real pesa unos pocos KB). */
const MAX_PAYLOAD_BYTES = 64 * 1024;

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Borrador no encontrado.');

const toSummary = (row: BetDraftRow): BetDraftSummary => ({
  id: row.id,
  summary: row.summary,
  ticketId: row.ticketId,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  version: row.version,
});
const toDetail = (row: BetDraftRow): BetDraftDetail => ({
  ...toSummary(row),
  payload: row.payload,
});

/**
 * Borradores de "Añadir apuesta" (ADR 0024). Pertenecen a quien los creó: otro miembro (incluido un
 * administrador) recibe 404. No tocan el ledger, los saldos ni ninguna tabla financiera.
 */
@Injectable()
export class BetDraftsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(access: ProjectAccess, actor: UserRow): Promise<BetDraftSummary[]> {
    const rows = await this.db
      .select()
      .from(betDrafts)
      .where(this.own(access, actor))
      .orderBy(desc(betDrafts.updatedAt));
    return rows.map(toSummary);
  }

  async get(access: ProjectAccess, actor: UserRow, id: string): Promise<BetDraftDetail> {
    return toDetail(await this.findOwn(access, actor, id));
  }

  async create(
    access: ProjectAccess,
    actor: UserRow,
    input: SaveBetDraftInput,
  ): Promise<BetDraftDetail> {
    assertFinanceReady(access);
    this.assertSize(input);
    await this.assertTicket(access, input);
    const alive = await this.db
      .select({ id: betDrafts.id })
      .from(betDrafts)
      .where(this.own(access, actor));
    if (alive.length >= MAX_DRAFTS_PER_USER) {
      throw new AppError(
        409,
        ErrorCode.INVALID_STATE,
        `Ya tienes ${MAX_DRAFTS_PER_USER} borradores: descarta alguno antes de guardar otro.`,
      );
    }
    const [row] = await this.db
      .insert(betDrafts)
      .values({
        projectId: access.project.id,
        createdBy: actor.id,
        ticketId: input.payload.ticketId,
        summary: input.summary,
        payload: input.payload,
      })
      .returning();
    return toDetail(row!);
  }

  async update(
    access: ProjectAccess,
    actor: UserRow,
    id: string,
    input: UpdateBetDraftInput,
  ): Promise<BetDraftDetail> {
    assertFinanceReady(access);
    this.assertSize(input);
    await this.assertTicket(access, input);
    const current = await this.findOwn(access, actor, id);
    if (current.version !== input.version) {
      throw new AppError(
        409,
        ErrorCode.CONCURRENCY_CONFLICT,
        'El borrador cambió desde que lo abriste. Recarga la lista y vuelve a intentarlo.',
      );
    }
    const [row] = await this.db
      .update(betDrafts)
      .set({
        ticketId: input.payload.ticketId,
        summary: input.summary,
        payload: input.payload,
        version: current.version + 1,
      })
      .where(and(eq(betDrafts.id, id), eq(betDrafts.version, current.version)))
      .returning();
    if (!row) {
      throw new AppError(
        409,
        ErrorCode.CONCURRENCY_CONFLICT,
        'El borrador cambió; vuelve a intentarlo.',
      );
    }
    return toDetail(row);
  }

  /** Descartar (borrado lógico). 404 para cualquiera que no sea su dueño. */
  async discard(access: ProjectAccess, actor: UserRow, id: string): Promise<void> {
    await this.findOwn(access, actor, id);
    await this.db
      .update(betDrafts)
      .set({ deletedAt: new Date(), deletionReason: 'Descartado' })
      .where(and(eq(betDrafts.id, id), isNull(betDrafts.deletedAt)));
  }

  private own(access: ProjectAccess, actor: UserRow) {
    return and(
      eq(betDrafts.projectId, access.project.id),
      eq(betDrafts.createdBy, actor.id),
      isNull(betDrafts.deletedAt),
    );
  }

  private async findOwn(access: ProjectAccess, actor: UserRow, id: string): Promise<BetDraftRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
    const [row] = await this.db
      .select()
      .from(betDrafts)
      .where(and(eq(betDrafts.id, id), this.own(access, actor)));
    if (!row) throw notFound();
    return row;
  }

  private assertSize(input: SaveBetDraftInput): void {
    if (Buffer.byteLength(JSON.stringify(input.payload), 'utf8') > MAX_PAYLOAD_BYTES) {
      throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'El borrador es demasiado grande.');
    }
  }

  /** El ticket del borrador debe existir y ser de este proyecto (nunca se referencia uno ajeno). */
  private async assertTicket(access: ProjectAccess, input: SaveBetDraftInput): Promise<void> {
    const ticketId = input.payload.ticketId;
    if (ticketId === null) return;
    const [ticket] = await this.db
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.projectId, access.project.id)));
    if (!ticket) {
      throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'El ticket del borrador no existe.');
    }
  }
}
