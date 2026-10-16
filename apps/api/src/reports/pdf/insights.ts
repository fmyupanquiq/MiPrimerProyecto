import {
  compareMoney,
  formatPEN,
  isZeroMoney,
  percentageOf,
  type DashboardBreakdownItem,
  type ReportData,
} from '@letfer/shared';
import { pct1, percent, signedPEN } from './format.js';

/*
 * Observaciones del informe ejecutivo (§108.11): REGLAS DETERMINISTAS sobre las cifras del reporte.
 * Sin IA ni texto generado: cada frase sale de una condición comprobable con datos reales. Nunca
 * recomiendan apostar más, nunca predicen ni califican una estrategia. Umbrales:
 *
 *  - Concentración por casa: la casa con más monto apostado (liquidadas) supera el 50 % del total.
 *  - Concentración por deporte: el deporte (o «Mixto») con más monto supera el 60 % del total.
 *  - Exposición pendiente: hay monto comprometido en apuestas sin resultado.
 *  - Dependencia de pocas operaciones: con 3 o más liquidadas y resultado no nulo, la mayor ganancia
 *    o la mayor pérdida equivale al 50 % o más del resultado neto (en valor absoluto).
 *  - Proporción de perdidas: con 10 o más decididas, las perdidas son el 60 % o más.
 *  - Muestra limitada: menos de 10 apuestas liquidadas.
 *  - Retornos provisionales: hay ganadas con retorno calculado, sin confirmar.
 */

export type ConclusionState = 'profit' | 'loss' | 'even' | 'undetermined';

