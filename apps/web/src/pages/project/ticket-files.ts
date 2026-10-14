import { TICKET_MAX_FILE_SIZE_BYTES, TICKET_MIME_TYPES, type TicketMimeType } from '@letfer/shared';

/*
 * Archivos de ticket en el cliente (D-T3): mismo criterio que el backend (tipos y tamaño máximo de
 * `@letfer/shared`), nombres para lo pegado desde el portapapeles y datos de presentación (tamaño
 * legible, calidad estimada por resolución). Funciones puras: ninguna analiza nada ni llama a la IA.
 */

/** Valor del atributo `accept` del selector de archivos. */
export const TICKET_ACCEPT = TICKET_MIME_TYPES.join(',');

const SHORT_NAMES: Record<TicketMimeType, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'application/pdf': 'PDF',
};

/** Nombre corto del formato ("JPG", "PNG", "PDF"); el subtipo en mayúsculas si no se conoce. */
export function ticketFormatName(mime: string): string {
  return SHORT_NAMES[mime as TicketMimeType] ?? (mime.split('/')[1] ?? mime).toUpperCase();
}

/** "JPG, PNG, PDF • máx. 10 MB", generado desde las constantes que valida el backend. */
export function acceptedFormatsLabel(): string {
  const names = TICKET_MIME_TYPES.map((mime) => SHORT_NAMES[mime]).join(', ');
  return `${names} • máx. ${Math.round(TICKET_MAX_FILE_SIZE_BYTES / (1024 * 1024))} MB`;
}

/** Mensaje de error si el archivo no se puede subir como ticket; `null` si es válido. */
export function ticketFileProblem(file: { type: string; size: number }): string | null {
  if (!(TICKET_MIME_TYPES as readonly string[]).includes(file.type)) {
    const names = TICKET_MIME_TYPES.map((mime) => SHORT_NAMES[mime]);
    return `Formato no admitido: usa ${names.slice(0, -1).join(', ')} o ${names.at(-1)}.`;
  }
  if (file.size > TICKET_MAX_FILE_SIZE_BYTES) {
    return `El archivo supera los ${Math.round(TICKET_MAX_FILE_SIZE_BYTES / (1024 * 1024))} MB.`;
  }
  return null;
}

/** ¿Es uno de los formatos admitidos (sin mirar el tamaño)? */
export function isAcceptedTicketFile(file: { type: string }): file is File & {
  type: TicketMimeType;
} {
  return (TICKET_MIME_TYPES as readonly string[]).includes(file.type);
}

export function extensionForMime(mime: string): string {
  if (mime === 'image/png') return '.png';
  if (mime === 'application/pdf') return '.pdf';
  return '.jpg';
}

/**
 * Archivo con nombre a partir de una imagen pegada: el genérico "image.png" que ponen los
 * navegadores se sustituye por uno reconocible.
 */
export function pastedTicketFile(blob: Blob & { name?: string }, type: string): File {
  const name =
    blob.name && blob.name !== 'image.png' ? blob.name : `ticket-pegado${extensionForMime(type)}`;
  return new File([blob], name, { type });
}

/** Tamaño legible: KB sin decimales por debajo de 1 MB; MB con un decimal a partir de ahí. */
export function formatFileSize(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export type ImageQuality = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Calidad ESTIMADA por la resolución de la imagen (no es un juicio de la IA): el lado corto manda.
 * ≥ 900 px alta, 600–899 px media, < 600 px baja.
 */
export function imageQuality(width: number, height: number): ImageQuality {
  const shortSide = Math.min(width, height);
  if (shortSide >= 900) return 'HIGH';
  if (shortSide >= 600) return 'MEDIUM';
  return 'LOW';
}

export const IMAGE_QUALITY_LABELS: Record<ImageQuality, string> = {
  HIGH: 'Calidad: Alta',
  MEDIUM: 'Calidad: Media',
  LOW: 'Calidad: Baja',
};

/** Texto cuando el portapapeles no trae una imagen (o el navegador no deja leerlo). */
export const CLIPBOARD_EMPTY_MESSAGE =
  'No hay ninguna imagen en el portapapeles. También puedes pulsar Ctrl+V (⌘V) sobre esta zona.';

/**
 * Lee la primera imagen del portapapeles con la API asíncrona (`navigator.clipboard.read`). Devuelve
 * `null` si el navegador no lo permite, la persona lo deniega o no hay ninguna imagen.
 */
export async function readClipboardImage(
  clipboard: Pick<Clipboard, 'read'> | undefined = globalThis.navigator?.clipboard,
): Promise<File | null> {
  if (!clipboard || typeof clipboard.read !== 'function') return null;
  try {
    const items = await clipboard.read();
    for (const item of items) {
      const type = item.types.find((candidate) => candidate.startsWith('image/'));
      if (!type) continue;
      return pastedTicketFile(await item.getType(type), type);
    }
    return null;
  } catch {
    return null;
  }
}
