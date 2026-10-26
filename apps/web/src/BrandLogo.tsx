import { SYSTEM_NAME } from '@letfer/shared';

/**
 * Logotipo oficial de LetFer (icono + nombre). Se sirve en WebP (18 KB) con el PNG optimizado de respaldo;
 * ambos miden 504×168 (3× la altura más grande con la que se muestra) y declaran su proporción para que la
 * página reserve el hueco antes de que llegue la imagen (sin saltos de diseño).
 */
export function BrandLogo({
  className,
  priority = false,
}: {
  className: string;
  priority?: boolean;
}) {
  return (
    <picture>
      <source srcSet="/logo-wordmark.webp" type="image/webp" />
      <img
        src="/logo-wordmark.png"
        alt={SYSTEM_NAME}
        width={504}
        height={168}
        decoding="async"
        // En la pantalla de acceso es el elemento más grande: se pide con prioridad alta.
        fetchPriority={priority ? 'high' : 'auto'}
        className={className}
      />
    </picture>
  );
}
