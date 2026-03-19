import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryEditor } from './MemoryEditor';

type FetchResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

function jsonResponse(data: unknown): FetchResponse {
  return {
    ok: true,
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

describe('MemoryEditor', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('ignores a stale section load from the previous agent', async () => {
    const alphaLoad = deferred<FetchResponse>();
    const bravoLoad = deferred<FetchResponse>();

    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/memories/section?title=Project&agentId=alpha') return alphaLoad.promise;
      if (url === '/api/memories/section?title=Project&agentId=bravo') return bravoLoad.promise;
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof globalThis.fetch;

    const onSave = vi.fn();
    const onCancel = vi.fn();

    const { rerender } = render(
      <MemoryEditor agentId="alpha" title="Project" onSave={onSave} onCancel={onCancel} />,
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/memories/section?title=Project&agentId=alpha', expect.any(Object));
    });

    rerender(
      <MemoryEditor agentId="bravo" title="Project" onSave={onSave} onCancel={onCancel} />,
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/memories/section?title=Project&agentId=bravo', expect.any(Object));
    });

    await act(async () => {
      bravoLoad.resolve(jsonResponse({ ok: true, content: 'bravo memory' }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Edit Project')).toHaveValue('bravo memory');
    });

    await act(async () => {
      alphaLoad.resolve(jsonResponse({ ok: true, content: 'alpha memory' }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Edit Project')).toHaveValue('bravo memory');
    });
  });
});
