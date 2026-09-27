import type { BetType } from '@letfer/shared';
import type { ImportOriginAdapter } from './import-normalization.js';
import { parseBetsafeSelections } from './betsafe-selections.js';
import { BETSAFE_TEMPLATE } from './spreadsheet-template.js';

/**
 * Adaptador de Betsafe (Fase 9.2.4, ADR 0020): lo único que `normalizeImportSheet` necesita para
 * entender este origen. Es el ejemplo y la plantilla para un futuro adaptador de Betano (o de
 * cualquier otro origen): la misma estructura, con su propia plantilla de columnas, su propia
 * gramática de selecciones y su propio vocabulario de tipos — nunca compartiendo estos tres con
 * otro origen sin confirmarlo primero (§113.5, D-X24).
 */

/** Tipo declarado (columna TIPO de Betsafe) → tipo de LetFer, para comparar contra el derivado. */
export const BETSAFE_DECLARED_TYPE_VOCABULARY: Readonly<Record<string, BetType>> = {
  Simple: 'SIMPLE',
  Multi: 'MULTIPLE',
  Creada: 'CREATED',
};

export const BETSAFE_ADAPTER: ImportOriginAdapter = {
  name: 'Betsafe',
  template: BETSAFE_TEMPLATE,
  parseSelections: parseBetsafeSelections,
  declaredTypeVocabulary: BETSAFE_DECLARED_TYPE_VOCABULARY,
};
