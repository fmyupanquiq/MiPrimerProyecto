import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, PROJECT_TRASH_RETENTION_DAYS, type ProjectStatus } from '@letfer/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { nextVersion } from '../database/concurrency.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { projects, type ProjectRow, type UserRow } from '../database/schema/index.js';

export type LifecycleAction = 'close' | 'reopen' | 'trash' | 'restore';

const AUDIT_ACTIONS: Record<LifecycleAction, string> = {
  close: 'project.closed',
  reopen: 'project.reopened',
  trash: 'project.trashed',
  restore: 'project.restored',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const ACTION_LABELS: Record<LifecycleAction, string> = {
  close: 'cerrar',
  reopen: 'reabrir',
  trash: 'enviar a la papelera',
  restore: 'restaurar',
};

/**
 * Ciclo de vida del proyecto (§105.5): cerrar, reabrir, enviar a la papelera y restaurar.
 * Los permisos y la reautenticación los exige el controlador; aquí se valida la transición sobre
 * la fila bloqueada (`FOR UPDATE`), de modo que dos peticiones simultáneas no se pisen.
 */
@Injectable()
export class ProjectLifecycleService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  close(projectId: string, actor: UserRow): Promise<ProjectRow> {
    return this.transition(projectId, actor, 'close', {});
  }

  reopen(projectId: string, actor: UserRow): Promise<ProjectRow> {
    return this.transition(projectId, actor, 'reopen', {});
  }

  trash(projectId: string, actor: UserRow, reason?: string): Promise<ProjectRow> {
    return this.transition(projectId, actor, 'trash', { reason });
  }

  restore(projectId: string, actor: UserRow): Promise<ProjectRow> {
    return this.transition(projectId, actor, 'restore', {});
  }

  private async transition(
    projectId: string,
    actor: UserRow,
    action: LifecycleAction,
    input: { reason?: string | undefined },
  ): Promise<ProjectRow> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .for('update')
        .limit(1);
      if (!current) throw new AppError(404, ErrorCode.NOT_FOUND, 'Proyecto no encontrado.');

      const target = this.targetStatus(action, current);
      if (!target) {
        throw new AppError(
          409,
          ErrorCode.INVALID_STATE,
          `No se puede ${ACTION_LABELS[action]} un proyecto en estado ${current.status}.`,
        );
      }

      const now = this.clock.now();
      const changes =
        action === 'trash'
          ? {
              status: target,
              previousStatus:
                current.status === 'CLOSED' ? ('CLOSED' as const) : ('ACTIVE' as const),
              deletedAt: now,
              deletedBy: actor.id,
              deletionReason: input.reason ?? null,
              purgeEligibleAt: new Date(now.getTime() + PROJECT_TRASH_RETENTION_DAYS * MS_PER_DAY),
            }
          : action === 'restore'
            ? {
                status: target,
                previousStatus: null,
                deletedAt: null,
                deletedBy: null,
                deletionReason: null,
                purgeEligibleAt: null,
              }
            : { status: target };

      const [updated] = await tx
        .update(projects)
        .set({ ...changes, version: nextVersion(projects.version) })
        .where(eq(projects.id, projectId))
        .returning();

      await this.audit.record(tx, {
        action: AUDIT_ACTIONS[action],
        entityType: 'project',
        entityId: projectId,
        projectId,
        actorUserId: actor.id,
        oldValues: { status: current.status },
        newValues: { status: target },
        ...(action === 'trash' ? { metadata: { reason: input.reason ?? null } } : {}),
      });
      return updated!;
    });
  }

  /** Estado al que lleva la acción, o `null` si no es válida desde el estado actual. */
  private targetStatus(action: LifecycleAction, project: ProjectRow): ProjectStatus | null {
    switch (action) {
      case 'close':
        return project.status === 'ACTIVE' ? 'CLOSED' : null;
      case 'reopen':
        return project.status === 'CLOSED' ? 'ACTIVE' : null;
      case 'trash':
        return project.status === 'ACTIVE' || project.status === 'CLOSED' ? 'TRASHED' : null;
      case 'restore':
        return project.status === 'TRASHED' ? (project.previousStatus ?? 'ACTIVE') : null;
    }
  }
}
