import { Inject, Injectable } from '@nestjs/common';
import {
  addMoney,
  defaultStageName,
  isNegativeMoney,
  multiplyMoney,
  subtractMoney,
  PROJECT_TRASH_RETENTION_DAYS,
  ZERO_MONEY,
  type CorrectStageUnitInput,
  type CreateStageInput,
  type MoneyString,
  type StageStatus,
  type StageSummary,
  type StageUnitCorrectionPreview,
} from '@letfer/shared';
import { and, count, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { Clock } from '../common/clock.js';
import { lockByKey } from '../database/advisory-lock.js';
import { nextVersion } from '../database/concurrency.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import { bets, houses, stages, type StageRow, type UserRow } from '../database/schema/index.js';
import { computeHouseBalances } from './balances.js';
import { assertProjectActive, financeConflict, financeNotFound } from './finance-errors.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toSummary(stage: StageRow): StageSummary {
  return {
    id: stage.id,
    projectId: stage.projectId,
    name: stage.name,
    unitStake: stage.unitStake,
    status: stage.status,
    createdAt: stage.createdAt.toISOString(),
    deletedAt: stage.deletedAt ? stage.deletedAt.toISOString() : null,
    purgeEligibleAt: stage.purgeEligibleAt ? stage.purgeEligibleAt.toISOString() : null,
    version: stage.version,
  };
}

/**
 * Etapas del proyecto (§11, §12, §86). Crear una nueva cierra la anterior de forma
 * transaccional; solo se envía a la papelera una etapa `CLOSED` (nunca la activa), así que
 * restaurarla siempre la devuelve a `CLOSED`.
 */
