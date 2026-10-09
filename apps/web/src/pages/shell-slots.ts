import { createContext, useContext } from 'react';

/**
 * Huecos del marco de la aplicación (Fase 10.3): la barra lateral y la superior los pone
 * `AppShell`, y quien conoce el contenido (p. ej. `ProjectLayout`, con el proyecto y sus permisos
 * ya cargados) lo pinta ahí con un portal. Así no se carga el proyecto dos veces.
 */
export interface ShellSlots {
  sidebar: HTMLElement | null;
  topbar: HTMLElement | null;
}

export const ShellSlotsContext = createContext<ShellSlots>({ sidebar: null, topbar: null });

export const useShellSlots = () => useContext(ShellSlotsContext);
