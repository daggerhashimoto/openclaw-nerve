import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, waitFor, act } from '@testing-library/react';
import { createElement } from 'react';
import { useDashboardData } from './useDashboardData';
import type { ServerEvent } from '@/hooks/useServerEvents';

type FetchResponse = {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
};

function jsonResponse(data: unknown, init: { ok?: boolean; status?: number } = {}): FetchResponse {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => data,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const subscribeMock = vi.fn(() => () => {});
let sseHandler: ((event: ServerEvent) => void) | undefined;

vi.mock('@/contexts/GatewayContext', () => ({
  useGateway: () => ({
    subscribe: subscribeMock,
    connectionState: 'disconnected',
  }),
}));

vi.mock('@/hooks/useServerEvents', () => ({
  useServerEvents: (handler: (event: ServerEvent) => void) => {
    sseHandler = handler;
    return { connected: true, reconnectAttempts: 0, lastEvent: null };
  },
}));

function DashboardDataRenderObserver({
  agentId,
  onFileChanged,
  emitDuringRender,
}: {
  agentId: string;
  onFileChanged?: (...args: unknown[]) => void;
  emitDuringRender?: () => void;
}) {
  useDashboardData({
    agentId,
    onFileChanged: onFileChanged as unknown as (path: string, targetAgentId: string) => void,
  });

  emitDuringRender?.();
  return null;
}

describe('useDashboardData', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    subscribeMock.mockClear();
    sseHandler = undefined;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('threads scoped memory fetches and ignores stale responses from the previous agent', async () => {
    const alphaMemories = deferred<FetchResponse>();
    const bravoMemories = deferred<FetchResponse>();

    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/tokens') {
        return Promise.resolve(jsonResponse({ totalTokens: 0 }));
      }
      if (url === '/api/memories?agentId=alpha') {
        return alphaMemories.promise;
      }
      if (url === '/api/memories?agentId=bravo') {
        return bravoMemories.promise;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ agentId }) => useDashboardData({ agentId }),
      { initialProps: { agentId: 'alpha' } },
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/memories?agentId=alpha', expect.any(Object));
    });

    rerender({ agentId: 'bravo' });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/memories?agentId=bravo', expect.any(Object));
    });

    await act(async () => {
      bravoMemories.resolve(jsonResponse([{ type: 'section', text: 'Bravo memory' }]));
    });

    await waitFor(() => {
      expect(result.current.memories).toEqual([{ type: 'section', text: 'Bravo memory' }]);
      expect(result.current.memoriesLoading).toBe(false);
    });

    await act(async () => {
      alphaMemories.resolve(jsonResponse([{ type: 'section', text: 'Alpha memory' }]));
    });

    await waitFor(() => {
      expect(result.current.memories).toEqual([{ type: 'section', text: 'Bravo memory' }]);
    });
  });

  it('drops old-agent file.changed events that arrive during the workspace switch render gap', async () => {
    const alphaOnFileChanged = vi.fn();
    const bravoOnFileChanged = vi.fn();
    const tokens = deferred<FetchResponse>();
    const alphaMemories = deferred<FetchResponse>();
    const bravoMemories = deferred<FetchResponse>();

    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/tokens') {
        return tokens.promise;
      }
      if (url === '/api/memories?agentId=alpha') {
        return alphaMemories.promise;
      }
      if (url === '/api/memories?agentId=bravo') {
        return bravoMemories.promise;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof globalThis.fetch;

    const { rerender } = render(createElement(DashboardDataRenderObserver, {
      agentId: 'alpha',
      onFileChanged: alphaOnFileChanged,
    }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/memories?agentId=alpha', expect.any(Object));
    });

    alphaOnFileChanged.mockClear();
    bravoOnFileChanged.mockClear();

    act(() => {
      rerender(createElement(DashboardDataRenderObserver, {
        agentId: 'bravo',
        onFileChanged: bravoOnFileChanged,
        emitDuringRender: () => {
          sseHandler?.({ event: 'file.changed', data: { path: 'shared.md', agentId: 'alpha' }, ts: Date.now() });
        },
      }));
    });

    expect(alphaOnFileChanged).not.toHaveBeenCalled();
    expect(bravoOnFileChanged).not.toHaveBeenCalled();
  });

  it('refreshes memories only for matching SSE agent scopes and forwards file.changed with its agent id', async () => {
    const onFileChanged = vi.fn();

    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/tokens') {
        return Promise.resolve(jsonResponse({ totalTokens: 0 }));
      }
      if (url === '/api/memories?agentId=alpha') {
        return Promise.resolve(jsonResponse([{ type: 'section', text: 'Alpha memory' }]));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof globalThis.fetch;

    renderHook(() => useDashboardData({ agentId: 'alpha', onFileChanged }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/memories?agentId=alpha', expect.any(Object));
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockClear();
    onFileChanged.mockClear();

    act(() => {
      sseHandler?.({ event: 'memory.changed', data: { agentId: 'bravo' }, ts: Date.now() });
      sseHandler?.({ event: 'file.changed', data: { path: 'memory/2026-03-19.md', agentId: 'bravo' }, ts: Date.now() });
      sseHandler?.({ event: 'file.changed', data: { path: 'memory/2026-03-19.md' }, ts: Date.now() });
    });

    expect(fetchMock).not.toHaveBeenCalledWith('/api/memories?agentId=alpha', expect.any(Object));
    expect(onFileChanged).not.toHaveBeenCalled();

    act(() => {
      sseHandler?.({ event: 'memory.changed', data: { agentId: 'alpha' }, ts: Date.now() });
      sseHandler?.({ event: 'file.changed', data: { path: 'memory/2026-03-19.md', agentId: 'alpha' }, ts: Date.now() });
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/memories?agentId=alpha', expect.any(Object));
    });
    expect(onFileChanged).toHaveBeenCalledWith('memory/2026-03-19.md', 'alpha');
  });
});
