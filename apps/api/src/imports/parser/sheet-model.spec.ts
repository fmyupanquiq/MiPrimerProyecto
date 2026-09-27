import { describe, expect, it } from 'vitest';
import { cellValueToJson, columnIndex, columnLetter, isBlankCell } from './sheet-model.js';

describe('columnLetter / columnIndex (§113.6, Fase 9.2.1)', () => {
  it.each([
    [1, 'A'],
    [2, 'B'],
    [26, 'Z'],
    [27, 'AA'],
    [28, 'AB'],
    [52, 'AZ'],
    [53, 'BA'],
    [702, 'ZZ'],
    [703, 'AAA'],
  ])('columnLetter(%i) === %s', (index, letter) => {
    expect(columnLetter(index)).toBe(letter);
  });

  it('es la inversa de columnIndex para cualquier índice razonable', () => {
    for (const index of [1, 2, 8, 10, 12, 26, 27, 100, 703]) {
      expect(columnIndex(columnLetter(index))).toBe(index);
    }
  });

  it('rechaza índices no válidos y letras no válidas', () => {
    expect(() => columnLetter(0)).toThrow();
    expect(() => columnLetter(-1)).toThrow();
    expect(() => columnLetter(1.5)).toThrow();
    expect(() => columnIndex('1A')).toThrow();
    expect(() => columnIndex('')).not.toThrow(); // cadena vacía: 0, caso degenerado pero no explota
    expect(columnIndex('')).toBe(0);
  });
});

describe('isBlankCell', () => {
  it('trata null, undefined y cadenas en blanco como vacío', () => {
    expect(isBlankCell(null)).toBe(true);
    expect(isBlankCell(undefined as unknown as null)).toBe(true);
    expect(isBlankCell('')).toBe(true);
    expect(isBlankCell('   ')).toBe(true);
  });

  it('no trata como vacío ni un texto con contenido, ni un cero, ni una fecha', () => {
    expect(isBlankCell('GANADO')).toBe(false);
    expect(isBlankCell(0)).toBe(false);
    expect(isBlankCell(false)).toBe(false);
    expect(isBlankCell(new Date('2024-10-22'))).toBe(false);
  });
});

describe('cellValueToJson', () => {
  it('convierte una fecha a ISO 8601 y deja el resto tal cual', () => {
    expect(cellValueToJson(new Date('2024-10-22T00:00:00.000Z'))).toBe('2024-10-22T00:00:00.000Z');
    expect(cellValueToJson('GANADO')).toBe('GANADO');
    expect(cellValueToJson(62.5)).toBe(62.5);
    expect(cellValueToJson(null)).toBeNull();
  });
});
