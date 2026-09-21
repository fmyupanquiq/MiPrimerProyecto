import {
  createInvitationSchema,
  DEFAULT_INVITATION_EXPIRY,
  INVITATION_EXPIRIES,
  type AssignableRole,
  type CreatedInvitation,
  type InvitationExpiry,
} from '@letfer/shared';
import { type FormEvent, useRef, useState } from 'react';
import { describeApiError } from '../../api/errors.js';
import { invitationsApi } from '../../api/projects.js';
import { useLoad } from '../../hooks/useLoad.js';
import { EXPIRY_LABELS, formatDateTime, roleLabel } from '../../labels.js';
import {
  btn,
  btnDanger,
  btnPrimary,
  inputClass,
  InvitationStatusBadge,
  Notice,
  Section,
} from '../../ui.js';
import { useProject } from './ProjectContext.js';

/** Invitaciones del proyecto (§84, §105.7): crear (el enlace se muestra una sola vez), listar y deshabilitar. */
export function InvitationsPanel({ roles }: { roles: AssignableRole[] }) {
  const { project, can } = useProject();
  const invitations = useLoad(`invitations:${project.id}`, () => invitationsApi.list(project.id));
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function disable(invitationId: string) {
    setBusy(true);
    setError(null);
    try {
      await invitationsApi.disable(project.id, invitationId);
      setDisabling(null);
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setBusy(false);
      invitations.reload();
    }
  }

  return (
    <Section title="Invitaciones">
      {can('invitations.create') &&
        (project.status === 'ACTIVE' ? (
          <NewInvitationForm
            roles={roles}
            onCreated={(invitation) => {
              setCreated(invitation);
              invitations.reload();
            }}
          />
        ) : (
          <Notice tone="info">Solo se pueden crear invitaciones en un proyecto activo.</Notice>
        ))}

      {created && <CreatedLink invitation={created} onDismiss={() => setCreated(null)} />}

      {error && <Notice tone="error">{error}</Notice>}
      {invitations.error && <Notice tone="error">{invitations.error}</Notice>}
      {invitations.loading && !invitations.data && <p>Cargando invitaciones…</p>}
      {invitations.data && invitations.data.length === 0 && (
        <Notice tone="info">Todavía no hay invitaciones.</Notice>
      )}
      {invitations.data && invitations.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-label="Invitaciones">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-3 font-medium">Rol</th>
                <th className="py-2 pr-3 font-medium">Estado</th>
                <th className="py-2 pr-3 font-medium">Uso</th>
                <th className="py-2 pr-3 font-medium">Vence</th>
                <th className="py-2 pr-3 font-medium">Correo</th>
                <th className="py-2 pr-3 font-medium">Creada por</th>
                <th className="py-2 pr-3 font-medium">Ingresaron</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invitations.data.map((invitation) => (
                <tr key={invitation.id} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-3">
                    {roleLabel(invitation.roleKey, invitation.roleName)}
                  </td>
                  <td className="py-2 pr-3">
                    <InvitationStatusBadge status={invitation.status} />
                  </td>
                  <td className="py-2 pr-3">
                    {invitation.singleUse ? 'Un solo uso' : 'Reutilizable'}
                  </td>
                  <td className="py-2 pr-3">
                    {invitation.expiresAt
                      ? formatDateTime(invitation.expiresAt)
                      : 'Sin vencimiento'}
                  </td>
                  <td className="py-2 pr-3">{invitation.restrictedEmail ?? 'Cualquiera'}</td>
                  <td className="py-2 pr-3">
                    {invitation.createdBy.name}
                    <br />
                    <span className="text-xs text-slate-500">
                      {formatDateTime(invitation.createdAt)}
                    </span>
                  </td>
                  <td className="py-2 pr-3">{invitation.acceptedCount}</td>
                  <td className="py-2">
                    {invitation.status === 'ACTIVE' &&
                      can('invitations.disable') &&
                      (disabling === invitation.id ? (
                        <div
                          className="flex flex-col gap-2"
                          role="group"
                          aria-label="Deshabilitar invitación"
                        >
                          <p className="font-medium">
                            ¿Deshabilitar esta invitación? No se puede deshacer.
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className={btnDanger}
                              disabled={busy}
                              onClick={() => void disable(invitation.id)}
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              className={btn}
                              onClick={() => setDisabling(null)}
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={btn}
                          onClick={() => setDisabling(invitation.id)}
                          aria-label={`Deshabilitar invitación de ${roleLabel(invitation.roleKey, invitation.roleName)} creada ${formatDateTime(invitation.createdAt)}`}
                        >
                          Deshabilitar
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function NewInvitationForm({
  roles,
  onCreated,
}: {
  roles: AssignableRole[];
  onCreated: (invitation: CreatedInvitation) => void;
}) {
  const { project } = useProject();
  // Por defecto, el rol más restrictivo: Lector, si la persona puede asignarlo.
  const defaultRole = roles.find((role) => role.key === 'READER') ?? roles[0];
  const [chosenRole, setChosenRole] = useState('');
  const [expiry, setExpiry] = useState<InvitationExpiry>(DEFAULT_INVITATION_EXPIRY);
  const [singleUse, setSingleUse] = useState(true);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const roleId = chosenRole || defaultRole?.id || '';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = createInvitationSchema.safeParse({
      roleId,
      expiry,
      singleUse,
      restrictedEmail: email.trim() === '' ? null : email,
    });
    if (!parsed.success) {
      setError(
        roleId === ''
          ? 'Elige el rol con el que ingresará la persona.'
          : 'Revisa el correo indicado: no es una dirección válida.',
      );
      return;
    }
    setSubmitting(true);
    try {
      onCreated(await invitationsApi.create(project.id, parsed.data));
      setEmail('');
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-3 rounded border border-slate-200 p-3"
      aria-label="Nueva invitación"
      noValidate
    >
      <h3 className="font-medium">Nueva invitación</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Rol al ingresar
          <select
            value={roleId}
            onChange={(event) => setChosenRole(event.target.value)}
            className={inputClass}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {roleLabel(role.key, role.name)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Vencimiento
          <select
            value={expiry}
            onChange={(event) => setExpiry(event.target.value as InvitationExpiry)}
            className={inputClass}
          >
            {INVITATION_EXPIRIES.map((value) => (
              <option key={value} value={value}>
                {EXPIRY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={singleUse}
          onChange={(event) => setSingleUse(event.target.checked)}
        />
        Un solo uso (si lo desmarcas, el enlace podrá usarlo más de una persona)
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Restringir a un correo (opcional)
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputClass}
          placeholder="persona@ejemplo.com"
        />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div>
        <button type="submit" disabled={submitting || roleId === ''} className={btnPrimary}>
          {submitting ? 'Creando…' : 'Crear invitación'}
        </button>
      </div>
    </form>
  );
}

/**
 * Enlace recién creado. Solo se conoce en este momento: en la base de datos queda únicamente su
 * hash, así que no volverá a mostrarse (§105.7).
 */
function CreatedLink({
  invitation,
  onDismiss,
}: {
  invitation: CreatedInvitation;
  onDismiss: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<'yes' | 'manual' | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(invitation.link);
      setCopied('yes');
    } catch {
      // Sin acceso al portapapeles (p. ej. sin HTTPS): se deja el enlace seleccionado.
      input.current?.select();
      setCopied('manual');
    }
  }

  return (
    <section
      aria-label="Enlace de invitación"
      className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3"
    >
      <p className="font-medium">Invitación creada</p>
      <p className="text-sm">
        Copia el enlace ahora y envíaselo a la persona. <strong>Se muestra una sola vez</strong>:
        por seguridad no se guarda y no podrá volver a consultarse. Si lo pierdes, crea otra
        invitación.
      </p>
      <input
        ref={input}
        readOnly
        value={invitation.link}
        aria-label="Enlace de invitación"
        onFocus={(event) => event.target.select()}
        className={`${inputClass} font-mono text-xs`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnPrimary} onClick={() => void copy()}>
          Copiar enlace
        </button>
        <button type="button" className={btn} onClick={onDismiss}>
          Ya lo copié
        </button>
        {copied === 'yes' && (
          <span role="status" className="text-sm">
            Enlace copiado.
          </span>
        )}
        {copied === 'manual' && (
          <span role="status" className="text-sm">
            No se pudo copiar automáticamente: el enlace quedó seleccionado, cópialo con Ctrl+C.
          </span>
        )}
      </div>
    </section>
  );
}