@Injectable()
export class StagesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** Sin filtro: activa + cerradas. `TRASHED` exige `stages.restore` (verificado en el controlador). */
  async list(access: ProjectAccess, filter?: StageStatus): Promise<StageSummary[]> {
    const where = filter
      ? and(eq(stages.projectId, access.project.id), eq(stages.status, filter))
      : and(eq(stages.projectId, access.project.id), ne(stages.status, 'TRASHED'));
    const rows = await this.db.select().from(stages).where(where).orderBy(desc(stages.createdAt));
    return rows.map(toSummary);
  }

  /**
   * Crea y activa una nueva etapa, cerrando la actual (§86). Exige que el proyecto ya tenga
   * una etapa activa (es decir, que haya completado la configuración inicial, D1).
   */
  async create(
    access: ProjectAccess,
    actor: UserRow,
    input: CreateStageInput,
  ): Promise<StageSummary> {
    assertProjectActive(access);
    const created = await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      const [current] = await tx
        .select()
        .from(stages)
        .where(and(eq(stages.projectId, access.project.id), eq(stages.status, 'ACTIVE')))
        .for('update')
        .limit(1);
      if (!current) {
        throw financeConflict('El proyecto todavía no completó su configuración inicial.');
      }

      await tx
        .update(stages)
        .set({ status: 'CLOSED', version: nextVersion(stages.version) })
        .where(eq(stages.id, current.id));

      const [totalRow] = await tx
        .select({ total: count() })
        .from(stages)
        .where(eq(stages.projectId, access.project.id));
      const [created] = await tx
        .insert(stages)
        .values({
          projectId: access.project.id,
          name: input.name ?? defaultStageName(totalRow!.total + 1),
          unitStake: input.unitStake,
        })
        .returning();

      await this.audit.record(tx, {
        action: 'stage.created',
        entityType: 'stage',
        entityId: created!.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        oldValues: { previousStageId: current.id, previousStageName: current.name },
        newValues: { name: created!.name, unitStake: created!.unitStake },
      });
      return created!;
    });
    return toSummary(created);
  }

  /**
   * Vista previa (por defecto) o aplicación (`confirm: true`) de la corrección de unidad
   * (§12.1, §73). `affectedBets` cuenta las apuestas `PENDING` de la etapa sin monto oficial
   * (§107.5): su monto calculado cambiará en la siguiente lectura, sin ningún job de
   * recálculo (D-B7), porque nunca se guardó. Antes de confirmar, se rechaza de forma
   * proactiva si el nuevo comprometido dejaría a alguna casa con disponible negativo (§73,
   * revisión de arquitectura previa a integrar la Fase 4): la comprobación corre dentro de la
   * misma transacción que aplica el cambio, bajo el mismo candado de Finanzas.
   */
  async correctUnit(
    access: ProjectAccess,
    actor: UserRow,
    stageId: string,
    input: CorrectStageUnitInput,
  ): Promise<StageUnitCorrectionPreview | StageSummary> {
    assertProjectActive(access);
    const stage = await this.findOwned(this.db, access.project.id, stageId);
    if (stage.status === 'TRASHED') {
      throw financeNotFound('Etapa no encontrada.');
    }

    if (!input.confirm) {
      const affectedBets = await this.countAffectedBets(this.db, stage.id);
      return {
        currentUnitStake: stage.unitStake,
        newUnitStake: input.unitStake,
        affectedBets,
        impact:
          affectedBets === 0
            ? 'No hay apuestas pendientes sin monto oficial en esta etapa: no se recalcula ningún valor.'
            : `${affectedBets} apuesta(s) pendiente(s) sin monto oficial recalcularán su monto calculado en la siguiente consulta.`,
      };
    }

    const updated = await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      await this.assertUnitCorrectionFits(
        tx,
        access.project.id,
        stage.id,
        stage.unitStake,
        input.unitStake,
      );
      const [updated] = await tx
        .update(stages)
        .set({ unitStake: input.unitStake, version: nextVersion(stages.version) })
        .where(eq(stages.id, stage.id))
        .returning();
      await this.audit.record(tx, {
        action: 'stage.unit_corrected',
        entityType: 'stage',
        entityId: stage.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        oldValues: { unitStake: stage.unitStake },
        newValues: { unitStake: input.unitStake },
      });
      return updated!;
    });
    return toSummary(updated);
  }

  /** Envía una etapa `CLOSED` a la papelera (nunca la activa: siempre debe haber una, D1). */
  async trash(access: ProjectAccess, actor: UserRow, stageId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [stage] = await tx
        .select()
        .from(stages)
        .where(and(eq(stages.id, stageId), eq(stages.projectId, access.project.id)))
        .for('update')
        .limit(1);
      if (!stage) throw financeNotFound('Etapa no encontrada.');
      if (stage.status !== 'CLOSED') {
        throw financeConflict('Solo se puede enviar a la papelera una etapa cerrada.');
      }
      const now = this.clock.now();
      await tx
        .update(stages)
        .set({
          status: 'TRASHED',
          deletedAt: now,
          deletedBy: actor.id,
          purgeEligibleAt: new Date(now.getTime() + PROJECT_TRASH_RETENTION_DAYS * MS_PER_DAY),
          version: nextVersion(stages.version),
        })
        .where(eq(stages.id, stage.id));
      await this.audit.record(tx, {
        action: 'stage.trashed',
        entityType: 'stage',
        entityId: stage.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        oldValues: { status: 'CLOSED' },
        newValues: { status: 'TRASHED' },
      });
    });
  }

  /** Restaura una etapa desde la papelera; siempre vuelve a `CLOSED`. */
  async restore(access: ProjectAccess, actor: UserRow, stageId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [stage] = await tx
        .select()
        .from(stages)
        .where(and(eq(stages.id, stageId), eq(stages.projectId, access.project.id)))
        .for('update')
        .limit(1);
      if (!stage) throw financeNotFound('Etapa no encontrada.');
      if (stage.status !== 'TRASHED') {
        throw financeConflict('Esta etapa no está en la papelera.');
      }
      await tx
        .update(stages)
        .set({
          status: 'CLOSED',
          deletedAt: null,
          deletedBy: null,
          deletionReason: null,
          purgeEligibleAt: null,
          version: nextVersion(stages.version),
        })
        .where(eq(stages.id, stage.id));
      await this.audit.record(tx, {
        action: 'stage.restored',
        entityType: 'stage',
        entityId: stage.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        oldValues: { status: 'TRASHED' },
        newValues: { status: 'CLOSED' },
      });
    });
  }

  private async findOwned(
    executor: DbExecutor,
    projectId: string,
    stageId: string,
  ): Promise<StageRow> {
    const [stage] = await executor
      .select()
      .from(stages)
      .where(and(eq(stages.id, stageId), eq(stages.projectId, projectId)))
      .limit(1);
    if (!stage) throw financeNotFound('Etapa no encontrada.');
    return stage;
  }

  /** Apuestas `PENDING` sin monto oficial de la etapa (§73, §107.5, Fase 4). */
  private async countAffectedBets(executor: DbExecutor, stageId: string): Promise<number> {
    const [row] = await executor
      .select({ total: count() })
      .from(bets)
      .where(
        and(
          eq(bets.stageId, stageId),
          eq(bets.status, 'PENDING'),
          isNull(bets.officialAmount),
          isNull(bets.deletedAt),
        ),
      );
    return row?.total ?? 0;
  }

  /**
   * Rechaza la corrección si dejaría a alguna casa con disponible negativo (§73, revisión de
   * arquitectura previa a integrar la Fase 4). Solo las apuestas `PENDING` sin monto oficial de
   * esta etapa cambian de monto calculado con la unidad nueva (D-B7); se agrupa por casa el
   * delta entre su monto con la unidad actual y con la nueva, y se compara contra el disponible
   * vigente (que ya incluye su aporte actual al comprometido, calculado con la unidad actual).
   */
  private async assertUnitCorrectionFits(
    executor: DbExecutor,
    projectId: string,
    stageId: string,
    currentUnitStake: string,
    newUnitStake: string,
  ): Promise<void> {
    const affected = await executor
      .select({ houseId: bets.houseId, stakeAmount: bets.stakeAmount })
      .from(bets)
      .where(
        and(
          eq(bets.stageId, stageId),
          eq(bets.status, 'PENDING'),
          isNull(bets.officialAmount),
          isNull(bets.deletedAt),
        ),
      );
    if (affected.length === 0) return;

    const deltaByHouse = new Map<string, MoneyString>();
    for (const bet of affected) {
      const oldAmount = multiplyMoney(currentUnitStake, bet.stakeAmount);
      const newAmount = multiplyMoney(newUnitStake, bet.stakeAmount);
      const delta = subtractMoney(newAmount, oldAmount);
      deltaByHouse.set(bet.houseId, addMoney(deltaByHouse.get(bet.houseId) ?? ZERO_MONEY, delta));
    }

    const balances = await computeHouseBalances(executor, projectId);
    const conflictedHouseIds: string[] = [];
    for (const [houseId, delta] of deltaByHouse) {
      const available = balances.get(houseId)?.available ?? ZERO_MONEY;
      const newAvailable = subtractMoney(available, delta);
      if (isNegativeMoney(newAvailable)) conflictedHouseIds.push(houseId);
    }
    if (conflictedHouseIds.length === 0) return;

    const conflictedHouses = await executor
      .select({ name: houses.name })
      .from(houses)
      .where(inArray(houses.id, conflictedHouseIds));
    const names = conflictedHouses.map((house) => house.name).join(', ');
    throw financeConflict(
      `Esta corrección dejaría sin saldo disponible suficiente a: ${names}. Liquida o ajusta las apuestas pendientes de esa(s) casa(s) antes de corregir la unidad.`,
    );
  }
}
