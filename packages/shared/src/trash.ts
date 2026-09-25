/** Tipos de elemento que puede contener la papelera de un proyecto (§36, §111.2). */
export const TRASH_ITEM_KINDS = ['BET', 'STAGE'] as const;
export type TrashItemKind = (typeof TRASH_ITEM_KINDS)[number];

/**
 * Elemento de la papelera de un proyecto. `purgeEligible` es informativo (§89): pasada la
 * retención el registro solo queda "elegible para purga"; en la Fase 8 nunca se purga (D8-3).
 */
export interface TrashItem {
  kind: TrashItemKind;
  id: string;
  /** Texto para reconocerlo (evento y selección de una apuesta; nombre de una etapa). */
  label: string;
  /** Contexto adicional (casa y stake de una apuesta; unidad de una etapa). */
  detail: string | null;
  deletedAt: string;
  deletedBy: { id: string; name: string } | null;
  deletionReason: string | null;
  purgeEligibleAt: string;
  /** `true` si la fecha de elegibilidad ya pasó. */
  purgeEligible: boolean;
}
