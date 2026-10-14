import { describe, expect, it } from 'vitest';
import {
  addCondition,
  addLeg,
  draftsFromExtraction,
  formatFromExtraction,
  legsOf,
  newSelection,
  patchRow,
  removeLeg,
  removeRow,
  restructure,
  toSelectionInputs,
  type SelectionDraft,
} from './bet-selection-drafts.js';

const row = (group: number, position: number, overrides: Partial<SelectionDraft> = {}) => ({
  ...newSelection(group, position),
  event: `Partido ${group}`,
  selection: `Sel ${group}.${position}`,
  ...overrides,
});

/** Combinada de 4 cuyo 2.º leg es un leg creado con 2 selecciones y UNA cuota (caso real, sintético). */
const fourLegs = (): SelectionDraft[] => [
  row(0, 0, { visibleOdds: '2.15' }),
  row(1, 0, { visibleOdds: '2.47', legScore: '0-3', legResult: 'LOST' }),
  row(1, 1, { conditionStatus: 'WON' }),
  row(2, 0, { visibleOdds: '1.21' }),
  row(3, 0, { visibleOdds: '1.31' }),
];

describe('estructura de edición TICKET → LEG → CONDICIÓN', () => {
  it('agrupa por leg: 4 legs y 5 filas', () => {
    expect(legsOf(fourLegs()).map((leg) => leg.length)).toEqual([1, 2, 1, 1]);
  });

  it('en una Múltiple la cuota del leg va solo en su fila principal, nunca en las condiciones', () => {
    const list = fourLegs();
    list[2]!.visibleOdds = '1.52'; // aunque alguien la escribiera, no se envía
    const inputs = toSelectionInputs(list, 'MULTIPLE');
    expect(inputs.map((s) => [s.eventGroup, s.position, s.visibleOdds])).toEqual([
      [0, 0, '2.15'],
      [1, 0, '2.47'],
      [1, 1, undefined],
      [2, 0, '1.21'],
      [3, 0, '1.31'],
    ]);
    // Marcador y resultado del leg solo en la primera fila; el estado, en la condición.
    expect(inputs[1]).toMatchObject({ legScore: '0-3', legResult: 'LOST' });
    expect(inputs[2]).toMatchObject({
      legScore: undefined,
      legResult: undefined,
      conditionStatus: 'WON',
    });
  });

  it('en una Creada independiente cada fila conserva la cuota opcional que se indicó', () => {
    const list = [row(0, 0, { visibleOdds: '1.50' }), row(0, 1)];
    expect(toSelectionInputs(list, 'CREATED').map((s) => s.visibleOdds)).toEqual([
      '1.50',
      undefined,
    ]);
  });

  it('convertir un leg en Creada añade una condición vacía sin cuota que hereda partido y deporte', () => {
    const list = addCondition(
      [row(0, 0, { visibleOdds: '2.00', sport: 'Tenis' }), row(1, 0, { visibleOdds: '1.50' })],
      0,
    );
    expect(legsOf(list).map((leg) => leg.length)).toEqual([2, 1]);
    const added = list[1]!;
    expect(added).toMatchObject({
      eventGroup: 0,
      position: 1,
      event: 'Partido 0',
      sport: 'Tenis',
      visibleOdds: '',
      selection: '',
    });
    // La cuota del leg sigue en la fila principal.
    expect(list[0]!.visibleOdds).toBe('2.00');
  });

  it('quitar la condición principal traspasa la cuota, el marcador y el resultado a la siguiente', () => {
    const source = fourLegs();
    const next = removeRow(source, source[1]!.key);
    expect(legsOf(next).map((leg) => leg.length)).toEqual([1, 1, 1, 1]);
    expect(next[1]).toMatchObject({
      selection: 'Sel 1.1',
      eventGroup: 1,
      position: 0,
      visibleOdds: '2.47',
      legScore: '0-3',
      legResult: 'LOST',
    });
  });

  it('quitar una condición de un leg de dos lo devuelve a leg normal', () => {
    const source = fourLegs();
    const next = removeRow(source, source[2]!.key);
    expect(legsOf(next).map((leg) => leg.length)).toEqual([1, 1, 1, 1]);
    expect(next[1]!.visibleOdds).toBe('2.47');
  });

  it('quitar un leg renumera los legs sin tocar los demás', () => {
    const next = removeLeg(fourLegs(), 1);
    expect(next.map((s) => [s.eventGroup, s.position, s.selection])).toEqual([
      [0, 0, 'Sel 0.0'],
      [1, 0, 'Sel 2.0'],
      [2, 0, 'Sel 3.0'],
    ]);
  });

  it('añadir un leg lo pone al final como leg normal', () => {
    const next = addLeg(fourLegs());
    expect(legsOf(next)).toHaveLength(5);
    expect(next[next.length - 1]).toMatchObject({ eventGroup: 4, position: 0, selection: '' });
  });

  it('el partido y el deporte son del leg: se comparten con sus condiciones, no con otros legs', () => {
    const source = fourLegs();
    const next = patchRow(source, source[1]!.key, { event: 'Nuevo', sport: 'Tenis' });
    expect(next.map((s) => s.event)).toEqual([
      'Partido 0',
      'Nuevo',
      'Nuevo',
      'Partido 2',
      'Partido 3',
    ]);
    // El pronóstico solo cambia en la fila editada.
    const edited = patchRow(source, source[2]!.key, { selection: 'X' });
    expect(edited.map((s) => s.selection)).toEqual([
      'Sel 0.0',
      'Sel 1.0',
      'X',
      'Sel 2.0',
      'Sel 3.0',
    ]);
  });

  describe('cambio de formato', () => {
    it('Múltiple → Múltiple (p. ej. al quitar algo) conserva los legs creados', () => {
      const next = restructure('MULTIPLE', fourLegs());
      expect(legsOf(next).map((leg) => leg.length)).toEqual([1, 2, 1, 1]);
    });

    it('Creada → Múltiple separa cada fila en su propio leg (cada una es un evento)', () => {
      const created = [row(0, 0, { event: 'A' }), row(0, 1, { event: 'A' })];
      const next = restructure('MULTIPLE', created, 'CREATED');
      expect(next.map((s) => [s.eventGroup, s.position])).toEqual([
        [0, 0],
        [1, 0],
      ]);
    });

    it('Múltiple → Creada junta todo en un único leg del primer partido', () => {
      const next = restructure('CREATED', fourLegs(), 'MULTIPLE');
      expect(next.every((s) => s.eventGroup === 0)).toBe(true);
      expect(next.map((s) => s.position)).toEqual([0, 1, 2, 3, 4]);
      expect(new Set(next.map((s) => s.event))).toEqual(new Set(['Partido 0']));
    });

    it('Múltiple → Simple deja solo la primera fila', () => {
      expect(restructure('SIMPLE', fourLegs())).toHaveLength(1);
    });
  });
});

