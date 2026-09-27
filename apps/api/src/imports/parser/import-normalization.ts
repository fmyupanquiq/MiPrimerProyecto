import type { BetType } from '@letfer/shared';
import { deriveBetType } from '../../bets/bets.service.js';
import { noonInTimeZone } from '../../common/timezone.js';
import type { NormalizedImportBet, NormalizedImportSelection } from '../import-types.js';
import {
  classifyRow,
  extractSemanticRow,
  toText,
  type RowClassification,
  type RowClassificationFinding,
} from './row-classifier.js';
import type { RawSheet } from './sheet-model.js';
import type { SpreadsheetTemplateConfig } from './spreadsheet-template.js';
import { detectStageCandidates, type StageCandidate } from './stage-candidates.js';

/**
 * Capa agnóstica de normalización (Fase 9.2.4, §113, ADR 0020). Betsafe fue, hasta la 9.2.2, la
 * única fuente que este módulo entendía; aquí se separa lo que de verdad depende de Betsafe (su
 * gramática de selecciones y su vocabulario de tipos, en `betsafe-adapter.ts`) de lo que no depende
 * de ningún origen concreto: recorrer la tabla, clasificar cada fila, comparar el tipo declarado
 * contra el derivado (D-X24) y construir el modelo preliminar. Ese resto vive aquí, en
 * `normalizeImportSheet`, y es exactamente el mismo código para Betsafe, para Betano el día que
 * llegue, o para cualquier otro origen futuro: solo cambia el `ImportOriginAdapter` que se le pasa.
 */

/** `NormalizedImportBet` sin los dos campos que dependen de la etapa confirmada (D-X7, D-X19). */
export type PreliminaryNormalizedBet = Omit<NormalizedImportBet, 'stageKey' | 'stake'>;

export interface ImportRowReport {
  rowNumber: number;
  status: RowClassification;
  findings: RowClassificationFinding[];
  /** Texto exacto de la columna de tipo, tal como está en el archivo; `null` si está vacía. */
  declaredType: string | null;
  /** Tipo derivado del texto de las selecciones (D-X24); `null` salvo en una fila `VALID`. */
  derivedType: BetType | null;
  /**
   * `true` si el tipo declarado y el derivado no coinciden (D-X24): aviso, nunca bloquea. También
   * es `true` cuando el texto declarado no está en el vocabulario del origen (p. ej. una errata).
   */
  typeMismatch: boolean;
}

export interface ImportNormalizationResult {
  /** Candidatos de etapa, con su evidencia; ninguno es todavía una etapa real (D-X7). */
  stageCandidates: StageCandidate[];
  /** Una por cada fila `VALID`, en el mismo orden que `rows`. */
  bets: PreliminaryNormalizedBet[];
  /** Una por cada fila de la tabla, sea o no válida: nada se pierde en silencio (D-X21). */
  rows: ImportRowReport[];
  counts: Record<RowClassification, number>;
}

/**
 * Lo que distingue a un origen concreto (Betsafe, y en el futuro Betano u otro) de cualquier otro:
 * su disposición de columnas y vocabularios (`template`, ya genérico desde la 9.2.1), cómo separa
 * el texto de una fila en selecciones (su propia gramática, nunca la de otro origen) y cómo declara
 * el tipo de apuesta en su columna de tipo. Nada más: `normalizeImportSheet` es idéntico para todos.
 */
export interface ImportOriginAdapter {
  name: string;
  template: SpreadsheetTemplateConfig;
  parseSelections: (description: string, sport: string | null) => NormalizedImportSelection[];
  /** Texto de la columna de tipo (tal como aparece en el archivo) → tipo de LetFer, para D-X24. */
  declaredTypeVocabulary: Readonly<Record<string, BetType>>;
}

/**
 * Convierte una hoja ya leída en el modelo preliminar de la 9.1.5, con el adaptador de un origen
 * concreto. No escribe nada, no crea ninguna etapa y no reutiliza ningún endpoint.
 */
export function normalizeImportSheet(
  sheet: RawSheet,
  adapter: ImportOriginAdapter,
  options: { timeZone: string },
): ImportNormalizationResult {
  const { template } = adapter;
  const dataRows = sheet.rows.filter((row) => row.rowNumber >= template.firstDataRow);
  const stageCandidates = detectStageCandidates(sheet.rows, {
    labelColumn: template.stageLabel.column,
    labelPattern: template.stageLabel.pattern,
  });

  const bets: PreliminaryNormalizedBet[] = [];
  const rows: ImportRowReport[] = [];
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
    const selections = adapter.parseSelections(normalized.description, normalized.sport);
    const derivedType = deriveBetType(selections);
    const declaredMapped = declaredType ? adapter.declaredTypeVocabulary[declaredType] : undefined;
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