export interface ReportInsights {
  conclusion: { state: ConclusionState; title: string; text: string };
  /** Lectura rápida: resultado económico, actividad y rendimiento/exposición (siempre 3). */
  quick: [string, string, string];
  /** Riesgos y observaciones (al menos una frase). */
  risks: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Fila con más monto apostado de un desglose (empate: la primera en orden alfabético). */
function topByStake(items: readonly DashboardBreakdownItem[]): DashboardBreakdownItem | null {
  let top: DashboardBreakdownItem | null = null;
  for (const item of items)
    if (!top || compareMoney(item.totalStaked, top.totalStaked) > 0) top = item;
  return top;
}

/** ¿`part` es al menos `threshold` % de `whole`? (porcentaje con la utilidad decimal compartida) */
function shareAtLeast(part: string, whole: string, threshold: number): string | null {
  const share = percentageOf(part, whole);
  return share !== null && compareMoney(share, String(threshold)) >= 0 ? share : null;
}

export function buildInsights(data: ReportData): ReportInsights {
  const { analysis, totals, highlights } = data;
  const { counts } = analysis;
  const settled = totals.settledBets;
  const decided = counts.won + counts.lost;
  const net = analysis.profitLoss;

  // Conclusión ejecutiva.
  let conclusion: ReportInsights['conclusion'];
  if (settled === 0) {
    conclusion = {
      state: 'undetermined',
      title: 'Resultado no determinado',
      text:
        totals.bets === 0
          ? 'No hay apuestas en el periodo y con los filtros seleccionados.'
          : `Ninguna de las ${totals.bets} apuestas del periodo tiene resultado todavía: aún no hay ganancia ni pérdida realizada.`,
    };
  } else if (isZeroMoney(net)) {
    conclusion = {
      state: 'even',
      title: 'Resultado equilibrado',
      text: `Las ${plural(settled, 'apuesta liquidada', 'apuestas liquidadas')} cerraron sin ganancia ni pérdida neta.`,
    };
  } else if (net.startsWith('-')) {
    conclusion = {
      state: 'loss',
      title: 'Periodo con pérdidas',
      text: `Se registró una pérdida neta de ${formatPEN(net.slice(1))}${analysis.yield === null ? '' : `, con un Yield de ${percent(analysis.yield)}`}${analysis.roi === null ? '' : ` y un ROI de ${percent(analysis.roi)}`}.`,
    };
  } else {
    conclusion = {
      state: 'profit',
      title: 'Periodo rentable',
      text: `Se generó una ganancia neta de ${formatPEN(net)}${analysis.yield === null ? '' : `, con un Yield de ${percent(analysis.yield)}`}${analysis.roi === null ? '' : ` y un ROI de ${percent(analysis.roi)}`}.`,
    };
  }

  // Lectura rápida (3 frases).
  const result =
    settled === 0
      ? 'Resultado económico: aún no hay apuestas liquidadas en el periodo.'
      : `Resultado económico: ${signedPEN(net)} sobre ${formatPEN(totals.stakedSettled)} apostados en ${plural(settled, 'apuesta liquidada', 'apuestas liquidadas')}.`;
  const activity =
    totals.bets === 0
      ? 'Actividad: no se registraron apuestas con estos filtros.'
      : `Actividad: ${plural(totals.bets, 'apuesta registrada', 'apuestas registradas')} — ${counts.won} ganadas, ${counts.lost} perdidas, ${counts.void} anuladas, ${counts.cashout} cash out y ${counts.pending} pendientes.`;
  const third =
    counts.pending > 0
      ? `Exposición: ${formatPEN(totals.stakedPending)} siguen comprometidos en ${plural(counts.pending, 'apuesta pendiente', 'apuestas pendientes')}; no forman parte del resultado.`
      : analysis.winRate !== null
        ? `Rendimiento: win rate de ${pct1(analysis.winRate, false)} (${counts.won} de ${plural(decided, 'apuesta decidida', 'apuestas decididas')}).`
        : 'Rendimiento: no hay apuestas ganadas ni perdidas para calcular el win rate.';

  // Riesgos y observaciones.
  const risks: string[] = [];
  const house = topByStake(analysis.byHouse);
  if (house && analysis.byHouse.length === 1 && settled > 0) {
    risks.push(`Todo el monto apostado de las liquidadas está en una sola casa (${house.key}).`);
  } else if (house) {
    const share = shareAtLeast(house.totalStaked, totals.stakedSettled, 50);
    if (share)
      risks.push(
        `Concentración por casa: ${house.key} reúne el ${pct1(share, false)} del monto apostado en liquidadas.`,
      );
  }
  const sport = topByStake(analysis.bySport);
  if (sport && analysis.bySport.length > 1) {
    const share = shareAtLeast(sport.totalStaked, totals.stakedSettled, 60);
    if (share)
      risks.push(
        `Concentración por deporte: ${sport.key} reúne el ${pct1(share, false)} del monto apostado en liquidadas.`,
      );
  }
  if (counts.pending > 0) {
    risks.push(
      `Hay ${formatPEN(totals.stakedPending)} comprometidos en ${plural(counts.pending, 'apuesta pendiente', 'apuestas pendientes')}: su resultado aún puede cambiar las cifras.`,
    );
  }
  if (settled >= 3 && !isZeroMoney(net)) {
    const absNet = net.startsWith('-') ? net.slice(1) : net;
    const best = highlights.best;
    const worst = highlights.worst;
    const bestShare = best ? shareAtLeast(best.profitLoss, absNet, 50) : null;
    const worstShare = worst ? shareAtLeast(worst.profitLoss.slice(1), absNet, 50) : null;
    if (bestShare && !net.startsWith('-')) {
      risks.push(
        `La mayor ganancia (${signedPEN(best!.profitLoss)}) equivale al ${pct1(bestShare, false)} del resultado neto: el resultado depende de pocas operaciones.`,
      );
    } else if (worstShare && net.startsWith('-')) {
      risks.push(
        `La mayor pérdida (${signedPEN(worst!.profitLoss)}) equivale al ${pct1(worstShare, false)} de la pérdida neta: el resultado depende de pocas operaciones.`,
      );
    }
  }
  if (decided >= 10) {
    const lostShare = shareAtLeast(String(counts.lost), String(decided), 60);
    if (lostShare)
      risks.push(`El ${pct1(lostShare, false)} de las apuestas decididas fueron perdidas.`);
  }
  if (settled > 0 && settled < 10) {
    risks.push(
      `Muestra limitada: con ${plural(settled, 'apuesta liquidada', 'apuestas liquidadas')}, las cifras son poco representativas.`,
    );
  }
  if (analysis.unconfirmedReturns.count > 0) {
    risks.push(
      `${plural(analysis.unconfirmedReturns.count, 'ganada tiene', 'ganadas tienen')} retorno calculado sin confirmar (${signedPEN(analysis.unconfirmedReturns.profitLoss)} provisionales).`,
    );
  }
  if (risks.length === 0) {
    risks.push(
      settled === 0
        ? 'Sin apuestas liquidadas no se pueden evaluar concentraciones ni resultados.'
        : 'No se detectaron concentraciones ni exposiciones relevantes con las reglas de este informe.',
    );
  }

  return { conclusion, quick: [result, activity, third], risks };
}
