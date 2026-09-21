import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertProject } from '../../test/support/factories.js';
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
import { roleIdByKey } from './role-lookup.js';
import {
  invitationAcceptances,
  invitations,
  type InvitationRow,
  type NewInvitation,
} from './schema/index.js';

const code = (expected: string) => (error: unknown) => pgErrorCode(error) === expected;

describe('integridad de invitaciones en PostgreSQL', () => {
  let t: TestDatabase;

  beforeAll(() => {
    t = createTestDatabase();
  });
  afterAll(() => t.close());
  beforeEach(() => truncateAll(t.pool));

  let counter = 0;
  const newInvitation = async (overrides: Partial<NewInvitation> = {}) => {
    const { project, owner } = await insertProject(t.db);
    const values: NewInvitation = {
      projectId: project.id,
      roleId: await roleIdByKey(t.db, 'COLLABORATOR'),
      createdBy: owner.id,
      tokenHash: `hash-${(counter += 1)}`,
      singleUse: true,
      ...overrides,
    };
    const [invitation] = await t.db.insert(invitations).values(values).returning();
    return { invitation: invitation!, project, owner };
  };

  const query = (text: string, params: unknown[]) => t.pool.query(text, params);

  it('se crea con valores por defecto y sin estado guardado', async () => {
    const { invitation } = await newInvitation();
    expect(invitation).toMatchObject({
      consumedAt: null,
      consumedBy: null,
      disabledAt: null,
      disabledBy: null,
      expiresAt: null,
      restrictedEmail: null,
      version: 1,
    });
  });

  it('el hash del token es único', async () => {
    const { invitation, project, owner } = await newInvitation();
    await expect(
      t.db.insert(invitations).values({
        projectId: project.id,
        roleId: invitation.roleId,
        createdBy: owner.id,
        tokenHash: invitation.tokenHash,
        singleUse: false,
      }),
    ).rejects.toSatisfy(code(PG_UNIQUE_VIOLATION));
  });

  it('el correo restringido debe estar normalizado (minúsculas y sin espacios)', async () => {
    await expect(newInvitation({ restrictedEmail: 'Ana@Example.com' })).rejects.toSatisfy(
      code(PG_CHECK_VIOLATION),
    );
    await expect(newInvitation({ restrictedEmail: ' ana@example.com' })).rejects.toSatisfy(
      code(PG_CHECK_VIOLATION),
    );
    const { invitation } = await newInvitation({ restrictedEmail: 'ana@example.com' });
    expect(invitation.restrictedEmail).toBe('ana@example.com');
  });

  it('solo una invitación de un solo uso puede estar consumida, y con su usuario', async () => {
    const { invitation, owner } = await newInvitation({ singleUse: false });
    await expect(
      t.db
        .update(invitations)
        .set({ consumedAt: new Date(), consumedBy: owner.id })
        .where(eq(invitations.id, invitation.id)),
    ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));

    const single = await newInvitation({ singleUse: true });
    await expect(
      t.db
        .update(invitations)
        .set({ consumedAt: new Date() })
        .where(eq(invitations.id, single.invitation.id)),
    ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
  });

  it('deshabilitar exige fecha y responsable a la vez', async () => {
    const { invitation, owner } = await newInvitation();
    await expect(
      t.db
        .update(invitations)
        .set({ disabledAt: new Date() })
        .where(eq(invitations.id, invitation.id)),
    ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
    await t.db
      .update(invitations)
      .set({ disabledAt: new Date(), disabledBy: owner.id })
      .where(eq(invitations.id, invitation.id));
  });

  it('no se elimina físicamente', async () => {
    const { invitation } = await newInvitation();
    await expect(
      t.db.delete(invitations).where(eq(invitations.id, invitation.id)),
    ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
  });

  it('los datos que definen la invitación son inmutables', async () => {
    const { invitation, owner } = await newInvitation();
    const otherRole = await roleIdByKey(t.db, 'READER');
    const changes: Partial<InvitationRow>[] = [
      { roleId: otherRole },
      { createdBy: (await insertProject(t.db)).owner.id },
      { tokenHash: 'otro-hash' },
      { singleUse: false },
      { expiresAt: new Date() },
      { restrictedEmail: 'otro@example.com' },
      { createdAt: new Date('2000-01-01') },
    ];
    for (const change of changes) {
      await expect(
        t.db.update(invitations).set(change).where(eq(invitations.id, invitation.id)),
        JSON.stringify(Object.keys(change)),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
    }
    void owner;
    const [unchanged] = await t.db
      .select()
      .from(invitations)
      .where(eq(invitations.id, invitation.id));
    expect(unchanged).toMatchObject({ roleId: invitation.roleId, tokenHash: invitation.tokenHash });
  });

  it('proyecto distinto tampoco puede reasignarse', async () => {
    const { invitation } = await newInvitation();
    const { project: other } = await insertProject(t.db);
    await expect(
      t.db
        .update(invitations)
        .set({ projectId: other.id })
        .where(eq(invitations.id, invitation.id)),
    ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
  });

  it('el consumo y la deshabilitación son irreversibles', async () => {
    const { invitation, owner } = await newInvitation();
    await t.db
      .update(invitations)
      .set({
        consumedAt: new Date(),
        consumedBy: owner.id,
        disabledAt: new Date(),
        disabledBy: owner.id,
      })
      .where(eq(invitations.id, invitation.id));

    await expect(
      query('UPDATE invitations SET consumed_at = NULL, consumed_by = NULL WHERE id = $1', [
        invitation.id,
      ]),
    ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
    await expect(
      query('UPDATE invitations SET disabled_at = NULL, disabled_by = NULL WHERE id = $1', [
        invitation.id,
      ]),
    ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
  });

  it('updated_at y version avanzan al modificar los campos permitidos', async () => {
    const { invitation, owner } = await newInvitation();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await t.db
      .update(invitations)
      .set({ disabledAt: new Date(), disabledBy: owner.id, version: 2 })
      .where(eq(invitations.id, invitation.id));
    const [after] = await t.db.select().from(invitations).where(eq(invitations.id, invitation.id));
    expect(after!.version).toBe(2);
    expect(after!.updatedAt.getTime()).toBeGreaterThan(invitation.updatedAt.getTime());
  });

  describe('aceptaciones', () => {
    it('una fila por (invitación, usuario) y con resultado válido', async () => {
      const { invitation, owner } = await newInvitation({ singleUse: false });
      const row = {
        invitationId: invitation.id,
        userId: owner.id,
        outcome: 'ADDED',
        acceptedAt: new Date(),
      };
      await t.db.insert(invitationAcceptances).values(row);
      await expect(t.db.insert(invitationAcceptances).values(row)).rejects.toSatisfy(
        code(PG_UNIQUE_VIOLATION),
      );
      const { owner: another } = await insertProject(t.db);
      await expect(
        t.db.insert(invitationAcceptances).values({ ...row, userId: another.id, outcome: 'OTRO' }),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
    });

    it('son un registro histórico: no se modifican ni se eliminan', async () => {
      const { invitation, owner } = await newInvitation({ singleUse: false });
      const [row] = await t.db
        .insert(invitationAcceptances)
        .values({
          invitationId: invitation.id,
          userId: owner.id,
          outcome: 'ADDED',
          acceptedAt: new Date(),
        })
        .returning();
      await expect(
        t.db
          .update(invitationAcceptances)
          .set({ outcome: 'REACTIVATED' })
          .where(eq(invitationAcceptances.id, row!.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
      await expect(
        t.db.delete(invitationAcceptances).where(eq(invitationAcceptances.id, row!.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
    });
  });
});
