import { z } from 'zod';

/**
 * Backups y recuperación (§37, §82, §109.3-4). El manifiesto de generaciones vive fuera de
 * PostgreSQL, junto a los propios volcados (D-B3): si la base de datos se pierde, la lista de
 * sus propios backups no se pierde con ella. La API solo lo lee, no lo posee.
 */
export const BACKUP_STATUSES = ['COMPLETED', 'FAILED'] as const;
export type BackupStatus = (typeof BACKUP_STATUSES)[number];

export const BACKUP_TRIGGERS = ['SCHEDULED', 'MANUAL'] as const;
export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];

export interface BackupGeneration {
  id: string;
  takenAt: string;
  triggeredBy: BackupTrigger;
  /** Nombre del archivo dentro del directorio de backups (D-B1), nunca una ruta absoluta. */
  fileName: string;
  sizeBytes: number;
  /** SHA-256 del archivo, para detectar corrupción (§109.3). */
  checksum: string;
  /**
   * Empaquetado de `TICKETS_DIR` con `tar` (§110.1, ADR 0017), junto al volcado en la misma
   * generación: ningún archivo queda fuera del respaldo completo (D-B2 ampliado a la Fase 7).
   * `null` únicamente en generaciones de antes de la Fase 7 (manifiestos ya existentes).
   */
  ticketsFileName: string | null;
  ticketsSizeBytes: number | null;
  ticketsChecksum: string | null;
  status: BackupStatus;
  errorMessage: string | null;
}

/**
 * Restaurar exige escribir el identificador exacto de la generación (confirmación fuerte, D-R1,
 * §37): evita restaurar la generación equivocada por un clic apresurado.
 */
export const restoreBackupSchema = z.object({
  generationId: z.uuid(),
  confirmation: z.string().trim().min(1),
});
export type RestoreBackupInput = z.infer<typeof restoreBackupSchema>;
