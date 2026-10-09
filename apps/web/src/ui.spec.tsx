import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Help } from './glossary.js';
import { formatStake, moneyTone, signedPEN } from './format.js';
import { HelpTip, Notice } from './ui.js';

afterEach(cleanup);

describe('ayuda contextual [?] (Fase 10.3)', () => {
  it('se abre al tocarla, explica el concepto y se cierra con Escape', () => {
    render(<HelpTip label="Stake">Nivel de la apuesta.</HelpTip>);
    const button = screen.getByRole('button', { name: '¿Qué es Stake?' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole('tooltip').textContent).toContain('Nivel de la apuesta.');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('también se abre con el teclado (foco) y se describe para lectores de pantalla', () => {
    render(<HelpTip label="Cuota">Multiplicador.</HelpTip>);
    const button = screen.getByRole('button', { name: '¿Qué es Cuota?' });
    fireEvent.focus(button);
    const tooltip = screen.getByRole('tooltip');
    expect(button.getAttribute('aria-describedby')).toBe(tooltip.id);
    fireEvent.blur(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('el glosario explica los conceptos del dominio con un ejemplo cuando ayuda', () => {
    render(
      <>
        <Help term="stake" />
        <Help term="available" />
        <Help term="committed" />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: '¿Qué es Stake?' }));
    expect(screen.getByRole('tooltip').textContent).toMatch(/stake 3 con unidad S\/ 20 = S\/ 60/);
    // Tocar otra ayuda cierra la anterior (pulsación fuera de ella).
    const committed = screen.getByRole('button', { name: '¿Qué es Comprometido?' });
    fireEvent.pointerDown(committed);
    fireEvent.click(committed);
    expect(screen.getByRole('tooltip').textContent).toMatch(/apuestas pendientes/);
  });
});

describe('avisos', () => {
  it('un error se anuncia como alerta; el resto, como estado', () => {
    render(
      <>
        <Notice tone="error">Falló.</Notice>
        <Notice tone="warning">Ojo.</Notice>
      </>,
    );
    expect(screen.getByRole('alert').textContent).toBe('Falló.');
    expect(screen.getByRole('status').textContent).toBe('Ojo.');
  });
});

describe('formato de cifras (solo presentación)', () => {
  it('importes con signo explícito, sin depender del color', () => {
    expect(signedPEN('19.00')).toBe('+S/ 19.00');
    expect(signedPEN('-20.00')).toBe('-S/ 20.00');
    expect(signedPEN('0.00')).toBe('S/ 0.00');
    expect(moneyTone('19.00')).toBe('text-green-700');
    expect(moneyTone('-1.00')).toBe('text-red-700');
    expect(moneyTone('0.00')).toBe('text-slate-700');
  });

  it('stake sin ceros de relleno', () => {
    expect(formatStake('2.0000')).toBe('2');
    expect(formatStake('1.5000')).toBe('1.5');
    expect(formatStake('3')).toBe('3');
  });
});
