import { IMPORT_MAX_FILE_BYTES } from '@letfer/shared';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  AUTH_STATE,
  OWNER_PERMISSIONS,
  projectDetail,
  PROJECT_ID,
  renderApp,
  stubApi,
  type Handler,
  type StubResponse,
} from '../../../test-utils.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const URL = `/projects/${PROJECT_ID}`;
const BATCHES_URL = `${URL}/import-batches`;
const BATCH_ID = '0195f7c0-0000-7000-8000-0000000000c1';
// Colaborador y Lector no reciben ningún permiso de importación (§113.9).
const WITHOUT_IMPORTS = OWNER_PERMISSIONS.filter((p) => p !== 'imports.view' && p !== 'import.run');
const VIEW_ONLY = OWNER_PERMISSIONS.filter((p) => p !== 'import.run');
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function importBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: BATCH_ID,
    projectId: PROJECT_ID,
    houseId: null,
    status: 'UPLOADED',
    origin: 'Betsafe',
    originalName: 'Betsafe.xlsx',
    sourceSha256: 'a'.repeat(64),
    sourceSizeBytes: 1234,
    isRehearsal: false,
    stagePlan: null,
    report: null,
    rowsTotal: 12,
    rowsValid: 10,
    rowsTemplate: 0,
    rowsEmpty: 1,
    rowsPartial: 1,
    rowsInvalid: 0,
    createdBy: '0195f7c0-0000-7000-8000-000000000001',
    validatedAt: null,
    validatedBy: null,
    importedAt: null,
    importedBy: null,
    importReason: null,
    annulledAt: null,
    annulledBy: null,
    annulmentReason: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    acknowledgmentReason: null,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

// Vista previa mínima coherente: fila 2 ganada simple, fila 3 perdida múltiple, fila 4 plantilla.
const PREVIEW_SUMMARY = {
  totalRows: 3,
  valid: 2,
  template: 1,
  empty: 0,
  partial: 0,
  invalid: 0,
  preliminaryBets: 2,
};

const validRow = (rowNumber: number, type: string) => ({
  rowNumber,
  status: 'VALID',
  category: 'INFORMATIONAL',
  findings: [],
  declaredType: type,
  derivedType: type,
  typeMismatch: false,
});

const PREVIEW_ROWS = [
  validRow(2, 'Simple'),
  validRow(3, 'Múltiple'),
  {
    rowNumber: 4,
    status: 'TEMPLATE',
    category: 'INFORMATIONAL',
    findings: [],
    declaredType: null,
    derivedType: null,
    typeMismatch: false,
  },
];

const selection = (eventGroup: number, event: string, pick: string) => ({
  eventGroup,
  position: 1,
  sport: 'Fútbol',
  event,
  market: null,
  selection: pick,
  visibleOdds: null,
});

const PREVIEW_BETS = [
  {
    rowNumber: 2,
    amount: '10.00',
    visibleTotalOdds: '1.95',
    status: 'WON',
    placedAt: '2026-05-01T05:00:00.000Z',
    declaredType: 'Simple',
    derivedType: 'SIMPLE',
    typeMismatch: false,
    selections: [selection(1, 'Alianza vs. Cristal', 'Alianza gana')],
    provisionalReturn: '19.50',
  },
  {
    rowNumber: 3,
    amount: '10.00',
    visibleTotalOdds: '3.40',
    status: 'LOST',
    placedAt: '2026-05-01T05:00:00.001Z',
    declaredType: 'Múltiple',
    derivedType: 'MULTIPLE',
    typeMismatch: false,
    selections: [
      selection(1, 'Universitario vs. Melgar', 'Más de 2.5 goles'),
      selection(2, 'Sporting Cristal vs. Cienciano', 'Empate'),
    ],
    provisionalReturn: null,
  },
];

const PREVIEW_CONTRAST = {
  configured: true,
  bets: [
    {
      rowNumber: 2,
      excelTotalReturn: '19.50',
      excelProfit: '9.50',
      letferTotalReturn: '19.50',
      letferProfit: '9.50',
      totalReturnResidual: '0.00',
      profitResidual: '0.00',
      semaphore: 'GREEN',
    },
    {
      rowNumber: 3,
      excelTotalReturn: '0.00',
      excelProfit: '-10.00',
      letferTotalReturn: '0.00',
      letferProfit: '-10.00',
      totalReturnResidual: '0.00',
      profitResidual: '0.00',
      semaphore: 'GREEN',
    },
  ],
  totalProfitResidual: '0.00',
  rowsWithMoreThanTwoDecimals: 0,
  semaphore: 'GREEN',
  headerChecks: [
    {
      label: 'Ganancia total',
      excelValue: '-0.50',
      expectedFromRows: '-0.50',
      residual: '0.00',
      consistent: true,
    },
  ],
  initialBankAmount: '100.00',
};

