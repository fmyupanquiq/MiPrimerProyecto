import { describe, expect, it } from 'vitest';
import {
  AUDIT_PAGE_DEFAULT_LIMIT,
  AUDIT_PAGE_MAX_LIMIT,
  listGlobalAuditLogsQuerySchema,
  listProjectAuditLogsQuerySchema,
} from './audit.js';

const uuid = '0195f0c0-0000-7000-8000-000000000001';

describe('consultas del visor de auditoría (§111.1)', () => {
  it('aplica el tamaño de página por defecto y acota el máximo', () => {
    expect(listProjectAuditLogsQuerySchema.parse({}).limit).toBe(AUDIT_PAGE_DEFAULT_LIMIT);
    expect(listProjectAuditLogsQuerySchema.parse({ limit: '20' }).limit).toBe(20);
    expect(listProjectAuditLogsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(
      listProjectAuditLogsQuerySchema.safeParse({ limit: String(AUDIT_PAGE_MAX_LIMIT + 1) })
        .success,
    ).toBe(false);
  });

  it('rechaza un rango de fechas invertido', () => {
    const result = listProjectAuditLogsQuerySchema.safeParse({
      from: '2026-06-02T00:00:00Z',
      to: '2026-06-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('la consulta de proyecto ignora un projectId que envíe el cliente (aislamiento, D8-2)', () => {
    const parsed = listProjectAuditLogsQuerySchema.parse({ projectId: uuid });
    expect(parsed).not.toHaveProperty('projectId');
  });

  it('la consulta global acepta projectId o system, no ambos', () => {
    expect(listGlobalAuditLogsQuerySchema.parse({ projectId: uuid }).projectId).toBe(uuid);
    expect(listGlobalAuditLogsQuerySchema.parse({ system: 'true' }).system).toBe(true);
    expect(
      listGlobalAuditLogsQuerySchema.safeParse({ projectId: uuid, system: 'true' }).success,
    ).toBe(false);
  });
});
