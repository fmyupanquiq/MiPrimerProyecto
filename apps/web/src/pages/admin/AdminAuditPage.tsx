import { useState } from 'react';
import { adminAuditApi } from '../../api/audit.js';
import { useAuth } from '../../auth/AuthContext.js';
import { inputClass, Notice, Section } from '../../ui.js';
import { AuditLogList } from '../AuditLogList.js';

type Scope = 'all' | 'system';

/** Auditoría de todo el sistema (§111.1): Administrador Global, solo lectura. */
export function AdminAuditPage() {
  const { can } = useAuth();
  const [scope, setScope] = useState<Scope>('all');
  if (!can('system.audit.view')) {
    return <Notice tone="info">No tienes permiso para ver la auditoría del sistema.</Notice>;
  }
  return (
    <Section title="Auditoría del sistema">
      <p className="text-sm text-slate-600">
        Todas las acciones registradas, de cualquier proyecto. No se puede editar ni eliminar.
      </p>
      <label className="flex max-w-xs flex-col gap-1 text-sm">
        Ámbito
        <select
          className={inputClass}
          value={scope}
          onChange={(event) => setScope(event.target.value as Scope)}
        >
          <option value="all">Todo el sistema</option>
          <option value="system">Solo acciones sin proyecto (cuentas, sesiones, sistema)</option>
        </select>
      </label>
      <AuditLogList
        queryKey={`admin:${scope}`}
        showProject
        loadPage={(query) =>
          adminAuditApi.list({ ...query, system: scope === 'system' ? true : undefined })
        }
      />
    </Section>
  );
}
