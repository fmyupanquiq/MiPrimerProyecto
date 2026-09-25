import { Controller, Get, Header } from '@nestjs/common';
import type { TrashItem } from '@letfer/shared';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { CurrentProject, ProjectRoute } from '../authorization/decorators.js';
import { ProjectTrashService } from './project-trash.service.js';

/** Papelera de apuestas y etapas de un proyecto (§36, §111.2). Solo lectura. */
@Controller('projects/:projectId/trash')
export class ProjectTrashController {
  constructor(private readonly trash: ProjectTrashService) {}

  @Get()
  @ProjectRoute('project.view')
  @Header('Cache-Control', 'no-store')
  list(@CurrentProject() access: ProjectAccess): Promise<TrashItem[]> {
    return this.trash.list(access);
  }
}
