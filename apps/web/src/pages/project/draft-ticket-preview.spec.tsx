import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { newSelection, type SelectionDraft } from './bet-selection-drafts.js';
import { DigitalTicket, totalOddsFigures } from './DigitalTicket.js';
import {
  draftPreviewLegs,
  draftReviewWarnings,
  legOddsProduct,
  resolveTotalOddsSource,
} from './draft-ticket-preview.js';

afterEach(cleanup);

function row(eventGroup: number, position: number, patch: Partial<SelectionDraft>): SelectionDraft {
  return { ...newSelection(eventGroup, position), ...patch };
}

// Combinada de 4 (Betano): el leg 2 es una Creada con dos condiciones y una sola cuota (2.47).
const REAL_CASE: SelectionDraft[] = [
  row(0, 0, {
    event: 'Universitario de Deportes - FBC Melgar',
    market: 'Doble oportunidad',
    selection: '1X',
    visibleOdds: '2.15',
    legScore: '2-2',
  }),
  row(1, 0, {
    event: 'Liverpool FC - Manchester City',
    market: 'Resultado del partido',
    selection: 'Manchester City',
    visibleOdds: '2.47',
    legScore: '0-3',
  }),
  row(1, 1, {
    event: 'Liverpool FC - Manchester City',
    market: 'Manchester City Más/Menos Córners',
    selection: 'Más de 2.5',
  }),
  row(2, 0, {
    event: 'SL Benfica - Vitória Guimarães',
    market: 'Resultado del partido',
    selection: 'SL Benfica',
    visibleOdds: '1.21',
  }),
  row(3, 0, {
    event: 'Inter Miami CF - D.C. United',
    market: 'Goles totales Más/Menos',
    selection: 'Más de 4.5',
    visibleOdds: '1.31',
  }),
];

describe('vista previa del ticket (paso Confirmar)', () => {
  it('caso real: 4 legs, 5 condiciones y la cuota 2.47 una sola vez', () => {
    const legs = draftPreviewLegs(REAL_CASE, 'MULTIPLE', '');
    expect(legs).toHaveLength(4);
    expect(legs.flatMap((leg) => leg.selections)).toHaveLength(5);
    expect(legs.map((leg) => leg.odds)).toEqual(['2.15', '2.47', '1.21', '1.31']);
    expect(legs[1]!.selections[1]!.visibleOdds).toBeNull();
  });

  it('el ticket digital dibuja 4 legs, dos selecciones separadas y no inventa cuota total', () => {
    const legs = draftPreviewLegs(REAL_CASE, 'MULTIPLE', '');
    render(
      <DigitalTicket
        houseName="Betano"
        structureTitle="Múltiple de 4"
        status={<span>Sin definir</span>}
        facts={[{ label: 'Etapa', value: 'Etapa 1' }]}
        legs={legs}
        selectionsCount={5}
        figures={[
          { label: 'Importe apostado', value: 'S/ 10.00', note: '(oficial)' },
          { label: 'Cuota total', value: '—' },
        ]}
      />,
    );
    expect(screen.getByText(/4 legs · 5 selecciones/)).toBeTruthy();
    expect(screen.queryByRole('listitem', { name: 'Leg 5' })).toBeNull();
    const leg2 = screen.getByRole('listitem', { name: 'Leg 2' });
    expect(within(leg2).getAllByText('2.47')).toHaveLength(1);
    expect(within(leg2).getByRole('listitem', { name: 'Selección 1 del leg 2' })).toBeTruthy();
    expect(within(leg2).getByRole('listitem', { name: 'Selección 2 del leg 2' })).toBeTruthy();
    expect(screen.getByText('Cuota total').nextElementSibling!.textContent).toBe('—');
  });

  it('avisa de lo que falta sin inventarlo', () => {
    expect(
      draftReviewWarnings({
        houseChosen: false,
        selections: [row(0, 0, {}), row(1, 0, { event: 'A', selection: 'B' })],
        format: 'MULTIPLE',
        totalOdds: '',
        amount: null,
      }),
    ).toEqual([
      'Falta elegir la casa de apuestas.',
      'Falta el importe apostado (stake o monto oficial).',
      '1 selección sin partido o pronóstico.',
      '2 legs sin cuota.',
      'No hay cuota total: indícala. Si el ticket no la muestra, el producto de las cuotas de los legs es solo una referencia, no una cuota oficial.',
    ]);
  });
});

describe('procedencia de la cuota total (ADR 0023)', () => {
  it('caso Betano: el producto de los 4 legs es una referencia de 8.42, nunca oficial', () => {
    // 2.15 × 2.47 × 1.21 × 1.31 = 8.41767355…
    expect(legOddsProduct(REAL_CASE, 'MULTIPLE')).toBe('8.42');
  });

  it('con una sola cuota de leg ausente no hay producto (sería un número menor al real)', () => {
    const partial = REAL_CASE.map((r, i) => (i === 3 ? { ...r, visibleOdds: '' } : r));
    expect(legOddsProduct(partial, 'MULTIPLE')).toBeNull();
    expect(legOddsProduct(REAL_CASE, 'CREATED')).toBeNull();
    expect(legOddsProduct(REAL_CASE, 'SIMPLE')).toBeNull();
  });

  it('en Múltiple/Creada la procedencia hay que declararla; en Simple es la cuota visible', () => {
    expect(
      resolveTotalOddsSource({ format: 'MULTIPLE', isCalculated: false, choice: null }),
    ).toBeNull();
    expect(
      resolveTotalOddsSource({ format: 'CREATED', isCalculated: false, choice: null }),
    ).toBeNull();
    expect(
      resolveTotalOddsSource({ format: 'MULTIPLE', isCalculated: false, choice: 'OFFICIAL' }),
    ).toBe('OFFICIAL');
    expect(
      resolveTotalOddsSource({ format: 'MULTIPLE', isCalculated: true, choice: 'OFFICIAL' }),
    ).toBe('CALCULATED');
    expect(resolveTotalOddsSource({ format: 'SIMPLE', isCalculated: false, choice: null })).toBe(
      'OFFICIAL',
    );
  });

  it('las cifras muestran oficial, referencia calculada, origen no verificado o no disponible', () => {
    expect(totalOddsFigures('OFFICIAL', '8.40')).toEqual([
      { label: 'Cuota total oficial', value: '8.40', note: '(oficial)' },
    ]);
    const calculated = totalOddsFigures('CALCULATED', '8.420000');
    expect(calculated.map((f) => [f.label, f.value])).toEqual([
      ['Cuota total oficial', '—'],
      ['Cuota calculada de referencia', '8.42'],
    ]);
    expect(totalOddsFigures('UNKNOWN', '1.95')[0]).toMatchObject({
      label: 'Cuota total',
      note: '(origen no verificado)',
    });
    expect(totalOddsFigures(undefined, '1.95')[0]!.note).toBe('(origen no verificado)');
    expect(totalOddsFigures('CALCULATED', '')).toEqual([
      { label: 'Cuota total oficial', value: '—', note: '(no disponible)' },
    ]);
  });
});
