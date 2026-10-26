/// <reference types="node" />
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Carpeta apps/web (esta prueba vive en apps/web/src). Se parte de la cadena import.meta.url: el URL de jsdom no es el de Node.
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fromWeb = (relative: string) => resolve(webRoot, relative);
const publicFile = (name: string) => fromWeb(`public/${name}`);
const kilobytes = (name: string) => statSync(publicFile(name)).size / 1024;

describe('recursos de marca (los que se publican con la web)', () => {
  it('existen los iconos que declara index.html y se sirven desde el mismo origen', () => {
    const html = readFileSync(fromWeb('index.html'), 'utf8');
    for (const href of ['/favicon.ico', '/favicon-32x32.png', '/apple-touch-icon.png']) {
      expect(html, href).toContain(`href="${href}"`);
      expect(statSync(publicFile(href.slice(1))).size, href).toBeGreaterThan(0);
    }
    // Ningún recurso de marca se carga de un servidor externo.
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('el logotipo pesa poco (WebP principal + PNG de respaldo) y mantiene su proporción 3:1', () => {
    expect(kilobytes('logo-wordmark.webp')).toBeLessThan(30);
    expect(kilobytes('logo-wordmark.png')).toBeLessThan(80);

    // PNG: cabecera IHDR (ancho y alto en los bytes 16-23).
    const png = readFileSync(publicFile('logo-wordmark.png'));
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([504, 168]);

    // WebP con transparencia (VP8X): lienzo de 24 bits menos uno en los bytes 24-29.
    const webp = readFileSync(publicFile('logo-wordmark.webp'));
    expect(webp.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(webp.subarray(8, 12).toString('latin1')).toBe('WEBP');
    expect(webp.subarray(12, 16).toString('latin1')).toBe('VP8X');
    const width = 1 + webp.readUIntLE(24, 3);
    const height = 1 + webp.readUIntLE(27, 3);
    expect([width, height]).toEqual([504, 168]);
    expect(webp[20]! & 0x10, 'el logotipo conserva su transparencia').toBe(0x10);
  });

  it('la sesión se pide en paralelo con el JavaScript y el fondo oscuro está listo antes de él', () => {
    const html = readFileSync(fromWeb('index.html'), 'utf8');
    expect(html).toContain('<link rel="preload" as="fetch" href="/api/auth/me" crossorigin />');
    expect(html).toMatch(/html:not\(\[data-theme\]\)\s*\{\s*background-color:\s*oklch\(/);
  });
});
