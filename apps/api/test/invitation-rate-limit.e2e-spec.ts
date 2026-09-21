import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './support/create-app.js';

/** Los endpoints públicos que reciben un token usan el límite estricto de autenticación. */
describe('límite de tasa de las invitaciones (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp({
      env: { THROTTLE_ENABLED: 'true', THROTTLE_AUTH_LIMIT: '2', THROTTLE_LIMIT: '100' },
    });
  });
  afterAll(() => ctx.close());

  const token = 'A'.repeat(43);

  it('la vista previa limita los intentos con 429', async () => {
    await request(ctx.server).post('/api/invitations/preview').send({ token }).expect(400);
    await request(ctx.server).post('/api/invitations/preview').send({ token }).expect(400);
    const blocked = await request(ctx.server)
      .post('/api/invitations/preview')
      .send({ token })
      .expect(429);
    expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('el registro por invitación también está limitado', async () => {
    const body = {
      token,
      firstName: 'A',
      lastName: 'B',
      email: 'a@example.com',
      password: 'contraseña-larga-2026',
    };
    await request(ctx.server).post('/api/auth/register').send(body).expect(400);
    await request(ctx.server).post('/api/auth/register').send(body).expect(400);
    await request(ctx.server).post('/api/auth/register').send(body).expect(429);
  });
});
