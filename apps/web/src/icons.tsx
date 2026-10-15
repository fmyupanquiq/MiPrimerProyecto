import type { ReactNode } from 'react';

/*
 * Iconos de la interfaz (Fase 10.3): SVG en línea, de trazo, 20×20, sin dependencias. Son
 * decorativos (`aria-hidden`): el texto que los acompaña es el nombre accesible.
 */

function Icon({ children, className = 'h-5 w-5' }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type IconProps = { className?: string };

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </Icon>
);
export const TicketIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4Z" />
    <path d="M13 5v14" strokeDasharray="2 2" />
  </Icon>
);
export const ReturnIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
  </Icon>
);
export const BankIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3 9 9-5 9 5" />
    <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" />
    <path d="M3 21h18" />
  </Icon>
);
export const LayersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 3 9 5-9 5-9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </Icon>
);
export const UploadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 16V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
  </Icon>
);
export const ChartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4v16h16" />
    <path d="m7 14 4-4 3 3 5-6" />
  </Icon>
);
export const UsersIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-3.5-5.5" />
  </Icon>
);
export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);
/** Distinto de `TrashIcon` a propósito (Fase 11, §35): "Proyectos eliminados" (un proyecto
 * completo, archivado) no es el mismo concepto que "Eliminados" dentro de un proyecto (apuestas
 * y etapas sueltas) — nunca deben compartir el mismo tratamiento visual. */
export const ArchiveIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="5" rx="1" />
    <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
    <path d="M10 13h4" />
  </Icon>
);
export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6Z" />
  </Icon>
);
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </Icon>
);
export const FolderIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
  </Icon>
);
export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);
export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const WalletIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h13v4" />
    <path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2Z" />
    <circle cx="16" cy="14.5" r="1" />
  </Icon>
);
export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);
export const TrendIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3 17 6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </Icon>
);
export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4 2.5 20h19Z" />
    <path d="M12 10v4M12 17h.01" />
  </Icon>
);
export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);
export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </Icon>
);
export const MonitorIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Icon>
);
export const HelpIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.3" />
    <path d="M12 17h.01" />
  </Icon>
);
export const InfoIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
);
export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);
export const CheckCircleIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.8 2.8L16 10" />
  </Icon>
);
export const XCircleIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m9 9 6 6M15 9l-6 6" />
  </Icon>
);
export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);
export const BanIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m5.6 5.6 12.8 12.8" />
  </Icon>
);
export const CoinsIcon = (p: IconProps) => (
  <Icon {...p}>
    <ellipse cx="9" cy="7" rx="6" ry="3" />
    <path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7" />
    <path d="M9 17c0 1.7 2.7 3 6 3s6-1.3 6-3v-4c0-1.6-2.4-2.9-5.5-3" />
  </Icon>
);
export const CircleIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
  </Icon>
);
export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </Icon>
);
export const ArrowUpRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Icon>
);
export const ArrowDownLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M17 7 7 17M16 17H7V8" />
  </Icon>
);
export const SwapIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8h14l-3-3M20 16H6l3 3" />
  </Icon>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);
export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m15 6-6 6 6 6" />
  </Icon>
);
export const FileIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
    <path d="M14 3v6h6" />
  </Icon>
);
export const DotsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="5" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="19" r="1.2" fill="currentColor" />
  </Icon>
);
export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const LogoutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 17l-5-5 5-5M5 12h11" />
  </Icon>
);
/** Lectura/prellenado por IA: nunca decorativo porque sí, siempre junto al texto que explica qué detectó. */
export const SparkleIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4Z" />
  </Icon>
);
/** Ampliar una imagen (visor a pantalla casi completa). */
export const ExpandIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </Icon>
);

export const TrophyIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
    <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
  </Icon>
);

export const SaveIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 3h11l4 4v14H5V3Z" />
    <path d="M8 3v6h8V3M8 21v-7h8v7" />
  </Icon>
);

export const StarIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" />
  </Icon>
);

/** Documento con lápiz ("Datos de la apuesta" en el asistente). */
export const DocumentIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5" />
    <path d="M14 3v5h5v3" />
    <path d="m18.5 14.5 2 2-5 5H13.5v-2Z" />
  </Icon>
);

