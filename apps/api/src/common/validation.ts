import { StandardSchemaValidationPipe } from '@nestjs/common';
import { ErrorCode, type ValidationIssue } from '@letfer/shared';
import { AppError } from './app-error.js';

/**
 * Pipe global de validación (§41, §58). Valida cualquier parámetro que declare un esquema
 * estándar (zod), p. ej. `@Body({ schema: loginSchema }) body: LoginInput`, y responde con el error
 * uniforme `VALIDATION_FAILED` y el detalle campo por campo.
 */
export function createValidationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    exceptionFactory: (issues) => {
      const details: ValidationIssue[] = issues.map((issue) => ({
        path: (issue.path ?? [])
          .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
          .join('.'),
        message: issue.message,
      }));
      return new AppError(400, ErrorCode.VALIDATION_FAILED, 'Los datos enviados no son válidos.', {
        details,
      });
    },
  });
}
