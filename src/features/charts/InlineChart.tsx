import { useMemo, lazy, Suspense } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import type { ChartData } from './extractCharts';

const LightweightChart = lazy(() => import('./LightweightChart'));
const TradingViewWidget = lazy(() => import('./TradingViewWidget'));

function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getThemeColors() {
  const chart = [
    getCSSVar('--color-chart-1') || '#3D7EFF',
    getCSSVar('--color-chart-2') || '#FFA567',
    getCSSVar('--color-chart-3') || '#7FD1C7',
    getCSSVar('--color-chart-4') || '#B9A7FF',
    getCSSVar('--color-chart-5') || '#FF5A5A',
  ];
  const mutedFg = getCSSVar('--color-muted-foreground') || '#888';
  const border = getCSSVar('--color-border') || '#333';
  const fg = getCSSVar('--color-foreground') || '#fff';
  const bg = getCSSVar('--color-popover') || getCSSVar('--color-background') || '#111';
  const mono = getCSSVar('--font-mono') || 'monospace';
  return { chart, mutedFg, border, fg, bg, mono };
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const { bg, fg, border, mono } = getThemeColors();
  return (
    <div style={{ background: bg, color: fg, border: `1px solid ${border}`, padding: '6px 10px', borderRadius: 3, fontFamily: mono, fontSize: 12, fontVariantNumeric: 'tabular-nums', boxShadow: '0 12px 32px rgba(0,0,0,0.32)' }}>
      {label && <div style={{ marginBottom: 2, opacity: 0.7 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || fg }}>
          {p.name}: {p.value?.toLocaleString()}
        </div>
      ))}
    </div>
  );
}

export default function InlineChart({ chart }: { chart: ChartData }) {
  const colors = useMemo(getThemeColors, []);
  const palette = colors.chart;

  try {
    const { type, title, data } = chart;

    if (type === 'tv') {
      return (
        <Suspense fallback={<div className="text-[0.8rem] text-muted-foreground">Loading TradingView chart</div>}>
          <TradingViewWidget chart={chart} />
        </Suspense>
      );
    }

    const isSingleSeries = !!data.values;

    if (type === 'line' || type === 'area' || type === 'candle') {
      return (
        <Suspense fallback={<div className="mt-3 w-full h-[320px]" />}>
          <LightweightChart chart={chart} />
        </Suspense>
      );
    }

    if (type === 'pie') {
      const pieData = data.labels.map((label, i) => ({
        name: label,
        value: data.values?.[i] ?? data.series?.[0]?.values[i] ?? 0,
      }));
      return (
        <div className="mt-3 w-full">
          {title && <div className="mb-1 text-[0.8rem] font-medium text-muted-foreground">{title}</div>}
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} strokeWidth={1} stroke={colors.border}>
                {pieData.map((_, i) => <Cell key={i} fill={palette[i % palette.length]} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      );
    }

    // Build recharts data array
    const rechartsData = data.labels.map((label, i) => {
      const entry: Record<string, string | number> = { name: label };
      if (isSingleSeries) {
        entry.value = data.values![i] ?? 0;
      } else {
        data.series?.forEach(s => { entry[s.name] = s.values[i] ?? 0; });
      }
      return entry;
    });

    const seriesKeys = isSingleSeries ? ['value'] : (data.series?.map(s => s.name) || []);

    const axisProps = {
      tick: { fill: colors.mutedFg, fontSize: 11, fontFamily: colors.mono },
      axisLine: { stroke: colors.border },
      tickLine: false,
    };

    const gridProps = { stroke: colors.border, strokeOpacity: 0.3, strokeDasharray: '3 3' };

    const chartContent = (
      <>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="name" {...axisProps} />
        <YAxis {...axisProps} width={40} />
        <Tooltip content={<CustomTooltip />} />
        {seriesKeys.map((key, i) => (
          <Bar key={key} dataKey={key} fill={palette[i % palette.length]} radius={[2, 2, 0, 0]} />
        ))}
      </>
    );

    const ChartComponent = BarChart;

    return (
      <div className="mt-3 w-full">
        {title && <div className="mb-1 text-[0.8rem] font-medium text-muted-foreground">{title}</div>}
        <ResponsiveContainer width="100%" height={250}>
          <ChartComponent data={rechartsData}>
            {chartContent}
          </ChartComponent>
        </ResponsiveContainer>
      </div>
    );
  } catch {
    return <div className="mt-2 text-[0.8rem] text-muted-foreground">Chart failed to render</div>;
  }
}
