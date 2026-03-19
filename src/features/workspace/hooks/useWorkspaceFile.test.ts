import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWorkspaceFile } from './useWorkspaceFile';

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

describe('useWorkspaceFile', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('loads the scoped workspace file and ignores stale responses from the previous agent', async () => {
    const alphaLoad = deferred<FetchResponse>();
    const bravoLoad = deferred<FetchResponse>();

    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/workspace/tools?agentId=alpha') return alphaLoad.promise;
      if (url === '/api/workspace/tools?agentId=bravo') return bravoLoad.promise;
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ agentId }) => useWorkspaceFile(agentId),
      { initialProps: { agentId: 'alpha' } },
    );

    act(() => {
      void result.current.load('tools');
    });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/workspace/tools?agentId=alpha', expect.any(Object));
    });

    rerender({ agentId: 'bravo' });

    act(() => {
      void result.current.load('tools');
    });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/workspace/tools?agentId=bravo', expect.any(Object));
    });

    await act(async () => {
      bravoLoad.resolve(jsonResponse({ ok: true, content: 'bravo tools' }));
    });

    await waitFor(() => {
      expect(result.current.content).toBe('bravo tools');
      expect(result.current.exists).toBe(true);
      expect(result.current.error).toBeNull();
    });

    await act(async () => {
      alphaLoad.resolve(jsonResponse({ ok: true, content: 'alpha tools' }));
    });

    await waitFor(() => {
      expect(result.current.content).toBe('bravo tools');
    });
  });

  it('returns stale for superseded saves so older agent responses cannot overwrite the current file state', async () => {
    const alphaSave = deferred<FetchResponse>();
    const bravoSave = deferred<FetchResponse>();

    globalThis.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { agentId?: string } : {};

      if (url === '/api/workspace/tools' && init?.method === 'PUT' && body.agentId === 'alpha') {
        return alphaSave.promise;
      }
      if (url === '/api/workspace/tools' && init?.method === 'PUT' && body.agentId === 'bravo') {
        return bravoSave.promise;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ agentId }) => useWorkspaceFile(agentId),
      { initialProps: { agentId: 'alpha' } },
    );

    let alphaSaveResult!: Promise<unknown>;
    act(() => {
      alphaSaveResult = result.current.save('tools', 'alpha draft');
    });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/workspace/tools', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ content: 'alpha draft', agentId: 'alpha' }),
      }));
    });

    rerender({ agentId: 'bravo' });

    let bravoSaveResult!: Promise<unknown>;
    act(() => {
      bravoSaveResult = result.current.save('tools', 'bravo draft');
    });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/workspace/tools', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ content: 'bravo draft', agentId: 'bravo' }),
      }));
    });

    let latestSaveStatus: unknown;
    await act(async () => {
      bravoSave.resolve(jsonResponse({ ok: true }));
      latestSaveStatus = await bravoSaveResult;
    });

    expect(latestSaveStatus).toBe('saved');

    await waitFor(() => {
      expect(result.current.content).toBe('bravo draft');
      expect(result.current.exists).toBe(true);
    });

    let staleSaveStatus: unknown;
    await act(async () => {
      alphaSave.resolve(jsonResponse({ ok: true }));
      staleSaveStatus = await alphaSaveResult;
    });

    expect(staleSaveStatus).toBe('stale');

    await waitFor(() => {
      expect(result.current.content).toBe('bravo draft');
    });
  });

  it('returns stale instead of surfacing an error when a superseded save fails after another file loads', async () => {
    const saveRequest = deferred<FetchResponse>();
    const loadRequest = deferred<FetchResponse>();

    globalThis.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url === '/api/workspace/tools' && init?.method === 'PUT') {
        return saveRequest.promise;
      }
      if (url === '/api/workspace/soul?agentId=alpha' && !init?.method) {
        return loadRequest.promise;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof globalThis.fetch;

    const { result } = renderHook(() => useWorkspaceFile('alpha'));

    let saveResult!: Promise<unknown>;
    act(() => {
      saveResult = result.current.save('tools', 'draft tools');
    });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/workspace/tools', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ content: 'draft tools', agentId: 'alpha' }),
      }));
    });

    act(() => {
      void result.current.load('soul');
    });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/workspace/soul?agentId=alpha', expect.any(Object));
    });

    await act(async () => {
      loadRequest.resolve(jsonResponse({ ok: true, content: 'fresh soul' }));
    });

    await waitFor(() => {
      expect(result.current.content).toBe('fresh soul');
      expect(result.current.error).toBeNull();
    });

    let staleSaveStatus: unknown;
    await act(async () => {
      saveRequest.resolve(jsonResponse({ ok: false, error: 'disk full' }));
      staleSaveStatus = await saveResult;
    });

    expect(staleSaveStatus).toBe('stale');
    expect(result.current.content).toBe('fresh soul');
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
