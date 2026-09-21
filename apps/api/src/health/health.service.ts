import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, SYSTEM_NAME } from '@letfer/shared';
import { AppError } from '../common/app-error.js';
import { PG_POOL } from '../database/database.constants.js';

export interface HealthStatus {
  status: 'ok';
  service: string;
  database: 'up';
}

/** Lo mínimo que se necesita del pool de conexiones para comprobar la base de datos. */
export interface Pingable {
  query(sql: string): Promise<unknown>;
}

@Injectable()
export class HealthService {
  constructor(@Inject(PG_POOL) private readonly pool: Pingable) {}

  async check(): Promise<HealthStatus> {
    const service = `${SYSTEM_NAME} API`;
    try {
      await this.pool.query('SELECT 1');
    } catch {
      throw new AppError(503, ErrorCode.SERVICE_UNAVAILABLE, 'La base de datos no responde.', {
        details: { service, database: 'down' },
      });
    }
    return { status: 'ok', service, database: 'up' };
  }
}
