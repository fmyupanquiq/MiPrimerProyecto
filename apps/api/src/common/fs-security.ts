import { chmod, mkdir } from 'node:fs/promises';

/**
 * Endurecimiento de permisos de archivos privados (§41, §42; H2 de la revisión de arquitectura
 * previa a integrar la Fase 5.5). Usado tanto por los backups (volcado completo de la base:
 * hashes de contraseña, hashes de token de sesión, ledger) como por los tickets (§110: fotos de
 * apuestas reales con datos personales/financieros) — cualquier archivo que la API escriba fuera
 * de PostgreSQL con contenido sensible. Sin efecto en Windows (Node no soporta `mode` en
 * archivos ahí); en Linux/macOS (el objetivo real de producción, §100) sí se aplica.
 */
export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

/**
 * Crea el directorio si hace falta y fuerza permisos 0700. `mkdir` con `recursive: true` solo
 * aplica `mode` a la creación inicial: si el directorio ya existía (de antes de este
 * endurecimiento, o creado con otro umask), el `chmod` aparte lo corrige igual.
 */
export async function ensureSecureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  await chmod(dir, PRIVATE_DIR_MODE).catch(() => undefined);
}

/** Fuerza permisos 0600 en un archivo ya escrito (p. ej. por un proceso externo como `pg_dump`). */
export async function secureFile(path: string): Promise<void> {
  await chmod(path, PRIVATE_FILE_MODE).catch(() => undefined);
}
