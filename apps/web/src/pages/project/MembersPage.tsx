import type { AssignableRole, MemberListFilter, MemberSummary } from '@letfer/shared';
import { useState } from 'react';
import { describeApiError } from '../../api/errors.js';
import { membersApi } from '../../api/projects.js';
import { useAuth } from '../../auth/AuthContext.js';
import { useLoad } from '../../hooks/useLoad.js';
import { formatDate, MEMBER_STATUS_LABELS, roleLabel, USER_STATUS_LABELS } from '../../labels.js';
import { Badge, btn, btnDanger, inputClass, Notice, Section } from '../../ui.js';
import { InvitationsPanel } from './InvitationsPanel.js';
import { useProject } from './ProjectContext.js';

const FILTER_LABELS: Record<MemberListFilter, string> = {
  ACTIVE: 'Miembros activos',
  LEFT: 'Salieron del proyecto',
  REMOVED: 'Expulsados',
  ALL: 'Todos',
};

/** Miembros del proyecto (§6, §105.4): roles, expulsiones e invitaciones. */
export function MembersPage() {
  const { project, can } = useProject();
  const { user } = useAuth();
  const canManage = can('members.update_role');
  const [filter, setFilter] = useState<MemberListFilter>('ACTIVE');
  const members = useLoad(`members:${project.id}:${filter}`, () =>
    membersApi.list(project.id, filter),
  );
  // Solo quien gestiona roles necesita saber qué roles puede asignar.
  const roles = useLoad(`assignable:${project.id}:${canManage}`, () =>
    canManage ? membersApi.assignableRoles(project.id) : Promise.resolve<AssignableRole[]>([]),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expelling, setExpelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  async function changeRole(member: MemberSummary, roleId: string) {
    if (roleId === member.roleId) return;
    setBusyId(member.userId);
    setError(null);
    setNotice(null);
    try {
      await membersApi.changeRole(project.id, member.userId, { roleId, version: member.version });
      setNotice(`Se cambió el rol de ${member.firstName} ${member.lastName}.`);
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setBusyId(null);
      // Se recarga siempre: tras un error (p. ej. versión obsoleta) la lista debe reflejar la realidad.
      members.reload();
    }
  }

  async function expel(member: MemberSummary) {
    setBusyId(member.userId);
    setError(null);
    setNotice(null);
    try {
      await membersApi.remove(project.id, member.userId, reason.trim() || undefined);
      setNotice(`${member.firstName} ${member.lastName} ya no es miembro del proyecto.`);
      setExpelling(null);
      setReason('');
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setBusyId(null);
      members.reload();
    }
  }

  const canRemove = can('members.remove');
  const showEmail = members.data?.some((member) => member.email !== null) ?? false;

  return (
    <>
      <Section title="Miembros">
        {canManage && (
          <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
            Mostrar
            <select
              aria-label="Mostrar miembros"
              value={filter}
              onChange={(event) => setFilter(event.target.value as MemberListFilter)}
              className={inputClass}
            >
              {(Object.keys(FILTER_LABELS) as MemberListFilter[]).map((value) => (
                <option key={value} value={value}>
                  {FILTER_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {notice && <Notice tone="success">{notice}</Notice>}
        {members.error && <Notice tone="error">{members.error}</Notice>}
        {members.loading && !members.data && <p>Cargando miembros…</p>}
        {members.data && members.data.length === 0 && (
          <Notice tone="info">No hay miembros en esta lista.</Notice>
        )}
        {members.data && members.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Nombre</th>
                  {showEmail && <th className="py-2 pr-3 font-medium">Correo</th>}
                  <th className="py-2 pr-3 font-medium">Rol</th>
                  <th className="py-2 pr-3 font-medium">Estado</th>
                  <th className="py-2 font-medium">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.data.map((member) => {
                  const name = `${member.firstName} ${member.lastName}`;
                  const isMe = member.userId === user?.id;
                  const editable = canManage && member.status === 'ACTIVE' && !member.isOwner;
                  return (
                    <tr key={member.userId} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-3">
                        {name}
                        {isMe && <span className="text-slate-500"> (tú)</span>}{' '}
                        {member.isOwner && <Badge tone="blue">Propietario</Badge>}
                      </td>
                      {showEmail && <td className="py-2 pr-3">{member.email}</td>}
                      <td className="py-2 pr-3">
                        {editable ? (
                          <RoleSelect
                            member={member}
                            name={name}
                            roles={roles.data ?? []}
                            disabled={busyId === member.userId}
                            onChange={(roleId) => void changeRole(member, roleId)}
                          />
                        ) : (
                          roleLabel(member.roleKey, member.roleName)
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {MEMBER_STATUS_LABELS[member.status]}
                        {member.accountStatus !== 'ACTIVE' &&
                          ` · cuenta ${USER_STATUS_LABELS[member.accountStatus].toLowerCase()}`}
                        {member.leftAt && ` (${formatDate(member.leftAt)})`}
                        {member.removedAt && ` (${formatDate(member.removedAt)})`}
                      </td>
                      <td className="py-2">
                        {canRemove && member.status === 'ACTIVE' && !member.isOwner && !isMe && (
                          <>
                            {expelling === member.userId ? (
                              <div
                                className="flex flex-col gap-2"
                                role="group"
                                aria-label={`Expulsar a ${name}`}
                              >
                                <p className="font-medium">¿Expulsar a {name}?</p>
                                <label className="flex flex-col gap-1">
                                  Motivo (opcional)
                                  <input
                                    value={reason}
                                    maxLength={500}
                                    onChange={(event) => setReason(event.target.value)}
                                    className={inputClass}
                                  />
                                </label>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    className={btnDanger}
                                    disabled={busyId === member.userId}
                                    onClick={() => void expel(member)}
                                  >
                                    Confirmar
                                  </button>
                                  <button
                                    type="button"
                                    className={btn}
                                    onClick={() => {
                                      setExpelling(null);
                                      setReason('');
                                    }}
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className={btn}
                                aria-label={`Expulsar a ${name}`}
                                onClick={() => {
                                  setExpelling(member.userId);
                                  setReason('');
                                }}
                              >
                                Expulsar
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!canManage && (
          <p className="text-xs text-slate-500">
            Los correos y el historial de quienes salieron solo los ve quien gestiona los roles.
          </p>
        )}
      </Section>

      {can('invitations.view') && <InvitationsPanel roles={roles.data ?? []} />}
    </>
  );
}

function RoleSelect({
  member,
  name,
  roles,
  disabled,
  onChange,
}: {
  member: MemberSummary;
  name: string;
  roles: AssignableRole[];
  disabled: boolean;
  onChange: (roleId: string) => void;
}) {
  // El rol actual siempre aparece, aunque la persona no pueda volver a asignarlo.
  const known = roles.some((role) => role.id === member.roleId);
  return (
    <select
      aria-label={`Rol de ${name}`}
      value={member.roleId}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="rounded border border-slate-300 px-2 py-1"
    >
      {!known && (
        <option value={member.roleId} disabled>
          {roleLabel(member.roleKey, member.roleName)}
        </option>
      )}
      {roles.map((role) => (
        <option key={role.id} value={role.id}>
          {roleLabel(role.key, role.name)}
        </option>
      ))}
    </select>
  );
}
