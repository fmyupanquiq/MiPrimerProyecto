import { z } from 'zod';
import type { MemberStatus } from './project.js';

/** Cambio de rol de un miembro. `version` es la de la membresía leída por el cliente (§96). */
export const changeMemberRoleSchema = z.object({
  roleId: z.uuid(),
  version: z.number().int().positive(),
});
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;

export const MEMBER_LIST_FILTERS = ['ACTIVE', 'LEFT', 'REMOVED', 'ALL'] as const;
export type MemberListFilter = (typeof MEMBER_LIST_FILTERS)[number];

export const listMembersQuerySchema = z.object({
  status: z.enum(MEMBER_LIST_FILTERS).default('ACTIVE'),
});
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;

/** Miembro de un proyecto. El correo solo lo ven quienes pueden gestionar roles (§105.4). */
export interface MemberSummary {
  userId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  roleId: string;
  /** Clave del rol de sistema; nulo en un rol personalizado. */
  roleKey: string | null;
  roleName: string;
  isOwner: boolean;
  status: MemberStatus;
  joinedAt: string;
  leftAt: string | null;
  removedAt: string | null;
  /** Versión de la membresía, necesaria para cambiar su rol. */
  version: number;
}

/** Rol que el usuario actual puede asignar en un proyecto. */
export interface AssignableRole {
  id: string;
  key: string | null;
  name: string;
  description: string;
}
