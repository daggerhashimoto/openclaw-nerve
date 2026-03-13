/** Tests for useConnectionManager hook. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mock GatewayContext exports used by useConnectionManager
const connectMock = vi.fn(async () => {});
const disconnectMock = vi.fn();

vi.mock('@/contexts/GatewayContext', () => ({
  useGateway: () => ({
    connectionState: 'disconnected',
    connect: connectMock,
    disconnect: disconnectMock,
  }),
  loadConfig: vi.fn(() => ({})),
  saveConfig: vi.fn(),
}));

describe('useConnectionManager', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.resetModules();
    connectMock.mockClear();
    disconnectMock.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('auto-connects without token when server authEnabled is true and wsUrl is provided', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wsUrl: 'ws://127.0.0.1:18789/ws', token: null, authEnabled: true }),
    });

    const mod = await import('./useConnectionManager');
    const { result } = renderHook(() => mod.useConnectionManager());

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalledTimes(1);
    });

    expect(connectMock).toHaveBeenCalledWith('ws://127.0.0.1:18789/ws', '');
    expect(result.current.authEnabled).toBe(true);
  });
});
