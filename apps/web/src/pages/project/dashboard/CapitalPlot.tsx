import { formatPEN, type BankrollPoint } from '@letfer/shared';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { formatDate } from '../../../labels.js';
import { zonedParts } from '../../../time-zone.js';
import { CHART } from '../chart-theme.js';
import { dayTicks, type valueAxis } from './chart-axes.js';
import { formatCalendarDate } from './date-range.js';

export interface ChartPoint extends BankrollPoint {
  /** Solo para dibujar (posición vertical): el valor mostrado es siempre `balance`. */
  value: number;
  /** Instante en milisegundos: eje X de tiempo real (varios movimientos el mismo día). */
  t: number;
}

/** Tooltip oscuro: fecha y capital del punto activo (y la etapa, si empezó ahí). */
function ChartTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const point = payload?.[0]?.payload as ChartPoint | undefined;
  if (!active || !point) return null;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-xl"
      style={{ background: CHART.tooltipBg, borderColor: CHART.tooltipBorder }}
    >
      <p style={{ color: '#cbd5e1' }}>{formatDate(point.occurredAt)}</p>
      <p className="mt-0.5 text-sm font-semibold text-white tabular-nums">
        {formatPEN(point.balance)}
      </p>
      {point.stageStarted && (
        <p className="mt-0.5" style={{ color: '#c4b5fd' }}>
          Inicio de {point.stageStarted.name}
        </p>
      )}
    </div>
  );
}

const axisMoney = (value: number) =>
  `S/ ${value.toLocaleString('es-PE', { maximumFractionDigits: 0 })}`;

/**
 * Trazado del gráfico de capital (la parte que usa Recharts). Vive aparte para que la tarjeta y las cifras
 * del Dashboard se pinten sin esperar a descargar y ejecutar Recharts.
 */
export function CapitalPlot({
  data,
  xDomain,
  yAxis,
  plotWidth,
  gradientId,
}: {
  data: ChartPoint[];
  xDomain: [number, number];
  yAxis: ReturnType<typeof valueAxis>;
  plotWidth: number;
  gradientId: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART.brand} stopOpacity={0.4} />
            <stop offset="100%" stopColor={CHART.brand} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          stroke={CHART.grid}
          strokeDasharray="3 4"
          strokeOpacity={0.7}
          vertical={false}
        />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={xDomain}
          ticks={dayTicks(xDomain[0], xDomain[1], plotWidth - 60)}
          interval={0}
          tickFormatter={(t: number) => formatCalendarDate(zonedParts(new Date(t)).date, false)}
          fontSize={11}
          tickLine={false}
          axisLine={false}
          stroke={CHART.axis}
          tickMargin={8}
        />
        <YAxis
          fontSize={11}
          width={60}
          tickLine={false}
          axisLine={false}
          stroke={CHART.axis}
          domain={yAxis.domain}
          ticks={yAxis.ticks}
          interval={0}
          tickFormatter={axisMoney}
        />
        <Tooltip
          content={(props) => <ChartTooltip {...props} />}
          cursor={{ stroke: CHART.axis, strokeDasharray: '4 4' }}
        />
        {/* Cada punto es el saldo real tras un movimiento; la línea solo los une. */}
        <Area
          type="linear"
          isAnimationActive={false}
          dataKey="value"
          name="Capital"
          stroke="#8b5cf6"
          strokeWidth={2.5}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{
            r: 5,
            fill: '#8b5cf6',
            stroke: 'rgba(139, 92, 246, 0.35)',
            strokeWidth: 8,
          }}
        />
        {data
          .filter((p) => p.stageStarted !== null)
          .map((p) => (
            <ReferenceLine
              key={p.occurredAt}
              x={p.t}
              stroke={CHART.marker}
              strokeDasharray="2 4"
              label={{
                value: p.stageStarted!.name,
                fontSize: 10,
                position: 'insideTopLeft',
                fill: CHART.markerText,
              }}
            />
          ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
