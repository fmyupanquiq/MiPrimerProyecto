/** Escapa `%`, `_` y `\` para usar un texto literal dentro de un patrón `LIKE`/`ILIKE`. */
export const escapeLike = (value: string): string =>
  value.replace(/[\\%_]/g, (char) => `\\${char}`);
