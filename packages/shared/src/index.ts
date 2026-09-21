import { z } from 'zod';

export * from './auth.js';
export * from './errors.js';
export * from './password-policy.js';
export * from './permissions.js';
export * from './user.js';

/** Nombre del producto. Sirve para verificar el enlace entre workspaces (Fase 0). */
export const SYSTEM_NAME = 'LetFer';

/** Mensajes de validación de zod en español. Se llama una vez al arrancar la API y la web. */
export function configureSpanishValidationMessages(): void {
  z.config(z.locales.es());
}
