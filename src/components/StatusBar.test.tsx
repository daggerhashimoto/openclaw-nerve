import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from './StatusBar';

vi.mock('@/contexts/GatewayContext', () => ({
  useGateway: () => ({}),
}));

vi.mock('./UpdateBadge', () => ({
  UpdateBadge: () => <span data-testid="update-badge" />,
}));

function renderStatusBar(performanceMode = false) {
  return render(
    <StatusBar
      connectionState="connected"
      sessionCount={2}
      sparkline="▁▂▃▄"
      performanceMode={performanceMode}
    />,
  );
}

function expectedServerTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
}

async function flushServerInfo() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('StatusBar', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    vi.stubGlobal('__APP_VERSION__', '1.5.3');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        serverTime: Date.now(),
        gatewayStartedAt: Date.now() - 5_000,
      }),
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('hides sparkline telemetry in performance mode', async () => {
    renderStatusBar(true);

    await flushServerInfo();
    expect(screen.getByText(expectedServerTime('2026-05-13T12:00:00Z'))).toBeInTheDocument();
    expect(screen.queryByText('▁▂▃▄')).not.toBeInTheDocument();
    expect(screen.getByText('v1.5.3')).toBeInTheDocument();
  });

  it('updates clock and uptime only on a slow interval in performance mode', async () => {
    renderStatusBar(true);

    await flushServerInfo();
    expect(screen.getByText(expectedServerTime('2026-05-13T12:00:00Z'))).toBeInTheDocument();
    expect(screen.getByText('00:00:05')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByText(expectedServerTime('2026-05-13T12:00:00Z'))).toBeInTheDocument();
    expect(screen.getByText('00:00:05')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(59_000);
    });

    expect(screen.getByText(expectedServerTime('2026-05-13T12:01:00Z'))).toBeInTheDocument();
    expect(screen.getByText('00:01:05')).toBeInTheDocument();
  });
});