function importPreview(overrides: Record<string, unknown> = {}) {
  return {
    file: { originalName: 'Betsafe.xlsx', sizeBytes: 1234, sha256: 'a'.repeat(64) },
    origin: 'Betsafe',
    summary: PREVIEW_SUMMARY,
    semaphore: 'OK',
    rows: PREVIEW_ROWS,
    capital: {
      detected: true,
      amount: '100.00',
      houseCandidate: 'Betsafe',
      occurredAt: '2026-05-01T05:00:00.000Z',
      occurredAtKnown: false,
    },
    stages: { candidates: [] },
    bets: PREVIEW_BETS,
    financialContrast: PREVIEW_CONTRAST,
    duplicates: { withinFile: [], againstHistory: [] },
    ...overrides,
  };
}

const HOUSES_URL = `${URL}/houses`;
const BETSAFE_ID = '0195f7c0-0000-7000-8000-0000000000h1';
const BETANO_ID = '0195f7c0-0000-7000-8000-0000000000h2';

const house = (id: string, name: string) => ({
  id,
  projectId: PROJECT_ID,
  name,
  status: 'ACTIVE',
  balance: '0.00',
  committed: '0.00',
  available: '0.00',
  createdAt: '2026-06-01T12:00:00.000Z',
});
const HOUSES = { status: 200, body: [house(BETSAFE_ID, 'Betsafe'), house(BETANO_ID, 'Betano')] };

/** Disponibilidad a confirmar (`GET /readiness`): por defecto, un lote listo sin reconocimiento. */
function readiness(overrides: Record<string, unknown> = {}): StubResponse {
  return {
    status: 200,
    body: {
      blocked: false,
      blockingReasons: [],
      needsAcknowledgment: false,
      acknowledgmentReasons: [],
      acknowledged: false,
      financialSemaphore: 'GREEN',
      canConfirm: true,
      ...overrides,
    },
  };
}

function open(
  path: string,
  project: Record<string, unknown> = {},
  extra: Record<string, Handler> = {},
) {
  const stub = stubApi({
    'GET /auth/me': AUTH_STATE,
    [`GET ${URL}`]: { status: 200, body: projectDetail(project) },
    ...extra,
  });
  renderApp(path);
  return stub;
}

describe('navegación de importaciones', () => {
  it('muestra la pestaña a quien tiene imports.view', async () => {
    open(`${URL}/imports`, {}, { [`GET ${BATCHES_URL}`]: { status: 200, body: [] } });
    const nav = await screen.findByRole('navigation', { name: 'Proyecto' });
    expect(within(nav).getByRole('link', { name: 'Importaciones' }).getAttribute('href')).toBe(
      `${URL}/imports`,
    );
  });

  it('la oculta a quien no tiene permisos de importación', async () => {
    open(`${URL}/imports`, { myPermissions: WITHOUT_IMPORTS });
    const nav = await screen.findByRole('navigation', { name: 'Proyecto' });
    expect(within(nav).queryByRole('link', { name: 'Importaciones' })).toBeNull();
  });
});

