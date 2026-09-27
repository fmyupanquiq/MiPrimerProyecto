import { describe, expect, it } from 'vitest';
import { parseBetsafeSelections } from './betsafe-selections.js';

describe('parseBetsafeSelections (§113.5, D-X15, D-X24: gramática confirmada en 9.2.0)', () => {
  it('una descripción sin "*" es una sola selección (Simple)', () => {
    const selections = parseBetsafeSelections(
      'Napoli vs Lecce:\nPrimer equipo en anotar 2 goles:  Napoli',
      'FUTBOL',
    );
    expect(selections).toEqual([
      {
        eventGroup: 0,
        position: 0,
        sport: 'FUTBOL',
        event: 'Napoli vs Lecce',
        market: null,
        selection: 'Primer equipo en anotar 2 goles:  Napoli',
        visibleOdds: null,
      },
    ]);
  });

  it('dos bloques "*" separados por una línea en blanco: dos selecciones (Multi)', () => {
    const description =
      '*Manchester City vs Southampton:\nGana Manchester City\n\n*Napoli vs Lecce:\nGana Napoli\n';
    const selections = parseBetsafeSelections(description, 'FUTBOL');
    expect(selections).toEqual([
      {
        eventGroup: 0,
        position: 0,
        sport: 'FUTBOL',
        event: 'Manchester City vs Southampton',
        market: null,
        selection: 'Gana Manchester City',
        visibleOdds: null,
      },
      {
        eventGroup: 1,
        position: 0,
        sport: 'FUTBOL',
        event: 'Napoli vs Lecce',
        market: null,
        selection: 'Gana Napoli',
        visibleOdds: null,
      },
    ]);
  });

  it('acepta \\r\\n (como llega el texto crudo) igual que \\n (como lo normaliza un XML real)', () => {
    const withCrlf =
      '*Real Madrid vs Barcelona:\r\nGana Real Madrid\r\n\r\n*Sevilla vs Betis:\r\nGana Sevilla';
    const withLf = withCrlf.replace(/\r\n/g, '\n');
    expect(parseBetsafeSelections(withCrlf, null)).toEqual(parseBetsafeSelections(withLf, null));
  });

  it('nunca inventa una cuota por selección: siempre null, sea Simple o Multi', () => {
    for (const description of [
      'Solo un evento:\nUna selección',
      '*Evento uno:\nA\n\n*Evento dos:\nB',
    ]) {
      for (const selection of parseBetsafeSelections(description, null)) {
        expect(selection.visibleOdds).toBeNull();
      }
    }
  });

  it('tres o más selecciones se numeran en orden (eventGroup 0, 1, 2, …)', () => {
    const description = '*Uno:\nA\n\n*Dos:\nB\n\n*Tres:\nC';
    const selections = parseBetsafeSelections(description, 'TENIS');
    expect(selections.map((s) => [s.eventGroup, s.event])).toEqual([
      [0, 'Uno'],
      [1, 'Dos'],
      [2, 'Tres'],
    ]);
  });

  it('sin deporte (columna vacía), sport queda null en cada selección', () => {
    expect(parseBetsafeSelections('Evento:\nSelección', null)[0]!.sport).toBeNull();
  });

  it('un evento sin ":" al final se conserva tal cual, sin cortar nada', () => {
    const selections = parseBetsafeSelections('Evento sin dos puntos\nSelección', null);
    expect(selections[0]!.event).toBe('Evento sin dos puntos');
    expect(selections[0]!.selection).toBe('Selección');
  });

  it('una sola línea (sin salto ni ":"): la misma frase sirve de evento y de selección', () => {
    const selections = parseBetsafeSelections('Frase única sin estructura', null);
    expect(selections).toHaveLength(1);
    expect(selections[0]).toMatchObject({
      event: 'Frase única sin estructura',
      selection: 'Frase única sin estructura',
    });
  });

  it('un "*" suelto sin nada detrás no rompe el separador (fila degenerada, defensivo)', () => {
    expect(() => parseBetsafeSelections('*', null)).not.toThrow();
    expect(parseBetsafeSelections('*', null)).toHaveLength(1);
  });
});
