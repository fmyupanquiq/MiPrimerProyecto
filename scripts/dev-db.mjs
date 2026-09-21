// PostgreSQL local de desarrollo y pruebas, sin instalar nada fuera de npm.
// Usa binarios reales de PostgreSQL 17 vía el paquete `embedded-postgres` y los
// controla con `initdb` / `pg_ctl` (ver docs/decisiones/0002-postgresql-local.md).
// Solo para desarrollo: producción usará un PostgreSQL administrado (spec §100).
//
// Uso (desde la raíz del repositorio):
//   npm run db:start    Inicializa (si hace falta) e inicia PostgreSQL en segundo plano.
//   npm run db:stop     Detiene PostgreSQL.
//   npm run db:status   Indica si PostgreSQL está en ejecución.
//   npm run db:reset    Borra los datos locales (.data/postgres) y vuelve a iniciar.
//
// Variables opcionales: DB_PORT (5432), DB_USER (letfer), DB_PASSWORD (letfer_dev),
// DB_NAMES (letfer_dev,letfer_test).
//
// Se usa pg_ctl (y no el arranque directo del paquete) porque PostgreSQL se niega a
// ejecutarse con privilegios de administrador y, en Windows, pg_ctl lo inicia con un
// token restringido.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const dataRoot = resolve(repoRoot, '.data');
const dataDir = resolve(dataRoot, 'postgres');
const logFile = resolve(dataRoot, 'postgres.log');

const port = Number(process.env.DB_PORT ?? 5432);
const user = process.env.DB_USER ?? 'letfer';
const password = process.env.DB_PASSWORD ?? 'letfer_dev';
const databaseNames = (process.env.DB_NAMES ?? 'letfer_dev,letfer_test')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

/** Paquete de binarios de embedded-postgres que corresponde a esta plataforma. */
function platformPackage() {
  const platform = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[os.platform()];
  const arch = os.arch();
  if (!platform) throw new Error(`Plataforma no soportada: ${os.platform()}`);
  return `@embedded-postgres/${platform}-${arch}`;
}

const { initdb, pg_ctl: pgCtl } = await import(platformPackage());

/** Ejecuta un binario sin heredar las tuberías (el servidor quedaría con ellas abiertas). */
function run(binary, args) {
  return spawnSync(binary, args, { stdio: 'ignore' });
}

function isRunning() {
  return existsSync(dataDir) && run(pgCtl, ['status', '-D', dataDir]).status === 0;
}

function tailLog(lines = 15) {
  if (!existsSync(logFile)) return '(sin registro del servidor)';
  return readFileSync(logFile, 'utf-8').trim().split('\n').slice(-lines).join('\n');
}

function initialise() {
  console.log('[db] Inicializando clúster nuevo...');
  mkdirSync(dataRoot, { recursive: true });
  const passwordFile = resolve(dataRoot, '.pwfile');
  writeFileSync(passwordFile, password, { mode: 0o600 });
  try {
    const result = run(initdb, [
      '-D',
      dataDir,
      '-U',
      user,
      `--pwfile=${passwordFile}`,
      '--auth=scram-sha-256',
      '-E',
      'UTF8',
      '--locale=C',
      '--locale-provider=icu',
      '--icu-locale=und',
    ]);
    if (result.status !== 0)
      throw new Error(
        'initdb falló (¿los datos locales están corruptos? Prueba npm run db:reset).',
      );
  } finally {
    rmSync(passwordFile, { force: true });
  }
}

async function ensureDatabases() {
  const client = new pg.Client({ host: 'localhost', port, user, password, database: 'postgres' });
  await client.connect();
  try {
    for (const name of databaseNames) {
      const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        name,
      ]);
      if (rowCount === 0) {
        // Los nombres provienen de la configuración local del desarrollador, no de un usuario final.
        await client.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
        console.log(`[db] Base de datos creada: ${name}`);
      }
    }
  } finally {
    await client.end();
  }
}

async function start() {
  if (isRunning()) {
    console.log('[db] PostgreSQL ya está en ejecución.');
  } else {
    if (!existsSync(resolve(dataDir, 'PG_VERSION'))) initialise();
    const result = run(pgCtl, [
      'start',
      '-D',
      dataDir,
      '-o',
      `-p ${port}`,
      '-l',
      logFile,
      '-w',
      '-t',
      '60',
    ]);
    if (result.status !== 0) {
      console.error(`[db] No se pudo iniciar PostgreSQL en el puerto ${port}.`);
      console.error(
        '[db] Si el puerto está ocupado, define otro con DB_PORT (p. ej. DB_PORT=5433).',
      );
      console.error(`[db] Últimas líneas del registro (${logFile}):\n${tailLog()}`);
      process.exit(1);
    }
  }
  await ensureDatabases();
  console.log(`[db] PostgreSQL listo en localhost:${port}`);
  for (const name of databaseNames) {
    console.log(`[db]   postgresql://${user}:${password}@localhost:${port}/${name}`);
  }
}

function stop() {
  if (!isRunning()) {
    console.log('[db] PostgreSQL no está en ejecución.');
    return;
  }
  const result = run(pgCtl, ['stop', '-D', dataDir, '-m', 'fast', '-w']);
  if (result.status !== 0) {
    console.error(`[db] No se pudo detener PostgreSQL.\n${tailLog()}`);
    process.exit(1);
  }
  console.log('[db] PostgreSQL detenido.');
}

const command = process.argv[2];
switch (command) {
  case 'start':
    await start();
    break;
  case 'stop':
    stop();
    break;
  case 'status':
    console.log(isRunning() ? `[db] En ejecución (puerto ${port}).` : '[db] Detenido.');
    process.exitCode = isRunning() ? 0 : 3;
    break;
  case 'reset':
    stop();
    rmSync(dataDir, { recursive: true, force: true });
    console.log(`[db] Datos locales eliminados: ${dataDir}`);
    await start();
    break;
  default:
    console.error('Uso: node scripts/dev-db.mjs <start|stop|status|reset>');
    process.exitCode = 1;
}
