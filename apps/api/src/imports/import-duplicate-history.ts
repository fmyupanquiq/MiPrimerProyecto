import { and, eq, inArray, isNull } from 'drizzle-orm';
import { calendarDateInTimeZone } from '../common/timezone.js';
import type { DbExecutor } from '../database/database.types.js';
import { betSelections, bets, importBatches } from '../database/schema/index.js';
import { duplicateKey, type ImportDuplicateMatch } from './parser/import-duplicate-detection.js';
import type { PreliminaryNormalizedBet } from './parser/import-normalization.js';

/**
 * Mitad de D-X10 que sí necesita base de datos: solapamiento contra el histórico **ya
 * importado** de la misma casa (bets cuyo lote sigue `IMPORTED`; uno anulado no cuenta — sus
 * apuestas quedaron eliminadas lógicamente, D-X25). Solo reporta, nunca bloquea ni descarta nada
 * (D-X11); se compara con la misma clave que el solapamiento dentro del archivo
 * (`parser/import-duplicate-detection.ts`), para que ambas mitades de D-X10 usen exactamente el
 * mismo criterio de "misma fecha, monto, cuota y descripción normalizada".
 */
export async function findDuplicatesAgainstHistory(
  db: DbExecutor,
  input: {
    projectId: string;
    houseId: string;
    timeZone: string;
    candidates: readonly PreliminaryNormalizedBet[];
  },
): Promise<ImportDuplicateMatch[]> {
  const existing = await db
    .select({
      id: bets.id,
      placedAt: bets.placedAt,
      officialAmount: bets.officialAmount,
      visibleTotalOdds: bets.visibleTotalOdds,
    })
    .from(bets)
    .innerJoin(importBatches, eq(importBatches.id, bets.batchId))
    .where(
      and(
        eq(bets.projectId, input.projectId),
        eq(bets.houseId, input.houseId),
        eq(importBatches.status, 'IMPORTED'),
        isNull(bets.deletedAt),
      ),
    );
  const withAmount = existing.filter(
    (bet): bet is typeof bet & { officialAmount: string } => bet.officialAmount !== null,
  );
  if (withAmount.length === 0) return [];

  const selections = await db
    .select({
      betId: betSelections.betId,
      event: betSelections.event,
      market: betSelections.market,
      selection: betSelections.selection,
    })
    .from(betSelections)
    .where(
      inArray(
        betSelections.betId,
        withAmount.map((bet) => bet.id),
      ),
    );
  const selectionsByBet = new Map<string, typeof selections>();
  for (const row of selections) {
    const list = selectionsByBet.get(row.betId) ?? [];
    list.push(row);
    selectionsByBet.set(row.betId, list);
  }

  const existingByKey = new Map<string, string[]>();
  for (const bet of withAmount) {
    const key = duplicateKey({
      placedAt: bet.placedAt,
      amount: bet.officialAmount,
      visibleTotalOdds: bet.visibleTotalOdds,
      selections: selectionsByBet.get(bet.id) ?? [],
      timeZone: input.timeZone,
    });
    const ids = existingByKey.get(key) ?? [];
    ids.push(bet.id);
    existingByKey.set(key, ids);
  }

  const matches: ImportDuplicateMatch[] = [];
  for (const candidate of input.candidates) {
    if (candidate.rowNumber === undefined) continue;
    const key = duplicateKey({ ...candidate, timeZone: input.timeZone });
    const existingBetIds = existingByKey.get(key);
    if (!existingBetIds) continue;
    matches.push({
      rowNumbers: [candidate.rowNumber],
      existingBetIds,
      date: calendarDateInTimeZone(candidate.placedAt, input.timeZone),
      amount: candidate.amount,
      odds: candidate.visibleTotalOdds,
    });
  }
  return matches;
}
