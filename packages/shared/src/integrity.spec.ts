import { describe, expect, it } from 'vitest';
import { INTEGRITY_CHECK_STATUSES, INTEGRITY_CHECKS } from './integrity.js';

describe('INTEGRITY_CHECKS (D-I1, §109.2: cinco comprobaciones v1)', () => {
  it('tiene exactamente las cinco comprobaciones aprobadas, sin duplicados', () => {
    expect(new Set(INTEGRITY_CHECKS).size).toBe(INTEGRITY_CHECKS.length);
    expect([...INTEGRITY_CHECKS].sort()).toEqual(
      [
        'NEGATIVE_AVAILABLE',
        'SETTLEMENT_SHAPE',
        'PENDING_BET_REFERENCES',
        'LEDGER_SHAPE',
        'CHECKPOINT_INVALIDATION',
      ].sort(),
    );
  });
});

describe('INTEGRITY_CHECK_STATUSES', () => {
  it('tiene OK e ISSUES_FOUND', () => {
    expect([...INTEGRITY_CHECK_STATUSES].sort()).toEqual(['ISSUES_FOUND', 'OK'].sort());
  });
});
