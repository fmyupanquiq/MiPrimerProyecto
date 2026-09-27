import type { BetType } from '@letfer/shared';
import { deriveBetType } from '../../bets/bets.service.js';
import { noonInTimeZone } from '../../common/timezone.js';
import type { NormalizedImportBet } from '../import-types.js';
import { parseBetsafeSelections } from './betsafe-selections.js';
import {
  classifyRow,
  extractSemanticRow,
  toText,
  type RowClassification,
  type RowClassificationFinding,
} from './row-classifier.js';
import type { RawSheet } from './sheet-model.js';
import { BETSAFE_TEMPLATE } from './spreadsheet-template.js';
import { detectStageCandidates, type StageCandidate } from './stage-candidates.js';

/**
 * Normalizador de Betsafe (Fase 9.2.2, §113, ADR 0020): convierte una hoja ya leída en el modelo
 * que espera el escritor de la 9.1.5, salvo dos campos que dependen de una etapa **confirmada**
 * (D-X7, sin confirmar todavía en esta subfase): `stageKey` (a qué etapa pertenece) y `stake`
 * (`monto ÷ unidad de esa etapa`, D-X19). Por eso el resultado es "preliminar": una vista previa
 * posterior (9.3), ya con los candidatos de etapa confirmados o ajustados por una persona, complet
 * esos dos campos y recién entonces esto se convierte en un `NormalizedImportBet` real.
 *
 * No escribe nada, no crea ninguna etapa y no reutiliza ningún endpoint. Todo lo que sabe de
 * Betsafe está en `BETSAFE_TEMPLATE` y en el separador de selecciones (`betsafe-selections.ts`):
 * este archivo solo orquesta las piezas genéricas de la 9.2.1 con esas dos.
 */

/** `NormalizedImportBet` sin los dos campos que dependen de la etapa confirmada (D-X7, D-X19). */
export type PreliminaryNormalizedBet = Omit<NormalizedImportBet, 'stageKey' | 'stake'>;

export interface BetsafeRowReport {
  rowNumber: number;
  status: RowClassification;
  findings: RowClassificationFinding[];
  /** Texto exacto de la columna TIPO, tal como está en el archivo; `null` si está vacía. */
  declaredType: string | null;
  /** Tipo derivado del texto de PARTIDO (D-X24); `null` salvo en una fila `VALID`. */
  derivedType: BetType | null;
  /**
   * `true` si el tipo declarado y el derivado no coinciden (D-X24): aviso, nunca bloquea. También
   * es `true` cuando el texto declarado no está en el vocabulario esperado (p. ej. una errata).
   */
  typeMismatch: boolean;
}

export interface BetsafeNormalizationResult {
  /** Candidatos de etapa, con su evidencia; ninguno es todavía una etapa real (D-X7). */
  stageCandidates: StageCandidate[];
  /** Una por cada fila `VALID`, en el mismo orden que `rows`. */
  bets: PreliminaryNormalizedBet[];
  /** Una por cada fila de la tabla, sea o no válida: nada se pierde en silencio (D-X21). */
  rows: BetsafeRowReport[];
  counts: Record<RowClassification, number>;
}

/** Tipo declarado (columna TIPO de Betsafe) → tipo de LetFer, para comparar contra el derivado. */
const BETSAFE_DECLARED_TYPE_VOCABULARY: Readonly<Record<string, BetType>> = {
  Simple: 'SIMPLE',
  Multi: 'MULTIPLE',
  Creada: 'CREATED',
};

export function normalizeBetsafeSheet(
  sheet: RawSheet,
  options: { timeZone: string },
): BetsafeNormalizationResult {
  const template = BETSAFE_TEMPLATE;
  const dataRows = sheet.rows.filter((row) => row.rowNumber >= template.firstDataRow);
  const stageCandidates = detectStageCandidates(sheet.rows, {
    labelColumn: template.stageLabel.column,
    labelPattern: template.stageLabel.pattern,
  });

  const bets: PreliminaryNormalizedBet[] = [];
  const rows: BetsafeRowReport[] = [];
  const counts: Record<RowClassification, number> = {
    VALID: 0,
    TEMPLATE: 0,
    EMPTY: 0,
    PARTIAL: 0,
    INVALID: 0,
  };

  for (const row of dataRows) {
    const semantic = extractSemanticRow(row, template.columns);
    const classified = classifyRow(semantic, { resultVocabulary: template.resultVocabulary });
    counts[classified.status] += 1;
    const declaredType = toText(semantic.declaredType);

    if (classified.status !== 'VALID' || !classified.normalized) {
      rows.push({
        rowNumber: row.rowNumber,
        status: classified.status,
        findings: classified.findings,
        declaredType,
        derivedType: null,
        typeMismatch: false,
      });
      continue;
    }

    const { normalized } = classified;
    const selections = parseBetsafeSelections(normalized.description, normalized.sport);
    const derivedType = deriveBetType(selections);
    const declaredMapped = declaredType
      ? BETSAFE_DECLARED_TYPE_VOCABULARY[declaredType]
      : undefined;
    const typeMismatch = declaredType !== null && declaredMapped !== derivedType;

    // D-X23: solo se conoce la fecha, nunca la hora; el instante técnico es 12:00 en la zona del
    // proyecto. `normalized.date` es siempre medianoche UTC del día que escribió la persona (así
    // llega un valor de fecha de Excel): por eso se leen sus componentes en UTC, nunca en local.
    const placedAt = noonInTimeZone(
      normalized.date.getUTCFullYear(),
      normalized.date.getUTCMonth() + 1,
      normalized.date.getUTCDate(),
      options.timeZone,
    );
    const settled = normalized.status !== 'PENDING';

    const bet: PreliminaryNormalizedBet = {
      rowNumber: row.rowNumber,
      amount: normalized.amount,
      visibleTotalOdds: normalized.odds,
      status: normalized.status,
      placedAt,
      placedTimeKnown: false,
      // D-X20: sin fecha de liquidación propia, es la misma que la de colocación.
      settledAt: settled ? placedAt : null,
      settledTimeKnown: settled ? false : true,
      selections,
    };
    bets.push(bet);
    rows.push({
      rowNumber: row.rowNumber,
      status: 'VALID',
      findings: [],
      declaredType,
      derivedType,
      typeMismatch,
    });
  }

  return { stageCandidates, bets, rows, counts };
}
