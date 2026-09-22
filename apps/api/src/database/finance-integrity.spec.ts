import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  insertHouse,
  insertProject,
  insertStage,
  insertUser,
} from '../../test/support/factories.js';
import {
  createTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/support/test-database.js';
import {
  PG_CHECK_VIOLATION,
  PG_RESTRICT_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
} from './pg-errors.js';
import {
  financialMovements,
  houses,
  stages,
  withdrawalRequests,
  type NewFinancialMovement,
  type NewWithdrawalRequest,
} from './schema/index.js';

const code = (expected: string) => (error: unknown) => pgErrorCode(error) === expected;

describe('integridad de finanzas en PostgreSQL (§16, §72, §86, D2-D5)', () => {
  let t: TestDatabase;

  beforeAll(() => {
    t = createTestDatabase();
  });
  afterAll(() => t.close());
  beforeEach(() => truncateAll(t.pool));

  describe('etapas', () => {
    it('se crea activa con los valores por defecto', async () => {
      const { project } = await insertProject(t.db);
      const stage = await insertStage(t.db, { projectId: project.id });
      expect(stage).toMatchObject({
        status: 'ACTIVE',
        unitStake: '10.00',
        deletedAt: null,
        purgeEligibleAt: null,
        version: 1,
      });
    });

    it('como máximo una etapa ACTIVE por proyecto (índice único parcial, §86)', async () => {
      const { project } = await insertProject(t.db);
      await insertStage(t.db, { projectId: project.id, name: 'Etapa 1' });
      await expect(insertStage(t.db, { projectId: project.id, name: 'Etapa 2' })).rejects.toSatisfy(
        code(PG_UNIQUE_VIOLATION),
      );

      // Pero dos proyectos distintos sí pueden tener cada uno la suya activa.
      const other = await insertProject(t.db);
      await expect(insertStage(t.db, { projectId: other.project.id })).resolves.toBeDefined();

      // Y dos CLOSED en el mismo proyecto no chocan entre sí ni con la ACTIVE.
      await expect(
        insertStage(t.db, { projectId: project.id, name: 'Etapa vieja A', status: 'CLOSED' }),
      ).resolves.toBeDefined();
      await expect(
        insertStage(t.db, { projectId: project.id, name: 'Etapa vieja B', status: 'CLOSED' }),
      ).resolves.toBeDefined();
    });

    it('rechaza nombre en blanco y unidad no positiva', async () => {
      const { project } = await insertProject(t.db);
      await expect(insertStage(t.db, { projectId: project.id, name: '   ' })).rejects.toSatisfy(
        code(PG_CHECK_VIOLATION),
      );
      await expect(insertStage(t.db, { projectId: project.id, unitStake: '0' })).rejects.toSatisfy(
        code(PG_CHECK_VIOLATION),
      );
      await expect(
        insertStage(t.db, { projectId: project.id, unitStake: '-5.00' }),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
    });

    it('la papelera exige fecha de borrado y de purga a la vez, y solo desde CLOSED', async () => {
      const { project } = await insertProject(t.db);
      const stage = await insertStage(t.db, { projectId: project.id, status: 'CLOSED' });
      await expect(
        t.db.update(stages).set({ status: 'TRASHED' }).where(eq(stages.id, stage.id)),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));

      const now = new Date();
      const purge = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      await t.db
        .update(stages)
        .set({ status: 'TRASHED', deletedAt: now, purgeEligibleAt: purge })
        .where(eq(stages.id, stage.id));
      const [trashed] = await t.db.select().from(stages).where(eq(stages.id, stage.id));
      expect(trashed!.status).toBe('TRASHED');
    });

    it('no se elimina físicamente', async () => {
      const { project } = await insertProject(t.db);
      const stage = await insertStage(t.db, { projectId: project.id });
      await expect(t.db.delete(stages).where(eq(stages.id, stage.id))).rejects.toSatisfy(
        code(PG_RESTRICT_VIOLATION),
      );
    });

    it('updated_at avanza al modificar', async () => {
      const { project } = await insertProject(t.db);
      const stage = await insertStage(t.db, { projectId: project.id });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await t.db.update(stages).set({ name: 'Renombrada' }).where(eq(stages.id, stage.id));
      const [after] = await t.db.select().from(stages).where(eq(stages.id, stage.id));
      expect(after!.updatedAt.getTime()).toBeGreaterThan(stage.updatedAt.getTime());
    });
  });

  describe('casas', () => {
    it('se crea activa; rechaza nombre en blanco', async () => {
      const { project } = await insertProject(t.db);
      const house = await insertHouse(t.db, { projectId: project.id, name: 'Betano' });
      expect(house.status).toBe('ACTIVE');
      await expect(insertHouse(t.db, { projectId: project.id, name: '   ' })).rejects.toSatisfy(
        code(PG_CHECK_VIOLATION),
      );
    });

    it('no se elimina físicamente (solo se desactiva)', async () => {
      const { project } = await insertProject(t.db);
      const house = await insertHouse(t.db, { projectId: project.id });
      await expect(t.db.delete(houses).where(eq(houses.id, house.id))).rejects.toSatisfy(
        code(PG_RESTRICT_VIOLATION),
      );
      await t.db.update(houses).set({ status: 'INACTIVE' }).where(eq(houses.id, house.id));
      const [after] = await t.db.select().from(houses).where(eq(houses.id, house.id));
      expect(after!.status).toBe('INACTIVE');
    });

    it('el mismo nombre de casa puede repetirse entre proyectos distintos', async () => {
      const a = await insertProject(t.db);
      const b = await insertProject(t.db);
      await expect(
        insertHouse(t.db, { projectId: a.project.id, name: 'Betano' }),
      ).resolves.toBeDefined();
      await expect(
        insertHouse(t.db, { projectId: b.project.id, name: 'Betano' }),
      ).resolves.toBeDefined();
    });
  });

  describe('ledger financiero (financial_movements)', () => {
    let projectId: string;
    let stageId: string;
    let houseA: string;
    let houseB: string;
    let userId: string;

    beforeEach(async () => {
      const { project, owner } = await insertProject(t.db);
      const stage = await insertStage(t.db, { projectId: project.id });
      const a = await insertHouse(t.db, { projectId: project.id, name: 'Casa A' });
      const b = await insertHouse(t.db, { projectId: project.id, name: 'Casa B' });
      projectId = project.id;
      stageId = stage.id;
      houseA = a.id;
      houseB = b.id;
      userId = owner.id;
    });

    const base = (overrides: Partial<NewFinancialMovement>): NewFinancialMovement => ({
      projectId,
      stageId,
      type: 'DEPOSIT',
      direction: 'CREDIT',
      houseId: houseA,
      amount: '100.00',
      createdBy: userId,
      ...overrides,
    });

    it('un depósito válido se inserta con operation_id propio', async () => {
      const [row] = await t.db.insert(financialMovements).values(base({})).returning();
      expect(row).toMatchObject({ type: 'DEPOSIT', direction: 'CREDIT', amount: '100.00' });
      expect(row!.operationId).toBeTruthy();
      expect(row!.operationId).not.toBe(row!.id);
    });

    it('rechaza un monto no positivo', async () => {
      await expect(t.db.insert(financialMovements).values(base({ amount: '0' }))).rejects.toSatisfy(
        code(PG_CHECK_VIOLATION),
      );
      await expect(
        t.db.insert(financialMovements).values(base({ amount: '-10' })),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
    });

    describe('forma según el tipo (house_shape)', () => {
      it('un movimiento normal exige house_id y prohíbe from/to', async () => {
        await expect(
          t.db.insert(financialMovements).values(base({ houseId: null })),
        ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
        await expect(
          t.db.insert(financialMovements).values(base({ fromHouseId: houseB })),
        ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      });

      it('una transferencia exige from/to distintos y prohíbe house_id', async () => {
        const valid = base({
          type: 'TRANSFER',
          direction: null,
          houseId: null,
          fromHouseId: houseA,
          toHouseId: houseB,
        });
        await expect(t.db.insert(financialMovements).values(valid)).resolves.toBeDefined();

        await expect(
          t.db.insert(financialMovements).values({ ...valid, houseId: houseA }),
        ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
        await expect(
          t.db.insert(financialMovements).values({ ...valid, toHouseId: houseA }),
        ).rejects.toSatisfy(code(PG_CHECK_VIOLATION)); // origen = destino
        await expect(
          t.db.insert(financialMovements).values({ ...valid, fromHouseId: null }),
        ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      });
    });

    describe('sentido según el tipo (direction_shape)', () => {
      it('capital inicial y depósito exigen CREDIT', async () => {
        await expect(
          t.db
            .insert(financialMovements)
            .values(base({ type: 'INITIAL_CAPITAL', direction: 'CREDIT' })),
        ).resolves.toBeDefined();
        await expect(
          t.db.insert(financialMovements).values(base({ direction: 'DEBIT' })),
        ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      });

      it('el retiro exige DEBIT', async () => {
        await expect(
          t.db
            .insert(financialMovements)
            .values(base({ type: 'WITHDRAWAL', direction: 'DEBIT', reason: 'Pago' })),
        ).resolves.toBeDefined();
        await expect(
          t.db
            .insert(financialMovements)
            .values(base({ type: 'WITHDRAWAL', direction: 'CREDIT', reason: 'Pago' })),
        ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      });

      it('el extraordinario admite CREDIT o DEBIT', async () => {
        await expect(
          t.db
            .insert(financialMovements)
            .values(base({ type: 'EXTRAORDINARY', direction: 'CREDIT', reason: 'Cashback' })),
        ).resolves.toBeDefined();
        await expect(
          t.db
            .insert(financialMovements)
            .values(base({ type: 'EXTRAORDINARY', direction: 'DEBIT', reason: 'Comisión' })),
        ).resolves.toBeDefined();
      });

      it('la transferencia exige direction NULL', async () => {
        await expect(
          t.db.insert(financialMovements).values(
            base({
              type: 'TRANSFER',
              direction: 'CREDIT',
              houseId: null,
              fromHouseId: houseA,
              toHouseId: houseB,
            }),
          ),
        ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      });
    });

    it('exige motivo en retiros y extraordinarios, pero no en depósitos ni capital inicial', async () => {
      await expect(
        t.db.insert(financialMovements).values(base({ type: 'WITHDRAWAL', direction: 'DEBIT' })),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      await expect(
        t.db
          .insert(financialMovements)
          .values(base({ type: 'WITHDRAWAL', direction: 'DEBIT', reason: '   ' })),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      await expect(
        t.db
          .insert(financialMovements)
          .values(base({ type: 'EXTRAORDINARY', direction: 'CREDIT' })),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      // El depósito no exige motivo.
      await expect(t.db.insert(financialMovements).values(base({}))).resolves.toBeDefined();
    });

    it('es inmutable: ni se modifica ni se elimina (D2)', async () => {
      const [row] = await t.db.insert(financialMovements).values(base({})).returning();
      await expect(
        t.db
          .update(financialMovements)
          .set({ amount: '999.00' })
          .where(eq(financialMovements.id, row!.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
      await expect(
        t.db.delete(financialMovements).where(eq(financialMovements.id, row!.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
    });
  });

  describe('solicitudes de retiro (withdrawal_requests, D5)', () => {
    let projectId: string;
    let stageId: string;
    let houseId: string;
    let userId: string;

    beforeEach(async () => {
      const { project, owner } = await insertProject(t.db);
      const stage = await insertStage(t.db, { projectId: project.id });
      const house = await insertHouse(t.db, { projectId: project.id });
      projectId = project.id;
      stageId = stage.id;
      houseId = house.id;
      userId = owner.id;
    });

    const base = (overrides: Partial<NewWithdrawalRequest> = {}): NewWithdrawalRequest => ({
      projectId,
      stageId,
      houseId,
      amount: '50.00',
      reason: 'Pago de premios',
      requestedBy: userId,
      ...overrides,
    });

    it('se crea PENDING sin decisión ni movimiento asociado', async () => {
      const [row] = await t.db.insert(withdrawalRequests).values(base()).returning();
      expect(row).toMatchObject({
        status: 'PENDING',
        decidedBy: null,
        decidedAt: null,
        movementId: null,
        version: 1,
      });
    });

    it('rechaza monto no positivo y motivo en blanco', async () => {
      await expect(t.db.insert(withdrawalRequests).values(base({ amount: '0' }))).rejects.toSatisfy(
        code(PG_CHECK_VIOLATION),
      );
      await expect(
        t.db.insert(withdrawalRequests).values(base({ reason: '   ' })),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
    });

    it('la forma de la decisión debe ser coherente con el estado (status_shape)', async () => {
      const [pending] = await t.db.insert(withdrawalRequests).values(base()).returning();
      // Rechazado con decidedBy pero sin decidedAt: incoherente.
      await expect(
        t.db
          .update(withdrawalRequests)
          .set({ status: 'REJECTED', decidedBy: userId })
          .where(eq(withdrawalRequests.id, pending!.id)),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));

      // Aprobado sin movementId: incoherente (D5: solo al aprobar se genera el movimiento).
      await expect(
        t.db
          .update(withdrawalRequests)
          .set({ status: 'APPROVED', decidedBy: userId, decidedAt: new Date() })
          .where(eq(withdrawalRequests.id, pending!.id)),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
    });

    it('aprobar exige un movimiento del ledger existente y consistente', async () => {
      const [pending] = await t.db.insert(withdrawalRequests).values(base()).returning();
      const [movement] = await t.db
        .insert(financialMovements)
        .values({
          projectId,
          stageId,
          type: 'WITHDRAWAL',
          direction: 'DEBIT',
          houseId,
          amount: '50.00',
          reason: 'Pago de premios',
          createdBy: userId,
        })
        .returning();

      await t.db
        .update(withdrawalRequests)
        .set({
          status: 'APPROVED',
          decidedBy: userId,
          decidedAt: new Date(),
          movementId: movement!.id,
        })
        .where(eq(withdrawalRequests.id, pending!.id));

      const [approved] = await t.db
        .select()
        .from(withdrawalRequests)
        .where(eq(withdrawalRequests.id, pending!.id));
      expect(approved!.status).toBe('APPROVED');
      expect(approved!.movementId).toBe(movement!.id);
    });

    it('los datos originales de la solicitud no se pueden modificar', async () => {
      const [pending] = await t.db.insert(withdrawalRequests).values(base()).returning();
      await expect(
        t.db
          .update(withdrawalRequests)
          .set({ amount: '999.00' })
          .where(eq(withdrawalRequests.id, pending!.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
      await expect(
        t.db
          .update(withdrawalRequests)
          .set({ reason: 'Otro motivo' })
          .where(eq(withdrawalRequests.id, pending!.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
    });

    it('la decisión no se puede revertir una vez tomada', async () => {
      const [pending] = await t.db.insert(withdrawalRequests).values(base()).returning();
      await t.db
        .update(withdrawalRequests)
        .set({ status: 'REJECTED', decidedBy: userId, decidedAt: new Date() })
        .where(eq(withdrawalRequests.id, pending!.id));

      await expect(
        t.db
          .update(withdrawalRequests)
          .set({ status: 'PENDING', decidedBy: null, decidedAt: null })
          .where(eq(withdrawalRequests.id, pending!.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
      await expect(
        t.db
          .update(withdrawalRequests)
          .set({ status: 'CANCELLED' })
          .where(eq(withdrawalRequests.id, pending!.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
    });

    it('no se elimina físicamente', async () => {
      const [pending] = await t.db.insert(withdrawalRequests).values(base()).returning();
      await expect(
        t.db.delete(withdrawalRequests).where(eq(withdrawalRequests.id, pending!.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
    });
  });

  describe('un usuario nuevo puede protagonizar el escenario financiero mínimo', () => {
    it('proyecto con etapa, dos casas y un depósito coherente', async () => {
      const creator = await insertUser(t.db);
      const { project } = await insertProject(t.db, { owner: creator });
      const stage = await insertStage(t.db, { projectId: project.id, unitStake: '5.00' });
      const house = await insertHouse(t.db, { projectId: project.id, name: 'Betano' });
      const [movement] = await t.db
        .insert(financialMovements)
        .values({
          projectId: project.id,
          stageId: stage.id,
          type: 'INITIAL_CAPITAL',
          direction: 'CREDIT',
          houseId: house.id,
          amount: '1000.00',
          createdBy: creator.id,
        })
        .returning();
      expect(movement!.amount).toBe('1000.00');
    });
  });
});
