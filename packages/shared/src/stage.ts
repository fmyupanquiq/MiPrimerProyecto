import { z } from 'zod';
import { moneyInputSchema, type MoneyString } from './money.js';

/**
 * Estados de una etapa (§86). Como máximo una `ACTIVE` por proyecto. Solo se envía a la
 * papelera una etapa `CLOSED` (nunca la activa): así siempre queda claro a qué estado
 * vuelve al restaurarla, sin necesitar guardar un "estado anterior" como en los proyectos.
 */
export const STAGE_STATUSES = ['ACTIVE', 'CLOSED', 'TRASHED'] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const STAGE_NAME_MAX_LENGTH = 100;

/** Nombre por defecto de la etapa según su posición (1, 2, 3…), si no se personaliza (§11). */
export const defaultStageName = (position: number): string => `Etapa ${position}`;

const stageNameSchema = z.string().trim().min(1).max(STAGE_NAME_MAX_LENGTH);

/** Crea/activa una nueva etapa: cierra la anterior de forma transaccional (§86). */
export const createStageSchema = z.object({
  name: stageNameSchema.optional(),
  unitStake: moneyInputSchema({ positive: true }),
});
export type CreateStageInput = z.infer<typeof createStageSchema>;

/**
 * Corrige la unidad de una etapa (§12.1, §73). Antes de confirmar, la API devuelve una
 * vista previa (`StageUnitCorrectionPreview`); `confirm: true` aplica el cambio.
 */
export const correctStageUnitSchema = z.object({
  unitStake: moneyInputSchema({ positive: true }),
  confirm: z.boolean().default(false),
});
export type CorrectStageUnitInput = z.infer<typeof correctStageUnitSchema>;

/**
 * Sin filtro: todo lo visible salvo la papelera (activa + cerradas). `TRASHED` exige poder
 * restaurar etapas (solo quien administra el proyecto, §88).
 */
export const listStagesQuerySchema = z.object({ status: z.enum(STAGE_STATUSES).optional() });
export type ListStagesQuery = z.infer<typeof listStagesQuerySchema>;

export interface StageSummary {
  id: string;
  projectId: string;
  name: string;
  unitStake: MoneyString;
  status: StageStatus;
  createdAt: string;
  deletedAt: string | null;
  purgeEligibleAt: string | null;
  version: number;
}

/**
 * Vista previa de una corrección de unidad (§12.1): unidad actual, nueva, apuestas afectadas
 * (siempre 0 mientras no existan apuestas, Fase 4) e impacto previsto.
 */
export interface StageUnitCorrectionPreview {
  currentUnitStake: MoneyString;
  newUnitStake: MoneyString;
  affectedBets: number;
  impact: string;
}
