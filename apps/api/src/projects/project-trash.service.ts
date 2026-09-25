import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, type TrashItem } from '@letfer/shared';
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { betSelections, bets, houses, stages, users } from '../database/schema/index.js';

const MAX_TRASH_ITEMS_PER_KIND = 500;

/**
 * Papelera de un proyecto (§36, §111.2): apuestas y etapas eliminadas lógicamente. Solo lectura:
 * restaurar usa los endpoints existentes (`bets.restore`, `stages.restore`). Cada tipo aparece
 * únicamente a quien puede restaurarlo, sin inventar un permiso nuevo. Nada se purga (D8-3).
 */
@Injectable()
export class ProjectTrashService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  async list(access: ProjectAccess): Promise<TrashItem[]> {
    const canBets = access.permissions.has('bets.restore');
    const canStages = access.permissions.has('stages.restore');
    if (!canBets && !canStages) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'No tienes permiso para esta acción.');
    }
    const projectId = access.project.id;
    const now = this.clock.now();
    const items: TrashItem[] = [];

    if (canBets) {
      const rows = await this.db
        .select({ bet: bets, houseName: houses.name })
        .from(bets)
        .innerJoin(houses, eq(houses.id, bets.houseId))
        .where(and(eq(bets.projectId, projectId), isNotNull(bets.deletedAt)))
        .orderBy(desc(bets.deletedAt))
        .limit(MAX_TRASH_ITEMS_PER_KIND);
      const firstSelection = await this.firstSelections(rows.map((row) => row.bet.id));
      const names = await this.namesOf(rows.map((row) => row.bet.deletedBy));
      for (const { bet, houseName } of rows) {
        const selection = firstSelection.get(bet.id);
        items.push({
          kind: 'BET',
          id: bet.id,
          label: selection ? `${selection.event} — ${selection.selection}` : 'Apuesta',
          detail: `${houseName} · stake ${bet.stakeAmount}`,
          deletedAt: bet.deletedAt!.toISOString(),
          deletedBy: bet.deletedBy
            ? { id: bet.deletedBy, name: names.get(bet.deletedBy) ?? '' }
            : null,
          deletionReason: bet.deletionReason,
          purgeEligibleAt: bet.purgeEligibleAt!.toISOString(),
          purgeEligible: bet.purgeEligibleAt!.getTime() <= now.getTime(),
          settled: bet.status !== 'PENDING',
        });
      }
    }

    if (canStages) {
      const rows = await this.db
        .select()
        .from(stages)
        .where(and(eq(stages.projectId, projectId), isNotNull(stages.deletedAt)))
        .orderBy(desc(stages.deletedAt))
        .limit(MAX_TRASH_ITEMS_PER_KIND);
      const names = await this.namesOf(rows.map((row) => row.deletedBy));
      for (const stage of rows) {
        items.push({
          kind: 'STAGE',
          id: stage.id,
          label: stage.name,
          detail: `unidad ${stage.unitStake}`,
          deletedAt: stage.deletedAt!.toISOString(),
          deletedBy: stage.deletedBy
            ? { id: stage.deletedBy, name: names.get(stage.deletedBy) ?? '' }
            : null,
          deletionReason: stage.deletionReason,
          purgeEligibleAt: stage.purgeEligibleAt!.toISOString(),
          purgeEligible: stage.purgeEligibleAt!.getTime() <= now.getTime(),
          settled: false,
        });
      }
    }

    // Lo eliminado más recientemente, primero.
    return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  private async firstSelections(
    betIds: string[],
  ): Promise<Map<string, { event: string; selection: string }>> {
    const result = new Map<string, { event: string; selection: string }>();
    if (betIds.length === 0) return result;
    const rows = await this.db
      .select({
        betId: betSelections.betId,
        event: betSelections.event,
        selection: betSelections.selection,
      })
      .from(betSelections)
      .where(inArray(betSelections.betId, betIds))
      .orderBy(asc(betSelections.eventGroup), asc(betSelections.position));
    for (const row of rows) {
      if (!result.has(row.betId)) result.set(row.betId, row);
    }
    return result;
  }

  private async namesOf(userIds: (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(rows.map((row) => [row.id, `${row.firstName} ${row.lastName}`.trim()]));
  }
}
