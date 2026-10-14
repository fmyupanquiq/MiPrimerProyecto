import { describe, expect, it } from 'vitest';
import {
  acceptedFormatsLabel,
  CLIPBOARD_EMPTY_MESSAGE,
  formatFileSize,
  imageQuality,
  readClipboardImage,
  ticketFileProblem,
  ticketFormatName,
} from './ticket-files.js';

describe('archivos de ticket en el cliente', () => {
  it('la línea de formatos sale de las constantes del backend (sin WEBP)', () => {
    expect(acceptedFormatsLabel()).toBe('JPG, PNG, PDF • máx. 10 MB');
    expect(ticketFormatName('image/jpeg')).toBe('JPG');
    expect(ticketFormatName('application/pdf')).toBe('PDF');
  });

  it('valida tipo y tamaño antes de subir', () => {
    expect(ticketFileProblem({ type: 'image/png', size: 1000 })).toBeNull();
    expect(ticketFileProblem({ type: 'image/webp', size: 1000 })).toBe(
      'Formato no admitido: usa JPG, PNG o PDF.',
    );
    expect(ticketFileProblem({ type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 })).toBe(
      'El archivo supera los 10 MB.',
    );
    expect(ticketFileProblem({ type: 'image/jpeg', size: 10 * 1024 * 1024 })).toBeNull();
  });

  it('tamaño legible: KB sin decimales, MB con uno', () => {
    expect(formatFileSize(239_616)).toBe('234 KB');
    expect(formatFileSize(300)).toBe('1 KB');
    expect(formatFileSize(1_887_437)).toBe('1.8 MB');
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
  });

  it('calidad estimada por el lado corto: ≥900 alta, 600–899 media, <600 baja', () => {
    expect(imageQuality(1080, 1812)).toBe('HIGH');
    expect(imageQuality(900, 3000)).toBe('HIGH');
    expect(imageQuality(899, 3000)).toBe('MEDIUM');
    expect(imageQuality(600, 600)).toBe('MEDIUM');
    expect(imageQuality(599, 2000)).toBe('LOW');
  });

  describe('pegar desde el portapapeles', () => {
    const item = (types: string[], blob = new Blob(['x'], { type: types[0] })) => ({
      types,
      getType: async () => blob,
    });

    it('toma la primera imagen y le da un nombre reconocible', async () => {
      const file = await readClipboardImage({
        read: async () => [item(['text/plain']), item(['image/png'])] as never,
      });
      expect(file?.name).toBe('ticket-pegado.png');
      expect(file?.type).toBe('image/png');
    });

    it('sin imagen, sin permiso o sin API devuelve null (la interfaz muestra la ayuda)', async () => {
      expect(await readClipboardImage({ read: async () => [item(['text/plain'])] as never })).toBe(
        null,
      );
      expect(
        await readClipboardImage({
          read: async () => {
            throw new DOMException('denegado', 'NotAllowedError');
          },
        }),
      ).toBeNull();
      expect(await readClipboardImage(undefined)).toBeNull();
      expect(CLIPBOARD_EMPTY_MESSAGE).toContain('Ctrl+V');
    });
  });
});
