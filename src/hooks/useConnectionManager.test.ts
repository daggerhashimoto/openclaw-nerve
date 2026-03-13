/** Tests for useConnectionManager hook. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

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

  it('auto-connects without token when serverSideAuth is true and wsUrl is provided', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ 
        wsUrl: 'ws://127.0.0.1:18789/ws', 
        token: null, 
        authEnabled: true,
        serverSideAuth: true 
      }),
    });

    const mod = await import('./useConnectionManager');
    const { result } = renderHook(() => mod.useConnectionManager());

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalledTimes(1);
    });

    expect(connectMock).toHaveBeenCalledWith('ws://127.0.0.1:18789/ws', '');
    expect(result.current.serverSideAuth).toBe(true);
  });

  it('does NOT auto-connect if user has a custom saved URL', async () => {
    const { loadConfig } = await import('../contexts/GatewayContext');
    vi.mocked(loadConfig).mockReturnValue({ url: 'ws://custom.host:1234/ws', token: 'saved-token' });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wsUrl: 'ws://default:1234/ws', serverSideAuth: true }),
    });

    const mod = await import('./useConnectionManager');
    const { result } = renderHook(() => mod.useConnectionManager());

    await waitFor(() => {
      expect(result.current.serverSideAuth).toBe(true);
    });

    // Should not connect because url already exists and is different from default
    expect(connectMock).not.toHaveBeenCalled();
    expect(result.current.editableUrl).toBe('ws://custom.host:1234/ws');
  });

  it('auto-connects if saved URL matches official URL but token is missing (Managed Upgrade)', async () => {
    const { loadConfig } = await import('../contexts/GatewayContext');
    // User has the official URL saved, but no token (e.g. fresh install or they cleared it)
    vi.mocked(loadConfig).mockReturnValue({ url: 'ws://official:18789/ws', token: '' });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wsUrl: 'ws://official:18789/ws', serverSideAuth: true }),
    });

    const mod = await import('./useConnectionManager');
    renderHook(() => mod.useConnectionManager());

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalledWith('ws://official:18789/ws', '');
    });
  });

  it('forces empty token on reconnect when serverSideAuth is active for official URL', async () => {
    const { loadConfig, saveConfig } = await import('../contexts/GatewayContext');
    vi.mocked(loadConfig).mockReturnValue({ url: 'ws://official:18789/ws', token: 'stale-token' });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wsUrl: 'ws://official:18789/ws', serverSideAuth: true }),
    });

    const mod = await import('./useConnectionManager');
    const { result } = renderHook(() => mod.useConnectionManager());

    await waitFor(() => {
      expect(result.current.serverSideAuth).toBe(true);
    });

    // Manually trigger reconnect
    await act(async () => {
      await result.current.handleReconnect();
    });

    expect(saveConfig).toHaveBeenCalledWith('ws://official:18789/ws', '');
    expect(connectMock).toHaveBeenCalledWith('ws://official:18789/ws', '');
    expect(result.current.editableToken).toBe('');
  });
});
