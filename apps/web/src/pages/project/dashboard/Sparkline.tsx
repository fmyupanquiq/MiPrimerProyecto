import type { BankrollChart } from '@letfer/shared';
import { useId, useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { zonedParts } from '../../../time-zone.js';
import { CHART } from '../chart-theme.js';
/** Curva decorativa del capital detrás del contenido (la cifra real está en el gráfico). */
export function Sparkline({ bankroll }: { bankroll: BankrollChart | null }) {
  const gradientId = useId();
  const data = useMemo(() => {
    // Solo para dibujar: el último saldo REAL de cada día (posición vertical), nunca un cálculo.
    const byDay = new Map<string, number>();
    for (const p of bankroll?.points ?? []) {
      byDay.set(zonedParts(new Date(p.occurredAt)).date, Number(p.balance));
    }
    return [...byDay.values()].slice(-45).map((value) => ({ value }));
  }, [bankroll]);
  if (data.length < 2) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-2 right-[33rem] left-[38rem] hidden h-[5.25rem] [mask-image:linear-gradient(to_right,transparent,black_25%,black_85%,transparent)] @[82rem]:block"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.brand} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART.brand} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Area
            type="linear"
            dataKey="value"
            stroke="#8b5cf6"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
