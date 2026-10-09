import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, readStoredTheme, resolveTheme, ThemeProvider, useTheme } from './theme.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

function Probe() {
  const { mode, resolved, setMode } = useTheme();
  return (
    <>
      <p>
        {mode}/{resolved}
      </p>
      <button type="button" onClick={() => setMode('light')}>
        claro
      </button>
    </>
  );
}

describe('tema visual (Fase 10.3)', () => {
  it('el tema principal es el oscuro', () => {
    expect(readStoredTheme()).toBe('dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText('dark/dark')).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('cambiar de tema se aplica al documento y se recuerda en este navegador', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => screen.getByRole('button', { name: 'claro' }).click());
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('letfer.theme')).toBe('light');
    expect(readStoredTheme()).toBe('light');
  });

  it('"Sistema" sigue la preferencia del sistema operativo; un valor guardado inválido no rompe', () => {
    localStorage.setItem('letfer.theme', 'neon');
    expect(readStoredTheme()).toBe('dark');
    // jsdom no implementa matchMedia: sin preferencia conocida, el oscuro.
    expect(resolveTheme('system')).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
