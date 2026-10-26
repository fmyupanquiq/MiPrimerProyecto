import type { BetStatus } from '@letfer/shared';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { DONUT_COLORS } from '../chart-theme.js';

/** Aro de la dona de estados. Vive aparte para que Recharts se descargue después de las cifras. */
export function DonutPlot({
  empty,
  visible,
}: {
  empty: boolean;
  visible: readonly { status: BetStatus; count: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={empty ? [{ status: 'EMPTY', count: 1 }] : [...visible]}
          dataKey="count"
          nameKey="status"
          innerRadius="76%"
          outerRadius="100%"
          startAngle={90}
          endAngle={-270}
          paddingAngle={visible.length > 1 ? 1.5 : 0}
          stroke="none"
          isAnimationActive={false}
        >
          {empty ? (
            <Cell fill="var(--color-slate-200)" />
          ) : (
            visible.map((r) => <Cell key={r.status} fill={DONUT_COLORS[r.status]} />)
          )}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
