import { DATE_FORMAT_LABELS, formatDate, roleLabel } from '../../labels.js';
import { Section } from '../../ui.js';
import { useProject } from './ProjectContext.js';

/** Resumen del proyecto. El tablero financiero llega con las fases siguientes. */
export function DashboardPage() {
  const { project } = useProject();
  return (
    <>
      <Section title="Resumen">
        {project.description ? (
          <p className="whitespace-pre-line">{project.description}</p>
        ) : (
          <p className="text-slate-500">Este proyecto todavía no tiene descripción.</p>
        )}
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Propietario</dt>
            <dd>{project.ownerName}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Tu rol</dt>
            <dd>
              {project.isOwner && 'Propietario · '}
              {project.myRole ? roleLabel(project.myRole) : 'Acceso como administrador global'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Moneda</dt>
            <dd>{project.currency}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Zona horaria</dt>
            <dd>{project.timezone}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Formato de fecha</dt>
            <dd>{DATE_FORMAT_LABELS[project.dateFormat]}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Creado</dt>
            <dd>{formatDate(project.createdAt)}</dd>
          </div>
        </dl>
      </Section>
      <p className="text-sm text-slate-500">
        Las etapas, la banca, las casas de apuestas y las apuestas se configuran en las fases
        siguientes.
      </p>
    </>
  );
}
