import { useEffect, useRef } from 'react';
import { createChart, ColorType, CrosshairMode, LineSeries, AreaSeries, CandlestickSeries } from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';
import type { ChartData } from './extractCharts';

const COLORS = ['#22c55e', '#3b82f6', '#f97316', '#8b5cf6', '#ef4444'];

export default function LightweightChart({ chart }: { chart: ChartData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const { type, data } = chart;
  const isSingleSeries = !!data.values;

  // Compute percentage change for single series
  const values = isSingleSeries ? data.values! : data.series?.[0]?.values ?? [];
  const firstVal = values[0] ?? 0;
  const lastVal = values[values.length - 1] ?? 0;
  const pctChange = firstVal ? ((lastVal - firstVal) / firstVal) * 100 : 0;
  const isPositive = pctChange >= 0;

  useEffect(() => {
    if (!containerRef.current) return;

    const labels = data.labels;

    const ch = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#888',
        fontFamily: 'monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.06)' },
        horzLines: { color: 'rgba(255,255,255,0.06)' },
      },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.1)',
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.1)',
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
      // Candlestick chart — expects data.candles or falls back to OHLC from values
      const s = ch.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderUpColor: '#22c55e',
        borderDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
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
                topColor: 'rgba(34,197,94,0.4)',
                bottomColor: 'rgba(34,197,94,0.0)',
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
                  topColor: color + '66',
                  bottomColor: color + '00',
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
  }, [data, type, isSingleSeries]);

  return (
    <div className="mt-3 w-full">
      {chart.title && (
        <div className="text-xs font-mono text-muted-foreground mb-1">
          {chart.title}
          {values.length > 1 && (
            <span
              className="ml-2 inline-block rounded px-1.5 py-0.5 text-[0.667rem] font-semibold"
              style={{
                backgroundColor: isPositive ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                color: isPositive ? '#22c55e' : '#ef4444',
              }}
            >
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