describe('lectura de la IA → filas del formulario', () => {
  const betano = [
    {
      event: 'U - M',
      market: 'Doble oportunidad',
      selection: '1X',
      visibleOdds: '2.15',
      legScore: '2-2',
    },
    {
      event: 'Liverpool - City',
      market: 'Bet Builder',
      visibleOdds: '2.47',
      legScore: '0-3',
      legResult: 'LOST',
      conditions: [
        { market: 'Resultado del partido', selection: 'Manchester City' },
        {
          market: 'Manchester City Más/Menos Córners',
          selection: 'Más de 2.5',
          conditionStatus: 'WON',
        },
      ],
    },
    {
      event: 'Benfica - V',
      market: 'Resultado del partido',
      selection: 'SL Benfica',
      visibleOdds: '1.21',
    },
    { event: 'Inter - DC', market: 'Goles totales', selection: 'Más de 4.5', visibleOdds: '1.31' },
  ];

  it('caso real: 4 legs y 5 filas; la cuota 2.47 una sola vez; mercado y pronóstico separados', () => {
    expect(formatFromExtraction('MULTIPLE', betano)).toBe('MULTIPLE');
    const rows = draftsFromExtraction('MULTIPLE', betano);
    expect(
      rows.map((s) => [s.eventGroup, s.position, s.market, s.selection, s.visibleOdds]),
    ).toEqual([
      [0, 0, 'Doble oportunidad', '1X', '2.15'],
      [1, 0, 'Resultado del partido', 'Manchester City', '2.47'],
      [1, 1, 'Manchester City Más/Menos Córners', 'Más de 2.5', ''],
      [2, 0, 'Resultado del partido', 'SL Benfica', '1.21'],
      [3, 0, 'Goles totales', 'Más de 4.5', '1.31'],
    ]);
    expect(rows.filter((s) => s.visibleOdds === '2.47')).toHaveLength(1);
    expect(rows[1]).toMatchObject({
      legScore: '0-3',
      legResult: 'LOST',
      event: 'Liverpool - City',
    });
    expect(rows[2]).toMatchObject({ conditionStatus: 'WON', event: 'Liverpool - City' });
  });

  it('ida y vuelta: lo que se prellena es exactamente lo que se enviaría', () => {
    const inputs = toSelectionInputs(draftsFromExtraction('MULTIPLE', betano), 'MULTIPLE');
    expect(inputs.map((s) => [s.eventGroup, s.position, s.visibleOdds])).toEqual([
      [0, 0, '2.15'],
      [1, 0, '2.47'],
      [1, 1, undefined],
      [2, 0, '1.21'],
      [3, 0, '1.31'],
    ]);
  });

  it('una Creada independiente nueva (un solo leg con condiciones) es formato Creada', () => {
    const items = [
      { event: 'A - B', conditions: [{ selection: 'Más de 2.5' }, { selection: 'Ambos marcan' }] },
    ];
    expect(formatFromExtraction('CREATED', items)).toBe('CREATED');
    expect(formatFromExtraction('SIMPLE', items)).toBe('CREATED'); // la estructura manda
    const rows = draftsFromExtraction('CREATED', items);
    expect(rows.map((s) => [s.eventGroup, s.position, s.selection])).toEqual([
      [0, 0, 'Más de 2.5'],
      [0, 1, 'Ambos marcan'],
    ]);
  });

  it('la forma anterior de una Creada (una entrada por condición) sigue funcionando', () => {
    const items = [
      { event: 'A - B', market: 'Goles', selection: 'Más de 2.5' },
      { event: 'A - B', market: 'Ambos marcan', selection: 'Sí' },
    ];
    expect(formatFromExtraction('CREATED', items)).toBe('CREATED');
    expect(draftsFromExtraction('CREATED', items).map((s) => [s.eventGroup, s.position])).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });

  it('una Simple y una Múltiple de legs normales no cambian de estructura', () => {
    expect(
      draftsFromExtraction('SIMPLE', [{ event: 'A', selection: 'X', visibleOdds: '1.5' }]),
    ).toHaveLength(1);
    const multi = draftsFromExtraction('MULTIPLE', [
      { event: 'A', selection: 'X', visibleOdds: '1.5' },
      { event: 'B', selection: 'Y', visibleOdds: '2' },
    ]);
    expect(multi.map((s) => [s.eventGroup, s.position])).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it('sin selecciones: una fila vacía; nada se inventa', () => {
    const rows = draftsFromExtraction(undefined, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event: '', selection: '', visibleOdds: '' });
  });
});
