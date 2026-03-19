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

  it('threads scoped saves so an older agent response cannot overwrite the current file state', async () => {
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

    let alphaSaveResult!: Promise<boolean>;
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

    let bravoSaveResult!: Promise<boolean>;
    act(() => {
      bravoSaveResult = result.current.save('tools', 'bravo draft');
    });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/workspace/tools', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ content: 'bravo draft', agentId: 'bravo' }),
      }));
    });

    await act(async () => {
      bravoSave.resolve(jsonResponse({ ok: true }));
      await bravoSaveResult;
    });

    await waitFor(() => {
      expect(result.current.content).toBe('bravo draft');
      expect(result.current.exists).toBe(true);
    });

    await act(async () => {
      alphaSave.resolve(jsonResponse({ ok: true }));
      await alphaSaveResult;
    });

    await waitFor(() => {
      expect(result.current.content).toBe('bravo draft');
    });
  });
});
