import { useEffect, useRef } from 'react';
import type { ChartData } from './extractCharts';

/**
 * TradingView Advanced Chart widget using official script injection.
 *
 * TradingView's embed pattern requires a <script> tag with the config as
 * JSON text content: the script creates the iframe internally and handles
 * referrer/origin validation. Direct iframe URLs return 403.
 */
export default function TradingViewWidget({ chart }: { chart: ChartData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const symbol = chart.symbol || 'TVC:GOLD';
  const interval = chart.interval || 'W';

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear any previous widget
    container.innerHTML = '';

    // Build the official TradingView widget structure
    const wrapper = document.createElement('div');
    wrapper.className = 'tradingview-widget-container';
    wrapper.style.height = '100%';
    wrapper.style.width = '100%';

    const widgetDiv = document.createElement('div');
    widgetDiv.className = 'tradingview-widget-container__widget';
    widgetDiv.style.height = '100%';
    widgetDiv.style.width = '100%';
    wrapper.appendChild(widgetDiv);

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.textContent = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      toolbar_bg: '#0D1119',
      enable_publishing: false,
      hide_side_toolbar: false,
      allow_symbol_change: true,
      save_image: false,
      withdateranges: true,
      hide_volume: false,
      studies: [],
    });
    wrapper.appendChild(script);

    container.appendChild(wrapper);

    return () => {
      container.innerHTML = '';
    };
  }, [symbol, interval]);

  return (
    <div className="mt-3 w-full">
      {chart.title && (
        <div className="mb-1 text-[0.8rem] font-medium text-muted-foreground">
          {chart.title}
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: 450 }} />
    </div>
  );
}
