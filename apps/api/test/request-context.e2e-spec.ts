import { Body, Controller, Module, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigModule } from '../src/config/config.module.js';
import { CommonModule } from '../src/common/common.module.js';
import { RequestContext } from '../src/common/request-context.js';
import { configureApp } from '../src/app.setup.js';

@Controller('probe')
class ProbeController {
  @Post()
  probe(@Body() body: { value: string }) {
    return { body, context: RequestContext.current() };
  }
}

@Module({ imports: [ConfigModule, CommonModule], controllers: [ProbeController] })
class ProbeModule {}

describe('contexto de petición (e2e)', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('está disponible en el controlador después de analizar el cuerpo JSON', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/probe')
      .set('User-Agent', 'prueba-agent/1.0')
      .send({ value: 'hola' })
      .expect(201);

    const { body, context } = response.body as {
      body: { value: string };
      context: { requestId: string; ip: string; userAgent: string };
    };
    expect(body).toEqual({ value: 'hola' });
    expect(context.requestId).toBe(response.headers['x-request-id']);
    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(context.userAgent).toBe('prueba-agent/1.0');
    expect(typeof context.ip).toBe('string');
  });

  it('cada petición recibe un identificador distinto', async () => {
    const server = app.getHttpServer();
    const first = await request(server).post('/api/probe').send({ value: 'a' });
    const second = await request(server).post('/api/probe').send({ value: 'b' });
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });
});
