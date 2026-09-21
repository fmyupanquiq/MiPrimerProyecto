import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { useSpanishValidationMessages } from '@letfer/shared';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { PasswordHasher } from '../../src/auth/password-hasher.js';
import { Clock } from '../../src/common/clock.js';
import type { UserRow } from '../../src/database/schema/index.js';
import { insertUser } from './factories.js';
import { FakeClock } from './fake-clock.js';
import { createTestDatabase, truncateAll, type TestDatabase } from './test-database.js';

export const TEST_PASSWORD = 'clave-de-prueba-2026';

export interface TestApp {
  app: NestExpressApplication;
  server: Server;
  clock: FakeClock;
  t: TestDatabase;
  hasher: PasswordHasher;
  /** Crea un usuario con contraseña real (hash argon2id). */
  createUser: (overrides?: Partial<UserRow> & { password?: string }) => Promise<UserRow>;
  /** Vacía la base de datos y reinicia el reloj (para `beforeEach`). */
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export interface CreateTestAppOptions {
  /** Variables de entorno adicionales (se aplican antes de compilar la aplicación). */
  env?: Record<string, string>;
  /** Permite sustituir proveedores (p. ej. el servicio de correo). */
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/** Aplicación completa (AppModule) con PostgreSQL real y reloj falso, lista para supertest. */
export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  for (const [key, value] of Object.entries(options.env ?? {})) vi.stubEnv(key, value);
  useSpanishValidationMessages();

  const clock = new FakeClock('2026-06-01T12:00:00.000Z');
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock);
  if (options.customize) builder = options.customize(builder);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();

  const t = createTestDatabase();
  await truncateAll(t.pool);
  const hasher = app.get(PasswordHasher);

  return {
    app,
    server: app.getHttpServer(),
    clock,
    t,
    hasher,
    createUser: async ({ password = TEST_PASSWORD, ...overrides } = {}) =>
      insertUser(t.db, { passwordHash: await hasher.hash(password), ...overrides }),
    reset: async () => {
      await truncateAll(t.pool);
      clock.set('2026-06-01T12:00:00.000Z');
    },
    close: async () => {
      await app.close();
      await t.close();
      vi.unstubAllEnvs();
    },
  };
}

/** Extrae `nombre=valor` de la cookie de sesión de una respuesta, para reenviarla. */
export function sessionCookie(response: request.Response): string | undefined {
  const setCookie = response.headers['set-cookie'] as unknown as string[] | undefined;
  return setCookie?.find((c) => c.startsWith('letfer_session='))?.split(';')[0];
}

/** Cabecera `Set-Cookie` completa de la sesión (con sus atributos). */
export function sessionSetCookie(response: request.Response): string | undefined {
  const setCookie = response.headers['set-cookie'] as unknown as string[] | undefined;
  return setCookie?.find((c) => c.startsWith('letfer_session='));
}

/** Petición de inicio de sesión (thenable de supertest: admite `.expect(...)`). */
export function login(
  server: Server,
  email: string,
  password = TEST_PASSWORD,
  keepSignedIn = false,
): request.Test {
  return request(server).post('/api/auth/login').send({ email, password, keepSignedIn });
}

/** Cuerpo JSON de respuesta con los campos que usan las pruebas (evita `any`). */
export interface ResponseBody {
  user: Record<string, unknown> & { id: string; email: string; status: string; systemRole: string };
  session: Record<string, unknown> & { persistent: boolean; current: boolean };
  code: string;
  message: string;
  details: { path: string; message: string }[];
  retryAfterSeconds: number;
}

export const bodyOf = (response: request.Response): ResponseBody => response.body as ResponseBody;
