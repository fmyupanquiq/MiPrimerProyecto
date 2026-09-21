import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordPolicyIssues,
} from './password-policy.js';

const codes = (password: string, email?: string) =>
  passwordPolicyIssues(password, email ? { email } : {}).map((issue) => issue.code);

describe('passwordPolicyIssues (§104.4)', () => {
  it('acepta una contraseña de 10 caracteres sin reglas de composición', () => {
    expect(codes('a'.repeat(PASSWORD_MIN_LENGTH))).toEqual([]);
    expect(codes('1234567890')).toEqual([]);
  });

  it('rechaza menos de 10 caracteres', () => {
    expect(codes('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toEqual(['TOO_SHORT']);
    expect(codes('')).toEqual(['TOO_SHORT']);
  });

  it('acepta hasta 128 caracteres y rechaza más', () => {
    expect(codes('a'.repeat(PASSWORD_MAX_LENGTH))).toEqual([]);
    expect(codes('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toEqual(['TOO_LONG']);
  });

  it('cuenta caracteres Unicode, no unidades UTF-16', () => {
    // 10 emojis = 10 caracteres (20 unidades UTF-16).
    expect(codes('😀'.repeat(10))).toEqual([]);
    expect(codes('😀'.repeat(9))).toEqual(['TOO_SHORT']);
  });

  it('rechaza contraseñas que contienen la parte local del correo (sin distinguir mayúsculas)', () => {
    expect(codes('xxAna.Perezxx1', 'ana.perez@example.com')).toEqual(['CONTAINS_EMAIL_LOCAL_PART']);
    expect(codes('CLAVE-ana.perez-9', 'Ana.Perez@Example.com')).toEqual([
      'CONTAINS_EMAIL_LOCAL_PART',
    ]);
  });

  it('acepta contraseñas que no contienen la parte local ni el dominio', () => {
    expect(codes('otra-clave-larga-7', 'ana.perez@example.com')).toEqual([]);
    expect(codes('mi-example.com-clave', 'ana.perez@example.com')).toEqual([]);
  });

  it('no aplica la regla del correo a partes locales muy cortas', () => {
    expect(codes('clave-con-ab-dentro', 'ab@example.com')).toEqual([]);
  });

  it('puede acumular varios problemas', () => {
    expect(codes('maria', 'maria@example.com')).toEqual(['TOO_SHORT', 'CONTAINS_EMAIL_LOCAL_PART']);
  });
});
