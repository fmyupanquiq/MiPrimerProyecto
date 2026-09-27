import { moneyInputSchema, oddsInputSchema } from '@letfer/shared';
import type { ImportBatchWriteInput } from './import-types.js';

/** Límite de apuestas de un lote: la escala es pequeña (D-X14) y esto acota el trabajo de una transacción. */
export const IMPORT_MAX_BETS_PER_BATCH = 5000;

const STAKE_PATTERN = /^\d{1,6}(\.\d{1,4})?$/;
const moneyOk = (value: unknown) => moneyInputSchema({ positive: true }).safeParse(value).success;
const oddsOk = (value: unknown) => oddsInputSchema().safeParse(value).success;
const validDate = (value: unknown): value is Date =>
  value instanceof Date && !Number.isNaN(value.getTime());
const blank = (value: string | null | undefined) => !value || value.trim() === '';

/**
 * Valida la forma de los datos normalizados antes de tocar la base de datos. No decide nada
 * financiero (saldos, línea de tiempo: eso lo hace el escritor con el ledger); solo detecta datos
 * que no pueden escribirse. Devuelve un mensaje por problema, con la posición del dato.
 */
export function validateImportInput(input: ImportBatchWriteInput): string[] {
  const issues: string[] = [];
  if (blank(input.reason)) issues.push('El motivo de la importación es obligatorio.');
  if (input.bets.length > IMPORT_MAX_BETS_PER_BATCH) {
    issues.push(`Un lote admite como máximo ${IMPORT_MAX_BETS_PER_BATCH} apuestas.`);
  }

  const stageKeys = new Set<string>();
  let activeStages = 0;
  input.stages.forEach((stage, index) => {
    const at = `etapa ${index + 1}`;
    if (blank(stage.key)) issues.push(`${at}: falta la clave.`);
    else if (stageKeys.has(stage.key)) issues.push(`${at}: la clave "${stage.key}" está repetida.`);
    stageKeys.add(stage.key);
    if (blank(stage.name)) issues.push(`${at}: falta el nombre.`);
    if (!moneyOk(stage.unitStake)) issues.push(`${at}: la unidad debe ser un monto positivo.`);
    if (stage.startsAt !== null && !validDate(stage.startsAt)) {
      issues.push(`${at}: la fecha de inicio no es válida.`);
    }
    if (stage.status === 'ACTIVE') activeStages += 1;
    else if (stage.status !== 'CLOSED') issues.push(`${at}: el estado debe ser CLOSED o ACTIVE.`);
  });
  if (activeStages > 1) issues.push('Como máximo una etapa del lote puede quedar activa.');
  if ((input.bets.length > 0 || input.initialCapital) && input.stages.length === 0) {
    issues.push('El lote necesita al menos una etapa.');
  }

  const capital = input.initialCapital;
  if (capital) {
    if (!moneyOk(capital.amount)) issues.push('capital inicial: el monto debe ser positivo.');
    if (!validDate(capital.occurredAt)) issues.push('capital inicial: la fecha no es válida.');
    if (!stageKeys.has(capital.stageKey)) {
      issues.push(`capital inicial: la etapa "${capital.stageKey}" no existe en el lote.`);
    }
  }

  const rowNumbers = new Set<number>();
  let firstPlacedAt: number | null = null;
  input.bets.forEach((bet, index) => {
    const at = `apuesta ${index + 1}${bet.rowNumber ? ` (fila ${bet.rowNumber})` : ''}`;
    if (!stageKeys.has(bet.stageKey)) issues.push(`${at}: la etapa "${bet.stageKey}" no existe.`);
    if (!STAKE_PATTERN.test(bet.stake) || Number(bet.stake) <= 0) {
      issues.push(`${at}: el stake debe ser un número positivo.`);
    }
    if (!moneyOk(bet.amount)) issues.push(`${at}: el monto debe ser positivo.`);
    if (!oddsOk(bet.visibleTotalOdds))
      issues.push(`${at}: la cuota total es obligatoria y válida.`);
    if (!['WON', 'LOST', 'PENDING'].includes(bet.status)) {
      issues.push(`${at}: el estado debe ser WON, LOST o PENDING.`);
    }
    if (!validDate(bet.placedAt)) issues.push(`${at}: la fecha de colocación no es válida.`);
    else firstPlacedAt = Math.min(firstPlacedAt ?? Infinity, bet.placedAt.getTime());
    if (bet.status === 'PENDING') {
      if (bet.settledAt !== null)
        issues.push(`${at}: una pendiente no lleva fecha de liquidación.`);
    } else if (!validDate(bet.settledAt)) {
      issues.push(`${at}: una apuesta liquidada necesita fecha de liquidación.`);
    } else if (validDate(bet.placedAt) && bet.settledAt.getTime() < bet.placedAt.getTime()) {
      issues.push(`${at}: la liquidación no puede ser anterior a la colocación.`);
    }
    if (bet.rowNumber !== undefined) {
      if (!Number.isInteger(bet.rowNumber) || bet.rowNumber <= 0) {
        issues.push(`${at}: el número de fila no es válido.`);
      } else if (rowNumbers.has(bet.rowNumber)) {
        issues.push(`${at}: la fila ${bet.rowNumber} está repetida.`);
      }
      rowNumbers.add(bet.rowNumber);
    }
    if (bet.selections.length === 0) issues.push(`${at}: falta al menos una selección.`);
    const positions = new Set<string>();
    for (const selection of bet.selections) {
      if (blank(selection.event) || blank(selection.selection)) {
        issues.push(`${at}: cada selección necesita evento y selección.`);
      }
      if (
        !Number.isInteger(selection.eventGroup) ||
        selection.eventGroup < 0 ||
        !Number.isInteger(selection.position) ||
        selection.position < 0
      ) {
        issues.push(`${at}: el grupo y la posición de una selección no son válidos.`);
      }
      const key = `${selection.eventGroup}:${selection.position}`;
      if (positions.has(key)) issues.push(`${at}: la selección ${key} está repetida.`);
      positions.add(key);
      if (selection.visibleOdds !== null && !oddsOk(selection.visibleOdds)) {
        issues.push(`${at}: la cuota de una selección no es válida.`);
      }
    }
  });

  if (
    capital &&
    validDate(capital.occurredAt) &&
    firstPlacedAt !== null &&
    capital.occurredAt.getTime() >= firstPlacedAt
  ) {
    issues.push('El capital inicial debe estar fechado antes de la primera apuesta (D-X23).');
  }
  return issues;
}
