import { moneyInputSchema } from '@letfer/shared';
import type { ImportStagePlan } from './import-types.js';

const moneyOk = (value: unknown) => moneyInputSchema({ positive: true }).safeParse(value).success;
const blank = (value: string | null | undefined) => !value || value.trim() === '';
const validDate = (value: unknown): value is Date =>
  value instanceof Date && !Number.isNaN(value.getTime());

/**
 * Valida la forma del plan de etapas que propone una persona (Fase 9.3.4, §113.3, D-X7), antes de
 * guardarlo. Solo comprueba que el plan en sí es coherente (claves, montos, fechas, rango de filas
 * de cada etapa y cuál puede quedar activa, §113.3): nunca lo contrasta contra las filas reales del
 * staging (eso es del resolutor de la 9.3.5, que además calcula `stageKey` y `stake`) ni decide
 * nada financiero. Devuelve un mensaje por problema, con la posición del dato.
 */
export function validateImportStagePlan(plan: ImportStagePlan): string[] {
  const issues: string[] = [];
  if (plan.stages.length === 0) {
    issues.push('El plan de etapas necesita al menos una etapa.');
    return issues;
  }

  const keys = new Set<string>();
  let activeCount = 0;
  for (const [index, stage] of plan.stages.entries()) {
    const at = `etapa ${index + 1}`;
    if (blank(stage.key)) issues.push(`${at}: falta la clave.`);
    else if (keys.has(stage.key)) issues.push(`${at}: la clave "${stage.key}" está repetida.`);
    keys.add(stage.key);
    if (blank(stage.name)) issues.push(`${at}: falta el nombre.`);
    if (!moneyOk(stage.unitStake)) issues.push(`${at}: la unidad debe ser un monto positivo.`);
    if (stage.startsAt !== null && !validDate(stage.startsAt)) {
      issues.push(`${at}: la fecha de inicio no es válida.`);
    }
    if (stage.status === 'ACTIVE') activeCount += 1;
    else if (stage.status !== 'CLOSED') issues.push(`${at}: el estado debe ser CLOSED o ACTIVE.`);
    if (
      !Number.isInteger(stage.firstRow) ||
      !Number.isInteger(stage.lastRow) ||
      stage.firstRow <= 0 ||
      stage.lastRow < stage.firstRow
    ) {
      issues.push(`${at}: el rango de filas no es válido.`);
    }
  }
  if (activeCount > 1) issues.push('Como máximo una etapa del plan puede quedar activa.');

  // Ninguna etapa se solapa con otra: cada fila del staging debe poder pertenecer, como mucho, a
  // una sola etapa del plan (D-X7). Se ordena por inicio de rango para comparar solo consecutivas.
  const withValidRange = plan.stages.filter(
    (stage) =>
      Number.isInteger(stage.firstRow) &&
      Number.isInteger(stage.lastRow) &&
      stage.firstRow > 0 &&
      stage.lastRow >= stage.firstRow,
  );
  const sorted = [...withValidRange].sort((a, b) => a.firstRow - b.firstRow);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]!.firstRow <= sorted[i - 1]!.lastRow) {
      issues.push(
        `las etapas "${sorted[i - 1]!.key}" y "${sorted[i]!.key}" tienen rangos de filas solapados.`,
      );
    }
  }
  // §113.3: "las rondas anteriores quedan cerradas y la última puede quedar activa" — nunca una
  // etapa anterior a la última por orden de filas.
  const lastByRow = sorted[sorted.length - 1];
  if (activeCount > 0 && lastByRow && lastByRow.status !== 'ACTIVE') {
    issues.push('Solo la última etapa del plan (por orden de filas) puede quedar activa.');
  }

  return issues;
}
