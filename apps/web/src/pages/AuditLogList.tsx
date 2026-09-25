import type { AuditLogEntry, AuditLogPage } from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import type { AuditQuery } from '../api/audit.js';
import { describeApiError } from '../api/errors.js';
import { useLoad } from '../hooks/useLoad.js';
import { formatDateTime } from '../labels.js';
import { btn, btnPrimary, inputClass, Notice } from '../ui.js';

interface Filters {
  action: string;
  entityType: string;
  from: string;
  to: string;
}

const NO_FILTERS: Filters = { action: '', entityType: '', from: '', to: '' };

/** Convierte una fecha de calendario local en el inicio o el fin de ese día (ISO 8601). */
function dayBoundary(date: string, edge: 'start' | 'end'): string | undefined {
  if (!date) return undefined;
  const local = new Date(`${date}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}`);
  return Number.isNaN(local.getTime()) ? undefined : local.toISOString();
}

function toQuery(filters: Filters): AuditQuery {
  return {
    action: filters.action.trim() || undefined,
    entityType: filters.entityType.trim() || undefined,
    from: dayBoundary(filters.from, 'start'),
    to: dayBoundary(filters.to, 'end'),
  };
}

function JsonBlock({ label, value }: { label: string; value: Record<string, unknown> | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <pre className="overflow-x-auto rounded bg-slate-100 p-2 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function AuditRow({ entry, showProject }: { entry: AuditLogEntry; showProject: boolean }) {
  return (
    <li className="rounded border border-slate-200 bg-white p-3">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span className="text-slate-500">{formatDateTime(entry.occurredAt)}</span>
          <code className="font-medium">{entry.action}</code>
          <span className="text-slate-600">{entry.actor ? entry.actor.name : 'Sistema'}</span>
        </summary>
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <p>
            <span className="text-slate-500">Registro afectado:</span> {entry.entityType}
            {entry.entityId ? ` (${entry.entityId})` : ''}
          </p>
          {showProject && (
            <p>
              <span className="text-slate-500">Proyecto:</span> {entry.projectId ?? 'ninguno'}
            </p>
          )}
          <JsonBlock label="Valor anterior" value={entry.oldValues} />
          <JsonBlock label="Valor nuevo" value={entry.newValues} />
          <JsonBlock label="Detalles" value={entry.metadata} />
          <p className="text-xs text-slate-500">
            {[
              entry.ip && `IP ${entry.ip}`,
              entry.userAgent,
              entry.requestId && `petición ${entry.requestId}`,
            ]
              .filter(Boolean)
              .join(' · ') || 'Sin datos de la conexión.'}
          </p>
        </div>
      </details>
    </li>
  );
}

/**
 * Lista de auditoría con filtros y "Cargar más" (§10, §35, §111.1). Solo lectura. `queryKey`
 * identifica lo que se consulta (proyecto o ámbito): al cambiar, vuelve a empezar por la primera
 * página.
 */
export function AuditLogList({
  queryKey,
  loadPage,
  showProject = false,
}: {
  queryKey: string;
  loadPage: (query: AuditQuery) => Promise<AuditLogPage>;
  showProject?: boolean;
}) {
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);
  // Las páginas siguientes se acumulan aparte; solo valen para la consulta (clave) que las pidió.
  const [more, setMore] = useState<{
    key: string;
    items: AuditLogEntry[];
    nextCursor: string | null;
  } | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const key = `${queryKey}|${JSON.stringify(applied)}`;
  const first = useLoad(key, () => loadPage(toQuery(applied)));
  const extra = more?.key === key ? more : null;
  const items = [...(first.data?.items ?? []), ...(extra?.items ?? [])];
  const nextCursor = extra ? extra.nextCursor : (first.data?.nextCursor ?? null);
  const loading = (first.loading && !first.data) || moreLoading;
  const error = first.error ?? moreError;

  async function loadMore() {
    if (!nextCursor) return;
    setMoreLoading(true);
    setMoreError(null);
    try {
      const page = await loadPage({ ...toQuery(applied), cursor: nextCursor });
      setMore({
        key,
        items: [...(extra?.items ?? []), ...page.items],
        nextCursor: page.nextCursor,
      });
    } catch (caught) {
      setMoreError(describeApiError(caught));
    } finally {
      setMoreLoading(false);
    }
  }

  function apply(event: FormEvent) {
    event.preventDefault();
    setApplied(draft);
  }

  const field = (name: keyof Filters, label: string, type = 'text') => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        type={type}
        className={inputClass}
        value={draft[name]}
        onChange={(event) => setDraft({ ...draft, [name]: event.target.value })}
      />
    </label>
  );

  return (
    <>
      <form onSubmit={apply} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {field('action', 'Acción (p. ej. bet.)')}
        {field('entityType', 'Tipo de registro')}
        {field('from', 'Desde', 'date')}
        {field('to', 'Hasta', 'date')}
        <div className="flex items-end gap-2">
          <button type="submit" className={btnPrimary}>
            Filtrar
          </button>
          <button
            type="button"
            className={btn}
            onClick={() => {
              setDraft(NO_FILTERS);
              setApplied(NO_FILTERS);
            }}
          >
            Limpiar
          </button>
        </div>
      </form>

      {error && <Notice tone="error">{error}</Notice>}
      {!error && !loading && items.length === 0 && (
        <Notice tone="info">No hay registros de auditoría con esos filtros.</Notice>
      )}

      <ul className="flex flex-col gap-2" aria-label="Registros de auditoría">
        {items.map((entry) => (
          <AuditRow key={entry.id} entry={entry} showProject={showProject} />
        ))}
      </ul>
      {loading && <p className="text-sm text-slate-500">Cargando…</p>}
      {nextCursor && !loading && (
        <div>
          <button type="button" className={btn} onClick={() => void loadMore()}>
            Cargar más
          </button>
        </div>
      )}
    </>
  );
}
