import { createRequire } from 'node:module';

/*
 * Tema del informe ejecutivo (§108.11; referencia
 * `docs/referencias/Referencias mockups/Reportes/Reporte ejecutivo.png`): fondo blanco y lavanda muy
 * tenue, azul marino para títulos y cifras estructurales, violeta LetFer como marca y verde, rojo y
 * ámbar SOLO con significado (ganancia, pérdida, advertencia).
 */

export const C = {
  navy: '#1e1b4b',
  ink: '#0f172a',
  text: '#334155',
  muted: '#64748b',
  faint: '#94a3b8',
  line: '#e6e3f4',
  lineSoft: '#efedf8',
  zebra: '#faf9ff',
  white: '#ffffff',
  brand: '#7c3aed',
  brandDark: '#5b21b6',
  lavender: '#f5f3ff',
  lavender2: '#ede9fe',
  green: '#15803d',
  greenMid: '#16a34a',
  greenSoft: '#ecfdf5',
  greenLine: '#bbf7d0',
  red: '#b91c1c',
  redMid: '#dc2626',
  redSoft: '#fef2f2',
  redLine: '#fecaca',
  amber: '#92400e',
  amberMid: '#d97706',
  amberSoft: '#fffbeb',
  amberLine: '#fde68a',
  slateSoft: '#f1f5f9',
} as const;

export type Tone = 'positive' | 'negative' | 'neutral';
export const TONE_COLOR: Record<Tone, string> = {
  positive: C.green,
  negative: C.red,
  neutral: C.navy,
};

/** Familias del documento. `inter`: Inter (OFL-1.1, incluida con la app); `standard`: Helvetica. */
export type FontMode = 'inter' | 'standard';
export const F = {
  regular: 'LF-Regular',
  medium: 'LF-Medium',
  semibold: 'LF-SemiBold',
  bold: 'LF-Bold',
  black: 'LF-ExtraBold',
} as const;

const require = createRequire(import.meta.url);
const INTER_FILES: Record<keyof typeof F, string> = {
  regular: '@fontsource/inter/files/inter-latin-400-normal.woff',
  medium: '@fontsource/inter/files/inter-latin-500-normal.woff',
  semibold: '@fontsource/inter/files/inter-latin-600-normal.woff',
  bold: '@fontsource/inter/files/inter-latin-700-normal.woff',
  black: '@fontsource/inter/files/inter-latin-800-normal.woff',
};

/**
 * Registra las fuentes en el documento. Inter se lee del paquete instalado (nunca de Internet) y se
 * incrusta como subconjunto: el texto sigue siendo seleccionable y buscable.
 */
export function registerFonts(doc: PDFKit.PDFDocument, mode: FontMode): void {
  for (const key of Object.keys(F) as (keyof typeof F)[]) {
    if (mode === 'inter') doc.registerFont(F[key], require.resolve(INTER_FILES[key]));
    else
      doc.registerFont(
        F[key],
        key === 'regular' || key === 'medium' ? 'Helvetica' : 'Helvetica-Bold',
      );
  }
}
