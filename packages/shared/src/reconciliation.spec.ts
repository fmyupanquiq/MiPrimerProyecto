import { describe, expect, it } from 'vitest';
import { confirmReconciliationSchema, RECONCILIATION_STATUSES } from './reconciliation.js';

describe('confirmReconciliationSchema (D-C1, D-C2: un solo paso, §80)', () => {
  it('acepta un saldo oficial válido, sin nota', () => {
    const result = confirmReconciliationSchema.safeParse({ officialAvailable: '480.00' });
    expect(result.success).toBe(true);
  });

  it('acepta una nota opcional', () => {
    const result = confirmReconciliationSchema.safeParse({
      officialAvailable: '480.00',
      note: 'Verificado contra la app de la casa.',
    });
    expect(result.success).toBe(true);
  });

  it('exige un monto válido para el saldo oficial', () => {
    expect(confirmReconciliationSchema.safeParse({}).success).toBe(false);
    expect(confirmReconciliationSchema.safeParse({ officialAvailable: '' }).success).toBe(false);
    expect(confirmReconciliationSchema.safeParse({ officialAvailable: '-1.00' }).success).toBe(
      false,
    );
  });

  it('acepta un saldo oficial en cero (una casa puede quedarse sin disponible)', () => {
    expect(confirmReconciliationSchema.safeParse({ officialAvailable: '0.00' }).success).toBe(true);
  });
});

describe('RECONCILIATION_STATUSES (D-C1, §109.1)', () => {
  it('tiene exactamente MATCHED, DISCREPANCY e INVALIDATED', () => {
    expect([...RECONCILIATION_STATUSES].sort()).toEqual(
      ['MATCHED', 'DISCREPANCY', 'INVALIDATED'].sort(),
    );
  });
});
