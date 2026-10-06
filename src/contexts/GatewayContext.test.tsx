import '@testing-library/jest-dom';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayEvent } from '@/types';
import { GatewayProvider, useGateway } from './GatewayContext';

const ws = vi.hoisted(() => ({
  onEvent: { current: null as ((msg: GatewayEvent) => void) | null },
  rpc: vi.fn(async () => ({ agent: { model: 'test-model', thinking: 'low' } })),
  connect: vi.fn(async () => {}),
  disconnect: vi.fn(),
}));

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    connectionState: 'connected' as const,
    connect: ws.connect,
    disconnect: ws.disconnect,
    rpc: ws.rpc,
    onEvent: ws.onEvent,
    connectError: '',
    reconnectAttempt: 0,
  }),
}));

const FLAT = '▁'.repeat(15);
const POLL_INTERVAL_MS = 10000;

function wrapper({ children }: { children: React.ReactNode }) {
  return <GatewayProvider>{children}</GatewayProvider>;
}

async function tick() {
  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });
}

function emitEvents(count: number) {
  act(() => {
    for (let i = 0; i < count; i++) ws.onEvent.current?.({ type: 'event', event: 'test' } as GatewayEvent);
  });
}

describe('GatewayContext activity sparkline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function renderBurstThenPause() {
    const hook = renderHook(() => useGateway(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    emitEvents(10);
    await tick();
    expect(hook.result.current.sparkline.endsWith('█')).toBe(true);

    localStorage.setItem('nerve:performanceMode', 'true');
    await tick();
    return hook;
  }

  it('drops pre-pause samples when performance mode suspends tracking', async () => {
    const { result } = await renderBurstThenPause();
    expect(result.current.sparkline).toBe(FLAT);

    localStorage.setItem('nerve:performanceMode', 'false');
    await tick();

    expect(result.current.sparkline).toBe(FLAT);
  });

  it('scales resumed samples without the pre-pause maximum', async () => {
    const { result } = await renderBurstThenPause();

    localStorage.setItem('nerve:performanceMode', 'false');
    emitEvents(1);
    await tick();

    expect(result.current.sparkline).toBe(`${'▁'.repeat(14)}█`);
  });
});
