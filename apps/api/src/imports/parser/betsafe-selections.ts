import type { NormalizedImportSelection } from '@letfer/shared';

/**
 * Separador de selecciones del texto de PARTIDO de Betsafe (Fase 9.2.2, §113.5, D-X15, D-X24;
 * gramática confirmada en la subfase 9.2.0). Un múltiple escribe cada selección como un bloque
 * `*Evento:\nSelección`, y separa los bloques con una línea en blanco; una apuesta sin ningún
 * bloque `*` es un solo evento (Simple o Creada, indistinguibles solo por el texto: ninguna apuesta
 * real de Betsafe usa "Creada" todavía, así que esa forma de texto sigue sin un ejemplo que la
 * calibre — de momento se trata igual que una Simple, con una única selección).
 *
 * Nunca inventa una cuota por selección (D-X15): siempre `visibleOdds: null`. La cuota total de la
 * apuesta (`visibleTotalOdds`) es la única autoridad.
 */
export function parseBetsafeSelections(
  description: string,
  sport: string | null,
): NormalizedImportSelection[] {
  const normalized = description.replace(/\r\n/g, '\n').trim();
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  const legBlocks = blocks.some((block) => block.startsWith('*'))
    ? blocks.filter((block) => block.startsWith('*'))
    : blocks.slice(0, 1);

  if (legBlocks.length === 0) {
    // Defensivo: no debería ocurrir (una fila VALID siempre tiene descripción), pero una selección
    // vacía nunca es mejor que una con el texto completo sin repartir.
    return [selectionFrom(normalized || '(sin descripción)', 0, sport)];
  }
  return legBlocks.map((block, index) => selectionFrom(block, index, sport));
}

function selectionFrom(
  block: string,
  eventGroup: number,
  sport: string | null,
): NormalizedImportSelection {
  const withoutStar = block.startsWith('*') ? block.slice(1) : block;
  const lines = withoutStar
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const firstLine = lines[0] ?? withoutStar.trim();
  const rawEvent = firstLine.endsWith(':') ? firstLine.slice(0, -1).trim() : firstLine;
  const event = rawEvent.length > 0 ? rawEvent : `Selección ${eventGroup + 1}`;
  const selectionText = lines.slice(1).join(' ').trim();
  return {
    eventGroup,
    position: 0,
    sport,
    event,
    market: null,
    selection: selectionText.length > 0 ? selectionText : event,
    visibleOdds: null,
  };
}
