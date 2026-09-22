import type { Currency, PermissionCode, ProjectDetail, ProjectSummary } from '@letfer/shared';
import type { ProjectRow } from '../database/schema/index.js';

export interface SummaryContext {
  ownerName: string;
  isOwner: boolean;
  myRole: string | null;
  /** Etapa activa (§50), o `null` mientras el proyecto no tenga una (antes del setup, D1). */
  activeStage: { id: string; name: string; unitStake: string } | null;
}

export function toProjectSummary(project: ProjectRow, context: SummaryContext): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    imageRef: project.imageRef,
    status: project.status,
    ownerId: project.ownerId,
    ownerName: context.ownerName,
    isOwner: context.isOwner,
    myRole: context.myRole,
    createdAt: project.createdAt.toISOString(),
    deletedAt: project.deletedAt ? project.deletedAt.toISOString() : null,
    purgeEligibleAt: project.purgeEligibleAt ? project.purgeEligibleAt.toISOString() : null,
    previousStatus: project.previousStatus,
    setupComplete: project.setupCompletedAt !== null,
    activeStage: context.activeStage,
  };
}

export function toProjectDetail(
  project: ProjectRow,
  context: SummaryContext & { permissions: Iterable<PermissionCode> },
): ProjectDetail {
  return {
    ...toProjectSummary(project, context),
    currency: project.currency as Currency,
    timezone: project.timezone,
    dateFormat: project.dateFormat,
    version: project.version,
    updatedAt: project.updatedAt.toISOString(),
    myPermissions: [...context.permissions].sort(),
  };
}

export const fullName = (user: { firstName: string; lastName: string }): string =>
  `${user.firstName} ${user.lastName}`.trim();
