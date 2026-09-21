import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertMember, insertProject, insertUser } from '../../test/support/factories.js';
import {
  createTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/support/test-database.js';
import { roleIdByKey } from './role-lookup.js';
import {
  PG_CHECK_VIOLATION,
  PG_RESTRICT_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
} from './pg-errors.js';
import { auditLogs, projectMembers, projects, roles } from './schema/index.js';

const FK_VIOLATION = '23503';
const code = (expected: string) => (error: unknown) => pgErrorCode(error) === expected;

describe('integridad de proyectos y membresías en PostgreSQL', () => {
  let t: TestDatabase;

  beforeAll(() => {
    t = createTestDatabase();
  });
  afterAll(() => t.close());
  beforeEach(() => truncateAll(t.pool));

  describe('proyecto', () => {
    it('se crea con los valores por defecto del §105.6', async () => {
      const { project, owner, membership } = await insertProject(t.db);
      expect(project).toMatchObject({
        currency: 'PEN',
        timezone: 'America/Lima',
        dateFormat: 'DD/MM/YYYY',
        status: 'ACTIVE',
        previousStatus: null,
        deletedAt: null,
        purgeEligibleAt: null,
        imageRef: null,
        description: '',
        version: 1,
        ownerId: owner.id,
      });
      expect(membership).toMatchObject({ status: 'ACTIVE', userId: owner.id });
    });

    it('rechaza moneda no soportada, nombre en blanco y zona horaria vacía', async () => {
      const owner = await insertUser(t.db);
      const base = { ownerId: owner.id, name: 'P' };
      await expect(
        t.pool.query(
          `INSERT INTO projects (id, name, owner_id, currency) VALUES (gen_random_uuid(), 'P', $1, 'USD')`,
          [owner.id],
        ),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      await expect(t.db.insert(projects).values({ ...base, name: '   ' })).rejects.toSatisfy(
        code(PG_CHECK_VIOLATION),
      );
      await expect(t.db.insert(projects).values({ ...base, timezone: '  ' })).rejects.toSatisfy(
        code(PG_CHECK_VIOLATION),
      );
    });

    it('la papelera exige estado, fecha, estado previo y fecha de purga a la vez', async () => {
      const { project } = await insertProject(t.db);
      const set = (sqlText: string) =>
        t.pool.query(`UPDATE projects SET ${sqlText} WHERE id = $1`, [project.id]);

      await expect(set(`status = 'TRASHED'`)).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      await expect(set(`deleted_at = now()`)).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      await expect(set(`previous_status = 'ACTIVE'`)).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      await expect(
        set(
          `status = 'TRASHED', deleted_at = now(), previous_status = 'TRASHED', purge_eligible_at = now()`,
        ),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      await expect(
        set(
          `status = 'TRASHED', deleted_at = now(), previous_status = 'CLOSED', purge_eligible_at = now() + interval '90 days'`,
        ),
      ).resolves.toBeDefined();
    });

    it('no se elimina físicamente y mantiene updated_at con el disparador', async () => {
      const { project } = await insertProject(t.db);
      await expect(
        t.pool.query('DELETE FROM projects WHERE id = $1', [project.id]),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));

      await new Promise((resolve) => setTimeout(resolve, 20));
      await t.db.update(projects).set({ description: 'nueva' }).where(eq(projects.id, project.id));
      const [after] = await t.db.select().from(projects).where(eq(projects.id, project.id));
      expect(after!.updatedAt.getTime()).toBeGreaterThan(project.updatedAt.getTime());
    });
  });

  describe('membresías', () => {
    it('una sola fila por (proyecto, usuario)', async () => {
      const { project } = await insertProject(t.db);
      const user = await insertUser(t.db);
      await insertMember(t.db, { projectId: project.id, userId: user.id });
      await expect(
        insertMember(t.db, { projectId: project.id, userId: user.id }),
      ).rejects.toSatisfy(code(PG_UNIQUE_VIOLATION));
    });

    it('un usuario puede pertenecer a varios proyectos con roles distintos (§6)', async () => {
      const a = await insertProject(t.db);
      const b = await insertProject(t.db);
      const user = await insertUser(t.db);
      await insertMember(t.db, { projectId: a.project.id, userId: user.id, roleKey: 'READER' });
      await insertMember(t.db, {
        projectId: b.project.id,
        userId: user.id,
        roleKey: 'PROJECT_ADMIN',
      });
      const rows = await t.db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.userId, user.id));
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.roleId)).size).toBe(2);
    });

    it('LEFT y REMOVED exigen su fecha y viceversa', async () => {
      const { project } = await insertProject(t.db);
      const user = await insertUser(t.db);
      const member = await insertMember(t.db, { projectId: project.id, userId: user.id });
      const set = (sqlText: string) =>
        t.pool.query(`UPDATE project_members SET ${sqlText} WHERE id = $1`, [member.id]);
      await expect(set(`status = 'LEFT'`)).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      await expect(set(`left_at = now()`)).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      await expect(set(`status = 'REMOVED'`)).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      await expect(set(`status = 'REMOVED', removed_at = now()`)).resolves.toBeDefined();
    });

    it('no se eliminan físicamente (el historial permanece)', async () => {
      const { membership } = await insertProject(t.db);
      await expect(
        t.pool.query('DELETE FROM project_members WHERE id = $1', [membership.id]),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
    });
  });

  describe('protección del propietario (§105.4)', () => {
    it('su membresía no puede degradarse a otro rol', async () => {
      const { membership } = await insertProject(t.db);
      const collaborator = await roleIdByKey(t.db, 'COLLABORATOR');
      await expect(
        t.db
          .update(projectMembers)
          .set({ roleId: collaborator })
          .where(eq(projectMembers.id, membership.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
    });

    it('su membresía no puede pasar a LEFT ni a REMOVED', async () => {
      const { membership } = await insertProject(t.db);
      await expect(
        t.pool.query(`UPDATE project_members SET status = 'LEFT', left_at = now() WHERE id = $1`, [
          membership.id,
        ]),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
      await expect(
        t.pool.query(
          `UPDATE project_members SET status = 'REMOVED', removed_at = now() WHERE id = $1`,
          [membership.id],
        ),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
      const [row] = await t.db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.id, membership.id));
      expect(row!.status).toBe('ACTIVE');
    });

    it('un proyecto no puede confirmarse sin la membresía de su propietario', async () => {
      const owner = await insertUser(t.db);
      await expect(
        t.db.transaction(async (tx) => {
          await tx.insert(projects).values({ name: 'Huérfano', ownerId: owner.id });
        }),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
      expect(await t.db.select().from(projects)).toHaveLength(0);
    });

    it('la membresía inicial del propietario debe ser de Administrador de Proyecto', async () => {
      const owner = await insertUser(t.db);
      await expect(
        t.db.transaction(async (tx) => {
          const [project] = await tx
            .insert(projects)
            .values({ name: 'X', ownerId: owner.id })
            .returning();
          await tx.insert(projectMembers).values({
            projectId: project!.id,
            userId: owner.id,
            roleId: await roleIdByKey(tx, 'COLLABORATOR'),
            joinedAt: new Date(),
          });
        }),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
    });

    it('cambiar el propietario a alguien que no es miembro activo administrador falla al confirmar', async () => {
      const { project } = await insertProject(t.db);
      const stranger = await insertUser(t.db);
      const collaborator = await insertUser(t.db);
      await insertMember(t.db, {
        projectId: project.id,
        userId: collaborator.id,
        roleKey: 'COLLABORATOR',
      });

      await expect(
        t.db.update(projects).set({ ownerId: stranger.id }).where(eq(projects.id, project.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
      await expect(
        t.db.update(projects).set({ ownerId: collaborator.id }).where(eq(projects.id, project.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT_VIOLATION));
      const [same] = await t.db.select().from(projects).where(eq(projects.id, project.id));
      expect(same!.ownerId).toBe(project.ownerId);
    });

    it('transferir la propiedad a un miembro promovido a administrador funciona y el anterior sigue como administrador', async () => {
      const { project, owner } = await insertProject(t.db);
      const next = await insertUser(t.db);
      await insertMember(t.db, { projectId: project.id, userId: next.id, roleKey: 'COLLABORATOR' });
      const adminRole = await roleIdByKey(t.db, 'PROJECT_ADMIN');

      await t.db.transaction(async (tx) => {
        await tx
          .update(projectMembers)
          .set({ roleId: adminRole })
          .where(eq(projectMembers.userId, next.id));
        await tx.update(projects).set({ ownerId: next.id }).where(eq(projects.id, project.id));
      });

      const [updated] = await t.db.select().from(projects).where(eq(projects.id, project.id));
      expect(updated!.ownerId).toBe(next.id);
      const [previous] = await t.db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.userId, owner.id));
      expect(previous).toMatchObject({ status: 'ACTIVE', roleId: adminRole });
    });

    it('el antiguo propietario, ya sin serlo, puede degradarse o salir', async () => {
      const { project, owner } = await insertProject(t.db);
      const next = await insertUser(t.db);
      await insertMember(t.db, {
        projectId: project.id,
        userId: next.id,
        roleKey: 'PROJECT_ADMIN',
      });
      await t.db.update(projects).set({ ownerId: next.id }).where(eq(projects.id, project.id));

      await t.pool.query(
        `UPDATE project_members SET status = 'LEFT', left_at = now() WHERE user_id = $1`,
        [owner.id],
      );
      const [row] = await t.db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.userId, owner.id));
      expect(row!.status).toBe('LEFT');
    });
  });

  describe('relaciones', () => {
    it('la auditoría solo acepta un project_id que exista', async () => {
      const { project } = await insertProject(t.db);
      await expect(
        t.db.insert(auditLogs).values({
          action: 'x.y',
          entityType: 'x',
          projectId: '00000000-0000-7000-8000-00000000000f',
        }),
      ).rejects.toSatisfy(code(FK_VIOLATION));
      await expect(
        t.db.insert(auditLogs).values({ action: 'x.y', entityType: 'x', projectId: project.id }),
      ).resolves.toBeDefined();
    });

    it('un rol personalizado de proyecto pertenece a un proyecto real y su nombre es único en él', async () => {
      const { project } = await insertProject(t.db);
      const values = { scope: 'PROJECT' as const, name: 'Analista', projectId: project.id };
      await expect(
        t.db.insert(roles).values({ ...values, projectId: '00000000-0000-7000-8000-00000000000f' }),
      ).rejects.toSatisfy(code(FK_VIOLATION));
      await expect(t.db.insert(roles).values(values)).resolves.toBeDefined();
      await expect(t.db.insert(roles).values(values)).rejects.toSatisfy(code(PG_UNIQUE_VIOLATION));
      // El mismo nombre en otro proyecto sí es válido.
      const other = await insertProject(t.db);
      await expect(
        t.db.insert(roles).values({ ...values, projectId: other.project.id }),
      ).resolves.toBeDefined();
    });
  });
});
