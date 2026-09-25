import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  listGlobalAuditLogsQuerySchema,
  listProjectAuditLogsQuerySchema,
  type AuditLogPage,
  type ListGlobalAuditLogsQuery,
  type ListProjectAuditLogsQuery,
} from '@letfer/shared';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import {
  CurrentProject,
  ProjectRoute,
  RequireGlobalPermission,
} from '../authorization/decorators.js';
import { AuditQueryService } from './audit-query.service.js';

/**
 * Auditoría de un proyecto (§10, §35, §111.1). El proyecto sale de la ruta y la consulta no
 * admite un `projectId` propio: un Administrador de Proyecto nunca ve otro proyecto (D8-2).
 * `allowTrashed`: la historia de un proyecto en papelera sigue siendo consultable para quien
 * tiene acceso a él (el guard ya limita ese acceso).
 */
@Controller('projects/:projectId/audit-logs')
export class ProjectAuditController {
  constructor(private readonly auditQuery: AuditQueryService) {}

  @Get()
  @ProjectRoute('audit.view', { allowTrashed: true })
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentProject() access: ProjectAccess,
    @Query({ schema: listProjectAuditLogsQuerySchema }) query: ListProjectAuditLogsQuery,
  ): Promise<AuditLogPage> {
    return this.auditQuery.list({ kind: 'project', projectId: access.project.id }, query);
  }
}

/** Auditoría de todo el sistema (Administrador Global, `system.audit.view`, D8-2). */
@Controller('admin/audit-logs')
export class AdminAuditController {
  constructor(private readonly auditQuery: AuditQueryService) {}

  @Get()
  @RequireGlobalPermission('system.audit.view')
  @Header('Cache-Control', 'no-store')
  list(
    @Query({ schema: listGlobalAuditLogsQuerySchema }) query: ListGlobalAuditLogsQuery,
  ): Promise<AuditLogPage> {
    return this.auditQuery.list(
      { kind: 'global', projectId: query.projectId, systemOnly: query.system },
      query,
    );
  }
}
