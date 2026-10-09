import { stakeFromAmount, type MoneyString, type TicketExtractionSelection } from '@letfer/shared';
import { formatStake } from '../../format.js';

/*
 * Funciones puras del prellenado por IA (Fase 10.8, §1-§5): nada aquí llama a React ni conoce el
 * formulario — son las mismas reglas deterministas que `NewBetForm.tsx` aplica al aceptar una
 * extracción, separadas para poder probarlas sin montar el componente completo.
 */

/**
 * Mercado + selección = Pronóstico (§1): el mercado no es un dato aparte que haya que abrir "Más
 * detalles" para entender — se incorpora al texto principal. `market` sigue existiendo como campo
 * estructurado en el modelo (se guarda igual, por si se necesita después); esto solo decide qué
 * texto se muestra en el campo "Pronóstico" visible. Nunca inventa texto: si falta un lado, se usa
 * solo el que hay.
 */
export function composeForecastText(
  market: string | undefined,
  selection: string | undefined,
): string {
  const m = market?.trim() ?? '';
  const s = selection?.trim() ?? '';
  if (m === '') return s;
  if (s === '') return m;
  return `${m} ${s}`;
}

export interface DerivedStake {
  /** El stake resultante (`importe ÷ unidad`), sin ceros de relleno (p. ej. "5.36", "30"). */
  stake: string;
  /** `true` si coincide exactamente con uno de los atajos rápidos; `false` → "Otra cantidad". */
  isPreset: boolean;
}

/**
 * Deriva el stake a partir del importe del ticket cuando este NO lo muestra explícitamente (§3,
 * §4, §5): `stake = importe ÷ unidad de la etapa activa`, sin redondear ni aproximar a un atajo
 * rápido — si el resultado exacto no coincide con ninguno, se marca como "no es un atajo" para que
 * quien llama active "Otra cantidad" y rellene el valor exacto. `null` si el importe o la unidad
 * no son cifras de dinero válidas.
 */
export function deriveStakeFromAmount(
  amount: MoneyString,
  unitStake: MoneyString,
  quickStakes: readonly number[],
): DerivedStake | null {
  let raw: string;
  try {
    raw = stakeFromAmount(amount, unitStake).stake;
  } catch {
    return null;
  }
  const stake = formatStake(raw);
  const asNumber = Number(stake);
  const isPreset = quickStakes.includes(asNumber) && String(asNumber) === stake;
  return { stake, isPreset };
}

/**
 * Cuotas individuales listas para `resolveTicketOdds` (Fase 10.9, §2-§4): el producto de las
 * cuotas individuales solo es una cifra de referencia válida si TODAS las selecciones la
 * muestran — si falta una sola, no se sabe su cuota real y multiplicar solo las conocidas daría
 * un número menor al verdadero (una invención silenciosa, nunca permitida). `undefined` sin
 * selecciones o con alguna sin cuota, para que la jerarquía de `resolveTicketOdds` no calcule
 * nada en ese caso.
 */
export function collectCompleteIndividualOdds(
  selections: readonly TicketExtractionSelection[] | undefined,
): string[] | undefined {
  if (!selections || selections.length === 0) return undefined;
  const odds: string[] = [];
  for (const selection of selections) {
    if (!selection.visibleOdds) return undefined;
    odds.push(selection.visibleOdds);
  }
  return odds;
}
