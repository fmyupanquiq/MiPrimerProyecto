import { eq, sql } from 'drizzle-orm';
import { betConflict } from '../bets/bet-errors.js';
import type { DbExecutor } from '../database/database.types.js';
import { bets, importBatches, type BetRow } from '../database/schema/index.js';

/**
 * Condición de consulta sobre `bets` (§113.8, D-X25): la apuesta no pertenece a un lote anulado.
 * Una apuesta de un lote anulado queda eliminada lógicamente con el motivo fijo "Lote anulado" y
 * ya no cuenta para nada: ni papelera, ni listados, ni retornos por confirmar.
 */
export const notInAnnulledBatch = sql`NOT EXISTS (
  SELECT 1 FROM import_batches ib WHERE ib.id = ${bets.batchId} AND ib.status = 'ANNULLED'
)`;

/**
 * Una apuesta de un lote anulado no puede restaurarse ni corregirse individualmente (D-X25): los
 * efectos del lote ya se revirtieron y volver a registrarlos dejaría el ledger inconsistente con el
 * lote. Se comprueba con la transacción que ya tiene bloqueado el proyecto, así que no compite con
 * la anulación del lote (que toma el mismo bloqueo).
 */
export async function assertBetNotInAnnulledBatch(
  executor: DbExecutor,
  bet: Pick<BetRow, 'batchId'>,
): Promise<void> {
  if (bet.batchId === null) return;
  const [batch] = await executor
    .select({ status: importBatches.status })
    .from(importBatches)
    .where(eq(importBatches.id, bet.batchId))
    .limit(1);
  if (batch?.status === 'ANNULLED') {
    throw betConflict(
      'Esta apuesta pertenece a un lote de importación anulado: no puede restaurarse ni modificarse.',
    );
  }
}
