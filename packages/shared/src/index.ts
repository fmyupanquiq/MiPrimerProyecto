import { z } from 'zod';

export * from './auth.js';
export * from './backup.js';
export * from './errors.js';
export * from './integrity.js';
export * from './password-policy.js';
export * from './permissions.js';
export * from './reconciliation.js';
export * from './user.js';

/** Nombre del producto. Sirve para verificar el enlace entre workspaces (Fase 0). */
export const SYSTEM_NAME = 'LetFer';

/** Mensajes de validación de zod en español. Se llama una vez al arrancar la API y la web. */
export function configureSpanishValidationMessages(): void {
  z.config(z.locales.es());
}
export * from './bet.js';
export * from './dashboard.js';
export * from './financial-movement.js';
export * from './house.js';
export * from './invitation.js';
export * from './member.js';
export * from './money.js';
export * from './odds.js';
export * from './project.js';
export * from './project-setup.js';
export * from './stage.js';
export * from './ticket.js';
export * from './withdrawal.js';
