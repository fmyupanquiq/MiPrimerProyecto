/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readStoredTheme, resolveTheme } from './theme.js';

// El script que index.html ejecuta antes del primer pintado (apps/web/public/assets/theme-init.v1.js).
const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'theme-init.v1.js'),
  'utf8',
);

function runInitScript(): string | null {
  document.documentElement.removeAttribute('data-theme');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  new Function(source)();
  return document.documentElement.getAttribute('data-theme');
}

function systemPrefersDark(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: dark, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('theme-init.v1.js (tema correcto desde el primer pintado)', () => {
  it('aplica el tema claro guardado, sin pasar por el oscuro', () => {
    window.localStorage.setItem('letfer.theme', 'light');
    expect(runInitScript()).toBe('light');
  });

  it('aplica el oscuro guardado y, sin nada guardado, el oscuro predeterminado', () => {
    window.localStorage.setItem('letfer.theme', 'dark');
    expect(runInitScript()).toBe('dark');
    window.localStorage.clear();
    expect(runInitScript()).toBe('dark');
  });

  it('un valor guardado no válido cae al oscuro (igual que la aplicación)', () => {
    window.localStorage.setItem('letfer.theme', 'rosa');
    expect(runInitScript()).toBe('dark');
  });

  it('«sistema» sigue la preferencia del sistema operativo', () => {
    window.localStorage.setItem('letfer.theme', 'system');
    systemPrefersDark(false);
    expect(runInitScript()).toBe('light');
    systemPrefersDark(true);
    expect(runInitScript()).toBe('dark');
  });

  it('sin acceso al almacenamiento (modo privado estricto) usa el oscuro y no falla', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(runInitScript()).toBe('dark');
  });

  it('solo lee la preferencia: nunca la escribe ni la borra', () => {
    window.localStorage.setItem('letfer.theme', 'light');
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    runInitScript();
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('letfer.theme')).toBe('light');
  });

  it('da siempre el mismo resultado que la lógica de la aplicación (theme.tsx)', () => {
    for (const stored of [null, 'dark', 'light', 'system', 'otro']) {
      for (const dark of [true, false]) {
        window.localStorage.clear();
        if (stored !== null) window.localStorage.setItem('letfer.theme', stored);
        systemPrefersDark(dark);
        expect(runInitScript(), `${String(stored)} / sistema oscuro=${String(dark)}`).toBe(
          resolveTheme(readStoredTheme()),
        );
      }
    }
  });
});
