import type { PermissionCode, ProjectDetail } from '@letfer/shared';
import { useOutletContext } from 'react-router';

/** Lo que el diseño del proyecto comparte con sus pantallas (resumen, miembros, configuración). */
export interface ProjectContextValue {
  project: ProjectDetail;
  /** Sustituye el proyecto cargado (p. ej. tras guardar, cerrar o reabrir). */
  setProject: (project: ProjectDetail) => void;
  reload: () => void;
  /** ¿Tiene la persona este permiso en el proyecto? Solo mejora la interfaz: manda la API. */
  can: (permission: PermissionCode) => boolean;
}

export function useProject(): ProjectContextValue {
  return useOutletContext<ProjectContextValue>();
}
