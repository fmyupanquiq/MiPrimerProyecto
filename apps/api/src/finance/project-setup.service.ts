import { Inject, Injectable } from '@nestjs/common';
import {
  defaultStageName,
  isPositiveMoney,
  sumMoney,
  type ProjectDetail,
  type ProjectSetupInput,
} from '@letfer/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { Clock } from '../common/clock.js';
import { lockByKey } from '../database/advisory-lock.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import {
  financialMovements,
  houses,
  projects,
  stages,
  type UserRow,
} from '../database/schema/index.js';
import { ProjectsService } from '../projects/projects.service.js';
import { assertProjectActive, financeConflict } from './finance-errors.js';

/**
 * Configuración inicial del proyecto (§5, D1): crea la Etapa 1 con su unidad, da de alta las
 * casas y registra la banca inicial distribuida entre ellas, todo en una sola transacción.
 * Hasta completarse, el proyecto no admite ninguna otra operación financiera.
 */
@Injectable()
export class ProjectSetupService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly projectsService: ProjectsService,
  ) {}

  async setup(
    access: ProjectAccess,
    actor: UserRow,
    input: ProjectSetupInput,
  ): Promise<ProjectDetail> {
    assertProjectActive(access);

    await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      const [project] = await tx
        .select({ setupCompletedAt: projects.setupCompletedAt })
        .from(projects)
        .where(eq(projects.id, access.project.id))
        .for('update')
        .limit(1);
      if (!project) throw financeConflict('El proyecto ya no existe.');
      if (project.setupCompletedAt !== null) {
        throw financeConflict('Este proyecto ya completó su configuración inicial.');
      }

      const [stage] = await tx
        .insert(stages)
        .values({
          projectId: access.project.id,
          name: defaultStageName(1),
          unitStake: input.unitStake,
        })
        .returning();

      const createdHouses = await tx
        .insert(houses)
        .values(input.houses.map((house) => ({ projectId: access.project.id, name: house.name })))
        .returning();

      const now = this.clock.now();
      for (const [index, house] of input.houses.entries()) {
        if (!isPositiveMoney(house.initialAmount)) continue; // §15: una casa puede arrancar en cero.
        await tx.insert(financialMovements).values({
          projectId: access.project.id,
          stageId: stage!.id,
          type: 'INITIAL_CAPITAL',
          direction: 'CREDIT',
          houseId: createdHouses[index]!.id,
          amount: house.initialAmount,
          occurredAt: now,
          createdBy: actor.id,
        });
      }

      await tx
        .update(projects)
        .set({ setupCompletedAt: now })
        .where(eq(projects.id, access.project.id));

      await this.audit.record(tx, {
        action: 'project.setup_completed',
        entityType: 'project',
        entityId: access.project.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        newValues: {
          stageId: stage!.id,
          unitStake: input.unitStake,
          totalCapital: sumMoney(input.houses.map((house) => house.initialAmount)),
          houses: input.houses.map((house, index) => ({
            id: createdHouses[index]!.id,
            name: house.name,
            initialAmount: house.initialAmount,
          })),
        },
      });
    });

    return this.projectsService.detailFor(actor, access.project.id);
  }
}
