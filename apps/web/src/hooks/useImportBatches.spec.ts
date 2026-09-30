import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReauthProvider } from '../auth/ReauthContext.js';
import { PROJECT_ID, stubApi } from '../test-utils.js';
import {
  useAcknowledgeImport,
  useImportPreview,
  useUploadImportBatch,
} from './useImportBatches.js';

afterEach(() => vi.unstubAllGlobals());

const BATCH_ID = '0195f7c0-0000-7000-8000-0000000000c1';
const BATCHES_URL = `/projects/${PROJECT_ID}/import-batches`;

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
    rowsTotal: 0,
    rowsValid: 0,
    rowsTemplate: 0,
    rowsEmpty: 0,
    rowsPartial: 0,
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

function importPreview(overrides: Record<string, unknown> = {}) {
  return {
    file: { originalName: 'Betsafe.xlsx', sizeBytes: 1234, sha256: 'a'.repeat(64) },
    origin: 'Betsafe',
    summary: {
      totalRows: 0,
      valid: 0,
      template: 0,
      empty: 0,
      partial: 0,
      invalid: 0,
      preliminaryBets: 0,
    },
    semaphore: 'OK',
    rows: [],
    capital: {
      detected: false,
      amount: null,
      houseCandidate: 'Betsafe',
      occurredAt: null,
      occurredAtKnown: false,
    },
    stages: { candidates: [] },
    bets: [],
    financialContrast: {
      configured: false,
      bets: [],
      totalProfitResidual: '0.00',
      rowsWithMoreThanTwoDecimals: 0,
      semaphore: 'GREEN',
      headerChecks: [],
      initialBankAmount: null,
    },
    duplicates: { withinFile: [], againstHistory: [] },
    ...overrides,
  };
}

describe('useImportPreview', () => {
  it('carga la vista previa del lote', async () => {
    stubApi({
      [`GET ${BATCHES_URL}/${BATCH_ID}/preview`]: { status: 200, body: importPreview() },
    });
    const { result } = renderHook(() => useImportPreview(PROJECT_ID, BATCH_ID));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.origin).toBe('Betsafe');
    expect(result.current.error).toBeNull();
  });
});

describe('useUploadImportBatch', () => {
  it('sube el archivo (con su origen) y ejecuta la mutación', async () => {
    const { calls } = stubApi({
      [`POST ${BATCHES_URL}`]: { status: 201, body: importBatch() },
    });
    const { result } = renderHook(() => useUploadImportBatch(PROJECT_ID));

    const file = new File(['contenido'], 'Betsafe.xlsx');
    let uploaded: unknown;
    await act(async () => {
      uploaded = await result.current.upload(file, 'Betsafe');
    });

    expect(uploaded).toEqual(importBatch());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', path: BATCHES_URL });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe('useAcknowledgeImport', () => {
  it('propaga un ApiError: `acknowledge` rechaza y `error` guarda el mensaje descrito', async () => {
    stubApi({
      [`POST ${BATCHES_URL}/${BATCH_ID}/acknowledge`]: {
        status: 409,
        body: { statusCode: 409, code: 'CONFLICT', message: 'El lote no se puede reconocer.' },
      },
    });
    const { result } = renderHook(() => useAcknowledgeImport(PROJECT_ID, BATCH_ID), {
      wrapper: ReauthProvider,
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.acknowledge({ reason: 'motivo' });
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).not.toBeNull();
  });
});
