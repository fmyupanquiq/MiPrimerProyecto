import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { useSpanishValidationMessages } from '@letfer/shared';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { configureApp } from '../src/app.setup.js';
import { CommonModule } from '../src/common/common.module.js';
import { AuthRateLimit } from '../src/common/rate-limit.js';
import { RequestContext } from '../src/common/request-context.js';
import { ConfigModule } from '../src/config/config.module.js';

const signupSchema = z.object({ email: z.email(), age: z.number().int().min(18) });

@Controller('probe')
class ProbeController {
  @Post('validate')
  validate(@Body({ schema: signupSchema }) body: z.infer<typeof signupSchema>) {
    return body;
  }

  @Post('echo')
  echo(@Body() body: unknown) {
    return { received: true, size: JSON.stringify(body).length };
  }

  @Get('boom')
  boom(): never {
    throw new Error('detalle-interno-secreto: contraseña de la base de datos');
  }

  @Get('ip')
  ip() {
    return { ip: RequestContext.current()?.ip };
  }

  @Get('plain')
  plain() {
    return { ok: true };
  }

  @AuthRateLimit()
  @Get('sensitive')
  sensitive() {
    return { ok: true };
  }
}

@Module({ imports: [ConfigModule, CommonModule], controllers: [ProbeController] })
class ProbeModule {}

describe('base HTTP y seguridad (e2e)', () => {
  let app: NestExpressApplication;

  async function start(env: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    useSpanishValidationMessages();
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    return app.getHttpServer();
  }

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('envía cabeceras de seguridad y no revela el framework', async () => {
    const response = await request(await start())
      .get('/api/probe/plain')
      .expect(200);
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('valida el cuerpo con el esquema y responde el error uniforme con el detalle', async () => {
    const response = await request(await start())
      .post('/api/probe/validate')
      .send({ email: 'no-es-correo', age: 12 })
      .expect(400);

    expect(response.body).toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED' });
    const { details } = response.body as { details: { path: string; message: string }[] };
    expect(details.map((issue) => issue.path).sort()).toEqual(['age', 'email']);
    expect(details.every((issue) => issue.message.length > 0)).toBe(true);
  });

  it('acepta un cuerpo válido y devuelve el valor validado', async () => {
    await request(await start())
      .post('/api/probe/validate')
      .send({ email: 'ana@example.com', age: 30 })
      .expect(201)
      .expect({ email: 'ana@example.com', age: 30 });
  });

  it('rechaza JSON mal formado con VALIDATION_FAILED', async () => {
    const response = await request(await start())
      .post('/api/probe/echo')
      .set('Content-Type', 'application/json')
      .send('{"roto":')
      .expect(400);
    expect(response.body).toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED' });
  });

  it('rechaza cuerpos de más de 100 kB con 413', async () => {
    const response = await request(await start())
      .post('/api/probe/echo')
      .send({ datos: 'x'.repeat(150_000) })
      .expect(413);
    expect(response.body).toMatchObject({ statusCode: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('responde 404 con el error uniforme en rutas desconocidas', async () => {
    const response = await request(await start())
      .get('/api/no-existe')
      .expect(404);
    expect(response.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('un error inesperado devuelve 500 genérico sin filtrar detalles internos', async () => {
    const response = await request(await start())
      .get('/api/probe/boom')
      .expect(500);
    expect(response.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Error interno del servidor.',
    });
    expect(JSON.stringify(response.body)).not.toContain('secreto');
  });

  it('el límite de tasa general responde 429 con Retry-After', async () => {
    const server = await start({
      THROTTLE_ENABLED: 'true',
      THROTTLE_LIMIT: '3',
      THROTTLE_AUTH_LIMIT: '2',
    });
    for (let i = 0; i < 3; i++) await request(server).get('/api/probe/plain').expect(200);
    const blocked = await request(server).get('/api/probe/plain').expect(429);
    expect(blocked.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('los endpoints sensibles usan el límite estricto (independiente del general)', async () => {
    const server = await start({
      THROTTLE_ENABLED: 'true',
      THROTTLE_LIMIT: '50',
      THROTTLE_AUTH_LIMIT: '2',
    });
    await request(server).get('/api/probe/sensitive').expect(200);
    await request(server).get('/api/probe/sensitive').expect(200);
    await request(server).get('/api/probe/sensitive').expect(429);
    // Las rutas normales no se ven afectadas por el límite estricto.
    await request(server).get('/api/probe/plain').expect(200);
  });

  it('con TRUST_PROXY_HOPS=0 ignora X-Forwarded-For (no se puede falsear la IP)', async () => {
    const response = await request(await start())
      .get('/api/probe/ip')
      .set('X-Forwarded-For', '203.0.113.9')
      .expect(200);
    expect((response.body as { ip: string }).ip).not.toContain('203.0.113.9');
  });

  it('con un proxy de confianza usa la IP de X-Forwarded-For', async () => {
    const response = await request(await start({ TRUST_PROXY_HOPS: '1' }))
      .get('/api/probe/ip')
      .set('X-Forwarded-For', '203.0.113.9')
      .expect(200);
    expect((response.body as { ip: string }).ip).toBe('203.0.113.9');
  });
});
