import type { RawRow } from './sheet-model.js';

/**
 * Detector de candidatos de etapa (Fase 9.2.1, precisión de D-X7, ADR 0020). **Nunca** decide una
 * etapa definitiva: solo agrupa filas alrededor de la evidencia que encuentra (un rótulo de sección
 * en una columna) y explica por qué las agrupó así. Confirmar, ajustar o dividir un candidato en
 * una o varias etapas reales es una decisión de la validación previa (9.3), nunca de este detector.
 *
 * No sabe nada de "RONDA n" en particular: el patrón que reconoce un rótulo lo aporta quien llama.
 * Tampoco intenta adivinar fronteras por posición (bloques de tamaño fijo): eso sería una regla
 * específica de un archivo concreto, y ni Betsafe la declara explícitamente (solo la Ronda 1 tiene
 * rótulo) ni se sabe todavía si Betano la sigue.
 */

export interface StageCandidate {
  /** Texto exacto del rótulo encontrado (p. ej. `"RONDA 1"`); `null` cuando no hay ningún rótulo. */
  label: string | null;
  /** Fila donde está el rótulo; `null` cuando no hay ninguno (todo el rango es un solo candidato). */
  labelRow: number | null;
  firstRow: number;
  lastRow: number;
  /** Por qué el detector agrupó así estas filas: para el informe, nunca para decidir nada solo. */
  evidence: string;
}

/**
 * Busca, en la columna indicada, todas las filas cuyo valor coincide con `labelPattern` y agrupa el
 * resto de filas alrededor de cada una encontrada (desde el rótulo hasta la fila anterior al
 * siguiente rótulo, o hasta el final). Sin ningún rótulo, todo el rango es un único candidato sin
 * etiqueta: es la evidencia más honesta que se puede dar sin inventar una frontera.
 */
export function detectStageCandidates(
  rows: readonly RawRow[],
  options: { labelColumn: string; labelPattern: RegExp },
): StageCandidate[] {
  if (rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => a.rowNumber - b.rowNumber);
  const firstRow = sorted[0]!.rowNumber;
  const lastRow = sorted[sorted.length - 1]!.rowNumber;

  const labels: { row: number; text: string }[] = [];
  for (const row of sorted) {
    const value = row.cells[options.labelColumn];
    if (typeof value === 'string' && options.labelPattern.test(value)) {
      labels.push({ row: row.rowNumber, text: value });
    }
  }

  if (labels.length === 0) {
    return [
      {
        label: null,
        labelRow: null,
        firstRow,
        lastRow,
        evidence:
          `Ninguna celda de la columna ${options.labelColumn} coincide con el patrón de rótulo de ` +
          `etapa: se agrupan todas las filas (${firstRow}-${lastRow}) en un solo candidato sin etiqueta.`,
      },
    ];
  }

  return labels.map((label, index) => {
    const next = labels[index + 1];
    const candidateLast = next ? next.row - 1 : lastRow;
    return {
      label: label.text,
      labelRow: label.row,
      firstRow: label.row,
      lastRow: candidateLast,
      evidence:
        `Rótulo "${label.text}" encontrado en la fila ${label.row}; agrupa hasta la fila ` +
        `${candidateLast} (${next ? `la anterior al siguiente rótulo, fila ${next.row}` : 'el final de la hoja'}).`,
    };
  });
}
