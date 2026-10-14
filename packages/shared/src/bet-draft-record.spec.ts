import { describe, expect, it } from 'vitest';
import { betDraftPayloadSchema, draftEntryMode, type BetDraftPayload } from './bet-draft-record.js';

const payload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  format: 'SIMPLE',
  houseId: '',
  placed: { date: '2026-10-10', time: '20:05' },
  placedTimeKnown: true,
  selections: [
    {
      eventGroup: 0,
      position: 0,
      sport: 'Fútbol',
      event: '',
      market: '',
      selection: '',
      visibleOdds: '',
      legScore: '',
      legResult: '',
      conditionStatus: '',
    },
  ],
  totalOdds: '',
  oddsKindChoice: null,
  calculatedOdds: null,
  stake: '',
  customStake: false,
  status: 'PENDING',
  statusChosen: false,
  statusFromAi: false,
  settled: { date: '2026-10-10', time: '22:00' },
  profitOverride: null,
  officialAmount: '',
  officialPotentialReturn: '',
  reason: '',
  ticketId: null,
  aiApplied: false,
  ...overrides,
});

describe('entryMode del borrador (rediseño del asistente, ADR 0024)', () => {
  it('un borrador guardado antes de existir el campo sigue siendo válido', () => {
    const parsed = betDraftPayloadSchema.safeParse(payload());
    expect(parsed.success).toBe(true);
    expect(parsed.data?.entryMode).toBeUndefined();
  });

  it('acepta AI y MANUAL y rechaza cualquier otro valor', () => {
    expect(betDraftPayloadSchema.safeParse(payload({ entryMode: 'AI' })).success).toBe(true);
    expect(betDraftPayloadSchema.safeParse(payload({ entryMode: 'MANUAL' })).success).toBe(true);
    expect(betDraftPayloadSchema.safeParse(payload({ entryMode: 'OCR' })).success).toBe(false);
  });

  it('sin el campo se deduce: con lectura de IA o ticket es "AI"; sin nada, "MANUAL"', () => {
    const base = betDraftPayloadSchema.parse(payload()) as BetDraftPayload;
    expect(draftEntryMode(base)).toBe('MANUAL');
    expect(draftEntryMode({ ...base, aiApplied: true })).toBe('AI');
    expect(draftEntryMode({ ...base, ticketId: '0195f7c0-0000-7000-8000-0000000000c1' })).toBe(
      'AI',
    );
    // El guardado manda siempre sobre la deducción.
    expect(draftEntryMode({ ...base, aiApplied: true, entryMode: 'MANUAL' })).toBe('MANUAL');
  });
});
