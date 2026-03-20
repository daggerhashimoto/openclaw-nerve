import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Memory } from '@/types';
import { useMemories } from './useMemories';

function createJsonResponse(data: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => data,
  } as Response;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function getRequestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, 'http://localhost');
  if (input instanceof URL) return new URL(input.toString(), 'http://localhost');
  return new URL(input.url, 'http://localhost');
}

describe('useMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('drops optimistic rows from the previous agent as soon as the agent changes', async () => {
    const addRequest = createDeferred<Response>();

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = getRequestUrl(input);
      if (url.pathname === '/api/memories' && init?.method === 'POST') {
        return addRequest.promise;
      }

      return createJsonResponse({ ok: false, error: 'Unexpected request' }, { ok: false, status: 500 });
    });

    const mainInitial: Memory[] = [{ type: 'item', text: 'main memory' }];
    const researchInitial: Memory[] = [{ type: 'item', text: 'research memory' }];

    const { result, rerender } = renderHook(
      ({ initialMemories, agentId }) => useMemories(initialMemories, agentId),
      { initialProps: { initialMemories: mainInitial, agentId: 'main' } },
    );

    act(() => {
      void result.current.addMemory('main draft');
    });

    expect(result.current.memories).toEqual([
      { type: 'item', text: 'main memory' },
      expect.objectContaining({ type: 'item', text: 'main draft', pending: true }),
    ]);

    await act(async () => {
      rerender({ initialMemories: researchInitial, agentId: 'research' });
      await Promise.resolve();
    });

    expect(result.current.memories).toEqual(researchInitial);
    expect(result.current.error).toBeNull();

    await act(async () => {
      addRequest.resolve(createJsonResponse({ ok: true }));
      await Promise.resolve();
    });

    expect(result.current.memories).toEqual(researchInitial);
    expect(result.current.error).toBeNull();
  });

  it('ignores late refresh completions from the previous agent', async () => {
    const mainRefresh = createDeferred<Response>();

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);
      if (url.pathname === '/api/memories' && url.searchParams.get('agentId') === 'main') {
        return mainRefresh.promise;
      }

      return createJsonResponse({ ok: false, error: 'Unexpected request' }, { ok: false, status: 500 });
    });

    const mainInitial: Memory[] = [{ type: 'item', text: 'main memory' }];
    const researchInitial: Memory[] = [{ type: 'item', text: 'research memory' }];

    const { result, rerender } = renderHook(
      ({ initialMemories, agentId }) => useMemories(initialMemories, agentId),
      { initialProps: { initialMemories: mainInitial, agentId: 'main' } },
    );

    act(() => {
      void result.current.refresh();
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      rerender({ initialMemories: researchInitial, agentId: 'research' });
      await Promise.resolve();
    });

    expect(result.current.memories).toEqual(researchInitial);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();

    await act(async () => {
      mainRefresh.resolve(createJsonResponse([{ type: 'item', text: 'stale main refresh' }]));
      await Promise.resolve();
    });

    expect(result.current.memories).toEqual(researchInitial);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('ignores late delete failures from the previous agent after switching', async () => {
    const deleteRequest = createDeferred<Response>();

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = getRequestUrl(input);
      if (url.pathname === '/api/memories' && init?.method === 'DELETE') {
        return deleteRequest.promise;
      }

      return createJsonResponse({ ok: false, error: 'Unexpected request' }, { ok: false, status: 500 });
    });

    const mainInitial: Memory[] = [{ type: 'item', text: 'main memory' }];
    const researchInitial: Memory[] = [{ type: 'item', text: 'research memory' }];

    const { result, rerender } = renderHook(
      ({ initialMemories, agentId }) => useMemories(initialMemories, agentId),
      { initialProps: { initialMemories: mainInitial, agentId: 'main' } },
    );

    act(() => {
      void result.current.deleteMemory('main memory', 'item');
    });

    expect(result.current.memories[0]).toMatchObject({
      text: 'main memory',
      deleting: true,
    });

    await act(async () => {
      rerender({ initialMemories: researchInitial, agentId: 'research' });
      await Promise.resolve();
    });

    expect(result.current.memories).toEqual(researchInitial);
    expect(result.current.error).toBeNull();

    await act(async () => {
      deleteRequest.resolve(createJsonResponse(
        { ok: false, error: 'delete failed' },
        { ok: false, status: 500 },
      ));
      await Promise.resolve();
    });

    expect(result.current.memories).toEqual(researchInitial);
    expect(result.current.error).toBeNull();
  });
});