/** Barras ascendentes (monto potencial). */
export const ChartBarsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 20v-5M10 20v-9M15 20v-7M20 20V5" strokeWidth={2.6} />
  </Icon>
);

// --- Asistente "Añadir apuesta" (rediseño de los tres pasos) ---------------------------------------

/** Subir: nube con flecha hacia arriba. */
export const CloudUploadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1 .5 7.97" />
    <path d="M12 12v8M8.5 15.5 12 12l3.5 3.5" />
  </Icon>
);
/** Imagen (marco con montaña y sol). */
export const ImageIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="9.5" r="1.6" />
    <path d="m21 16-5-5-8 9" />
  </Icon>
);
export const ClipboardIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="4.5" width="12" height="16" rx="2" />
    <path d="M9 4.5V3.8A.8.8 0 0 1 9.8 3h4.4a.8.8 0 0 1 .8.8v.7M9 4.5h6v2H9z" />
  </Icon>
);
export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
export const ExternalLinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Icon>
);
export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Icon>
);
export const FlagIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  </Icon>
);
export const CalendarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);
/** Billete (monto apostado). */
export const BanknoteIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6 9v.01M18 15v.01" />
  </Icon>
);
/** Escáner de documento (lectura con IA). */
export const ScanIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <path d="M8 9h8M8 12h8M8 15h5" />
  </Icon>
);
export const PlusCircleIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8.5v7M8.5 12h7" />
  </Icon>
);
export const MinusCircleIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 12h7" />
  </Icon>
);
/** Lista con viñetas. */
export const ListIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth={2.6} />
  </Icon>
);
/** Indicador de trabajo en curso (gira con `animate-spin`; respeta prefers-reduced-motion en CSS). */
export const SpinnerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Icon>
);

// --- Dashboard (rediseño 2026-10-15) ----------------------------------------------------------------

/** Balón de fútbol: deporte de una apuesta. */
export const SoccerBallIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m12 7.5 4 2.9-1.5 4.7h-5L8 10.4Z" />
    <path d="M12 7.5V3.2M16 10.4l4.2-1.4M14.5 15.1l2.6 3.6M9.5 15.1l-2.6 3.6M8 10.4 3.8 9" />
  </Icon>
);
/** Trofeo/medalla genérica: deporte que no es fútbol o sin deporte. */
export const SportIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3.5 9.5c3 1 5.5 3.5 6.5 11M20.5 14.5c-3-1-5.5-3.5-6.5-11" />
  </Icon>
);
/** Reloj de arena: apuestas pendientes. */
export const HourglassIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3h12M6 21h12" />
    <path d="M7 3v3a5 5 0 0 0 5 5 5 5 0 0 0 5-5V3M7 21v-3a5 5 0 0 1 5-5 5 5 0 0 1 5 5v3" />
  </Icon>
);
/** Rayo: acciones rápidas. */
export const BoltIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12Z" />
  </Icon>
);
/** Gráfico de área: evolución del capital. */
export const AreaChartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 4v16.5H20" />
    <path d="m6.5 16 4-5 3.5 3 5.5-6.5" />
    <path
      d="M6.5 16v1.5h13V8l-5.5 6.5-3.5-3Z"
      fill="currentColor"
      fillOpacity={0.25}
      stroke="none"
    />
  </Icon>
);
/** Gráfico de dona: estado de apuestas. */
export const DonutIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 3.5v5M18.5 17.5l-3.6-3.2" />
  </Icon>
);
/** Flecha hacia arriba (variación positiva). */
export const ArrowUpIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);
/** Flecha hacia abajo (variación negativa). */
export const ArrowDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);

// --- Reportes (§108.11) -------------------------------------------------------------------------------

/** Embudo: filtros. */
export const FilterIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 5h17l-6.5 7.5v5.5l-4 2v-7.5Z" />
  </Icon>
);
/** Etiqueta: mercado. */
export const TagIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7Z" />
    <circle cx="8" cy="8" r="1.4" />
  </Icon>
);
/** Descarga. */
export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4v11M7 10.5l5 5 5-5" />
    <path d="M4.5 19.5h15" />
  </Icon>
);
