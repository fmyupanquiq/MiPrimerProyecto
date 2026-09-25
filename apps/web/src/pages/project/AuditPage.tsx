import { auditApi } from '../../api/audit.js';
import { Notice, Section } from '../../ui.js';
import { AuditLogList } from '../AuditLogList.js';
import { useProject } from './ProjectContext.js';

/**
 * Auditoría del proyecto (§10, §35, §111.1): solo lectura, solo de este proyecto y solo para el
 * Administrador de Proyecto. La API valida el permiso; aquí solo se evita mostrar una pantalla vacía.
 */
export function AuditPage() {
  const { project, can } = useProject();
  if (!can('audit.view')) {
    return <Notice tone="info">No tienes permiso para ver la auditoría de este proyecto.</Notice>;
  }
  return (
    <Section title="Auditoría del proyecto">
      <p className="text-sm text-slate-600">
        Registro de las acciones relevantes de este proyecto. No se puede editar ni eliminar.
      </p>
      <AuditLogList
        queryKey={`project:${project.id}`}
        loadPage={(query) => auditApi.list(project.id, query)}
      />
    </Section>
  );
}
