import { describe, expect, it } from 'vitest';
import { BACKUP_STATUSES, BACKUP_TRIGGERS, restoreBackupSchema } from './backup.js';

describe('restoreBackupSchema (D-R1: confirmación fuerte, §37)', () => {
  it('acepta un id de generación válido con confirmación', () => {
    const result = restoreBackupSchema.safeParse({
      generationId: '0195f7c0-0000-7000-8000-0000000000a1',
      confirmation: 'letfer-backup-2026-06-01.dump',
    });
    expect(result.success).toBe(true);
  });

  it('rechaza un generationId que no es uuid', () => {
    expect(
      restoreBackupSchema.safeParse({ generationId: 'no-es-uuid', confirmation: 'algo' }).success,
    ).toBe(false);
  });

  it('exige una confirmación no vacía', () => {
    expect(
      restoreBackupSchema.safeParse({
        generationId: '0195f7c0-0000-7000-8000-0000000000a1',
        confirmation: '',
      }).success,
    ).toBe(false);
    expect(
      restoreBackupSchema.safeParse({ generationId: '0195f7c0-0000-7000-8000-0000000000a1' })
        .success,
    ).toBe(false);
  });
});

describe('catálogos de backup', () => {
  it('BACKUP_STATUSES tiene COMPLETED y FAILED', () => {
    expect([...BACKUP_STATUSES].sort()).toEqual(['COMPLETED', 'FAILED'].sort());
  });

  it('BACKUP_TRIGGERS tiene SCHEDULED y MANUAL (D-B1)', () => {
    expect([...BACKUP_TRIGGERS].sort()).toEqual(['MANUAL', 'SCHEDULED'].sort());
  });
});
