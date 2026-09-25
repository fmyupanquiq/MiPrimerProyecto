import type { TrashItem } from '@letfer/shared';
import { useState } from 'react';
import { betsApi } from '../../api/bets.js';
import { describeApiError } from '../../api/errors.js';
import { stagesApi } from '../../api/finance.js';
import { trashApi } from '../../api/trash.js';
import { useLoad } from '../../hooks/useLoad.js';
import { formatDate } from '../../labels.js';
import { Badge, btnPrimary, Notice, Section } from '../../ui.js';
import { SettledTrashPanel } from './BetFinancialPanels.js';
import { useProject } from './ProjectContext.js';

const KIND_LABELS: Record<TrashItem['kind'], string> = { BET: 'Apuesta', STAGE: 'Etapa' };

/**
 * Papelera del proyecto (§36, §111.2): apuestas y etapas eliminadas. Restaurar usa las mismas
 * acciones que ya existían (la API valida `bets.restore` / `stages.restore`). Nada se purga:
 * "elegible para purga" es solo informativo (§89, D8-3).
 */
export function ProjectTrashPage() {
  const { project, can } = useProject();
  const allowed = can('bets.restore') || can('stages.restore');
  const items = useLoad(`trash:${project.id}`, () =>
    allowed ? trashApi.list(project.id) : Promise.resolve([] as TrashItem[]),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  // Una apuesta que estaba liquidada se restaura con motivo y contraseña (D-A11).
  const [restoringSettled, setRestoringSettled] = useState<TrashItem | null>(null);

  if (!allowed) {
    return <Notice tone="info">No tienes permiso para ver la papelera de este proyecto.</Notice>;
  }

  async function restore(item: TrashItem) {
    if (item.kind === 'BET' && item.settled) {
      setRestoringSettled(item);
      return;
    }
    setBusyId(item.id);
    setError(null);
    setRestored(null);
    try {
      if (item.kind === 'BET') await betsApi.restore(project.id, item.id);
      else await stagesApi.restore(project.id, item.id);
      setRestored(item.label);
      items.reload();
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setBusyId(null);
    }
  }

  const canRestore = (item: TrashItem) =>
    item.kind === 'BET'
      ? can('bets.restore') && (!item.settled || can('bets.correct'))
      : can('stages.restore');

  return (
    <Section title="Papelera del proyecto">
      <p className="text-sm text-slate-600">
        Las apuestas y etapas eliminadas se conservan al menos 90 días y se pueden restaurar. Pasado
        ese plazo quedan elegibles para purga, pero no se eliminan automáticamente.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {restored && <Notice tone="success">«{restored}» se restauró correctamente.</Notice>}
      {items.error && <Notice tone="error">{items.error}</Notice>}
      {items.loading && !items.data && <p>Cargando papelera…</p>}
      {items.data && items.data.length === 0 && (
        <Notice tone="info">La papelera está vacía.</Notice>
      )}
      <ul className="flex flex-col gap-3" aria-label="Elementos en la papelera">
        {items.data?.map((item) => (
          <li
            key={`${item.kind}:${item.id}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 bg-white p-4"
          >
            <div className="flex flex-col gap-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <Badge tone="slate">{KIND_LABELS[item.kind]}</Badge>
                {item.label}
                {item.purgeEligible && <Badge tone="amber">Elegible para purga</Badge>}
              </p>
              {item.detail && <p className="text-sm text-slate-600">{item.detail}</p>}
              <p className="text-xs text-slate-500">
                Eliminada el {formatDate(item.deletedAt)}
                {item.deletedBy && ` por ${item.deletedBy.name}`}
                {item.deletionReason && ` · Motivo: ${item.deletionReason}`}
                {` · Restaurable como mínimo hasta el ${formatDate(item.purgeEligibleAt)}`}
              </p>
            </div>
            {restoringSettled?.id === item.id && (
              <div className="w-full">
                <SettledTrashPanel
                  action="restore"
                  label={item.label}
                  onSubmit={async (reason) => {
                    await betsApi.restore(project.id, item.id, { reason });
                    setRestored(item.label);
                    setRestoringSettled(null);
                    items.reload();
                  }}
                  onCancel={() => setRestoringSettled(null)}
                />
              </div>
            )}
            {canRestore(item) && restoringSettled?.id !== item.id && (
              <button
                type="button"
                className={btnPrimary}
                disabled={busyId === item.id}
                onClick={() => void restore(item)}
                aria-label={`Restaurar ${item.label}`}
              >
                {busyId === item.id ? 'Restaurando…' : 'Restaurar'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
