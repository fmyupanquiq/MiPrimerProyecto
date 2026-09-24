/**
 * Almacenamiento de archivos (D-T2, ADR 0017): interfaz desacoplada del proveedor concreto,
 * igual que `TicketReader` (`ai/ticket-reader.ts`) lo está del proveedor de IA. `TicketsService`
 * depende de este token, nunca de `LocalFileStorage` directamente — migrar a un object storage
 * real (S3/R2/MinIO) es sustituir el proveedor de este token, sin tocar el resto del sistema.
 */
export const FILE_STORAGE = Symbol('FILE_STORAGE');

export interface SavedFile {
  sizeBytes: number;
  /** SHA-256 del contenido, mismo propósito que en los backups (§109.3). */
  checksum: string;
}

export interface FileStorage {
  /** Guarda `data` bajo `key`; `key` es relativa, nunca una ruta absoluta ni una URL. */
  save(key: string, data: Buffer): Promise<SavedFile>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
