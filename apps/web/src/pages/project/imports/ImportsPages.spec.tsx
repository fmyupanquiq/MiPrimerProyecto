import { IMPORT_MAX_FILE_BYTES } from '@letfer/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
  type RecordedCall,
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
      [`POST ${BATCHES_URL}`]: apiError(400, 'VALIDATION_FAILED', 'Adjunta un archivo.'),
    });
    choose(form, xlsx());
    submit(form);
    expect(
      await within(form).findByText('Revisa los datos ingresados. Adjunta un archivo.'),
    ).toBeTruthy();
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
    expect(await screen.findByText(/Ocurrió un error inesperado en el servidor/)).toBeTruthy();
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

describe('Resolución del lote (casa y plan de etapas)', () => {
  const BATCH_URL = `${BATCHES_URL}/${BATCH_ID}`;

  function openResolution({
    batch = {},
    preview = {},
    project = {},
    extra = {},
  }: {
    batch?: Record<string, unknown>;
    preview?: Record<string, unknown>;
    project?: Record<string, unknown>;
    extra?: Record<string, Handler>;
  } = {}) {
    return open(`${URL}/imports/${BATCH_ID}`, project, {
      [`GET ${BATCH_URL}`]: { status: 200, body: importBatch(batch) },
      [`GET ${BATCH_URL}/preview`]: { status: 200, body: importPreview(preview) },
      [`GET ${BATCH_URL}/readiness`]: readiness(),
      [`GET ${HOUSES_URL}`]: HOUSES,
      ...extra,
    });
  }

  const CANDIDATES = {
    stages: {
      candidates: [
        { label: 'Ronda 1', labelRow: 1, firstRow: 2, lastRow: 3, evidence: 'Fila de título' },
      ],
    },
  };

  const savedPlan = {
    stages: [
      {
        key: 'R1',
        name: 'Ronda 1',
        unitStake: '10.00',
        startsAt: null,
        status: 'ACTIVE',
        firstRow: 2,
        lastRow: 3,
      },
    ],
  };

  const rejected = (details: unknown): StubResponse => ({
    status: 400,
    body: {
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'El plan de etapas contiene datos no válidos.',
      details,
    },
  });

  async function fillStage(form: HTMLElement) {
    fireEvent.change(within(form).getByLabelText('Clave de la etapa 1'), {
      target: { value: 'R1' },
    });
    fireEvent.change(within(form).getByLabelText('Unidad de la etapa 1'), {
      target: { value: '10.00' },
    });
    fireEvent.change(within(form).getByLabelText('Inicio de la etapa 1'), {
      target: { value: '2026-05-01T00:00' },
    });
    fireEvent.change(within(form).getByLabelText('Estado de la etapa 1'), {
      target: { value: 'ACTIVE' },
    });
    fireEvent.click(await within(form).findByRole('button', { name: 'Guardar plan' }));
  }

  it('confirma la casa candidata y refresca el lote y la vista previa', async () => {
    const { calls } = openResolution({
      extra: {
        [`POST ${BATCH_URL}/house`]: {
          status: 200,
          body: importBatch({ status: 'VALIDATED', houseId: BETSAFE_ID }),
        },
      },
    });
    const panel = await section('Casa del lote');
    expect(within(panel).getByText('Sin confirmar')).toBeTruthy();
    const form = await within(panel).findByRole('form', { name: 'Casa del lote' });
    // La candidata de la API aparece sugerida, pero nada se guarda sin que la persona confirme.
    await waitFor(() =>
      expect(within(form).getByRole<HTMLSelectElement>('combobox').value).toBe(BETSAFE_ID),
    );
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.click(within(form).getByRole('button', { name: 'Confirmar casa' }));

    expect(await screen.findByText('Se confirmó la casa del lote.')).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe(`${BATCH_URL}/house`);
    expect(post.body).toEqual({ houseId: BETSAFE_ID });
    const summary = await section('Betsafe.xlsx');
    expect(within(summary).getByText('Validado', { selector: 'span' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Corregir casa' })).toBeTruthy();
    await waitFor(() =>
      expect(calls.filter((c) => c.path === `${BATCH_URL}/preview`)).toHaveLength(2),
    );
  });

  it('corrige una casa ya confirmada', async () => {
    const { calls } = openResolution({
      batch: { status: 'VALIDATED', houseId: BETSAFE_ID },
      extra: {
        [`POST ${BATCH_URL}/house`]: {
          status: 200,
          body: importBatch({ status: 'VALIDATED', houseId: BETANO_ID }),
        },
      },
    });
    const panel = await section('Casa del lote');
    const form = await within(panel).findByRole('form', { name: 'Casa del lote' });
    const button = within(form).getByRole('button', { name: 'Corregir casa' });
    // Sin cambiar la elección no hay nada que corregir.
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(form).getByRole('combobox'), { target: { value: BETANO_ID } });
    fireEvent.click(button);

    expect(await screen.findByText('Se corrigió la casa del lote.')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ houseId: BETANO_ID });
    expect(within(panel).getByText('Betano', { selector: 'dd' })).toBeTruthy();
  });

  it('muestra el error de la API al confirmar la casa', async () => {
    openResolution({
      extra: {
        [`POST ${BATCH_URL}/house`]: apiError(
          409,
          'INVALID_STATE',
          'Este lote ya no admite confirmar ni corregir su casa.',
        ),
      },
    });
    const panel = await section('Casa del lote');
    const form = await within(panel).findByRole('form', { name: 'Casa del lote' });
    await waitFor(() =>
      expect(within(form).getByRole<HTMLSelectElement>('combobox').value).toBe(BETSAFE_ID),
    );
    fireEvent.click(within(form).getByRole('button', { name: 'Confirmar casa' }));
    expect(
      await within(panel).findByText('Este lote ya no admite confirmar ni corregir su casa.'),
    ).toBeTruthy();
  });

  it('parte de los candidatos y guarda un plan válido tal como lo escribe la persona', async () => {
    const { calls } = openResolution({
      preview: CANDIDATES,
      extra: {
        [`POST ${BATCH_URL}/stage-plan`]: {
          status: 200,
          body: importBatch({ stagePlan: savedPlan }),
        },
      },
    });
    const panel = await section('Plan de etapas');
    const candidates = await within(panel).findByRole('table', { name: 'Candidatos de etapa' });
    expect(within(candidates).getByText('Ronda 1')).toBeTruthy();
    expect(within(candidates).getByText('2–3')).toBeTruthy();

    const form = within(panel).getByRole('form', { name: 'Plan de etapas' });
    // Del candidato solo se toman el nombre y el rango; la clave y la unidad no se deducen.
    expect(within(form).getByLabelText<HTMLInputElement>('Nombre de la etapa 1').value).toBe(
      'Ronda 1',
    );
    expect(within(form).getByLabelText<HTMLInputElement>('Clave de la etapa 1').value).toBe('');
    expect(within(form).getByLabelText<HTMLInputElement>('Unidad de la etapa 1').value).toBe('');
    await fillStage(form);

    expect(await screen.findByText('Se guardó el plan de etapas.')).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe(`${BATCH_URL}/stage-plan`);
    expect(post.body).toEqual({
      stages: [
        {
          key: 'R1',
          name: 'Ronda 1',
          unitStake: '10.00',
          startsAt: new Date('2026-05-01T00:00').toISOString(),
          status: 'ACTIVE',
          firstRow: 2,
          lastRow: 3,
        },
      ],
    });
    expect(within(form).getByText('Plan guardado (editable)')).toBeTruthy();
  });

  it('muestra los problemas del plan que rechaza la API', async () => {
    openResolution({
      preview: CANDIDATES,
      extra: {
        [`POST ${BATCH_URL}/stage-plan`]: rejected({
          issues: [
            'Solo la última etapa del plan (por orden de filas) puede quedar activa.',
            'Etapa 1: la clave "R1" está repetida.',
          ],
        }),
      },
    });
    const panel = await section('Plan de etapas');
    const form = await within(panel).findByRole('form', { name: 'Plan de etapas' });
    await fillStage(form);

    const alert = await within(form).findByRole('alert');
    expect(within(alert).getByText('La API rechazó el plan:')).toBeTruthy();
    expect(
      within(alert).getByText(
        'Solo la última etapa del plan (por orden de filas) puede quedar activa.',
      ),
    ).toBeTruthy();
    expect(within(alert).getByText('Etapa 1: la clave "R1" está repetida.')).toBeTruthy();
    expect(screen.queryByText('Se guardó el plan de etapas.')).toBeNull();
  });

  it('traduce la ruta de un error de esquema a la etapa y el campo', async () => {
    openResolution({
      preview: CANDIDATES,
      extra: {
        [`POST ${BATCH_URL}/stage-plan`]: rejected([
          { path: 'stages.0.unitStake', message: 'El monto debe ser mayor que cero.' },
        ]),
      },
    });
    const panel = await section('Plan de etapas');
    const form = await within(panel).findByRole('form', { name: 'Plan de etapas' });
    await fillStage(form);
    expect(
      await within(form).findByText('Etapa 1, unidad: El monto debe ser mayor que cero.'),
    ).toBeTruthy();
  });

  it('sin import.run no ve controles, solo la casa y el plan guardados', async () => {
    const { calls } = openResolution({
      batch: { status: 'VALIDATED', houseId: BETSAFE_ID, stagePlan: savedPlan },
      project: { myPermissions: VIEW_ONLY },
    });
    const house = await section('Casa del lote');
    // Candidata y confirmada coinciden: las dos muestran Betsafe.
    expect(await within(house).findAllByText('Betsafe', { selector: 'dd' })).toHaveLength(2);
    expect(within(house).queryByRole('form')).toBeNull();

    const plan = await section('Plan de etapas');
    const table = within(plan).getByRole('table', { name: 'Plan de etapas guardado' });
    expect(within(table).getByText('R1')).toBeTruthy();
    expect(within(table).getByText('S/ 10.00')).toBeTruthy();
    expect(within(plan).queryByRole('form')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Confirmar casa|Corregir casa|Guardar plan/ }),
    ).toBeNull();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('un lote ya importado no ofrece controles aunque se tenga import.run', async () => {
    openResolution({ batch: { status: 'IMPORTED', houseId: BETSAFE_ID, stagePlan: savedPlan } });
    const plan = await section('Plan de etapas');
    expect(within(plan).getByRole('table', { name: 'Plan de etapas guardado' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Casa del lote' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Plan de etapas' })).toBeNull();
  });
});

describe('Reconocimiento, confirmación y anulación', () => {
  const BATCH_URL = `${BATCHES_URL}/${BATCH_ID}`;
  const REAUTH: StubResponse = {
    status: 200,
    body: { reauthenticatedAt: '2026-06-01T12:00:00.000Z' },
  };
  const DUPLICATE_REASON =
    '1 grupo(s) de filas con la misma fecha, monto, cuota y descripción dentro del propio archivo (D-X10).';
  const pendingAck = readiness({
    needsAcknowledgment: true,
    acknowledgmentReasons: [DUPLICATE_REASON],
    canConfirm: false,
  });
  const PLAN = {
    stages: [
      {
        key: 'R1',
        name: 'Ronda 1',
        unitStake: '10.00',
        startsAt: null,
        status: 'ACTIVE',
        firstRow: 2,
        lastRow: 3,
      },
    ],
  };
  const validated = { status: 'VALIDATED', houseId: BETSAFE_ID, stagePlan: PLAN };

  function openLifecycle({
    batch = validated,
    ready = readiness(),
    project = {},
    extra = {},
  }: {
    batch?: Record<string, unknown>;
    ready?: Handler;
    project?: Record<string, unknown>;
    extra?: Record<string, Handler>;
  } = {}) {
    return open(`${URL}/imports/${BATCH_ID}`, project, {
      [`GET ${BATCH_URL}`]: { status: 200, body: importBatch(batch) },
      [`GET ${BATCH_URL}/preview`]: { status: 200, body: importPreview() },
      [`GET ${BATCH_URL}/readiness`]: ready,
      [`GET ${HOUSES_URL}`]: HOUSES,
      ...extra,
    });
  }

  const writeResult = () => ({
    batch: importBatch({
      status: 'IMPORTED',
      houseId: BETSAFE_ID,
      importedAt: '2026-06-02T12:00:00.000Z',
      importReason: 'Historial de Betsafe',
    }),
    stageIds: ['s1'],
    initialCapitalMovementId: null,
    betIds: ['b1', 'b2'],
    report: {
      houseId: BETSAFE_ID,
      stages: 1,
      initialCapital: null,
      bets: { total: 2, won: 1, lost: 1, pending: 0 },
      ledgerRows: 4,
      profitLoss: '-0.50',
      balanceBefore: '0.00',
      balanceAfter: '-0.50',
      warnings: [],
    },
  });

  async function openConfirmForm() {
    const panel = await section('Confirmación');
    const start = await within(panel).findByRole('button', { name: 'Confirmar importación' });
    await waitFor(() => expect(start).toHaveProperty('disabled', false));
    fireEvent.click(start);
    const form = within(panel).getByRole('form', { name: 'Confirmar importación' });
    fireEvent.change(within(form).getByLabelText('Motivo de la confirmación'), {
      target: { value: 'Historial de Betsafe' },
    });
    return { panel, form };
  }

  it('muestra los motivos de la API y registra el reconocimiento', async () => {
    let acknowledged = false;
    const { calls } = openLifecycle({
      ready: () =>
        acknowledged
          ? readiness({
              needsAcknowledgment: true,
              acknowledgmentReasons: [DUPLICATE_REASON],
              acknowledged: true,
            })
          : pendingAck,
      extra: {
        [`POST ${BATCH_URL}/acknowledge`]: () => {
          acknowledged = true;
          return {
            status: 200,
            body: importBatch({
              ...validated,
              acknowledgedAt: '2026-06-01T13:00:00.000Z',
              acknowledgmentReason: 'Son dos apuestas distintas.',
            }),
          };
        },
      },
    });
    const panel = await section('Reconocimiento');
    expect(await within(panel).findByText(DUPLICATE_REASON)).toBeTruthy();
    const form = within(panel).getByRole('form', { name: 'Reconocer el lote' });
    const submit = within(form).getByRole('button', { name: 'Reconocer' });
    expect(submit).toHaveProperty('disabled', true); // el motivo es obligatorio
    fireEvent.change(within(form).getByLabelText('Motivo del reconocimiento'), {
      target: { value: 'Son dos apuestas distintas.' },
    });
    fireEvent.click(submit);

    expect(await screen.findByText('Se registró el reconocimiento del lote.')).toBeTruthy();
    expect(within(panel).getByText('Reconocido')).toBeTruthy();
    expect(within(panel).getByText(/Motivo: Son dos apuestas distintas\./)).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      reason: 'Son dos apuestas distintas.',
    });
    // Tras reconocer, la disponibilidad se vuelve a pedir a la API: ahora puede confirmarse.
    const confirmation = await section('Confirmación');
    expect(await within(confirmation).findByText('Sí, ya reconocido')).toBeTruthy();
    expect(
      within(confirmation).getByRole('button', { name: 'Confirmar importación' }),
    ).toHaveProperty('disabled', false);
  });

  it('muestra el rechazo de la API al reconocer', async () => {
    openLifecycle({
      ready: pendingAck,
      extra: {
        [`POST ${BATCH_URL}/acknowledge`]: apiError(
          409,
          'INVALID_STATE',
          'Este lote ya no admite reconocimientos.',
        ),
      },
    });
    const panel = await section('Reconocimiento');
    const form = await within(panel).findByRole('form', { name: 'Reconocer el lote' });
    fireEvent.change(within(form).getByLabelText('Motivo del reconocimiento'), {
      target: { value: 'Revisado.' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Reconocer' }));
    const alert = await within(form).findByRole('alert');
    expect(within(alert).getByText('Este lote ya no admite reconocimientos.')).toBeTruthy();
    expect(screen.queryByText('Se registró el reconocimiento del lote.')).toBeNull();
  });

  it('sin reconocimiento la confirmación queda bloqueada, según la API', async () => {
    const { calls } = openLifecycle({ ready: pendingAck });
    const panel = await section('Confirmación');
    expect(await within(panel).findByText('Falta el reconocimiento del lote.')).toBeTruthy();
    expect(within(panel).getByText('Sí, pendiente (1 motivo(s))')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Confirmar importación' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(calls.some((c) => c.path.endsWith('/confirm'))).toBe(false);
  });

  it('si la API rechaza la confirmación, muestra su mensaje y sus motivos', async () => {
    openLifecycle({
      extra: {
        [`POST ${BATCH_URL}/confirm`]: {
          status: 409,
          body: {
            statusCode: 409,
            code: 'INVALID_STATE',
            message: 'Este lote necesita un reconocimiento explícito antes de confirmarse.',
            details: { issues: [DUPLICATE_REASON] },
          },
        },
      },
    });
    const { form } = await openConfirmForm();
    fireEvent.click(within(form).getByRole('button', { name: 'Confirmar' }));
    const alert = await within(form).findByRole('alert');
    expect(
      within(alert).getByText(
        'Este lote necesita un reconocimiento explícito antes de confirmarse.',
      ),
    ).toBeTruthy();
    expect(within(alert).getByText(DUPLICATE_REASON)).toBeTruthy();
  });

  it('confirma tras pedir la contraseña cuando la API exige reautenticación', async () => {
    let reauthed = false;
    const { calls } = openLifecycle({
      extra: {
        [`POST ${BATCH_URL}/confirm`]: () =>
          reauthed ? { status: 200, body: writeResult() } : apiError(403, 'REAUTH_REQUIRED'),
        'POST /auth/reauth': () => {
          reauthed = true;
          return REAUTH;
        },
      },
    });
    const { form } = await openConfirmForm();
    fireEvent.click(within(form).getByRole('checkbox', { name: /Es un ensayo/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Confirmar' }));

    const dialog = await screen.findByRole('dialog', { name: 'Confirma tu contraseña' });
    fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
      target: { value: 'mi-clave-secreta' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    expect(
      await screen.findByText('Se importó el lote: 2 apuestas y 1 etapas registradas.'),
    ).toBeTruthy();
    const posts = calls.filter((c) => c.path === `${BATCH_URL}/confirm`);
    expect(posts).toHaveLength(2);
    // Sin `origin`: la API lo lee del propio lote.
    expect(posts[1]!.body).toEqual({ reason: 'Historial de Betsafe', isRehearsal: true });
  });

  it('una confirmación exitosa deja el lote importado y ofrece anularlo', async () => {
    const { calls } = openLifecycle({
      extra: { [`POST ${BATCH_URL}/confirm`]: { status: 200, body: writeResult() } },
    });
    const { form } = await openConfirmForm();
    fireEvent.click(within(form).getByRole('button', { name: 'Confirmar' }));

    expect(
      await screen.findByText('Se importó el lote: 2 apuestas y 1 etapas registradas.'),
    ).toBeTruthy();
    const summary = await section('Betsafe.xlsx');
    expect(within(summary).getByText('Importado', { selector: 'span' })).toBeTruthy();
    expect(within(summary).getByText(/Historial de Betsafe/)).toBeTruthy();
    expect(calls.find((c) => c.path === `${BATCH_URL}/confirm`)!.body).toMatchObject({
      isRehearsal: false,
    });
    // Reconocer y confirmar ya no aplican; anular sí.
    expect(screen.queryByRole('heading', { name: 'Confirmación' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Reconocimiento' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Anular lote' })).toBeTruthy();
    await waitFor(() =>
      expect(calls.filter((c) => c.path === `${BATCH_URL}/readiness`)).toHaveLength(2),
    );
  });

  const imported = {
    status: 'IMPORTED',
    houseId: BETSAFE_ID,
    importedAt: '2026-06-02T12:00:00.000Z',
  };

  async function openAnnulForm() {
    const panel = await section('Anulación');
    fireEvent.click(within(panel).getByRole('button', { name: 'Anular lote' }));
    const form = within(panel).getByRole('form', { name: 'Anular lote' });
    expect(within(form).getByText(/Esta acción no se puede deshacer/)).toBeTruthy();
    const submit = within(form).getByRole('button', { name: 'Confirmar anulación' });
    expect(submit).toHaveProperty('disabled', true); // el motivo es obligatorio
    fireEvent.change(within(form).getByLabelText('Motivo de la anulación'), {
      target: { value: 'Archivo equivocado' },
    });
    fireEvent.click(submit);
    return form;
  }

  it('anula un lote importado tras la confirmación previa', async () => {
    const { calls } = openLifecycle({
      batch: imported,
      extra: {
        [`POST ${BATCH_URL}/annul`]: {
          status: 200,
          body: {
            batch: importBatch({
              ...imported,
              status: 'ANNULLED',
              annulledAt: '2026-06-03T12:00:00.000Z',
              annulmentReason: 'Archivo equivocado',
            }),
            annulledBetIds: ['b1', 'b2'],
            reversedMovementIds: ['m1', 'm2', 'm3'],
            annulledStageIds: ['s1'],
            keptStageIds: [],
          },
        },
      },
    });
    await openAnnulForm();

    expect(
      await screen.findByText('Se anuló el lote: 2 apuestas anuladas y 3 movimientos revertidos.'),
    ).toBeTruthy();
    expect(calls.find((c) => c.path === `${BATCH_URL}/annul`)!.body).toEqual({
      reason: 'Archivo equivocado',
    });
    const summary = await section('Betsafe.xlsx');
    expect(within(summary).getByText('Anulado', { selector: 'span' })).toBeTruthy();
    expect(within(summary).getByText(/Archivo equivocado/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Anulación' })).toBeNull();
  });

  it('muestra el error de la API al anular', async () => {
    openLifecycle({
      batch: imported,
      extra: {
        [`POST ${BATCH_URL}/annul`]: apiError(
          409,
          'INVALID_STATE',
          'Anular este lote dejaría un saldo negativo.',
        ),
      },
    });
    const form = await openAnnulForm();
    const alert = await within(form).findByRole('alert');
    expect(within(alert).getByText('Anular este lote dejaría un saldo negativo.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Anulación' })).toBeTruthy();
  });

  it('sin import.run ve el estado y los motivos, pero ninguna acción', async () => {
    openLifecycle({ ready: pendingAck, project: { myPermissions: VIEW_ONLY } });
    const panel = await section('Reconocimiento');
    expect(await within(panel).findByText(DUPLICATE_REASON)).toBeTruthy();
    expect(within(panel).queryByRole('form')).toBeNull();
    const confirmation = await section('Confirmación');
    expect(within(confirmation).getByText('Sí, pendiente (1 motivo(s))')).toBeTruthy();
    expect(within(confirmation).queryByRole('button')).toBeNull();
  });

  it('sin import.run no puede anular un lote importado', async () => {
    openLifecycle({ batch: imported, project: { myPermissions: VIEW_ONLY } });
    await section('Betsafe.xlsx');
    await section('Resumen de la vista previa');
    expect(screen.queryByRole('heading', { name: 'Anulación' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Anular lote' })).toBeNull();
  });
});

describe('Flujo completo de importación (integración de página)', () => {
  const BATCH_URL = `${BATCHES_URL}/${BATCH_ID}`;
  const REAUTH: StubResponse = {
    status: 200,
    body: { reauthenticatedAt: '2026-06-01T12:00:00.000Z' },
  };
  const DUPLICATE_REASON = '1 grupo(s) de filas duplicadas dentro del propio archivo (D-X10).';

  /**
   * Una API simulada con estado: cada acción cambia el lote igual que lo haría la real (estado,
   * casa, plan, reconocimiento), y la disponibilidad responde según ese estado. Así se comprueba
   * que la página vuelve a pedir lo que cambió después de cada paso, y solo eso.
   */
  function fakeImportApi(
    initial: Record<string, unknown> | null = null,
    path = `${URL}/imports/new`,
  ) {
    let batch: Record<string, unknown> | null = initial && importBatch(initial);
    let reauthed = false;
    const current = () => {
      if (!batch) throw new Error('Todavía no se subió el lote');
      return batch;
    };
    const update = (patch: Record<string, unknown>) => {
      batch = { ...current(), ...patch, version: (current().version as number) + 1 };
      return { status: 200, body: batch };
    };
    const needsReauth = (respond: (call: RecordedCall) => StubResponse) => (call: RecordedCall) =>
      reauthed ? respond(call) : apiError(403, 'REAUTH_REQUIRED');

    const stub = open(
      path,
      {},
      {
        [`POST ${BATCHES_URL}`]: () => {
          batch = importBatch();
          return { status: 201, body: batch };
        },
        [`GET ${BATCH_URL}`]: () => ({ status: 200, body: current() }),
        [`GET ${BATCH_URL}/preview`]: {
          status: 200,
          body: importPreview({
            stages: {
              candidates: [
                { label: 'Ronda 1', labelRow: 1, firstRow: 2, lastRow: 3, evidence: 'Título' },
              ],
            },
          }),
        },
        [`GET ${BATCH_URL}/readiness`]: () => {
          const acknowledged = current().acknowledgedAt !== null;
          return readiness({
            needsAcknowledgment: true,
            acknowledgmentReasons: [DUPLICATE_REASON],
            acknowledged,
            canConfirm: acknowledged,
          });
        },
        [`GET ${HOUSES_URL}`]: HOUSES,
        [`POST ${BATCH_URL}/house`]: (call) =>
          update({ status: 'VALIDATED', houseId: (call.body as { houseId: string }).houseId }),
        [`POST ${BATCH_URL}/stage-plan`]: (call) => update({ stagePlan: call.body }),
        [`POST ${BATCH_URL}/acknowledge`]: needsReauth((call) =>
          update({
            acknowledgedAt: '2026-06-01T13:00:00.000Z',
            acknowledgmentReason: (call.body as { reason: string }).reason,
          }),
        ),
        [`POST ${BATCH_URL}/confirm`]: needsReauth(() => {
          update({
            status: 'IMPORTED',
            importedAt: '2026-06-01T14:00:00.000Z',
            importReason: 'Historial de Betsafe',
          });
          return {
            status: 200,
            body: {
              batch: current(),
              stageIds: ['s1'],
              initialCapitalMovementId: 'm0',
              betIds: ['b1', 'b2'],
              report: {
                houseId: BETSAFE_ID,
                stages: 1,
                initialCapital: '100.00',
                bets: { total: 2, won: 1, lost: 1, pending: 0 },
                ledgerRows: 5,
                profitLoss: '-0.50',
                balanceBefore: '0.00',
                balanceAfter: '99.50',
                warnings: [],
              },
            },
          };
        }),
        [`POST ${BATCH_URL}/annul`]: needsReauth(() => {
          update({
            status: 'ANNULLED',
            annulledAt: '2026-06-01T15:00:00.000Z',
            annulmentReason: 'Archivo equivocado',
          });
          return {
            status: 200,
            body: {
              batch: current(),
              annulledBetIds: ['b1', 'b2'],
              reversedMovementIds: ['m0', 'm1', 'm2'],
              annulledStageIds: ['s1'],
              keptStageIds: [],
            },
          };
        }),
        'POST /auth/reauth': () => {
          reauthed = true;
          return REAUTH;
        },
      },
    );
    const count = (method: string, suffix: string) =>
      stub.calls.filter((c) => c.method === method && c.path === `${BATCH_URL}${suffix}`).length;
    return { ...stub, count };
  }

  async function passReauth() {
    const dialog = await screen.findByRole('dialog', { name: 'Confirma tu contraseña' });
    fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
      target: { value: 'mi-clave-secreta' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
  }

  const summaryStatus = async (label: string) =>
    within(await section('Betsafe.xlsx')).findByText(label, { selector: 'span' });

  it('recorre subida → casa → plan → reconocimiento → confirmación → anulación, refrescando cada vez', async () => {
    const api = fakeImportApi();

    // 1. Subida: abre el detalle del lote creado.
    const uploadForm = await screen.findByRole('form', { name: 'Subir archivo' });
    fireEvent.change(within(uploadForm).getByLabelText('Archivo (.xlsx)'), {
      target: { files: [new File(['x'], 'Betsafe.xlsx', { type: XLSX_TYPE })] },
    });
    fireEvent.click(within(uploadForm).getByRole('button', { name: 'Subir archivo' }));
    expect(await summaryStatus('Subido')).toBeTruthy();
    expect(
      screen.getByText('Se subió el archivo. Todavía no se ha registrado nada en el ledger.'),
    ).toBeTruthy();
    await waitFor(() => expect(api.count('GET', '/readiness')).toBe(1));
    expect(api.count('GET', '/preview')).toBe(1);
    const confirmation = await section('Confirmación');
    expect(within(confirmation).getByText('Confirma la casa del lote.')).toBeTruthy();
    expect(within(confirmation).getByText('Guarda el plan de etapas.')).toBeTruthy();
    expect(within(confirmation).getByText('Falta el reconocimiento del lote.')).toBeTruthy();
    const start = within(confirmation).getByRole('button', { name: 'Confirmar importación' });
    expect(start).toHaveProperty('disabled', true);

    // 2. Casa: el lote pasa a Validado; se vuelven a pedir vista previa y disponibilidad.
    const houseForm = await screen.findByRole('form', { name: 'Casa del lote' });
    await waitFor(() =>
      expect(within(houseForm).getByRole<HTMLSelectElement>('combobox').value).toBe(BETSAFE_ID),
    );
    fireEvent.click(within(houseForm).getByRole('button', { name: 'Confirmar casa' }));
    expect(await screen.findByText('Se confirmó la casa del lote.')).toBeTruthy();
    // El aviso de la subida ya no aplica: lo sustituye el de la última acción.
    expect(screen.queryByText(/Se subió el archivo/)).toBeNull();
    expect(await summaryStatus('Validado')).toBeTruthy();
    await waitFor(() => expect(api.count('GET', '/readiness')).toBe(2));
    expect(api.count('GET', '/preview')).toBe(2);
    expect(within(confirmation).queryByText('Confirma la casa del lote.')).toBeNull();

    // 3. Plan: solo cambia el lote (la vista previa y la disponibilidad no dependen de él).
    const planForm = screen.getByRole('form', { name: 'Plan de etapas' });
    fireEvent.change(within(planForm).getByLabelText('Clave de la etapa 1'), {
      target: { value: 'R1' },
    });
    fireEvent.change(within(planForm).getByLabelText('Unidad de la etapa 1'), {
      target: { value: '10.00' },
    });
    fireEvent.click(within(planForm).getByRole('button', { name: 'Guardar plan' }));
    expect(await screen.findByText('Se guardó el plan de etapas.')).toBeTruthy();
    expect(within(confirmation).getByText('1 etapa(s) guardada(s)')).toBeTruthy();
    expect(within(confirmation).queryByText('Guarda el plan de etapas.')).toBeNull();
    expect(api.count('GET', '/readiness')).toBe(2);
    expect(api.count('GET', '/preview')).toBe(2);

    // 4. Reconocimiento (con reautenticación): la API ya permite confirmar.
    const ackForm = within(await section('Reconocimiento')).getByRole('form', {
      name: 'Reconocer el lote',
    });
    fireEvent.change(within(ackForm).getByLabelText('Motivo del reconocimiento'), {
      target: { value: 'Son dos apuestas distintas.' },
    });
    fireEvent.click(within(ackForm).getByRole('button', { name: 'Reconocer' }));
    await passReauth();
    expect(await screen.findByText('Se registró el reconocimiento del lote.')).toBeTruthy();
    await waitFor(() => expect(api.count('GET', '/readiness')).toBe(3));
    expect(await within(confirmation).findByText('Sí, ya reconocido')).toBeTruthy();
    await waitFor(() => expect(start).toHaveProperty('disabled', false));

    // 5. Confirmación: explica qué se registrará antes de hacerlo.
    fireEvent.click(start);
    const confirmForm = within(confirmation).getByRole('form', { name: 'Confirmar importación' });
    expect(
      within(confirmForm).getByText(/Se registrarán en el ledger 2 apuestas en Betsafe/),
    ).toBeTruthy();
    expect(
      within(confirmForm).getByText(/capital inicial declarado en el archivo: S\/ 100\.00/),
    ).toBeTruthy();
    fireEvent.change(within(confirmForm).getByLabelText('Motivo de la confirmación'), {
      target: { value: 'Historial de Betsafe' },
    });
    fireEvent.click(within(confirmForm).getByRole('button', { name: 'Confirmar' }));
    expect(
      await screen.findByText('Se importó el lote: 2 apuestas y 1 etapas registradas.'),
    ).toBeTruthy();
    expect(await summaryStatus('Importado')).toBeTruthy();
    expect(screen.getByText(/Este lote ya está registrado en el ledger/)).toBeTruthy();
    // Terminal para casa, plan, reconocimiento y confirmación: sin controles.
    expect(screen.queryByRole('form', { name: 'Casa del lote' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Plan de etapas' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Confirmación' })).toBeNull();
    await waitFor(() => expect(api.count('GET', '/preview')).toBe(3));

    // 6. Anulación.
    const annulPanel = await section('Anulación');
    fireEvent.click(within(annulPanel).getByRole('button', { name: 'Anular lote' }));
    const annulForm = within(annulPanel).getByRole('form', { name: 'Anular lote' });
    fireEvent.change(within(annulForm).getByLabelText('Motivo de la anulación'), {
      target: { value: 'Archivo equivocado' },
    });
    fireEvent.click(within(annulForm).getByRole('button', { name: 'Confirmar anulación' }));
    // La reautenticación ya se hizo: la API no la vuelve a pedir en esta sesión simulada.
    expect(
      await screen.findByText('Se anuló el lote: 2 apuestas anuladas y 3 movimientos revertidos.'),
    ).toBeTruthy();
    expect(await summaryStatus('Anulado')).toBeTruthy();
    expect(screen.getByText(/Este lote está anulado/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Anulación' })).toBeNull();
    expect(within(screen.getByRole('main')).queryByRole('button')).toBeNull();

    // Cada acción se envió una sola vez con éxito (más el intento rechazado por reautenticación).
    expect(api.count('POST', '/house')).toBe(1);
    expect(api.count('POST', '/stage-plan')).toBe(1);
    expect(api.count('POST', '/acknowledge')).toBe(2);
    expect(api.count('POST', '/confirm')).toBe(1);
    expect(api.count('POST', '/annul')).toBe(1);
  });

  it('un lote anulado es terminal: se consulta, pero no ofrece ninguna acción', async () => {
    const api = fakeImportApi(
      {
        status: 'ANNULLED',
        houseId: BETSAFE_ID,
        importedAt: '2026-06-01T14:00:00.000Z',
        annulledAt: '2026-06-01T15:00:00.000Z',
        annulmentReason: 'Archivo equivocado',
      },
      `${URL}/imports/${BATCH_ID}`,
    );
    expect(await summaryStatus('Anulado')).toBeTruthy();
    expect(screen.getByText(/Este lote está anulado/)).toBeTruthy();
    await section('Resumen de la vista previa');
    expect(screen.queryByRole('heading', { name: 'Anulación' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Confirmación' })).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
    expect(within(screen.getByRole('main')).queryByRole('button')).toBeNull();
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('Permisos en las pantallas de importación', () => {
  const BATCH_URL = `${BATCHES_URL}/${BATCH_ID}`;
  const needsAck = readiness({
    needsAcknowledgment: true,
    acknowledgmentReasons: ['2 fila(s) parcial(es) requieren revisión (D-X21b).'],
    canConfirm: false,
  });

  function openDetail(project: Record<string, unknown>, batch: Record<string, unknown>) {
    return open(`${URL}/imports/${BATCH_ID}`, project, {
      [`GET ${BATCHES_URL}`]: { status: 200, body: [importBatch(batch)] },
      [`GET ${BATCH_URL}`]: { status: 200, body: importBatch(batch) },
      [`GET ${BATCH_URL}/preview`]: { status: 200, body: importPreview() },
      [`GET ${BATCH_URL}/readiness`]: needsAck,
      [`GET ${HOUSES_URL}`]: HOUSES,
    });
  }

  it('imports.view sin import.run: consulta todo, sin ninguna acción', async () => {
    const { calls } = openDetail({ myPermissions: VIEW_ONLY }, { status: 'UPLOADED' });
    expect(await within(await section('Reconocimiento')).findByText(/parcial/)).toBeTruthy();
    await section('Resumen de la vista previa');
    expect(screen.queryByRole('form')).toBeNull();
    expect(within(screen.getByRole('main')).queryByRole('button')).toBeNull();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    // En la lista tampoco se ofrece subir.
    fireEvent.click(screen.getByRole('link', { name: '← Volver a importaciones' }));
    await screen.findByRole('table', { name: 'Lotes de importación' });
    expect(screen.queryByRole('link', { name: 'Subir archivo' })).toBeNull();
  });

  it('import.run con imports.view: ofrece cada acción del estado actual', async () => {
    openDetail({}, { status: 'UPLOADED' });
    expect(await screen.findByRole('form', { name: 'Casa del lote' })).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Plan de etapas' })).toBeTruthy();
    expect(await screen.findByRole('form', { name: 'Reconocer el lote' })).toBeTruthy();
    // Confirmar existe, pero la API todavía no lo permitiría: se ofrece desactivado y con el motivo.
    const start = screen.getByRole('button', { name: 'Confirmar importación' });
    expect(start).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Anular lote' })).toBeNull();
  });

  it('sin acceso al proyecto no se ve nada ni se pide ningún lote', async () => {
    const { calls } = stubApi({
      'GET /auth/me': AUTH_STATE,
      [`GET ${URL}`]: apiError(404, 'NOT_FOUND'),
    });
    renderApp(`${URL}/imports/${BATCH_ID}`);
    expect(
      await screen.findByText('No se encontró el proyecto, o no tienes acceso a él.'),
    ).toBeTruthy();
    expect(calls.some((c) => c.path.startsWith(BATCHES_URL))).toBe(false);
  });
});

/** La sección (`Section`) cuyo título es `title`. */
async function section(title: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: title });
  return heading.closest('section')!;
}
