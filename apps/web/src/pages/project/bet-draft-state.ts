import type { BetDraftPayload, BetType } from '@letfer/shared';
import type { DateTimeParts } from '../../date-inputs.js';
import { newSelection, type SelectionDraft } from './bet-selection-drafts.js';
import type { DraftStatus } from './bet-draft.js';

/*
 * Conversión entre el estado del formulario "Añadir apuesta" y un borrador guardado (ADR 0024).
 * Son funciones puras: el borrador son los textos del formulario tal cual (nunca cifras ya
 * interpretadas), de modo que retomarlo deja exactamente lo que había y al registrar todo se valida
 * de nuevo desde cero. Nada de esto es financiero.
 */

export interface FormSnapshot {
  format: BetType;
  houseId: string;
  placed: DateTimeParts;
  placedTimeKnown: boolean;
  selections: SelectionDraft[];
  totalOdds: string;
  oddsKindChoice: 'OFFICIAL' | 'CALCULATED' | null;
  calculatedOdds: { value: string; note: string } | null;
  stake: string;
  customStake: boolean;
  status: DraftStatus;
  statusChosen: boolean;
  statusFromAi: boolean;
  settled: DateTimeParts;
  profitOverride: string | null;
  officialAmount: string;
  officialPotentialReturn: string;
  reason: string;
  ticketId: string | null;
  aiApplied: boolean;
}

export function snapshotToPayload(snapshot: FormSnapshot): BetDraftPayload {
  return {
    schemaVersion: 1,
    format: snapshot.format,
    houseId: snapshot.houseId,
    placed: { date: snapshot.placed.date, time: snapshot.placed.time },
    placedTimeKnown: snapshot.placedTimeKnown,
    selections: snapshot.selections.map((row) => ({
      eventGroup: row.eventGroup,
      position: row.position,
      sport: row.sport,
      event: row.event,
      market: row.market,
      selection: row.selection,
      visibleOdds: row.visibleOdds,
      legScore: row.legScore,
      legResult: row.legResult,
      conditionStatus: row.conditionStatus,
    })),
    totalOdds: snapshot.totalOdds,
    oddsKindChoice: snapshot.oddsKindChoice,
    calculatedOdds: snapshot.calculatedOdds,
    stake: snapshot.stake,
    customStake: snapshot.customStake,
    status: snapshot.status,
    statusChosen: snapshot.statusChosen,
    statusFromAi: snapshot.statusFromAi,
    settled: { date: snapshot.settled.date, time: snapshot.settled.time },
    profitOverride: snapshot.profitOverride,
    officialAmount: snapshot.officialAmount,
    officialPotentialReturn: snapshot.officialPotentialReturn,
    reason: snapshot.reason,
    ticketId: snapshot.ticketId,
    aiApplied: snapshot.aiApplied,
  };
}

export function payloadToSnapshot(payload: BetDraftPayload): FormSnapshot {
  return {
    format: payload.format,
    houseId: payload.houseId,
    placed: { ...payload.placed },
    placedTimeKnown: payload.placedTimeKnown,
    // Claves nuevas: son identidad de React/edición, no parte del contenido.
    selections: payload.selections.map((row) => ({
      ...newSelection(row.eventGroup, row.position),
      sport: row.sport,
      event: row.event,
      market: row.market,
      selection: row.selection,
      visibleOdds: row.visibleOdds,
      legScore: row.legScore,
      legResult: row.legResult,
      conditionStatus: row.conditionStatus,
    })),
    totalOdds: payload.totalOdds,
    oddsKindChoice: payload.oddsKindChoice,
    calculatedOdds: payload.calculatedOdds,
    stake: payload.stake,
    customStake: payload.customStake,
    status: payload.status,
    statusChosen: payload.statusChosen,
    statusFromAi: payload.statusFromAi,
    settled: { ...payload.settled },
    profitOverride: payload.profitOverride,
    officialAmount: payload.officialAmount,
    officialPotentialReturn: payload.officialPotentialReturn,
    reason: payload.reason,
    ticketId: payload.ticketId,
    aiApplied: payload.aiApplied,
  };
}

/** Texto corto para la lista de borradores: casa + primer partido (+ cuántos más). */
export function draftSummaryText(
  houseName: string | null,
  selections: readonly SelectionDraft[],
): string {
  const events = [
    ...new Set(selections.map((row) => row.event.trim()).filter((event) => event !== '')),
  ];
  const first = events[0];
  const extra = events.length > 1 ? ` (+${events.length - 1})` : '';
  const parts = [houseName, first ? `${first}${extra}` : null].filter(
    (part): part is string => part !== null && part !== '',
  );
  return parts.length > 0 ? parts.join(' · ') : 'Borrador sin datos';
}
