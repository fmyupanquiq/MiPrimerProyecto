import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './client.js';
import { describeApiError } from './errors.js';

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body?: string) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(body ?? null, { status }))),
  );

describe('apiFetch', () => {
  it('llama a /api con la cookie del mismo origen y devuelve el JSON', async () => {
    respond(200, JSON.stringify({ ok: true }));
    await expect(apiFetch<{ ok: boolean }>('/health')).resolves.toEqual({ ok: true });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/health');
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin' });
  });

  it('envía el cuerpo como JSON', async () => {
    respond(200, '{}');
    await apiFetch('/x', { method: 'POST', body: { a: 1 } });
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.body).toBe('{"a":1}');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('un 204 devuelve undefined', async () => {
    respond(204);
    await expect(apiFetch('/x', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('convierte los errores de la API en ApiError con su código', async () => {
    respond(429, JSON.stringify({ statusCode: 429, code: 'ACCOUNT_LOCKED', message: 'bloqueada' }));
    const error = await apiFetch('/x').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(429);
    expect((error as ApiError).code).toBe('ACCOUNT_LOCKED');
  });

  it('una respuesta de error que no es JSON se trata como error interno', async () => {
    respond(502, '<html>Bad Gateway</html>');
    const error = (await apiFetch('/x').catch((caught: unknown) => caught)) as ApiError;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.status).toBe(502);
  });
});

describe('describeApiError', () => {
  it('no revela detalles internos en los errores desconocidos', () => {
    expect(describeApiError(new Error('boom con datos internos'))).toMatch(/No se pudo conectar/);
    const internal = new ApiError(500, {
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'detalle interno',
    });
    expect(describeApiError(internal)).not.toContain('detalle interno');
  });

  it('el bloqueo usa singular y plural correctamente', () => {
    const locked = (retryAfterSeconds: number) =>
      new ApiError(429, {
        statusCode: 429,
        code: 'ACCOUNT_LOCKED',
        message: 'x',
        retryAfterSeconds,
      });
    expect(describeApiError(locked(30))).toContain('1 minuto.');
    expect(describeApiError(locked(600))).toContain('10 minutos.');
  });
});
