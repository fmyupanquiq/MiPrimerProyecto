import { describe, expect, it } from 'vitest';
import {
  TICKET_ANALYSIS_STATUSES,
  TICKET_MIME_TYPES,
  ticketIdSchema,
  uploadTicketSchema,
} from './ticket.js';

describe('uploadTicketSchema', () => {
  it('acepta un betId opcional', () => {
    expect(uploadTicketSchema.safeParse({}).success).toBe(true);
    expect(
      uploadTicketSchema.safeParse({ betId: '0195f7c0-0000-7000-8000-0000000000a1' }).success,
    ).toBe(true);
  });

  it('rechaza un betId que no es uuid', () => {
    expect(uploadTicketSchema.safeParse({ betId: 'no-es-uuid' }).success).toBe(false);
  });
});

describe('ticketIdSchema (D-T5, §110.3)', () => {
  it('exige un uuid', () => {
    expect(ticketIdSchema.safeParse('0195f7c0-0000-7000-8000-0000000000a1').success).toBe(true);
    expect(ticketIdSchema.safeParse('no-es-uuid').success).toBe(false);
  });
});

describe('catálogos de ticket', () => {
  it('TICKET_MIME_TYPES cubre JPG/PNG/PDF (D-T3)', () => {
    expect([...TICKET_MIME_TYPES].sort()).toEqual(
      ['application/pdf', 'image/jpeg', 'image/png'].sort(),
    );
  });

  it('TICKET_ANALYSIS_STATUSES tiene COMPLETED y FAILED', () => {
    expect([...TICKET_ANALYSIS_STATUSES].sort()).toEqual(['COMPLETED', 'FAILED'].sort());
  });
});
