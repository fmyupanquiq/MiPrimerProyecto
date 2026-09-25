import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANA,
  apiError,
  AUTH_STATE,
  OWNER_PERMISSIONS,
  projectDetail,
  PROJECT_ID,
  renderApp,
  STAGE_ID,
  stubApi,
  type Handler,
  type StubResponse,
} from '../../test-utils.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const URL = `/projects/${PROJECT_ID}`;
const BETS_URL = `${URL}/bets`;
const HOUSES_URL = `${URL}/houses`;
const HOUSE_A = '0195f7c0-0000-7000-8000-0000000000a1';
const BET_ID = '0195f7c0-0000-7000-8000-0000000000b1';
const REAUTH: StubResponse = {
  status: 200,
  body: { reauthenticatedAt: '2026-06-01T12:00:00.000Z' },
};

const house = () => ({
  id: HOUSE_A,
  projectId: PROJECT_ID,
  name: 'Betano',
  status: 'ACTIVE',
  balance: '519.00',
  committed: '0.00',
  available: '519.00',
  createdAt: '2026-06-01T12:00:00.000Z',
});

/** Ganada liquidada con retorno calculado (provisional). */
const provisional = (overrides: Record<string, unknown> = {}) => ({
  id: BET_ID,
  projectId: PROJECT_ID,
  stageId: STAGE_ID,
  stageName: 'Etapa 1',
  houseId: HOUSE_A,
  houseName: 'Betano',
  betType: 'SIMPLE',
  stake: '2.0000',
  officialAmount: '20.00',
  effectiveAmount: '20.00',
  amountSource: 'CALCULATED',
  visibleTotalOdds: '1.95',
  officialPotentialReturn: null,
  officialRealizedReturn: null,
  calculatedRealizedReturn: '39.00',
  effectiveReturn: '39.00',
  returnSource: 'CALCULATED',
  effectiveOdds: '1.95',
  profitLoss: '19.00',
  status: 'WON',
  placedAt: '2026-06-01T20:00:00.000Z',
  placedTimeKnown: true,
  settledAt: '2026-06-01T22:00:00.000Z',
  settledTimeKnown: true,
  reason: null,
  createdBy: { id: ANA.id, name: 'Ana Pérez' },
  createdAt: '2026-06-01T20:05:00.000Z',
  updatedAt: '2026-06-01T22:05:00.000Z',
  deletedAt: null,
  purgeEligibleAt: null,
  version: 3,
  ...overrides,
});

const officialWin = (overrides: Record<string, unknown> = {}) =>
  provisional({
    officialRealizedReturn: '38.50',
    effectiveReturn: '38.50',
    returnSource: 'OFFICIAL',
    profitLoss: '18.50',
    ...overrides,
  });

const preview = (overrides: Record<string, unknown> = {}) => ({
  kind: 'SETTLEMENT_CORRECTION',
  valid: true,
  ledgerChanged: true,
  reversals: [
    {
      type: 'REVERSAL',
      direction: 'DEBIT',
      houseId: HOUSE_A,
      houseName: 'Betano',
      amount: '39.00',
      occurredAt: '2026-06-01T22:00:00.000Z',
      reverses: 'BET_SETTLEMENT',
    },
  ],
  inserts: [],
  balances: [
    {
      houseId: HOUSE_A,
      houseName: 'Betano',
      balanceBefore: '519.00',
      balanceAfter: '480.00',
      availableBefore: '519.00',
      availableAfter: '480.00',
    },
  ],
  checkpointsToInvalidate: [],
  conflicts: [],
  availabilityProblems: [],
  profitLossBefore: '19.00',
  profitLossAfter: '-20.00',
  before: {},
  after: {},
  ...overrides,
});

function open(
  bet: Record<string, unknown>,
  extra: Record<string, Handler> = {},
  permissions?: string[],
) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: {
      status: 200,
      body: projectDetail(permissions ? { myPermissions: permissions } : {}),
    },
    [`GET ${HOUSES_URL}`]: { status: 200, body: [house()] },
    [`GET ${BETS_URL}`]: { status: 200, body: [bet] },
    ...extra,
  });
}

const formNamed = (name: string) => screen.getByRole('form', { name });

