import type { ImportBatchSummaryRow, ImportConfirmationReadiness } from '@letfer/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ImportProgress, importSteps } from './ImportProgress.js';

afterEach(cleanup);

const batch = (overrides: Partial<ImportBatchSummaryRow> = {}) =>
  ({
    id: 'b1',
    status: 'UPLOADED',
    originalName: 'Betsafe.xlsx',
    houseId: null,
    stagePlan: null,
    ...overrides,
  }) as ImportBatchSummaryRow;

const readiness = (
  overrides: Partial<ImportConfirmationReadiness> = {},
): ImportConfirmationReadiness => ({
  blocked: false,
  blockingReasons: [],
  needsAcknowledgment: false,
  acknowledgmentReasons: [],
  acknowledged: false,
  financialSemaphore: 'GREEN',
  canConfirm: true,
  ...overrides,
});

const states = (b: ImportBatchSummaryRow, r: ImportConfirmationReadiness | null) =>
  importSteps(b, r).map((step) => step.state);

describe('progreso de la importación (Fase 10.3)', () => {
  it('recién subido: el siguiente paso es confirmar la casa', () => {
    expect(states(batch(), readiness())).toEqual(['done', 'current', 'todo', 'skipped', 'todo']);
  });

  it('casa confirmada y plan guardado: el siguiente paso es confirmar la importación', () => {
    const validated = batch({
      status: 'VALIDATED',
      houseId: 'h1',
      stagePlan: { stages: [] },
    });
    expect(states(validated, readiness())).toEqual(['done', 'done', 'done', 'skipped', 'current']);
  });

  it('con avisos sin reconocer, el paso lo indica; reconocidos, queda hecho', () => {
    const pending = readiness({ needsAcknowledgment: true, canConfirm: false });
    expect(importSteps(batch(), pending)[3]!.title).toBe('Reconocer avisos');
    expect(importSteps(batch(), pending)[3]!.state).toBe('todo');
    expect(
      importSteps(batch(), readiness({ needsAcknowledgment: true, acknowledged: true }))[3]!.state,
    ).toBe('done');
  });

  it('bloqueado: lo dice en el paso y en el semáforo, con una explicación', () => {
    render(
      <ImportProgress
        batch={batch()}
        readiness={readiness({ blocked: true, canConfirm: false })}
      />,
    );
    const region = screen.getByRole('region', { name: 'Progreso de la importación' });
    expect(within(region).getByText(/Hay filas con errores/)).toBeTruthy();
    expect(within(region).getByLabelText('Estado para confirmar').textContent).toMatch(
      /Bloqueado\. Hay problemas que deben resolverse/,
    );
  });

  it('el semáforo amarillo pide reconocimiento; el verde, completar los pasos', () => {
    render(
      <ImportProgress
        batch={batch()}
        readiness={readiness({ needsAcknowledgment: true, canConfirm: false })}
      />,
    );
    expect(screen.getByLabelText('Estado para confirmar').textContent).toMatch(
      /Requiere reconocimiento/,
    );
    cleanup();
    render(<ImportProgress batch={batch()} readiness={readiness()} />);
    expect(screen.getByLabelText('Estado para confirmar').textContent).toMatch(
      /Listo para continuar/,
    );
  });

  it('importado: todo hecho y sin semáforo (ya no hay nada que confirmar)', () => {
    render(
      <ImportProgress
        batch={batch({ status: 'IMPORTED', houseId: 'h1' })}
        readiness={readiness()}
      />,
    );
    expect(screen.getByText('Registrado en el ledger.')).toBeTruthy();
    expect(screen.queryByLabelText('Estado para confirmar')).toBeNull();
  });
});
