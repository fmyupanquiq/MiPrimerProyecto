import { ErrorCode } from '@letfer/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from './client.js';
import { describeApiError } from './errors.js';

const apiError = (code: string, message: string, details?: unknown) =>
  new ApiError(400, { statusCode: 400, code: code as ErrorCode, message, details });

describe('describeApiError: mensajes humanos sin perder lo útil del backend (Fase 10.3)', () => {
  it('sin respuesta de la API: problema de conexión', () => {
    expect(describeApiError(new Error('boom'))).toMatch(/No se pudo conectar con el servidor/);
  });

  it('validación: muestra los campos y motivos que dio la API', () => {
    const error = apiError(ErrorCode.VALIDATION_FAILED, 'Los datos enviados no son válidos.', [
      { path: 'stake', message: 'Debe ser mayor que 0.' },
      { path: 'selections.0.visibleOdds', message: 'Debe ser mayor que 1.' },
    ]);
    expect(describeApiError(error)).toBe(
      'Revisa los datos ingresados. Stake: Debe ser mayor que 0. · Cuota: Debe ser mayor que 1.',
    );
  });

  it('validación con un motivo de negocio redactado por la API', () => {
    const error = apiError(ErrorCode.VALIDATION_FAILED, 'La casa no existe en este proyecto.');
    expect(describeApiError(error)).toBe(
      'Revisa los datos ingresados. La casa no existe en este proyecto.',
    );
  });

  it('validación genérica: no repite el texto técnico', () => {
    const error = apiError(ErrorCode.VALIDATION_FAILED, 'Los datos enviados no son válidos.');
    expect(describeApiError(error)).toBe('Revisa los datos ingresados.');
  });

  it('conflictos de negocio: el motivo exacto de la API (saldo, correcciones)', () => {
    expect(
      describeApiError(
        apiError(
          ErrorCode.INVALID_STATE,
          'El saldo disponible de la casa no alcanza para esta apuesta.',
        ),
      ),
    ).toBe('El saldo disponible de la casa no alcanza para esta apuesta.');
    expect(
      describeApiError(
        apiError(
          ErrorCode.CORRECTION_CONFLICT,
          'La corrección dejaría una casa con saldo negativo en el historial.',
        ),
      ),
    ).toBe('La corrección dejaría una casa con saldo negativo en el historial.');
  });

  it('nunca muestra un código técnico', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(describeApiError(apiError(code, 'mensaje'))).not.toContain(code);
    }
    expect(describeApiError(apiError('ALGO_RARO', 'x'))).toMatch(/error inesperado/);
  });
});
