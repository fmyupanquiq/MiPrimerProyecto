import type { ReactNode } from 'react';
import { HelpTip } from './ui.js';

/**
 * Glosario de LetFer (Fase 10.3): explicaciones breves para quien no conoce el mundo de las
 * apuestas. Resumen la especificación (§11, §12, §17, §32, §77, §80, §92, §108); no definen
 * reglas nuevas. Un solo lugar para que el mismo concepto se explique igual en todas partes.
 */
export const GLOSSARY = {
  stake: {
    label: 'Stake',
    text: 'Nivel de la apuesta: un multiplicador (no un porcentaje). El importe es stake × unidad de la etapa. Ej.: stake 3 con unidad S/ 20 = S/ 60.',
  },
  unit: {
    label: 'Unidad de stake',
    text: 'Valor en soles de un stake 1 en la etapa. Es la misma para todas las casas y solo cambia de una etapa a otra.',
  },
  amount: {
    label: 'Importe apostado',
    text: 'Dinero que se apuesta. Se calcula como stake × unidad; si la casa cobró otra cifra, se puede indicar el importe oficial.',
  },
  odds: {
    label: 'Cuota',
    text: 'Multiplicador que paga la casa si la apuesta gana. Ej.: S/ 20 a cuota 1.95 devuelven S/ 39 (S/ 20 apostados + S/ 19 de ganancia).',
  },
  calculatedOdds: {
    label: 'Cuota calculada',
    text: 'El ticket no muestra una cuota total. LetFer la calculó (con el retorno dividido entre el importe, o con el producto de las cuotas individuales si no hay retorno). Es editable: corrígela si la casa muestra otra cifra.',
  },
  profit: {
    label: 'Ganancia',
    text: 'Lo que se gana o se pierde con la apuesta: retorno − importe apostado. En una perdida es el importe en negativo; en una anulada, 0.',
  },
  ag: {
    label: 'A+G (apostado + ganancia)',
    text: 'El total que devuelve la casa cuando la apuesta se cobra: el importe apostado más la ganancia. Es lo mismo que el retorno.',
  },
  return: {
    label: 'Retorno',
    text: 'Dinero que la casa devuelve al liquidar la apuesta (apostado + ganancia). Una perdida tiene retorno 0.',
  },
  officialReturn: {
    label: 'Retorno oficial',
    text: 'El retorno que muestra la casa. Si se registra, manda sobre el cálculo de LetFer. Sin él, el retorno es "calculado" y queda pendiente de confirmar.',
  },
  calculatedReturn: {
    label: 'Retorno calculado',
    text: 'Retorno estimado por LetFer con el importe y la cuota. Ya cuenta en los resultados, pero es provisional hasta confirmar el retorno oficial.',
  },
  cashout: {
    label: 'Cash out',
    text: 'Cobro anticipado: la casa paga una cantidad antes de que termine el evento. El retorno es lo que la casa pagó.',
  },
  void: {
    label: 'Anulada',
    text: 'Apuesta cancelada por la casa: se devuelve el importe apostado y la ganancia es 0.',
  },
  capital: {
    label: 'Capital actual',
    text: 'Todo el dinero del proyecto: lo disponible más lo comprometido, sumando todas las casas.',
  },
  available: {
    label: 'Disponible',
    text: 'Dinero que puedes usar ahora para nuevas apuestas o retiros. Nunca puede ser negativo.',
  },
  committed: {
    label: 'Comprometido',
    text: 'Dinero reservado en apuestas pendientes y retiros por aprobar. Se libera al liquidar la apuesta o resolver el retiro.',
  },
  balance: {
    label: 'Saldo',
    text: 'Dinero de una casa: disponible + comprometido.',
  },
  betFormat: {
    label: 'Formato de apuesta',
    text: 'Simple: un pronóstico. Múltiple: varios partidos combinados en una sola apuesta. Creada: varios pronósticos del mismo partido combinados entre sí.',
  },
  stage: {
    label: 'Etapa',
    text: 'Periodo de trabajo con una unidad de stake propia. Solo una está activa; al cambiar de etapa la banca continúa, no se reinicia.',
  },
  house: {
    label: 'Casa',
    text: 'Casa de apuestas donde está el dinero (Betano, Betsafe…). Cada una es una cuenta con su propio saldo.',
  },
  reconciliation: {
    label: 'Conciliación',
    text: 'Comparar el disponible que calcula LetFer con el que muestra la casa. Si coinciden, queda un punto de control; si no, se registra la diferencia.',
  },
  transfer: {
    label: 'Transferencia',
    text: 'Mover dinero entre dos casas del proyecto. No es ganancia ni pérdida: el total del proyecto no cambia.',
  },
  extraordinary: {
    label: 'Movimiento extraordinario',
    text: 'Un cambio real del saldo de una casa que no es apuesta, depósito ni retiro: un bono, un cashback, una comisión.',
  },
  pl: {
    label: 'Ganancia / pérdida (P/L)',
    text: 'Resultado neto de las apuestas liquidadas. No incluye depósitos, retiros ni transferencias.',
  },
  yield: {
    label: 'Yield',
    text: 'Ganancia ÷ total apostado en las liquidadas × 100. Cuánto ganas por cada sol que apuestas.',
  },
  roi: {
    label: 'ROI',
    text: 'Ganancia ÷ capital invertido (banca inicial + depósitos netos) × 100. Rendimiento sobre el dinero aportado.',
  },
  drawdown: {
    label: 'Drawdown',
    text: 'La mayor caída de los resultados desde su punto más alto. Mide la peor racha.',
  },
} as const satisfies Record<string, { label: string; text: string }>;

export type GlossaryKey = keyof typeof GLOSSARY;

/** El "[?]" de un concepto del glosario. */
export function Help({ term }: { term: GlossaryKey }) {
  return <HelpTip label={GLOSSARY[term].label}>{GLOSSARY[term].text}</HelpTip>;
}

/** Texto de un concepto con su ayuda al lado (para cabeceras y rótulos que no son `<label>`). */
export function TermLabel({ term, children }: { term: GlossaryKey; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children ?? GLOSSARY[term].label}
      <Help term={term} />
    </span>
  );
}
