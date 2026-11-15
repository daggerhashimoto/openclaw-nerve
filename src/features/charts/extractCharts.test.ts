/** Tests for extractCharts: parsing [chart:{...}] markers. */
import { describe, it, expect } from 'vitest';
import { extractChartMarkers } from './extractCharts';

describe('extractChartMarkers', () => {
  describe('valid charts', () => {
    it('extracts a bar chart', () => {
      const text = 'Here is a chart:\n[chart:{"type":"bar","title":"Revenue","data":{"labels":["Q1","Q2"],"values":[100,200]}}]\nDone.';
      const { cleaned, charts } = extractChartMarkers(text);
      expect(charts).toHaveLength(1);
      expect(charts[0].type).toBe('bar');
      expect(charts[0].title).toBe('Revenue');
      expect(charts[0].data.labels).toEqual(['Q1', 'Q2']);
      expect(charts[0].data.values).toEqual([100, 200]);
      expect(cleaned).not.toContain('[chart:');
      expect(cleaned).toContain('Here is a chart:');
      expect(cleaned).toContain('Done.');
    });

    it('extracts a line chart', () => {
      const text = '[chart:{"type":"line","data":{"labels":["A","B"],"values":[1,2]}}]';
      const { charts } = extractChartMarkers(text);
      expect(charts).toHaveLength(1);
      expect(charts[0].type).toBe('line');
    });

    it('extracts a pie chart', () => {
      const text = '[chart:{"type":"pie","data":{"labels":["X","Y"],"values":[60,40]}}]';
      const { charts } = extractChartMarkers(text);
      expect(charts).toHaveLength(1);
      expect(charts[0].type).toBe('pie');
    });

    it('extracts an area chart', () => {
      const text = '[chart:{"type":"area","data":{"labels":["Jan"],"values":[50]}}]';
      const { charts } = extractChartMarkers(text);
      expect(charts).toHaveLength(1);
      expect(charts[0].type).toBe('area');
    });

    it('extracts a candle chart', () => {
      const text = '[chart:{"type":"candle","data":{"labels":["W1"],"candles":[{"open":100,"high":110,"low":95,"close":105}]}}]';
      const { charts } = extractChartMarkers(text);
      expect(charts).toHaveLength(1);
      expect(charts[0].type).toBe('candle');
      expect(charts[0].data.candles).toHaveLength(1);
    });

    it('extracts a TradingView chart', () => {
      const text = '[chart:{"type":"tv","symbol":"TVC:GOLD","interval":"W","title":"Gold"}]';
      const { charts } = extractChartMarkers(text);
      expect(charts).toHaveLength(1);
      expect(charts[0].type).toBe('tv');
      expect(charts[0].symbol).toBe('TVC:GOLD');
    });

    it('extracts multi-series chart', () => {
      const text = '[chart:{"type":"line","data":{"labels":["Q1","Q2"],"series":[{"name":"Revenue","values":[100,200]},{"name":"Cost","values":[50,75]}]}}]';
      const { charts } = extractChartMarkers(text);
      expect(charts).toHaveLength(1);
      expect(charts[0].data.series).toHaveLength(2);
    });
  });

  describe('multiple charts', () => {
    it('extracts multiple charts from one message', () => {
      const text = [
        'First chart:',
        '[chart:{"type":"bar","data":{"labels":["A"],"values":[1]}}]',
        'Second chart:',
        '[chart:{"type":"pie","data":{"labels":["B"],"values":[2]}}]',
      ].join('\n');
      const { charts, cleaned } = extractChartMarkers(text);
      expect(charts).toHaveLength(2);
      expect(charts[0].type).toBe('bar');
      expect(charts[1].type).toBe('pie');
      expect(cleaned).toContain('First chart:');
      expect(cleaned).toContain('Second chart:');
    });
  });

  describe('invalid/edge cases', () => {
    it('skips invalid JSON', () => {
      const text = '[chart:{invalid json}]';
      const { charts } = extractChartMarkers(text);
      expect(charts).toHaveLength(0);
    });

    it('skips invalid chart types', () => {
      const text = '[chart:{"type":"scatter","data":{"labels":["A"],"values":[1]}}]';
      const { charts } = extractChartMarkers(text);
      expect(charts).toHaveLength(0);
    });

    it('skips charts with no data (non-tv)', () => {
      const text = '[chart:{"type":"bar"}]';
      const { charts } = extractChartMarkers(text);
      expect(charts).toHaveLength(0);
    });

    it('skips tv charts with no symbol', () => {
      const text = '[chart:{"type":"tv"}]';
      const { charts } = extractChartMarkers(text);
      expect(charts).toHaveLength(0);
    });

    it('returns text unchanged when no chart markers', () => {
      const text = 'Just regular text here';
      const { cleaned, charts } = extractChartMarkers(text);
      expect(cleaned).toBe('Just regular text here');
      expect(charts).toHaveLength(0);
    });

    it('handles empty string', () => {
      const { cleaned, charts } = extractChartMarkers('');
      expect(cleaned).toBe('');
      expect(charts).toHaveLength(0);
    });

    it('handles [chart: without opening brace', () => {
      const text = '[chart:not-json]';
      const { charts } = extractChartMarkers(text);
      expect(charts).toHaveLength(0);
    });

    it('handles unbalanced brackets gracefully', () => {
      const text = '[chart:{"type":"bar","data":{"labels":["A"],"values":[1]';
      const { charts } = extractChartMarkers(text);
      expect(charts).toHaveLength(0);
    });

    it('handles nested brackets in JSON', () => {
      const text = '[chart:{"type":"bar","title":"Test [brackets]","data":{"labels":["A"],"values":[1]}}]';
      const { charts } = extractChartMarkers(text);
      expect(charts).toHaveLength(1);
      expect(charts[0].title).toBe('Test [brackets]');
    });

    it('preserves surrounding text', () => {
      const text = 'Before [chart:{"type":"bar","data":{"labels":["A"],"values":[1]}}] After';
      const { cleaned } = extractChartMarkers(text);
      expect(cleaned).toContain('Before');
      expect(cleaned).toContain('After');
    });
  });
});
