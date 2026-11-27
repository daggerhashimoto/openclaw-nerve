import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanTask } from '@/features/kanban/types';
import type { KanbanProposal } from '@/features/kanban/hooks/useProposals';
import { useAttentionSources } from './useAttentionSources';

const NOW = Date.UTC(2026, 10, 27, 8, 22);

const TASK: KanbanTask = {
  id: 't1',
  title: 'Fix the backup',
  status: 'review',
  priority: 'normal',
  createdBy: 'operator',
  createdAt: NOW - 86_400_000,
  updatedAt: NOW - 3_600_000,
  version: 1,
  labels: [],
  columnOrder: 0,
  feedback: [],
};

const PROPOSAL: KanbanProposal = {
  id: 'p1',
  type: 'create',
  payload: { title: 'Write release notes' },
  proposedBy: 'agent:kim',
  proposedAt: NOW - 3_600_000,
  status: 'pending',
  version: 1,
};

const RAW_CRON = {
  id: 'c1',
  name: 'Nightly backup',
  enabled: true,
  schedule: { kind: 'cron', expr: '0 2 * * *' },
  state: { lastStatus: 'ok', lastRunAtMs: NOW - 3_600_000 },
};

function jsonResponse(data: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => data,
  } as Response;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function pathOf(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  return raw;
}

interface Routes {
  tasks: () => Response | Promise<Response>;
  proposals: () => Response | Promise<Response>;
  crons: () => Response | Promise<Response>;
}

