import { and, eq, gte } from 'drizzle-orm';
import type { DbExecutor } from '../database/database.types.js';
import { reconciliationCheckpoints } from '../database/schema/index.js';

/**
 * Invalida los checkpoints de conciliación `MATCHED` de una casa cuya fotografía ya no es correcta
 * (§74, §109.1.3, §112.5, ADR 0016): los de fecha igual o posterior a `from`. Nunca borra ni reescribe
 * el checkpoint original (D2): registra cuándo y por qué. Se llama dentro de la transacción de la
 * acción que cambió el efecto financiero.
 */
export async function invalidateCheckpoints(
  tx: DbExecutor,
  input: { houseId: string; from: Date; reason: string; now: Date },
): Promise<void> {
  await tx
    .update(reconciliationCheckpoints)
    .set({ status: 'INVALIDATED', invalidatedAt: input.now, invalidatedReason: input.reason })
    .where(
      and(
        eq(reconciliationCheckpoints.houseId, input.houseId),
        eq(reconciliationCheckpoints.status, 'MATCHED'),
        gte(reconciliationCheckpoints.occurredAt, input.from),
      ),
    );
}
