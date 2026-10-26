import { render } from '@testing-library/react';
import { SYSTEM_NAME } from '@letfer/shared';
import { describe, expect, it } from 'vitest';
import { BrandLogo } from './BrandLogo.js';

describe('BrandLogo', () => {
  it('sirve WebP con el PNG optimizado de respaldo, con nombre accesible y proporción declarada', () => {
    const { container } = render(<BrandLogo className="h-9 w-auto" />);
    const source = container.querySelector('picture > source');
    const image = container.querySelector('picture > img');
    expect(source?.getAttribute('srcset')).toBe('/logo-wordmark.webp');
    expect(source?.getAttribute('type')).toBe('image/webp');
    expect(image?.getAttribute('src')).toBe('/logo-wordmark.png');
    expect(image?.getAttribute('alt')).toBe(SYSTEM_NAME);
    // Con ancho y alto declarados el navegador reserva el hueco antes de descargarla (sin salto de diseño).
    expect(image?.getAttribute('width')).toBe('504');
    expect(image?.getAttribute('height')).toBe('168');
    expect(image?.className).toBe('h-9 w-auto');
    expect(image?.getAttribute('decoding')).toBe('async');
    expect(image?.getAttribute('fetchpriority')).toBe('auto');
  });

  it('en la pantalla de acceso (el elemento más grande) se pide con prioridad alta', () => {
    const { container } = render(<BrandLogo className="h-14 w-auto" priority />);
    expect(container.querySelector('img')?.getAttribute('fetchpriority')).toBe('high');
  });
});
