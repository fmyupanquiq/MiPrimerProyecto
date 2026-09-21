import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { reconcileRbac } from './rbac-seeder.js';

/** Sincroniza el catálogo de permisos y roles de sistema al arrancar la aplicación. */
@Injectable()
export class RbacBootstrap implements OnApplicationBootstrap {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onApplicationBootstrap(): Promise<void> {
    await reconcileRbac(this.db);
  }
}
