import { describe, expect, it } from 'vitest';
import {
  resolveTicketOdds,
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

describe('resolveTicketOdds (Fase 10.8, §6-§11: cuota visible vs. efectiva, prioridad §10)', () => {
  it('ganada: retorno real ÷ importe, y conserva la cuota visible aparte (§7)', () => {
    // Ticket de ejemplo: apuesta S/10.00, ganancias (pago total) S/51.40, cuota visible 5.14.
    expect(
      resolveTicketOdds({
        officialTotalOdds: '5.14',
        officialAmount: '10.00',
        officialRealizedReturn: '51.40',
      }),
    ).toEqual({ visible: '5.14', effective: { value: '5.14', source: 'REALIZED_RETURN' } });
  });

  it('pendiente: retorno potencial ÷ importe, nunca se confunde con un retorno oficial (§8)', () => {
    // Apuesta S/2.00, ganancias potenciales S/4.35, cuotas individuales 1.23 / 1.67 / 1.06.
    expect(
      resolveTicketOdds({
        officialTotalOdds: '2.17',
        officialAmount: '2.00',
        officialPotentialReturn: '4.35',
        individualOdds: ['1.23', '1.67', '1.06'],
      }),
    ).toEqual({ visible: '2.17', effective: { value: '2.175', source: 'POTENTIAL_RETURN' } });
  });

  it('perdida sin cuota total visible: nunca inventa la oficial, solo una referencia del producto (§9)', () => {
    expect(
      resolveTicketOdds({
        officialAmount: '10.72',
        individualOdds: ['1.31', '1.42', '1.29', '1.30', '1.53'],
      }),
    ).toEqual({ visible: null, effective: { value: '4.77292', source: 'SELECTIONS_PRODUCT' } });
  });

  it('perdida con 3 cuotas individuales (sin la quinta ni la sexta): producto correcto (Fase 10.9, §2)', () => {
    expect(
      resolveTicketOdds({
        officialAmount: '5.00',
        individualOdds: ['1.50', '2.00', '1.10'],
      }),
    ).toEqual({ visible: null, effective: { value: '3.3', source: 'SELECTIONS_PRODUCT' } });
  });

  it('perdida con una selección sin cuota: no inventa el producto parcial (Fase 10.9, §2-§4)', () => {
    // Si `individualOdds` no llega completo (quien llama ya lo filtró con
    // `collectCompleteIndividualOdds`), aquí no hay nada que calcular: sin inventar un producto
    // de solo las cuotas conocidas, que sería menor al real y engañoso.
    expect(
      resolveTicketOdds({
        officialAmount: '10.72',
        individualOdds: undefined,
      }),
    ).toEqual({ visible: null, effective: null });
  });

  it('perdida con cuota total visible: se conserva tal cual, sin calcular nada más (§9, §11)', () => {
    expect(
      resolveTicketOdds({
        officialTotalOdds: '1.56',
        officialAmount: '10.72',
        individualOdds: ['1.31', '1.42'],
      }),
    ).toEqual({ visible: '1.56', effective: null });
  });

  it('sin ningún dato suficiente, ninguna de las dos cifras se inventa', () => {
    expect(resolveTicketOdds({})).toEqual({ visible: null, effective: null });
  });

  it('ganada SIN cuota total visible: calcula la cuota efectiva para poder registrar (Caso G, Fase 10.8.1)', () => {
    // El ticket solo muestra apuesta S/10.00 y "Ganancias" (retorno total) S/51.40: sin cuota
    // total impresa, LetFer la calcula — nunca bloquea el registro por falta de ese dato.
    expect(
      resolveTicketOdds({
        officialAmount: '10.00',
        officialRealizedReturn: '51.40',
      }),
    ).toEqual({ visible: null, effective: { value: '5.14', source: 'REALIZED_RETURN' } });
  });

  it('pendiente SIN cuota total visible: cuota efectiva potencial, nunca retorno oficial (Caso H variante)', () => {
    expect(
      resolveTicketOdds({
        officialAmount: '2.00',
        officialPotentialReturn: '4.35',
      }),
    ).toEqual({ visible: null, effective: { value: '2.175', source: 'POTENTIAL_RETURN' } });
  });

  it('el retorno real manda sobre el potencial si por error llegaran ambos', () => {
    expect(
      resolveTicketOdds({
        officialAmount: '10.00',
        officialRealizedReturn: '51.40',
        officialPotentialReturn: '99.00',
      }).effective,
    ).toEqual({ value: '5.14', source: 'REALIZED_RETURN' });
  });
});
