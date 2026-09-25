import type {
  BackupGeneration,
  IntegrityCheckRunSummary,
  MaintenanceRunSummary,
} from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { adminIntegrityApi } from '../api/integrity.js';
import { backupsApi } from '../api/backups.js';
import { maintenanceApi } from '../api/maintenance.js';
import { describeApiError } from '../api/errors.js';
import { useAuth } from '../auth/AuthContext.js';
import { isReauthCancelled, useReauth } from '../auth/ReauthContext.js';
import { useLoad } from '../hooks/useLoad.js';
import {
  BACKUP_STATUS_LABELS,
  formatDateTime,
  INTEGRITY_CHECK_LABELS,
  INTEGRITY_CHECK_STATUS_LABELS,
  MAINTENANCE_STATUS_LABELS,
  MAINTENANCE_TRIGGER_LABELS,
} from '../labels.js';
import { Badge, btn, btnDanger, btnPrimary, inputClass, Notice, Section } from '../ui.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Administración de la instancia (§37, §38, §82, §109): backups y verificación de integridad
 * global. Exclusivo del Administrador Global (permisos `system.*`, D-I3/D-B1-D-B4/D-R1).
 */
export function AdminPage() {
  const { can } = useAuth();
  const showIntegrity = can('system.integrity.run');
  const showBackups = can('system.backups.view') || can('system.backups.create');
  const showMaintenance = can('system.maintenance.run');
  if (!showIntegrity && !showBackups && !showMaintenance) {
    return <Notice tone="info">No tienes permiso para ver esta sección.</Notice>;
  }
  return (
    <>
      {showIntegrity && <GlobalIntegritySection />}
      {showBackups && <BackupsSection />}
      {showMaintenance && <MaintenanceSection />}
    </>
  );
}

/**
 * Mantenimiento (§111.6, ADR 0018): purga de registros auxiliares caducados. Solo sesiones,
 * intentos de acceso y tokens de recuperación con más de N días de haber dejado de valer; nunca
 * datos de negocio, ledger ni auditoría. Corre a diario por sí sola y también se puede lanzar aquí.
 */
