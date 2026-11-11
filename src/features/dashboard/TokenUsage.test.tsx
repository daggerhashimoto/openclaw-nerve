import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TokenUsage } from './TokenUsage';
import { fmtDollars, providerName } from './usageWords';
import type { TokenData } from '@/types';

const limits = {
  codexLimits: null as unknown,
  claudeLimits: null as unknown,
  codexLastChecked: null as number | null,
  claudeLastChecked: null as number | null,
};

vi.mock('./useLimits', () => ({
  useLimits: () => limits,
}));

const data: TokenData = {
  totalCost: 12.5,
  totalInput: 1_200_000,
  totalOutput: 340_000,
  totalMessages: 2310,
  entries: [
    { source: 'openai-codex', cost: 10, messageCount: 2000, inputTokens: 1_000_000, outputTokens: 300_000, cacheReadTokens: 5_000_000, errorCount: 0 },
    { source: 'anthropic', cost: 2.5, messageCount: 310, inputTokens: 200_000, outputTokens: 40_000, errorCount: 3 },
  ],
  persistent: { totalCost: 2615.8084, totalInput: 1_300_000, totalOutput: 350_000, lastUpdated: '2026-11-02T14:16:48.411Z' },
};

describe('words and numbers', () => {
  it('names providers in the product voice and falls back to a capitalised id', () => {
    expect(providerName('openai-codex')).toBe('OpenAI Codex');
    expect(providerName('anthropic')).toBe('Anthropic');
    expect(providerName('mistral-large')).toBe('Mistral large');
  });

  it('prints dollars with separators, matching the top bar', () => {
    expect(fmtDollars(2615.8084)).toBe('$2,615.81');
    expect(fmtDollars(0.00491, 4)).toBe('$0.0049');
  });
});

describe('TokenUsage', () => {
  it('says it is loading without a header figure', () => {
    render(<TokenUsage data={null} />);
    expect(screen.getByText('Usage')).toBeInTheDocument();
    expect(screen.getByText('Loading usage')).toBeInTheDocument();
    expect(screen.queryByText(/all time/)).toBeNull();
  });

  it('puts the all-time spend in the header and one row per provider', () => {
    render(<TokenUsage data={data} />);
    expect(screen.getByText('$2,615.81')).toBeInTheDocument();
    expect(screen.getByText('all time')).toBeInTheDocument();
    // The accessible name carries the cost (and any errors), since it replaces the visible text.
    expect(screen.getByRole('button', { name: 'OpenAI Codex, $10.00' })).toHaveTextContent('$10.00');
    expect(screen.getByRole('button', { name: 'Anthropic, $2.50, 3 errors' })).toHaveTextContent('$2.50');
    // Shares of the providers' combined spend ($12.50), not ratios to the largest.
    expect(screen.getByRole('meter', { name: 'OpenAI Codex share of spend' })).toHaveAttribute('aria-valuenow', '80');
    expect(screen.getByRole('meter', { name: 'Anthropic share of spend' })).toHaveAttribute('aria-valuenow', '20');
  });

  it('hides the share meter when there is only one provider', () => {
    render(<TokenUsage data={{ ...data, entries: [data.entries![0]] }} />);
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('marks a provider with errors with a red pane and lists them in the details', () => {
    render(<TokenUsage data={data} />);
    const row = screen.getByRole('button', { name: 'Anthropic, $2.50, 3 errors' });
    expect(row.querySelector('.pane')).toHaveAttribute('data-state', 'error');
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Errors').nextElementSibling).toHaveTextContent('3');
    expect(screen.getByText('Per message').nextElementSibling).toHaveTextContent('$0.0081');
  });

  it('shows the token breakdown and the rate limits when a row opens', () => {
    limits.codexLimits = {
      available: true,
      five_hour_limit: { used_percent: 84, left_percent: 16, resets_at: 1_791_751_805, resets_at_formatted: null },
      weekly_limit: { used_percent: 12, left_percent: 88, resets_at: 1_792_338_605, resets_at_formatted: null },
    };
    limits.codexLastChecked = Date.now() - 3 * 60_000;
    render(<TokenUsage data={data} />);
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI Codex, $10.00' }));

    expect(screen.getByText('Input').nextElementSibling).toHaveTextContent('1.0M tokens');
    expect(screen.getByText('Cached').nextElementSibling).toHaveTextContent('5.0M tokens');
    expect(screen.getByText('Rate limits')).toBeInTheDocument();
    expect(screen.getByText('checked 3m ago')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: '5 hour window used' })).toHaveAttribute('aria-valuenow', '84');
    expect(screen.getByText('84% used')).toHaveClass('text-operator-text');
    expect(screen.getByText('12% used')).toHaveClass('text-foreground');
    expect(screen.getAllByText(/resets/)).toHaveLength(2);
  });

  it('says when limits are unavailable', () => {
    limits.claudeLimits = { available: false };
    render(<TokenUsage data={data} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anthropic, $2.50, 3 errors' }));
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('sums the fleet in the footer and names an empty panel', () => {
    render(<TokenUsage data={data} />);
    expect(screen.getByText('1.3M')).toBeInTheDocument();
    expect(screen.getByText('2,310')).toBeInTheDocument();

    render(<TokenUsage data={{ entries: [] }} />);
    expect(screen.getByText('No usage recorded yet.')).toBeInTheDocument();
  });

  it('carries no emoji, glyph icons or tracked capitals', () => {
    const { container } = render(<TokenUsage data={data} />);
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI Codex, $10.00' }));
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}◆▼↑↓]/u);
    expect(container.querySelector('.uppercase')).toBeNull();
    expect(container.querySelector('[class*="tracking-"]')).toBeNull();
  });
});
