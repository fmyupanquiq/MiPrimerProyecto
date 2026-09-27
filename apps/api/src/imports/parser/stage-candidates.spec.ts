import { describe, expect, it } from 'vitest';
import { detectStageCandidates } from './stage-candidates.js';
import type { RawRow } from './sheet-model.js';

const row = (rowNumber: number, label?: string): RawRow => ({
  rowNumber,
  cells: label ? { B: label } : { C: '2024-10-22' },
});

describe('detectStageCandidates (precisión de D-X7: candidatos con evidencia, nunca definitivos)', () => {
  it('sin ninguna hoja: ningún candidato', () => {
    expect(detectStageCandidates([], { labelColumn: 'B', labelPattern: /^RONDA/i })).toEqual([]);
  });

  it('sin ningún rótulo: un único candidato sin etiqueta que abarca todo el rango, con su evidencia', () => {
    const rows = [row(11), row(12), row(16)];
    const candidates = detectStageCandidates(rows, { labelColumn: 'B', labelPattern: /^RONDA/i });
    expect(candidates).toEqual([
      {
        label: null,
        labelRow: null,
        firstRow: 11,
        lastRow: 16,
        evidence: expect.stringContaining('sin etiqueta') as string,
      },
    ]);
  });

  it('un solo rótulo (como Betsafe, solo "RONDA 1"): un candidato que agrupa hasta el final', () => {
    const rows = [row(8, 'RONDA 1'), row(10), row(11), row(16), row(168)];
    const candidates = detectStageCandidates(rows, {
      labelColumn: 'B',
      labelPattern: /^RONDA\s+\d+/i,
    });
    expect(candidates).toEqual([
      {
        label: 'RONDA 1',
        labelRow: 8,
        firstRow: 8,
        lastRow: 168,
        evidence: expect.any(String) as string,
      },
    ]);
  });

  it('varios rótulos: cada uno agrupa hasta la fila anterior al siguiente', () => {
    const rows = [
      row(8, 'RONDA 1'),
      row(11),
      row(21, 'RONDA 2'),
      row(24),
      row(34, 'RONDA 3'),
      row(37),
    ];
    const candidates = detectStageCandidates(rows, {
      labelColumn: 'B',
      labelPattern: /^RONDA\s+\d+/i,
    });
    expect(candidates).toEqual([
      {
        label: 'RONDA 1',
        labelRow: 8,
        firstRow: 8,
        lastRow: 20,
        evidence: expect.any(String) as string,
      },
      {
        label: 'RONDA 2',
        labelRow: 21,
        firstRow: 21,
        lastRow: 33,
        evidence: expect.any(String) as string,
      },
      {
        label: 'RONDA 3',
        labelRow: 34,
        firstRow: 34,
        lastRow: 37,
        evidence: expect.any(String) as string,
      },
    ]);
  });

  it('no depende del orden de entrada de las filas (las ordena por número de fila)', () => {
    const rows = [row(24), row(8, 'RONDA 1'), row(21, 'RONDA 2'), row(11)];
    const candidates = detectStageCandidates(rows, {
      labelColumn: 'B',
      labelPattern: /^RONDA\s+\d+/i,
    });
    expect(candidates.map((c) => c.label)).toEqual(['RONDA 1', 'RONDA 2']);
    expect(candidates[0]).toMatchObject({ firstRow: 8, lastRow: 20 });
  });

  it('un texto parecido pero que no coincide con el patrón no cuenta como rótulo', () => {
    const rows = [row(5, 'Ronda de prueba (borrador)'), row(8, 'RONDA 1'), row(11)];
    const candidates = detectStageCandidates(rows, {
      labelColumn: 'B',
      labelPattern: /^RONDA\s+\d+/i,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.label).toBe('RONDA 1');
  });

  it('nunca decide una etapa definitiva: solo describe el candidato, sin crear nada', () => {
    const rows = [row(8, 'RONDA 1'), row(11)];
    const candidates = detectStageCandidates(rows, {
      labelColumn: 'B',
      labelPattern: /^RONDA\s+\d+/i,
    });
    for (const candidate of candidates) {
      expect(candidate).not.toHaveProperty('stageId');
      expect(candidate).not.toHaveProperty('confirmed');
    }
  });
});
