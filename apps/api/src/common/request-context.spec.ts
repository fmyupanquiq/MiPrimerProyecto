import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../test/support/fake-clock.js';
import { RequestContext } from './request-context.js';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('RequestContext', () => {
  it('no hay contexto fuera de una petición y set() no falla', () => {
    expect(RequestContext.current()).toBeUndefined();
    expect(() => RequestContext.set({ userId: 'x' })).not.toThrow();
  });

  it('se conserva a través de await y permite completar el contexto', async () => {
    await RequestContext.run({ requestId: 'r1' }, async () => {
      await tick(5);
      RequestContext.set({ userId: 'u1' });
      await Promise.resolve();
      expect(RequestContext.current()).toEqual({ requestId: 'r1', userId: 'u1' });
    });
  });

  it('aísla peticiones concurrentes', async () => {
    const observe = (id: string, delay: number) =>
      RequestContext.run({ requestId: id }, async () => {
        await tick(delay);
        RequestContext.set({ sessionId: `s-${id}` });
        await tick(delay);
        return RequestContext.current();
      });

    const [a, b] = await Promise.all([observe('A', 10), observe('B', 3)]);
    expect(a).toEqual({ requestId: 'A', sessionId: 's-A' });
    expect(b).toEqual({ requestId: 'B', sessionId: 's-B' });
  });
});

describe('FakeClock', () => {
  it('avanza de forma controlada', () => {
    const clock = new FakeClock('2026-01-01T00:00:00.000Z');
    clock.advanceSeconds(90);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:01:30.000Z');
    clock.set('2027-01-01T00:00:00.000Z');
    expect(clock.now().getUTCFullYear()).toBe(2027);
  });
});
