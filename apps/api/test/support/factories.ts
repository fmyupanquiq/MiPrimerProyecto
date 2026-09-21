import type { Database } from '../../src/database/database.module.js';
import type { DbExecutor } from '../../src/database/database.types.js';
import { roleIdByKey } from '../../src/database/role-lookup.js';
import { newId } from '../../src/database/schema/columns.js';
import {
  projectMembers,
  projects,
  users,
  type NewProject,
  type NewUser,
  type ProjectMemberRow,
  type ProjectRow,
  type UserRow,
} from '../../src/database/schema/index.js';

/**
 * Inserta un usuario de prueba directamente en la base de datos (sin hash real).
 * `globalRole` es la clave del rol global (por defecto `USER`).
 */
export async function insertUser(
  db: DbExecutor,
  overrides: Partial<NewUser> & { globalRole?: string } = {},
): Promise<UserRow> {
  const { globalRole = 'USER', ...values } = overrides;
  const [user] = await db
    .insert(users)
    .values({
      firstName: 'Ana',
      lastName: 'Pérez',
      email: `usuario-${newId()}@example.com`,
      passwordHash: 'hash-de-prueba',
      globalRoleId: values.globalRoleId ?? (await roleIdByKey(db, globalRole)),
      ...values,
    })
    .returning();
  return user!;
}

/**
 * Inserta un proyecto con su propietario y la membresía de Administrador de Proyecto, en una sola
 * transacción (el disparador diferido exige que ambos existan al confirmar).
 */
export async function insertProject(
  db: Database,
  overrides: Partial<NewProject> & { owner?: UserRow } = {},
): Promise<{ project: ProjectRow; owner: UserRow; membership: ProjectMemberRow }> {
  const { owner: givenOwner, ...values } = overrides;
  const owner = givenOwner ?? (await insertUser(db));
  const adminRoleId = await roleIdByKey(db, 'PROJECT_ADMIN');

  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({ name: 'Proyecto de prueba', ownerId: owner.id, ...values })
      .returning();
    const [membership] = await tx
      .insert(projectMembers)
      .values({
        projectId: project!.id,
        userId: owner.id,
        roleId: adminRoleId,
        joinedAt: new Date(),
      })
      .returning();
    return { project: project!, owner, membership: membership! };
  });
}

/** Añade a un usuario como miembro de un proyecto con el rol de sistema indicado. */
export async function insertMember(
  db: DbExecutor,
  input: {
    projectId: string;
    userId: string;
    roleKey?: string;
    status?: 'ACTIVE' | 'LEFT' | 'REMOVED';
  },
): Promise<ProjectMemberRow> {
  const status = input.status ?? 'ACTIVE';
  const now = new Date();
  const [member] = await db
    .insert(projectMembers)
    .values({
      projectId: input.projectId,
      userId: input.userId,
      roleId: await roleIdByKey(db, input.roleKey ?? 'COLLABORATOR'),
      status,
      joinedAt: now,
      leftAt: status === 'LEFT' ? now : null,
      removedAt: status === 'REMOVED' ? now : null,
    })
    .returning();
  return member!;
}
