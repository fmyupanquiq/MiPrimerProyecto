import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './app-config.js';

/** Expone la configuración tipada a toda la aplicación (`@Inject(APP_CONFIG)`). */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
