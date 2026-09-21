import { Global, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { Clock, SystemClock } from './clock.js';
import { RequestContextMiddleware } from './request-context.js';

@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
