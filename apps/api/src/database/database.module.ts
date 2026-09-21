import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { DATABASE, PG_POOL } from './database.constants.js';
import * as schema from './schema/index.js';

/** Instancia de Drizzle de la aplicación, con el esquema completo. */
export type Database = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new pg.Pool({ connectionString: config.databaseUrl, max: 10 }),
    },
    {
      provide: DATABASE,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool): Database => drizzle(pool, { schema }),
    },
  ],
  exports: [PG_POOL, DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