function MaintenanceSection() {
  const history = useLoad('admin-maintenance', () => maintenanceApi.runs());
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const result = await maintenanceApi.purge();
      if (result.status === 'FAILED') setError(result.errorMessage ?? 'La purga falló.');
      else setNotice(`Purga completada: ${purgedText(result.purged)}.`);
      history.reload();
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Section title="Mantenimiento">
      <p className="text-sm text-slate-500">
        Elimina sesiones, intentos de acceso y enlaces de recuperación caducados hace más de{' '}
        {history.data?.[0]?.retentionDays ?? 30} días. No toca proyectos, finanzas, invitaciones ni
        la auditoría. Se ejecuta sola una vez al día.
      </p>
      <button
        type="button"
        className={`${btnPrimary} self-start`}
        disabled={running}
        onClick={() => void run()}
      >
        {running ? 'Purgando…' : 'Purgar ahora'}
      </button>
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {history.error && <Notice tone="error">{history.error}</Notice>}
      {history.data && history.data.length === 0 && (
        <p className="text-sm text-slate-500">Todavía no se ha ejecutado ninguna purga.</p>
      )}
      {history.data && history.data.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Historial de mantenimiento">
          {history.data.map((item: MaintenanceRunSummary) => (
            <li key={item.id} className="rounded border border-slate-200 p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <Badge tone={item.status === 'COMPLETED' ? 'green' : 'red'}>
                  {MAINTENANCE_STATUS_LABELS[item.status]}
                </Badge>
                {formatDateTime(item.startedAt)} ·{' '}
                {item.runBy ? item.runBy.name : MAINTENANCE_TRIGGER_LABELS[item.trigger]}
              </p>
              <p className="text-slate-600">
                {item.status === 'FAILED' ? item.errorMessage : purgedText(item.purged)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function purgedText(purged: MaintenanceRunSummary['purged']): string {
  return `${purged.sessions} sesiones, ${purged.loginAttempts} intentos de acceso y ${purged.passwordResetTokens} enlaces de recuperación`;
}

function GlobalIntegritySection() {
  const history = useLoad('admin-integrity', () => adminIntegrityApi.list());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      await adminIntegrityApi.run();
      history.reload();
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Section title="Verificación de integridad global">
      <p className="text-sm text-slate-500">
        Solo lectura, sobre todos los proyectos (§38, §109.2, D-I3).
      </p>
      <button
        type="button"
        className={`${btnPrimary} self-start`}
        disabled={running}
        onClick={() => void run()}
      >
        {running ? 'Verificando…' : 'Verificar ahora'}
      </button>
      {error && <Notice tone="error">{error}</Notice>}
      {history.error && <Notice tone="error">{history.error}</Notice>}
      {history.data && history.data.length === 0 && (
        <p className="text-sm text-slate-500">Todavía no se ha ejecutado ninguna verificación.</p>
      )}
      {history.data && history.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {history.data.map((run: IntegrityCheckRunSummary) => (
            <li key={run.id} className="rounded border border-slate-200 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <Badge tone={run.status === 'OK' ? 'green' : 'red'}>
                  {INTEGRITY_CHECK_STATUS_LABELS[run.status]}
                </Badge>
                {formatDateTime(run.startedAt)} · {run.runBy.name}
              </p>
              {run.findings.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {run.findings.map((finding, index) => (
                    <li key={index} className="text-slate-600">
                      <strong>{INTEGRITY_CHECK_LABELS[finding.check] ?? finding.check}</strong>:{' '}
                      {finding.message} ({finding.affected.length} afectado(s))
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Backups y recuperación (§37, §82, §109.3-4). La restauración exige confirmación fuerte (D-R1). */
function BackupsSection() {
  const { can } = useAuth();
  const runWithReauth = useReauth();
  const list = useLoad('admin-backups', () => backupsApi.list());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState('');

  async function createBackup() {
    setCreating(true);
    setError(null);
    try {
      const generation = await backupsApi.create();
      setNotice(
        generation.status === 'COMPLETED'
          ? 'Backup completado.'
          : `Backup fallido: ${generation.errorMessage}`,
      );
      list.reload();
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setCreating(false);
    }
  }

  async function restore(event: FormEvent<HTMLFormElement>, generation: BackupGeneration) {
    event.preventDefault();
    setError(null);
    try {
      await runWithReauth(() => backupsApi.restore({ generationId: generation.id, confirmation }));
      setNotice(`Se restauró la generación del ${formatDateTime(generation.takenAt)}.`);
      setRestoring(null);
      setConfirmation('');
      list.reload();
    } catch (caught) {
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
    }
  }

  return (
    <Section title="Backups">
      <p className="text-sm text-slate-500">
        Volcado completo mediante <code>pg_dump</code> (D-B2). Retención de ~30 generaciones (D-B4).
        Restaurar es una operación de mantenimiento controlada, no en caliente (D-R1).
      </p>
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {can('system.backups.create') && (
        <button
          type="button"
          className={`${btnPrimary} self-start`}
          disabled={creating}
          onClick={() => void createBackup()}
        >
          {creating ? 'Generando…' : 'Backup manual ahora'}
        </button>
      )}
      {list.error && <Notice tone="error">{list.error}</Notice>}
      {list.data && list.data.length === 0 && (
        <p className="text-sm text-slate-500">Todavía no hay backups.</p>
      )}
      {list.data && list.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {list.data.map((generation: BackupGeneration) => (
            <li key={generation.id} className="rounded border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    <Badge tone={generation.status === 'COMPLETED' ? 'green' : 'red'}>
                      {BACKUP_STATUS_LABELS[generation.status]}
                    </Badge>{' '}
                    {formatDateTime(generation.takenAt)} · {generation.triggeredBy}
                  </p>
                  <p className="text-xs text-slate-500">
                    {generation.fileName} · {formatBytes(generation.sizeBytes)}
                  </p>
                  {generation.errorMessage && (
                    <p className="text-xs text-red-700">{generation.errorMessage}</p>
                  )}
                </div>
                {can('system.backups.restore') && generation.status === 'COMPLETED' && (
                  <button
                    type="button"
                    className={btn}
                    onClick={() => {
                      setRestoring(generation.id);
                      setConfirmation('');
                      setError(null);
                    }}
                  >
                    Restaurar
                  </button>
                )}
              </div>
              {restoring === generation.id && (
                <form
                  onSubmit={(event) => void restore(event, generation)}
                  className="mt-3 flex flex-col gap-2"
                  aria-label="Confirmar restauración"
                >
                  <p className="text-sm font-medium">
                    Escribe exactamente el identificador de esta generación para confirmar:{' '}
                    <code>{generation.id}</code>
                  </p>
                  <input
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    className={inputClass}
                  />
                  <div className="flex gap-2">
                    <button type="submit" className={btnDanger}>
                      Confirmar restauración
                    </button>
                    <button type="button" className={btn} onClick={() => setRestoring(null)}>
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
