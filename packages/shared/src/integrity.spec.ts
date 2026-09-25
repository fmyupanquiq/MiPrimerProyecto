import { describe, expect, it } from 'vitest';
import { INTEGRITY_CHECK_STATUSES, INTEGRITY_CHECKS } from './integrity.js';

describe('INTEGRITY_CHECKS (D-I1, §109.2 y §112.7: cinco comprobaciones v1 y dos de la Fase 8.5)', () => {
  it('tiene exactamente las comprobaciones aprobadas, sin duplicados', () => {
    expect(new Set(INTEGRITY_CHECKS).size).toBe(INTEGRITY_CHECKS.length);
    expect([...INTEGRITY_CHECKS].sort()).toEqual(
      [
        'NEGATIVE_AVAILABLE',
        'SETTLEMENT_SHAPE',
        'PENDING_BET_REFERENCES',
        'LEDGER_SHAPE',
        'CHECKPOINT_INVALIDATION',
        'BET_LEDGER_NET',
        'REVERSAL_INTEGRITY',
      ].sort(),
    );
  });
});

describe('INTEGRITY_CHECK_STATUSES', () => {
  it('tiene OK e ISSUES_FOUND', () => {
    expect([...INTEGRITY_CHECK_STATUSES].sort()).toEqual(['ISSUES_FOUND', 'OK'].sort());
  });
});
