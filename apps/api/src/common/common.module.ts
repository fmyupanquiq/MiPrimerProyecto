import {
  type ExecutionContext,
  Global,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { Clock, SystemClock } from './clock.js';
import { AUTH_RATE_LIMIT_KEY } from './rate-limit.js';
import { RequestContextMiddleware } from './request-context.js';
import { createValidationPipe } from './validation.js';

const isAuthRoute = (handler: unknown): boolean =>
  typeof handler === 'function' && Reflect.getMetadata(AUTH_RATE_LIMIT_KEY, handler) === true;

@Global()
@Module({
  imports: [
    // Límite de tasa por IP: `default` para toda la API y `auth` (más estricto) solo para los
    // endpoints marcados con @AuthRateLimit(). Cada uno se omite en las rutas del otro. El interruptor
    // THROTTLE_ENABLED va dentro de cada `skipIf` porque el `skipIf` global no se aplica a los
    // limitadores que definen el suyo.
    ThrottlerModule.forRootAsync({
      imports: [],
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ThrottlerModuleOptions => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.throttle.ttlMs,
            limit: config.throttle.limit,
            skipIf: (context: ExecutionContext) =>
              !config.throttle.enabled || isAuthRoute(context.getHandler()),
          },
          {
            name: 'auth',
            ttl: config.throttle.authTtlMs,
            limit: config.throttle.authLimit,
            skipIf: (context: ExecutionContext) =>
              !config.throttle.enabled || !isAuthRoute(context.getHandler()),
          },
        ],
      }),
    }),
  ],
  providers: [
    { provide: Clock, useClass: SystemClock },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [Clock],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
