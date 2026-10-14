import { z } from 'zod';
import { deriveEffectiveOdds, multiplyOdds, type OddsString } from './odds.js';

/**
 * Tickets e IA (§28-§31, §51-§53, §90, §97, §110). El ticket es una entrada no confiable
 * (§97): la IA propone, el humano confirma, el backend valida y recién entonces se registra
 * (regla crítica de dominio). La IA nunca escribe una apuesta directamente (§110.3).
 */
export const TICKET_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type TicketMimeType = (typeof TICKET_MIME_TYPES)[number];

/** D-T3: 10 MB por archivo. */
export const TICKET_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const TICKET_ANALYSIS_STATUSES = ['COMPLETED', 'FAILED'] as const;
export type TicketAnalysisStatus = (typeof TICKET_ANALYSIS_STATUSES)[number];

/**
 * Contrato conceptual de lectura de ticket (§53), devuelto por `TicketReader.analyze()`. Todos
 * los campos son opcionales: la IA extrae lo que puede leer, nunca inventa lo que no ve.
 */
/**
 * Condición interna de un leg creado (Bet Builder / Same Game Parlay / apuestas construidas, de
 * cualquier casa — la estructura visual, no el nombre). Sin cuota propia: la cuota es del LEG.
 */
export interface TicketExtractionCondition {
  market?: string;
  selection?: string;
  /** Estado individual que el ticket muestra para esta condición (documental). */
  conditionStatus?: string;
}
/**
 * Un LEG del ticket (apuesta principal): lo que la casa cuenta como "una apuesta" de la
 * combinada. Sin `conditions` es un leg normal (`market` + `selection`). Con `conditions` (2 o
 * más) es un leg creado: `market` es solo el nombre del bloque, `selection` no se usa y la
 * `visibleOdds` es la del leg ENTERO, una sola vez.
 */
export interface TicketExtractionSelection {
  sport?: string;
  event?: string;
  market?: string;
  selection?: string;
  visibleOdds?: string;
  /** Marcador visible del evento (documental). */
  legScore?: string;
  /** Resultado individual visible del leg (documental): WON, LOST, VOID o PENDING. */
  legResult?: string;
  conditions?: TicketExtractionCondition[];
}
export interface TicketExtraction {
  house?: string;
  placedDate?: string;
  placedTime?: string;
  betType?: string;
  /** Referencia/código que la casa imprime en el ticket (documental). */
  externalReference?: string;
  selections?: TicketExtractionSelection[];
  /** Stake (nivel de apuesta) solo si el ticket lo muestra explícitamente; nunca derivado del importe. */
  stake?: string;
  /**
   * Cuota TOTAL/combinada tal como la imprime la casa ("cuota visible", regla crítica 6): se
   * conserva exactamente, nunca se sustituye por una calculada (Fase 10.8, §6, §10-§11).
   */
  officialTotalOdds?: string;
  /** Importe apostado (el dinero puesto en juego), nunca el stake (un multiplicador, §12). */
  officialAmount?: string;
  /**
   * Retorno TOTAL potencial de una apuesta aún pendiente, tal como lo muestra la casa (incluye el
   * importe apostado, no es ganancia neta). En Betano corresponde a "Ganancias potenciales"
   * (Fase 10.8, §8). `calculada a partir del retorno potencial` ≠ retorno oficial: la apuesta
   * sigue pendiente, nunca se presenta como un resultado confirmado.
   */
  officialPotentialReturn?: string;
  /**
   * Retorno TOTAL (pago total) de una apuesta ya resuelta, tal como lo muestra la casa — **nunca
   * la ganancia neta** (Fase 10.8, §7). En Betano, el campo "Ganancias" de un ticket Ganado es
   * este pago total (importe + ganancia); LetFer calcula la ganancia neta como
   * `officialRealizedReturn − officialAmount`, nunca al revés. Una apuesta perdida no tiene
   * retorno: se deja ausente, nunca `0` inventado por la IA (lo decide `result`, §9).
   */
  officialRealizedReturn?: string;
  result?: string;
}

/** Confianza por campo (D-T6), 0-1; solo para ayudar la revisión humana, nunca decide nada. */
export type TicketConfidenceByField = Record<string, number>;