describe('confirmar el retorno oficial (§77, §112.2, D-A12)', () => {
  it('avisa que el retorno es calculado y ofrece confirmarlo solo a quien puede', async () => {
    open(provisional());
    renderApp(BETS_URL);
    expect(await screen.findByText('Retorno calculado, sin confirmar')).toBeTruthy();
    expect(screen.getByText(/Retorno S\/ 39\.00 \(calculado\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar retorno oficial' })).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();

    // Sin bets.confirm_return (p. ej. el Colaborador) el aviso sigue, pero no la acción.
    open(
      provisional(),
      {},
      OWNER_PERMISSIONS.filter((p) => p !== 'bets.confirm_return' && p !== 'bets.correct'),
    );
    renderApp(BETS_URL);
    await screen.findByText('Retorno calculado, sin confirmar');
    expect(screen.queryByRole('button', { name: 'Confirmar retorno oficial' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Corregir liquidación' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reabrir' })).toBeNull();
  });

  it('si coincide con el calculado, solo se confirma: sin diferencia ni confirmación explícita', async () => {
    const { calls } = open(provisional(), {
      [`POST ${BETS_URL}/${BET_ID}/confirm-return`]: { status: 200, body: officialWin() },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar retorno oficial' }));
    const form = formNamed('Confirmar retorno oficial de la apuesta de Betano');
    fireEvent.change(within(form).getByLabelText('Retorno oficial'), {
      target: { value: '39.00' },
    });
    expect(within(form).getByText(/Coincide con el retorno calculado/)).toBeTruthy();
    expect(within(form).queryByRole('checkbox')).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: 'Confirmar retorno oficial' }));

    expect(await screen.findByText('Se confirmó el retorno oficial.')).toBeTruthy();
    const post = calls.find((c) => c.path === `${BETS_URL}/${BET_ID}/confirm-return`)!;
    expect(post.body).toMatchObject({
      officialRealizedReturn: '39.00',
      acknowledgeDifference: false,
      version: 3,
    });
  });

  it('con diferencia muestra calculado, oficial y diferencia, y exige confirmarla y la contraseña', async () => {
    let reauthed = false;
    const { calls } = open(provisional(), {
      [`POST ${BETS_URL}/${BET_ID}/confirm-return`]: () =>
        reauthed ? { status: 200, body: officialWin() } : apiError(403, 'REAUTH_REQUIRED'),
      'POST /auth/reauth': () => {
        reauthed = true;
        return REAUTH;
      },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar retorno oficial' }));
    const form = formNamed('Confirmar retorno oficial de la apuesta de Betano');
    fireEvent.change(within(form).getByLabelText('Retorno oficial'), {
      target: { value: '38.50' },
    });

    expect(within(form).getByText('Retorno calculado')).toBeTruthy();
    expect(within(form).getByText('S/ 39.00')).toBeTruthy();
    expect(within(form).getByText('S/ 38.50')).toBeTruthy();
    expect(within(form).getByText(/-S\/ 0\.50|S\/ -0\.50/)).toBeTruthy();
    const submit = within(form).getByRole('button', { name: 'Confirmar retorno oficial' });
    expect(submit).toHaveProperty('disabled', true); // falta la confirmación explícita
    fireEvent.click(within(form).getByRole('checkbox', { name: /Confirmo la diferencia/ }));
    expect(submit).toHaveProperty('disabled', false);
    fireEvent.click(submit);

    const dialog = await screen.findByRole('dialog', { name: 'Confirma tu contraseña' });
    fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
      target: { value: 'mi-clave-secreta' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('Se confirmó el retorno oficial.')).toBeTruthy();
    const posts = calls.filter((c) => c.path === `${BETS_URL}/${BET_ID}/confirm-return`);
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toMatchObject({
      officialRealizedReturn: '38.50',
      acknowledgeDifference: true,
    });
  });

  it('si la API detecta una diferencia que la web no vio (RETURN_MISMATCH), muestra sus valores', async () => {
    open(provisional({ calculatedRealizedReturn: '38.99' }), {
      [`POST ${BETS_URL}/${BET_ID}/confirm-return`]: {
        status: 409,
        body: {
          statusCode: 409,
          code: 'RETURN_MISMATCH',
          message: 'El retorno oficial difiere del calculado',
          details: { calculated: '39.00', official: '38.99', delta: '-0.01' },
        },
      },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar retorno oficial' }));
    const form = formNamed('Confirmar retorno oficial de la apuesta de Betano');
    // La web compara con 38.99 y cree que coincide; la API dice otra cosa.
    fireEvent.change(within(form).getByLabelText('Retorno oficial'), {
      target: { value: '38.99' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Confirmar retorno oficial' }));

    expect(
      await within(form).findByRole('checkbox', { name: /Confirmo la diferencia/ }),
    ).toBeTruthy();
    expect(within(form).getByText('S/ 39.00')).toBeTruthy();
    expect(within(form).getByText('S/ 38.99')).toBeTruthy();
  });
});

describe('corregir la liquidación (§112.3, D-A8)', () => {
  it('exige motivo, muestra el impacto (saldo antes y después, conciliación) y solo aplica lo revisado', async () => {
    let reauthed = false;
    const { calls } = open(officialWin(), {
      [`POST ${BETS_URL}/${BET_ID}/correct-settlement/preview`]: {
        status: 200,
        body: preview({
          checkpointsToInvalidate: [
            {
              id: 'c1',
              houseId: HOUSE_A,
              houseName: 'Betano',
              occurredAt: '2026-06-01T23:00:00.000Z',
            },
          ],
        }),
      },
      [`POST ${BETS_URL}/${BET_ID}/correct-settlement`]: () =>
        reauthed
          ? { status: 200, body: provisional({ status: 'LOST' }) }
          : apiError(403, 'REAUTH_REQUIRED'),
      'POST /auth/reauth': () => {
        reauthed = true;
        return REAUTH;
      },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Corregir liquidación' }));
    const form = formNamed('Corregir liquidación de la apuesta de Betano');
    fireEvent.change(within(form).getByLabelText('Resultado'), { target: { value: 'LOST' } });

    const apply = within(form).getByRole('button', {
      name: 'Aplicar corrección',
    });
    expect(apply).toHaveProperty('disabled', true); // hay que ver el impacto primero

    // Sin motivo no se calcula nada.
    fireEvent.click(within(form).getByRole('button', { name: 'Ver impacto' }));
    expect(await within(form).findByText(/Indica el motivo/)).toBeTruthy();
    expect(calls.some((c) => c.path.endsWith('/preview'))).toBe(false);

    fireEvent.change(within(form).getByLabelText(/Motivo de la corrección/), {
      target: { value: 'Se liquidó por error' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Ver impacto' }));

    const saldo = await within(form).findByRole('table', { name: 'Saldo antes y después' });
    expect(within(saldo).getAllByText('S/ 519.00').length).toBeGreaterThan(0);
    expect(within(saldo).getAllByText('S/ 480.00').length).toBeGreaterThan(0);
    expect(within(form).getByText(/Afecta a la conciliación/)).toBeTruthy();
    expect(within(form).getByText(/Ganancia\/pérdida de la apuesta: S\/ 19\.00/)).toBeTruthy();
    expect(
      within(form).getByRole('table', { name: 'Filas del ledger que se registrarían' }),
    ).toBeTruthy();
    expect(within(form).getByText(/Reversión de apuesta \(liquidación\)/)).toBeTruthy();

    // Solo se envía lo que cambia, con el motivo y la versión.
    const sent = calls.find((c) => c.path.endsWith('/correct-settlement/preview'))!;
    expect(sent.body).toEqual({ status: 'LOST', reason: 'Se liquidó por error', version: 3 });

    // Si cambian los datos, hay que volver a calcular el impacto.
    fireEvent.change(within(form).getByLabelText(/Motivo de la corrección/), {
      target: { value: 'Se liquidó por error de captura' },
    });
    expect(within(form).getByText(/vuelve a calcularlo para poder aplicar/)).toBeTruthy();
    expect(apply).toHaveProperty('disabled', true);
    fireEvent.click(within(form).getByRole('button', { name: 'Ver impacto' }));
    await within(form).findByRole('table', { name: 'Saldo antes y después' });
    expect(apply).toHaveProperty('disabled', false);
    fireEvent.click(apply);

    const dialog = await screen.findByRole('dialog', { name: 'Confirma tu contraseña' });
    fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
      target: { value: 'mi-clave-secreta' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Se corrigió la liquidación.')).toBeTruthy();
    const applied = calls.filter((c) => c.path === `${BETS_URL}/${BET_ID}/correct-settlement`);
    expect(applied).toHaveLength(2);
    expect(applied[1]!.body).toMatchObject({
      reason: 'Se liquidó por error de captura',
      status: 'LOST',
    });
  });

  it('una corrección que se rechazaría explica el conflicto y no se puede aplicar', async () => {
    open(officialWin(), {
      [`POST ${BETS_URL}/${BET_ID}/correct-settlement/preview`]: {
        status: 200,
        body: preview({
          valid: false,
          conflicts: [
            {
              houseId: HOUSE_A,
              houseName: 'Betano',
              occurredAt: '2026-06-02T15:00:00.000Z',
              balance: '-60.00',
              movementIds: ['m1'],
              pendingIds: ['p1'],
            },
          ],
        }),
      },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Corregir liquidación' }));
    const form = formNamed('Corregir liquidación de la apuesta de Betano');
    fireEvent.change(within(form).getByLabelText('Resultado'), { target: { value: 'LOST' } });
    fireEvent.change(within(form).getByLabelText(/Motivo de la corrección/), {
      target: { value: 'x' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Ver impacto' }));

    expect(await within(form).findByText(/se rechazaría con el historial actual/)).toBeTruthy();
    expect(within(form).getByText(/quedaría con un saldo de/)).toBeTruthy();
    expect(within(form).getByText(/1 apuesta o retiro pendiente/)).toBeTruthy();
    expect(within(form).getByRole('button', { name: 'Aplicar corrección' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('exige al menos un cambio antes de calcular el impacto', async () => {
    const { calls } = open(officialWin());
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Corregir liquidación' }));
    const form = formNamed('Corregir liquidación de la apuesta de Betano');
    fireEvent.change(within(form).getByLabelText(/Motivo de la corrección/), {
      target: { value: 'x' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Ver impacto' }));
    expect(await within(form).findByText(/Indica al menos un cambio/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('reabrir (D-A4)', () => {
  it('advierte que revierte los efectos financieros, exige motivo y muestra el impacto', async () => {
    const { calls } = open(officialWin(), {
      [`POST ${BETS_URL}/${BET_ID}/reopen/preview`]: {
        status: 200,
        body: preview({ kind: 'REOPEN', profitLossAfter: null }),
      },
      [`POST ${BETS_URL}/${BET_ID}/reopen`]: {
        status: 200,
        body: provisional({
          status: 'PENDING',
          returnSource: null,
          effectiveReturn: null,
          profitLoss: null,
        }),
      },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir' }));
    const form = formNamed('Reabrir la apuesta de Betano');
    expect(
      within(form).getByText(/Reabrir revierte los efectos financieros de esta apuesta/),
    ).toBeTruthy();
    expect(within(form).getByText(/quedan en el historial/)).toBeTruthy();

    fireEvent.click(within(form).getByRole('button', { name: 'Ver impacto' }));
    expect(await within(form).findByText(/Indica el motivo de la reapertura/)).toBeTruthy();

    fireEvent.change(within(form).getByLabelText(/Motivo de la reapertura/), {
      target: { value: 'Se liquidó por error' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Ver impacto' }));
    await within(form).findByRole('table', { name: 'Saldo antes y después' });
    fireEvent.click(within(form).getByRole('button', { name: 'Reabrir apuesta' }));

    expect(await screen.findByText('Se reabrió la apuesta.')).toBeTruthy();
    const post = calls.find((c) => c.path === `${BETS_URL}/${BET_ID}/reopen`)!;
    expect(post.body).toEqual({ reason: 'Se liquidó por error', version: 3 });
  });
});

describe('papelera y restauración de una liquidada (D-A7, D-A11)', () => {
  it('eliminarla exige motivo y advierte que revierte el ledger; una pendiente se elimina como siempre', async () => {
    const { calls } = open(officialWin(), {
      [`POST ${BETS_URL}/${BET_ID}/trash`]: { status: 200, body: { id: BET_ID } },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Papelera' }));
    const form = formNamed('Enviar a la papelera la apuesta de Betano');
    expect(within(form).getByText(/revierte todo su efecto en el ledger/)).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Enviar a la papelera' }));
    expect(await within(form).findByText('Indica el motivo.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.change(within(form).getByLabelText(/Motivo/), {
      target: { value: 'Registrada por error' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Enviar a la papelera' }));
    expect(await screen.findByText(/Se envió la apuesta a la papelera y se revirtió/)).toBeTruthy();
    expect(calls.find((c) => c.path.endsWith('/trash'))!.body).toEqual({
      reason: 'Registrada por error',
    });
  });

  it('quien no puede corregir liquidadas no ve la papelera de una liquidada', async () => {
    open(
      officialWin(),
      {},
      OWNER_PERMISSIONS.filter((p) => p !== 'bets.correct'),
    );
    renderApp(BETS_URL);
    await screen.findByText('Ganada');
    expect(screen.queryByRole('button', { name: 'Papelera' })).toBeNull();
  });

  it('restaurar una liquidada desde la papelera exige motivo y avisa que vuelve a registrar el ledger', async () => {
    const { calls } = open(officialWin({ deletedAt: '2026-06-02T10:00:00.000Z' }), {
      [`GET ${BETS_URL}?status=TRASHED`]: {
        status: 200,
        body: [officialWin({ deletedAt: '2026-06-02T10:00:00.000Z' })],
      },
      [`POST ${BETS_URL}/${BET_ID}/restore`]: { status: 200, body: { id: BET_ID } },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByLabelText('Ver la papelera'));
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar' }));
    const form = formNamed('Restaurar la apuesta de Betano');
    expect(within(form).getByText(/vuelve a registrar su efecto en el ledger/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/Motivo/), { target: { value: 'Era correcta' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Restaurar apuesta' }));
    expect(await screen.findByText(/Se restauró la apuesta y se volvió a registrar/)).toBeTruthy();
    expect(calls.find((c) => c.path.endsWith('/restore'))!.body).toEqual({
      reason: 'Era correcta',
    });
  });
});

describe('historial financiero de la apuesta (§112.1)', () => {
  it('muestra las filas del ledger (vigentes, anuladas y reversiones) y los valores anteriores de cada corrección', async () => {
    open(officialWin(), {
      [`GET ${BETS_URL}/${BET_ID}/ledger`]: {
        status: 200,
        body: {
          movements: [
            {
              id: 'm1',
              type: 'BET_SETTLEMENT',
              direction: 'CREDIT',
              houseId: HOUSE_A,
              houseName: 'Betano',
              amount: '39.00',
              occurredAt: '2026-06-01T22:00:00.000Z',
              createdAt: '2026-06-01T22:00:00.000Z',
              reversesMovementId: null,
              correctionId: null,
              live: false,
            },
            {
              id: 'm2',
              type: 'REVERSAL',
              direction: 'DEBIT',
              houseId: HOUSE_A,
              houseName: 'Betano',
              amount: '39.00',
              occurredAt: '2026-06-01T22:00:00.000Z',
              createdAt: '2026-06-02T09:00:00.000Z',
              reversesMovementId: 'm1',
              correctionId: 'k1',
              live: false,
            },
            {
              id: 'm3',
              type: 'BET_SETTLEMENT',
              direction: 'CREDIT',
              houseId: HOUSE_A,
              houseName: 'Betano',
              amount: '38.50',
              occurredAt: '2026-06-01T22:00:00.000Z',
              createdAt: '2026-06-02T09:00:00.000Z',
              reversesMovementId: null,
              correctionId: 'k1',
              live: true,
            },
          ],
          corrections: [
            {
              id: 'k1',
              kind: 'RETURN_CONFIRMATION',
              before: { officialRealizedReturn: null, calculatedRealizedReturn: '39.00' },
              after: { officialRealizedReturn: '38.50', calculatedRealizedReturn: '39.00' },
              reason: 'Ticket oficial',
              createdBy: { id: ANA.id, name: 'Ana Pérez' },
              createdAt: '2026-06-02T09:00:00.000Z',
            },
          ],
        },
      },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Historial financiero' }));
    const table = await screen.findByRole('table', { name: 'Movimientos de la apuesta' });
    expect(within(table).getByText('Vigente')).toBeTruthy();
    expect(within(table).getByText('Anulada')).toBeTruthy();
    expect(within(table).getByText('Reversión')).toBeTruthy();
    const corrections = screen.getByRole('list', { name: 'Correcciones de la apuesta' });
    expect(within(corrections).getByText(/Confirmación del retorno oficial/)).toBeTruthy();
    expect(within(corrections).getByText('Motivo: Ticket oficial')).toBeTruthy();
    expect(within(corrections).getByText('Retorno oficial: — → S/ 38.50')).toBeTruthy();
  });
});
