import { describe, expect, it } from 'vitest';
import {
  groupByLeg,
  legOdds,
  validateSelectionStructure,
  type StructureRow,
} from './bet-structure.js';

const row = (overrides: Partial<StructureRow> = {}): StructureRow => ({
  eventGroup: 0,
  position: 0,
  event: 'A - B',
  visibleOdds: '1.50',
  ...overrides,
});

const BETANO: StructureRow[] = [
  row({ eventGroup: 0, event: 'Universitario - Melgar', visibleOdds: '2.15' }),
  row({ eventGroup: 1, event: 'Liverpool - City', visibleOdds: '2.47' }),
  row({ eventGroup: 1, position: 1, event: 'Liverpool - City', visibleOdds: null }),
  row({ eventGroup: 2, event: 'Benfica - Guimarães', visibleOdds: '1.21' }),
  row({ eventGroup: 3, event: 'Inter Miami - D.C. United', visibleOdds: '1.31' }),
];

describe('estructura TICKET → LEG → CONDICIÓN (§114)', () => {
  it('caso real: 4 legs, 5 filas y la cuota del leg creado una sola vez', () => {
    expect(groupByLeg(BETANO)).toHaveLength(4);
    expect(legOdds(BETANO)).toEqual(['2.15', '2.47', '1.21', '1.31']);
    expect(validateSelectionStructure(BETANO, 'MULTIPLE')).toBeNull();
  });

  it('agrupa y ordena sin importar el orden de entrada', () => {
    const shuffled = [BETANO[2]!, BETANO[4]!, BETANO[0]!, BETANO[1]!, BETANO[3]!];
    const legs = groupByLeg(shuffled);
    expect(legs.map((leg) => leg.map((r) => r.position))).toEqual([[0], [0, 1], [0], [0]]);
  });

  it('Simple: exige su cuota', () => {
    expect(validateSelectionStructure([row()], 'SIMPLE')).toBeNull();
    expect(validateSelectionStructure([row({ visibleOdds: undefined })], 'SIMPLE')).toMatch(
      /necesita su cuota/,
    );
  });

  it('Creada independiente: las cuotas son opcionales', () => {
    const rows = [row({ visibleOdds: null }), row({ position: 1, visibleOdds: null })];
    expect(validateSelectionStructure(rows, 'CREATED')).toBeNull();
  });

  it('Múltiple: cada leg necesita cuota en su fila principal', () => {
    const rows = [row(), row({ eventGroup: 1, visibleOdds: undefined })];
    expect(validateSelectionStructure(rows, 'MULTIPLE')).toMatch(/Cada leg de una Múltiple/);
  });

  it('Múltiple: una condición interna sin cuota es válida solo si el leg tiene su cuota', () => {
    const orphan = [row(), row({ eventGroup: 1, position: 1, visibleOdds: null })];
    // Sin fila principal, las posiciones no empiezan en 0.
    expect(validateSelectionStructure(orphan, 'MULTIPLE')).toMatch(/numerarse 0, 1, 2/);
  });

  it('posiciones repetidas o con huecos se rechazan', () => {
    expect(validateSelectionStructure([row(), row({ visibleOdds: '2.00' })], 'CREATED')).toMatch(
      /numerarse/,
    );
    expect(validateSelectionStructure([row(), row({ position: 2 })], 'CREATED')).toMatch(
      /numerarse/,
    );
  });

  it('las condiciones de un leg deben ser del mismo partido', () => {
    const rows = [row(), row({ position: 1, event: 'C - D', visibleOdds: null })];
    expect(validateSelectionStructure(rows, 'CREATED')).toMatch(/mismo partido/);
  });

  it('marcador y resultado del leg solo en la fila principal', () => {
    const rows = [row(), row({ position: 1, visibleOdds: null, legScore: '1-0' })];
    expect(validateSelectionStructure(rows, 'CREATED')).toMatch(/una vez, en la primera/);
    expect(
      validateSelectionStructure(
        [row({ legScore: '1-0', legResult: 'WON' }), row({ position: 1, visibleOdds: null })],
        'CREATED',
      ),
    ).toBeNull();
  });
});
