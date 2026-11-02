import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode, LineSeries, AreaSeries, CandlestickSeries } from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';
import type { ChartData } from './extractCharts';

function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Series colours come from the chart tokens; up/down candles from the green/red data tokens. */
function getChartColors() {
  return {
    series: [
      getCSSVar('--color-chart-1') || '#3D7EFF',
      getCSSVar('--color-chart-2') || '#FFA567',
      getCSSVar('--color-chart-3') || '#7FD1C7',
      getCSSVar('--color-chart-4') || '#B9A7FF',
      getCSSVar('--color-chart-5') || '#FF5A5A',
    ],
    up: getCSSVar('--color-green') || '#22c55e',
    down: getCSSVar('--color-red') || '#ef4444',
    text: getCSSVar('--color-muted-foreground') || '#888',
    rule: getCSSVar('--color-border') || 'rgba(255,255,255,0.1)',
    mono: getCSSVar('--font-mono') || 'monospace',
  };
}

/**
 * Counts theme changes. applyTheme writes the tokens onto the root element, so a
 * mounted chart rebuilds with the new colours instead of keeping the old palette.
 */
function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => observer.disconnect();
  }, []);
  return version;
}

/** Flat translucent fill for area series: a hex colour plus an alpha byte. */
function withAlpha(color: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color + alpha : color;
}

export default function LightweightChart({ chart }: { chart: ChartData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const { type, data } = chart;
  const isSingleSeries = !!data.values;
  const themeVersion = useThemeVersion();

  // Compute percentage change for single series
  const values = isSingleSeries ? data.values! : data.series?.[0]?.values ?? [];
  const firstVal = values[0] ?? 0;
  const lastVal = values[values.length - 1] ?? 0;
  const pctChange = firstVal ? ((lastVal - firstVal) / firstVal) * 100 : 0;
  const isPositive = pctChange >= 0;

  useEffect(() => {
    if (!containerRef.current) return;

    const labels = data.labels;
    const colors = getChartColors();
    const COLORS = colors.series;

    const ch = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: colors.text,
        fontFamily: colors.mono,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: withAlpha(colors.rule, '99') },
        horzLines: { color: withAlpha(colors.rule, '99') },
      },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: {
        borderColor: colors.rule,
      },
      timeScale: {
        borderColor: colors.rule,
        tickMarkFormatter: (time: number) => labels[time as number] ?? '',
      },
      autoSize: true,
      height: 320,
    });

    // Remove TradingView watermark/logo
    const watermark = containerRef.current.querySelector('a[href*="tradingview"]');
    if (watermark) (watermark as HTMLElement).style.display = 'none';

    chartRef.current = ch;

    if (type === 'candle') {
      // Candlestick chart: expects data.candles or falls back to OHLC from values
      const s = ch.addSeries(CandlestickSeries, {
        upColor: colors.up,
        downColor: colors.down,
        borderUpColor: colors.up,
        borderDownColor: colors.down,
        wickUpColor: colors.up,
        wickDownColor: colors.down,
      });
      const candleData = labels.map((_, i) => {
        const candles = (data as Record<string, unknown>).candles as Array<{ open: number; high: number; low: number; close: number }> | undefined;
        if (candles?.[i]) {
          return {
            time: i as unknown as { year: number; month: number; day: number },
            open: candles[i].open,
            high: candles[i].high,
            low: candles[i].low,
            close: candles[i].close,
          };
        }
        // Fallback: synthesize candles from values (open=prev close, close=value)
        const val = data.values?.[i] ?? 0;
        const prevVal = data.values?.[i - 1] ?? val;
        const high = Math.max(val, prevVal) * 1.01;
        const low = Math.min(val, prevVal) * 0.99;
        return {
          time: i as unknown as { year: number; month: number; day: number },
          open: prevVal,
          high,
          low,
          close: val,
        };
      });
      s.setData(candleData);
    } else {
      const SeriesDef = type === 'area' ? AreaSeries : LineSeries;

      if (isSingleSeries) {
        const seriesData = labels.map((_, i) => ({
          time: i as unknown as { year: number; month: number; day: number },
          value: data.values![i] ?? 0,
        }));

        const opts =
          type === 'area'
            ? {
                lineColor: COLORS[0],
                topColor: withAlpha(COLORS[0], '33'),
                bottomColor: withAlpha(COLORS[0], '33'),
                lineWidth: 2 as const,
              }
            : { color: COLORS[0], lineWidth: 2 as const };

        const s = ch.addSeries(SeriesDef, opts);
        s.setData(seriesData);
      } else {
        data.series?.forEach((series, si) => {
          const color = COLORS[si % COLORS.length];
          const seriesData = labels.map((_, i) => ({
            time: i as unknown as { year: number; month: number; day: number },
            value: series.values[i] ?? 0,
          }));

          const opts =
            type === 'area'
              ? {
                  lineColor: color,
                  topColor: withAlpha(color, '33'),
                  bottomColor: withAlpha(color, '33'),
                  lineWidth: 2 as const,
                  title: series.name,
                }
              : { color, lineWidth: 2 as const, title: series.name };

          const s = ch.addSeries(SeriesDef, opts);
          s.setData(seriesData);
        });
      }
    }

    ch.timeScale().fitContent();

    return () => {
      ch.remove();
      chartRef.current = null;
    };
  }, [data, type, isSingleSeries, themeVersion]);

  return (
    <div className="mt-3 w-full">
      {chart.title && (
        <div className="mb-1 flex items-baseline gap-2 text-[0.8rem] font-medium text-muted-foreground">
          {chart.title}
          {values.length > 1 && (
            <span className={`font-mono tabular ${isPositive ? 'text-green' : 'text-red'}`}>
              {isPositive ? '+' : ''}
              {pctChange.toFixed(1)}%
            </span>
          )}
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: 320 }} />
    </div>
  );
}
