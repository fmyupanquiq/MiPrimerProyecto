/**
 * Fase 11, §5: `DashboardCard` ya no es una segunda implementación de tarjeta — era un duplicado
 * casi idéntico de `Section` (mismo borde, mismo radio, mismo propósito, con un padding distinto
 * por accidente). Un solo primitivo de tarjeta para toda la aplicación: este módulo queda solo
 * para no reescribir los imports de cada pieza del dashboard.
 */
export {
  Section as DashboardCard,
  CardLink,
  SectionError,
  PrimaryLink,
  EmptyState,
  LoadingBlock,
  Skeleton,
} from '../../../ui.js';