/** De dónde sale una cuota efectiva calculada (Fase 10.8, §10): solo para rotular, nunca decide nada. */
export const TICKET_EFFECTIVE_ODDS_SOURCES = [
  'REALIZED_RETURN',
  'POTENTIAL_RETURN',
  'SELECTIONS_PRODUCT',
] as const;
export type TicketEffectiveOddsSource = (typeof TICKET_EFFECTIVE_ODDS_SOURCES)[number];

export interface TicketOddsSummary {
  /** Cuota visible de la casa, exactamente como la mostró (`officialTotalOdds`); `null` si no hay. */
  visible: OddsString | null;
  /** Cuota calculada, solo de referencia (regla crítica 6); nunca sustituye a `visible`. */
  effective: { value: OddsString; source: TicketEffectiveOddsSource } | null;
}

/**
 * Jerarquía de fuentes para "la cuota" de un ticket (Fase 10.8, §10-§11): 1) retorno real ÷
 * importe (apuesta liquidada); 2) retorno potencial ÷ importe (apuesta pendiente); 3) cuota total
 * explícita (ya es `visible`, no necesita calcularse); 4) producto de las cuotas individuales,
 * solo si no hay ninguna de las anteriores (referencia, nunca oficial). Nunca sustituye la cuota
 * visible por una calculada (regla crítica 6): ambas se devuelven por separado, para que quien
 * muestre el resultado pueda presentar las dos sin ocultar ninguna.
 */
export function resolveTicketOdds(input: {
  officialTotalOdds?: string;
  officialAmount?: string;
  officialRealizedReturn?: string;
  officialPotentialReturn?: string;
  individualOdds?: readonly string[];
}): TicketOddsSummary {
  const visible = input.officialTotalOdds ?? null;
  const amount = input.officialAmount;

  const realized =
    amount && input.officialRealizedReturn
      ? deriveEffectiveOdds(input.officialRealizedReturn, amount)
      : null;
  if (realized) return { visible, effective: { value: realized, source: 'REALIZED_RETURN' } };

  const potential =
    amount && input.officialPotentialReturn
      ? deriveEffectiveOdds(input.officialPotentialReturn, amount)
      : null;
  if (potential) return { visible, effective: { value: potential, source: 'POTENTIAL_RETURN' } };

  if (visible) return { visible, effective: null };

  const product = input.individualOdds ? multiplyOdds(input.individualOdds) : null;
  if (product)
    return { visible: null, effective: { value: product, source: 'SELECTIONS_PRODUCT' } };

  return { visible: null, effective: null };
}

export interface TicketAnalysisSummary {
  id: string;
  ticketId: string;
  /** Posición secuencial dentro del ticket (1º, 2º análisis...), no una fecha (§30). */
  version: number;
  status: TicketAnalysisStatus;
  provider: string;
  model: string;
  extraction: TicketExtraction;
  confidenceByField: TicketConfidenceByField | null;
  errorMessage: string | null;
  analyzedBy: { id: string; name: string };
  analyzedAt: string;
}

export interface TicketSummary {
  id: string;
  projectId: string;
  betId: string | null;
  originalFileName: string;
  mimeType: TicketMimeType;
  sizeBytes: number;
  uploadedBy: { id: string; name: string };
  createdAt: string;
  /** Último análisis conocido, para no tener que pedir el histórico completo en las listas. */
  lastAnalysis: TicketAnalysisSummary | null;
}

/** Cuerpo textual esperado junto al archivo multipart al subir un ticket. */
export const uploadTicketSchema = z.object({
  betId: z.uuid().optional(),
});
export type UploadTicketInput = z.infer<typeof uploadTicketSchema>;

/**
 * Vincula un ticket ya subido a una apuesta al crearla/editarla (§110.3): se añade a
 * `createBetSchema`/`updateBetSchema` (`bet.ts`). No hay un endpoint "aplicar" — el propio
 * formulario de apuesta hace el merge campo a campo (D-T5) en el cliente y envía el resultado a
 * `POST/PATCH .../bets` de siempre; la IA nunca tiene su propio camino de escritura (§110.3).
 */
export const ticketIdSchema = z.uuid();