function installFetch(overrides: Partial<Routes> = {}) {
  const routes: Routes = {
    tasks: () => jsonResponse({ items: [TASK], total: 1, limit: 200, offset: 0, hasMore: false }),
    proposals: () => jsonResponse({ proposals: [PROPOSAL] }),
    crons: () => jsonResponse({ ok: true, result: { jobs: [RAW_CRON] } }),
    ...overrides,
  };
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const url = pathOf(input);
    if (url.startsWith('/api/kanban/tasks')) return routes.tasks();
    if (url.startsWith('/api/kanban/proposals')) return routes.proposals();
    if (url.startsWith('/api/crons')) return routes.crons();
    return jsonResponse({ error: 'Unexpected request' }, { ok: false, status: 500 });
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function urls(mock: ReturnType<typeof installFetch>): string[] {
  return mock.mock.calls.map(([input]) => pathOf(input));
}

function countOf(mock: ReturnType<typeof installFetch>, prefix: string): number {
  return urls(mock).filter((url) => url.startsWith(prefix)).length;
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useAttentionSources', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches all three when active and none when inactive', async () => {
    const fetchMock = installFetch();

    const { rerender } = renderHook(
      ({ active }) => useAttentionSources({ active, kanbanEnabled: true }),
      { initialProps: { active: false } },
    );
    await flush(120_000);

    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ active: true });
    await flush();

    expect(urls(fetchMock).sort()).toEqual([
      '/api/crons',
      '/api/kanban/proposals?status=pending',
      '/api/kanban/tasks?limit=200',
    ]);
  });

  it('exposes the fetched tasks, proposals and crons as live', async () => {
    installFetch();

    const { result } = renderHook(() => useAttentionSources({ active: true, kanbanEnabled: true }));
    await flush();

    expect(result.current.tasks).toEqual([TASK]);
    expect(result.current.proposals).toEqual([PROPOSAL]);
    expect(result.current.crons).toHaveLength(1);
    expect(result.current.crons[0]).toMatchObject({ id: 'c1', name: 'Nightly backup', enabled: true });
    expect(result.current.sources).toEqual({
      tasks: { state: 'live', checkedAt: NOW },
      proposals: { state: 'live', checkedAt: NOW },
      crons: { state: 'live', checkedAt: NOW },
    });
  });

  it('starts every source as loading until the first response', async () => {
    const pending = createDeferred<Response>();
    installFetch({ tasks: () => pending.promise });

    const { result } = renderHook(() => useAttentionSources({ active: true, kanbanEnabled: true }));

    expect(result.current.sources.tasks).toEqual({ state: 'loading' });
    expect(result.current.sources.proposals).toEqual({ state: 'loading' });
    expect(result.current.sources.crons).toEqual({ state: 'loading' });

    await flush();

    expect(result.current.sources.tasks).toEqual({ state: 'loading' });
    expect(result.current.sources.proposals.state).toBe('live');
    expect(result.current.sources.crons.state).toBe('live');

    pending.resolve(jsonResponse({ items: [TASK], total: 1, limit: 200, offset: 0, hasMore: false }));
    await flush();

    expect(result.current.sources.tasks.state).toBe('live');
  });

  it('polls tasks every 5s and crons every 60s', async () => {
    const fetchMock = installFetch();

    renderHook(() => useAttentionSources({ active: true, kanbanEnabled: true }));
    await flush();

    expect(countOf(fetchMock, '/api/kanban/tasks')).toBe(1);
    expect(countOf(fetchMock, '/api/kanban/proposals')).toBe(1);
    expect(countOf(fetchMock, '/api/crons')).toBe(1);

    await flush(5_000);

    expect(countOf(fetchMock, '/api/kanban/tasks')).toBe(2);
    expect(countOf(fetchMock, '/api/kanban/proposals')).toBe(2);
    expect(countOf(fetchMock, '/api/crons')).toBe(1);

    await flush(55_000);

    expect(countOf(fetchMock, '/api/kanban/tasks')).toBe(13);
    expect(countOf(fetchMock, '/api/kanban/proposals')).toBe(13);
    expect(countOf(fetchMock, '/api/crons')).toBe(2);
  });

  it('a failed crons request marks crons error and keeps previous jobs', async () => {
    let failCrons = false;
    installFetch({
      crons: () =>
        failCrons
          ? jsonResponse({ ok: false, error: 'gateway down' }, { ok: false, status: 502 })
          : jsonResponse({ ok: true, result: { jobs: [RAW_CRON] } }),
    });

    const { result } = renderHook(() => useAttentionSources({ active: true, kanbanEnabled: true }));
    await flush();

    expect(result.current.crons).toHaveLength(1);
    expect(result.current.sources.crons.state).toBe('live');

    failCrons = true;
    await flush(60_000);

    expect(result.current.sources.crons).toEqual({ state: 'error', error: 'gateway down' });
    expect(result.current.crons).toHaveLength(1);
    expect(result.current.sources.tasks.state).toBe('live');
    expect(result.current.sources.proposals.state).toBe('live');
  });

  it('a failed tasks request reports the HTTP status and keeps previous tasks', async () => {
    let failTasks = false;
    installFetch({
      tasks: () =>
        failTasks
          ? jsonResponse({}, { ok: false, status: 503 })
          : jsonResponse({ items: [TASK], total: 1, limit: 200, offset: 0, hasMore: false }),
    });

    const { result } = renderHook(() => useAttentionSources({ active: true, kanbanEnabled: true }));
    await flush();

    failTasks = true;
    await flush(5_000);

    expect(result.current.sources.tasks).toEqual({ state: 'error', error: 'HTTP 503' });
    expect(result.current.tasks).toEqual([TASK]);

    failTasks = false;
    await flush(5_000);

    expect(result.current.sources.tasks).toEqual({ state: 'live', checkedAt: NOW + 10_000 });
  });

  it('a network failure marks the source error with the message', async () => {
    installFetch({
      proposals: () => {
        throw new Error('Failed to fetch');
      },
    });

    const { result } = renderHook(() => useAttentionSources({ active: true, kanbanEnabled: true }));
    await flush();

    expect(result.current.sources.proposals).toEqual({ state: 'error', error: 'Failed to fetch' });
    expect(result.current.proposals).toEqual([]);
  });

  it('kanban disabled marks tasks and proposals off and skips their requests', async () => {
    const fetchMock = installFetch();

    const { result } = renderHook(() => useAttentionSources({ active: true, kanbanEnabled: false }));
    await flush(10_000);

    expect(result.current.sources.tasks).toEqual({ state: 'off' });
    expect(result.current.sources.proposals).toEqual({ state: 'off' });
    expect(result.current.sources.crons.state).toBe('live');
    expect(countOf(fetchMock, '/api/kanban')).toBe(0);
    expect(countOf(fetchMock, '/api/crons')).toBe(1);
  });

  it('turning kanban back on fetches tasks and proposals again', async () => {
    const fetchMock = installFetch();

    const { result, rerender } = renderHook(
      ({ kanbanEnabled }) => useAttentionSources({ active: true, kanbanEnabled }),
      { initialProps: { kanbanEnabled: false } },
    );
    await flush();

    expect(countOf(fetchMock, '/api/kanban')).toBe(0);

    rerender({ kanbanEnabled: true });
    await flush();

    expect(countOf(fetchMock, '/api/kanban/tasks')).toBe(1);
    expect(countOf(fetchMock, '/api/kanban/proposals')).toBe(1);
    expect(result.current.sources.tasks.state).toBe('live');
    expect(result.current.sources.proposals.state).toBe('live');
  });

  it('refresh fetches every enabled source at once and does nothing while inactive', async () => {
    const fetchMock = installFetch();

    const { result, rerender } = renderHook(
      ({ active }) => useAttentionSources({ active, kanbanEnabled: true }),
      { initialProps: { active: true } },
    );
    await flush();
    fetchMock.mockClear();

    act(() => {
      result.current.refresh();
    });
    await flush();

    expect(urls(fetchMock).sort()).toEqual([
      '/api/crons',
      '/api/kanban/proposals?status=pending',
      '/api/kanban/tasks?limit=200',
    ]);

    rerender({ active: false });
    fetchMock.mockClear();

    act(() => {
      result.current.refresh();
    });
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops polling and aborts in-flight requests when deactivated', async () => {
    const signals: AbortSignal[] = [];
    const never = new Promise<Response>(() => {});
    const fetchMock = installFetch({ tasks: () => never });
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.signal) signals.push(init.signal);
      return base(input, init);
    });

    const { rerender } = renderHook(
      ({ active }) => useAttentionSources({ active, kanbanEnabled: true }),
      { initialProps: { active: true } },
    );
    await flush();

    expect(signals.length).toBe(3);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);

    rerender({ active: false });
    await flush();

    expect(signals.every((signal) => signal.aborted)).toBe(true);

    fetchMock.mockClear();
    await flush(120_000);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts in-flight requests on unmount', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = installFetch({ tasks: () => new Promise<Response>(() => {}) });
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.signal) signals.push(init.signal);
      return base(input, init);
    });

    const { unmount } = renderHook(() => useAttentionSources({ active: true, kanbanEnabled: true }));
    await flush();

    unmount();

    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('ignores a response that arrives after the request was aborted', async () => {
    const late = createDeferred<Response>();
    installFetch({ tasks: () => late.promise });

    const { result, rerender } = renderHook(
      ({ active }) => useAttentionSources({ active, kanbanEnabled: true }),
      { initialProps: { active: true } },
    );
    await flush();

    rerender({ active: false });
    late.resolve(jsonResponse({ items: [TASK], total: 1, limit: 200, offset: 0, hasMore: false }));
    await flush();

    expect(result.current.tasks).toEqual([]);
    expect(result.current.sources.tasks).toEqual({ state: 'loading' });
  });

  it('never issues a non-GET request', async () => {
    const fetchMock = installFetch();

    const { result } = renderHook(() => useAttentionSources({ active: true, kanbanEnabled: true }));
    await flush(120_000);
    act(() => {
      result.current.refresh();
    });
    await flush();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(3);
    for (const [, init] of fetchMock.mock.calls) {
      const method = (init as RequestInit | undefined)?.method;
      expect(method === undefined || method === 'GET').toBe(true);
      expect((init as RequestInit | undefined)?.body).toBeUndefined();
    }
  });
});
