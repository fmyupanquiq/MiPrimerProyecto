import type { TicketMimeType } from '@letfer/shared';

/**
 * Detecta el tipo MIME real por los primeros bytes del archivo (D-T3, §97: nunca se confía en
 * el `Content-Type` declarado por el cliente, que cualquiera puede falsear). Solo reconoce los
 * tres formatos aceptados (§28); cualquier otro contenido devuelve `null`.
 */
export function sniffMimeType(buffer: Buffer): TicketMimeType | null {
  if (buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

const EXTENSION_MIME: Record<string, TicketMimeType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
};

/** Extensión reconocida (§28); `null` si no es ninguna de las aceptadas. */
export function mimeForExtension(fileName: string): TicketMimeType | null {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = fileName.slice(dot).toLowerCase();
  return EXTENSION_MIME[ext] ?? null;
}
