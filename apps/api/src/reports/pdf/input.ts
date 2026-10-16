import type {
  ReportData,
  ReportFilters,
  ReportGroupBy,
  ReportSection,
  ReportSortBy,
} from '@letfer/shared';
import type { FontMode } from './theme.js';

export interface ReportTicketImage {
  betId: string;
  /** `null` si el ticket no es una imagen incrustable (p. ej. un PDF). */
  buffer: Buffer | null;
}

/** Todo lo que necesita el informe. Las cifras llegan calculadas (`data`): el PDF solo las presenta. */
export interface ReportPdfInput {
  data: ReportData;
  projectName: string;
  currency: string;
  timeZone: string;
  generatedBy: string;
  filters: ReportFilters;
  /** Nombres legibles de los filtros por id (casa, etapa). */
  filterNames?: { house?: string; stage?: string };
  periodLabel: string | null;
  sections: readonly ReportSection[];
  groupBy: ReportGroupBy;
  sortBy: ReportSortBy;
  direction: 'asc' | 'desc';
  orientation: 'portrait' | 'landscape';
  paper: 'A4' | 'LETTER';
  /** `null` si no se pidieron o no hay permiso de tickets. */
  ticketImages: ReportTicketImage[] | null;
  ticketsAllowed: boolean;
  /** Solo para pruebas: sin compresión, el texto del PDF se puede inspeccionar. */
  compress?: boolean;
  /** Fuente del documento (por defecto Inter; `standard` = Helvetica, para inspeccionar el texto). */
  fonts?: FontMode;
}

export const BET_TYPE_LABEL = {
  SIMPLE: 'Simple',
  CREATED: 'Creada',
  MULTIPLE: 'Múltiple',
} as const;
