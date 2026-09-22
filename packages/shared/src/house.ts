import { z } from 'zod';
import type { MoneyString } from './money.js';

/**
 * Estados de una casa de apuestas (§13). No hay papelera propia: nunca se elimina
 * físicamente (integridad financiera), solo se desactiva (y puede reactivarse).
 */
export const HOUSE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type HouseStatus = (typeof HOUSE_STATUSES)[number];

export const HOUSE_NAME_MAX_LENGTH = 100;

export const houseNameSchema = z.string().trim().min(1).max(HOUSE_NAME_MAX_LENGTH);

/** Añade una casa (§13). Catálogo libre por proyecto (D7): cualquier nombre, sin catálogo global. */
export const createHouseSchema = z.object({ name: houseNameSchema });
export type CreateHouseInput = z.infer<typeof createHouseSchema>;

export interface HouseSummary {
  id: string;
  projectId: string;
  name: string;
  status: HouseStatus;
  /** Reconstruido desde el ledger en cada consulta (D3): nunca es una segunda fuente de verdad. */
  balance: MoneyString;
  /** Comprometido en retiros pendientes de esta casa (§17, §92; los de apuestas llegan en la Fase 4). */
  committed: MoneyString;
  /** `balance - committed`; nunca negativo (§17). */
  available: MoneyString;
  createdAt: string;
}
