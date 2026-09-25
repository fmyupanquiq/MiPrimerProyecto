/**
 * Verificación de integridad del ledger (§38, §109.2). Herramienta de solo lectura: nunca
 * corrige datos, nunca crea movimientos, nunca inventa dinero. Cada ejecución queda registrada
 * (D-I1: cinco comprobaciones v1; D-I2: manual bajo demanda; D-I3: por proyecto o global).
 */
export const INTEGRITY_CHECKS = [
  'NEGATIVE_AVAILABLE',
  'SETTLEMENT_SHAPE',
  'PENDING_BET_REFERENCES',
  'LEDGER_SHAPE',
  'CHECKPOINT_INVALIDATION',
  /** El efecto neto de una apuesta en el ledger no es su ganancia o pérdida (§112.6, §112.7). */
  'BET_LEDGER_NET',
  /** Una reversión sin corrección o con una corrección de otra apuesta (§112.1, §112.7). */
  'REVERSAL_INTEGRITY',
] as const;
export type IntegrityCheck = (typeof INTEGRITY_CHECKS)[number];

export const INTEGRITY_CHECK_STATUSES = ['OK', 'ISSUES_FOUND'] as const;
export type IntegrityCheckStatus = (typeof INTEGRITY_CHECK_STATUSES)[number];

/** Un hallazgo concreto de una ejecución; `affected` son los identificadores relevantes. */
export interface IntegrityFinding {
  check: IntegrityCheck;
  message: string;
  affected: string[];
}

export interface IntegrityCheckRunSummary {
  id: string;
  /** `null` en una ejecución global (D-I3: todos los proyectos). */
  projectId: string | null;
  runBy: { id: string; name: string };
  startedAt: string;
  finishedAt: string;
  status: IntegrityCheckStatus;
  findings: IntegrityFinding[];
}
