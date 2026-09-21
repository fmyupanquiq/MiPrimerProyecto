import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { PG_POOL } from '../database/database.constants.js';
import { HealthController } from './health.controller.js';
import { HealthService, type Pingable } from './health.service.js';

async function createController(pool: Pingable): Promise<HealthController> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [HealthService, { provide: PG_POOL, useValue: pool }],
  }).compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('resuelve el servicio por inyección de dependencias y responde ok', async () => {
    const controller = await createController({ query: () => Promise.resolve([]) });
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      service: 'LetFer API',
      database: 'up',
    });
  });

  it('responde 503 cuando la base de datos no responde', async () => {
    const controller = await createController({
      query: () => Promise.reject(new Error('conexión rechazada')),
    });
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