describe('ImportsPage', () => {
  it('lista los lotes con enlace a su detalle', async () => {
    open(`${URL}/imports`, {}, { [`GET ${BATCHES_URL}`]: { status: 200, body: [importBatch()] } });
    const table = await screen.findByRole('table', { name: 'Lotes de importación' });
    expect(within(table).getByRole('link', { name: 'Betsafe.xlsx' }).getAttribute('href')).toBe(
      `${URL}/imports/${BATCH_ID}`,
    );
    expect(within(table).getByText('Subido', { selector: 'span' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Subir archivo' }).getAttribute('href')).toBe(
      `${URL}/imports/new`,
    );
  });

  it('indica cuando todavía no hay lotes', async () => {
    open(`${URL}/imports`, {}, { [`GET ${BATCHES_URL}`]: { status: 200, body: [] } });
    expect(await screen.findByText('Todavía no se ha subido ningún archivo.')).toBeTruthy();
  });

  it('sin import.run no ofrece subir archivos', async () => {
    open(
      `${URL}/imports`,
      { myPermissions: VIEW_ONLY },
      { [`GET ${BATCHES_URL}`]: { status: 200, body: [importBatch()] } },
    );
    await screen.findByRole('table', { name: 'Lotes de importación' });
    expect(screen.queryByRole('link', { name: 'Subir archivo' })).toBeNull();
  });

  it('remite a la configuración si el proyecto no completó su setup, sin pedir los lotes', async () => {
    const { calls } = open(`${URL}/imports`, { setupComplete: false, activeStage: null });
    expect(
      await screen.findByRole('link', { name: 'configuración inicial del proyecto' }),
    ).toBeTruthy();
    expect(calls.some((call) => call.path.startsWith(BATCHES_URL))).toBe(false);
  });

  it('sin imports.view no pide los lotes', async () => {
    const { calls } = open(`${URL}/imports`, { myPermissions: WITHOUT_IMPORTS });
    expect(
      await screen.findByText('No tienes permiso para esta sección de importaciones.'),
    ).toBeTruthy();
    expect(calls.some((call) => call.path.startsWith(BATCHES_URL))).toBe(false);
  });
});

describe('ImportUploadPage', () => {
  const xlsx = (name = 'Betsafe.xlsx') => new File(['contenido'], name, { type: XLSX_TYPE });

  async function openForm(extra: Record<string, Handler> = {}) {
    const stub = open(`${URL}/imports/new`, {}, extra);
    const form = await screen.findByRole('form', { name: 'Subir archivo' });
    return { ...stub, form };
  }

  function choose(form: HTMLElement, file: File) {
    fireEvent.change(within(form).getByLabelText('Archivo (.xlsx)'), {
      target: { files: [file] },
    });
  }

  const submit = (form: HTMLElement) =>
    fireEvent.click(within(form).getByRole('button', { name: 'Subir archivo' }));

  /** `stubApi` no registra cuerpos `multipart`: se leen del `FormData` enviado a `fetch`. */
  function uploadedForm(): FormData {
    const call = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) => input === `/api${BATCHES_URL}` && init?.method === 'POST',
      );
    return call![1]!.body as FormData;
  }

  it('sube el archivo con su origen y abre el detalle del lote creado', async () => {
    const { calls, form } = await openForm({
      [`POST ${BATCHES_URL}`]: { status: 201, body: importBatch() },
      [`GET ${BATCHES_URL}/${BATCH_ID}`]: { status: 200, body: importBatch() },
      [`GET ${BATCHES_URL}/${BATCH_ID}/preview`]: { status: 200, body: importPreview() },
      [`GET ${BATCHES_URL}/${BATCH_ID}/readiness`]: readiness(),
      [`GET ${HOUSES_URL}`]: HOUSES,
    });
    expect(within(form).getByRole('option', { name: 'Betsafe' })).toBeTruthy();
    const file = xlsx();
    choose(form, file);
    expect(within(form).getByText('Betsafe.xlsx · 1 KB')).toBeTruthy();
    submit(form);

    expect(await screen.findByRole('heading', { name: 'Betsafe.xlsx' })).toBeTruthy();
    expect(
      screen.getByText('Se subió el archivo. Todavía no se ha registrado nada en el ledger.'),
    ).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    const sent = uploadedForm();
    expect(sent.get('origin')).toBe('Betsafe');
    expect(sent.get('file')).toBe(file);
  });

  it('exige elegir un archivo antes de enviar', async () => {
    const { calls, form } = await openForm();
    submit(form);
    expect(await within(form).findByText('Elige un archivo .xlsx.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('rechaza en la interfaz un archivo que no es .xlsx, sin llamar a la API', async () => {
    const { calls, form } = await openForm();
    choose(form, new File(['a,b'], 'historial.csv', { type: 'text/csv' }));
    submit(form);
    expect(await within(form).findByText('El archivo debe ser un .xlsx.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('rechaza en la interfaz un archivo mayor que el límite de la API', async () => {
    const { calls, form } = await openForm();
    const big = xlsx();
    Object.defineProperty(big, 'size', { value: IMPORT_MAX_FILE_BYTES + 1 });
    choose(form, big);
    submit(form);
    expect(
      await within(form).findByText('El archivo supera el tamaño máximo de 10 MB.'),
    ).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('muestra el error de la API y se queda en el formulario', async () => {
    const { form } = await openForm({
      [`POST ${BATCHES_URL}`]: apiError(400, 'VALIDATION_FAILED'),
    });
    choose(form, xlsx());
    submit(form);
    expect(await within(form).findByText('Revisa los datos ingresados.')).toBeTruthy();
    expect(within(form).getByRole('button', { name: 'Subir archivo' })).toBeTruthy();
  });

  it('sin import.run no la muestra', async () => {
    open(`${URL}/imports/new`, { myPermissions: VIEW_ONLY });
    expect(
      await screen.findByText('No tienes permiso para esta sección de importaciones.'),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Subir archivo' })).toBeNull();
  });
});

describe('ImportBatchPage', () => {
  const BATCH_URL = `${BATCHES_URL}/${BATCH_ID}`;

  function openBatch(preview: StubResponse, project: Record<string, unknown> = {}) {
    return open(`${URL}/imports/${BATCH_ID}`, project, {
      [`GET ${BATCH_URL}`]: {
        status: 200,
        body: importBatch({ status: 'IMPORTED', importedAt: '2026-06-02T12:00:00.000Z' }),
      },
      [`GET ${BATCH_URL}/preview`]: preview,
      [`GET ${BATCH_URL}/readiness`]: readiness(),
      [`GET ${HOUSES_URL}`]: HOUSES,
    });
  }

  const ok = (overrides: Record<string, unknown> = {}): StubResponse => ({
    status: 200,
    body: importPreview(overrides),
  });

  it('muestra el resumen del lote', async () => {
    openBatch(ok());
    expect(await screen.findByRole('heading', { name: 'Betsafe.xlsx' })).toBeTruthy();
    expect(screen.getByText('Importado', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText(/12 en total · 10 válidas · 1 parciales · 0 inválidas/)).toBeTruthy();
    // El aviso de subida solo aparece al llegar desde el formulario, no al abrir el lote.
    expect(screen.queryByText(/Se subió el archivo/)).toBeNull();
  });

  it('carga la vista previa: resumen, estado, contraste, apuestas y duplicados', async () => {
    openBatch(ok());
    const summary = await section('Resumen de la vista previa');
    expect(within(summary).getByText('Betsafe.xlsx · Betsafe')).toBeTruthy();
    expect(within(summary).getByText('1 de plantilla · 0 vacías')).toBeTruthy();

    const status = await section('Estado estructural');
    expect(within(status).getByText('Listo')).toBeTruthy();
    expect(within(status).queryByRole('table')).toBeNull();

    const contrast = await section('Contraste financiero');
    expect(within(contrast).getByText('Verde')).toBeTruthy();
    expect(within(contrast).getByText('Ninguna fila difiere del archivo.')).toBeTruthy();
    const header = within(contrast).getByRole('table', { name: 'Totales de cabecera' });
    expect(within(header).getByText('Coincide')).toBeTruthy();

    const bets = screen.getByRole('table', { name: 'Apuestas preliminares' });
    const [, won, lost] = within(bets).getAllByRole('row');
    expect(within(won!).getByText('Fútbol')).toBeTruthy();
    expect(within(won!).getByText('Simple → Simple')).toBeTruthy();
    expect(within(won!).getByText('S/ 10.00')).toBeTruthy();
    expect(within(won!).getByText('1.95')).toBeTruthy();
    expect(within(won!).getByText('S/ 19.50')).toBeTruthy();
    expect(within(won!).getByText('Calculado, sin confirmar')).toBeTruthy();
    expect(within(lost!).getByText('Perdida')).toBeTruthy();
    expect(within(lost!).getAllByRole('listitem')).toHaveLength(2);

    const duplicates = await section('Posibles duplicados');
    expect(within(duplicates).getByText('No se detectaron posibles duplicados.')).toBeTruthy();
  });

  it('un lote bloqueado muestra por qué, fila por fila', async () => {
    openBatch(
      ok({
        semaphore: 'BLOCKED',
        summary: { ...PREVIEW_SUMMARY, invalid: 1 },
        rows: [
          ...PREVIEW_ROWS,
          {
            rowNumber: 5,
            status: 'INVALID',
            category: 'BLOCKING',
            findings: [{ code: 'INVALID_ODDS', message: 'La cuota no es un número positivo.' }],
            declaredType: null,
            derivedType: null,
            typeMismatch: false,
          },
        ],
      }),
    );
    const status = await section('Estado estructural');
    expect(within(status).getByText('Bloqueado')).toBeTruthy();
    expect(within(status).getByText(/el lote no puede confirmarse tal como está/)).toBeTruthy();
    const findings = within(status).getByRole('table', { name: 'Filas con hallazgos' });
    const [, row] = within(findings).getAllByRole('row');
    expect(within(row!).getByText('5')).toBeTruthy();
    expect(within(row!).getByText('Inválida')).toBeTruthy();
    expect(within(row!).getByText('Bloquea')).toBeTruthy();
    expect(within(row!).getByText('La cuota no es un número positivo.')).toBeTruthy();
  });

  it('un lote con advertencias las muestra sin recalcularlas', async () => {
    openBatch(
      ok({
        semaphore: 'NEEDS_ACKNOWLEDGMENT',
        bets: [PREVIEW_BETS[0], { ...PREVIEW_BETS[1], typeMismatch: true }],
        financialContrast: {
          ...PREVIEW_CONTRAST,
          semaphore: 'RED',
          totalProfitResidual: '0.035',
          bets: [
            PREVIEW_CONTRAST.bets[0],
            {
              ...PREVIEW_CONTRAST.bets[1],
              excelProfit: '-9.965',
              profitResidual: '0.035',
              semaphore: 'RED',
            },
          ],
        },
        duplicates: {
          withinFile: [
            {
              rowNumbers: [2, 3],
              existingBetIds: [],
              date: '2026-05-01',
              amount: '10.00',
              odds: '1.95',
            },
          ],
          againstHistory: [],
        },
      }),
    );
    const status = await section('Estado estructural');
    expect(within(status).getByText('Requiere reconocimiento')).toBeTruthy();

    const contrast = await section('Contraste financiero');
    expect(within(contrast).getByText('Rojo')).toBeTruthy();
    // Residuos exactos, tal como los da la API: sin redondear a dos decimales.
    expect(within(contrast).getAllByText('S/ 0.035')).toHaveLength(2);
    const differing = within(contrast).getByRole('table', {
      name: 'Filas que difieren del archivo',
    });
    expect(within(differing).getAllByRole('row')).toHaveLength(2);

    const bets = screen.getByRole('table', { name: 'Apuestas preliminares' });
    const [, first, second] = within(bets).getAllByRole('row');
    expect(
      within(first!).getByText('Posible duplicado dentro del archivo (filas 2, 3).'),
    ).toBeTruthy();
    expect(
      within(second!).getByText('El tipo declarado no coincide con el derivado.'),
    ).toBeTruthy();
    expect(
      within(second!).getByText('Difiere del archivo (ver contraste financiero).'),
    ).toBeTruthy();

    const duplicates = await section('Posibles duplicados');
    const table = within(duplicates).getByRole('table', { name: 'Duplicados dentro del archivo' });
    expect(within(table).getByText('2026-05-01')).toBeTruthy();
  });

  it('indica cuando el origen no tiene contraste financiero configurado', async () => {
    openBatch(ok({ financialContrast: { ...PREVIEW_CONTRAST, configured: false, bets: [] } }));
    const contrast = await section('Contraste financiero');
    expect(within(contrast).getByText(/no tiene contraste financiero configurado/)).toBeTruthy();
    expect(within(contrast).queryByText('Verde')).toBeNull();
  });

  it('si la vista previa falla, lo informa y conserva el resumen del lote', async () => {
    openBatch(apiError(500, 'INTERNAL'));
    expect(
      await screen.findByText('No se pudo completar la operación. Inténtalo de nuevo.'),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Betsafe.xlsx' })).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Apuestas preliminares' })).toBeNull();
  });

  it('sin imports.view no pide el lote ni su vista previa', async () => {
    const { calls } = openBatch(ok(), { myPermissions: WITHOUT_IMPORTS });
    expect(
      await screen.findByText('No tienes permiso para esta sección de importaciones.'),
    ).toBeTruthy();
    expect(calls.some((call) => call.path.startsWith(BATCHES_URL))).toBe(false);
  });

  it('un lote inexistente o ajeno se muestra como no encontrado, sin pedir la vista previa', async () => {
    const { calls } = open(
      `${URL}/imports/${BATCH_ID}`,
      {},
      { [`GET ${BATCH_URL}`]: apiError(404, 'NOT_FOUND') },
    );
    expect(await screen.findByText('No se encontró el lote de importación.')).toBeTruthy();
    expect(calls.some((call) => call.path.endsWith('/preview'))).toBe(false);
  });
});

/** La sección (`Section`) cuyo título es `title`. */
async function section(title: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: title });
  return heading.closest('section')!;
}
