import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem, AttentionKind } from './types';
import { actionsFor, postAction, useItemActions, type ActionId } from './useAttentionActions';

function item(kind: AttentionKind, overrides: Partial<AttentionItem> = {}): AttentionItem {
  const source = kind.startsWith('cron') ? 'crons' : kind === 'proposal' ? 'proposals' : kind.startsWith('session') ? 'sessions' : 'tasks';
  return {
    key: `${source}:x:${kind}`,
    source,
    sourceId: 'id/1',
    kind,
    section: 'decide',
    title: 'Item',
    updatedAt: 0,
    priority: 'normal',
    freshness: 'live',
    open: { type: 'task', id: 'id/1' },
    detail: {},
    ...overrides,
  };
}

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => respond(200, { ok: true }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCall() {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return {
    url,
    method: init?.method,
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    contentType: (init?.headers as Record<string, string> | undefined)?.['Content-Type'],
  };
}

describe('actionsFor', () => {
  it('maps each kind to its actions', () => {
    expect(actionsFor(item('review'), true)).toEqual({ primary: 'approve', secondary: 'request-changes' });
    expect(actionsFor(item('proposal'), true)).toEqual({ primary: 'approve-proposal', secondary: 'reject-proposal' });
    expect(actionsFor(item('task-failed'), true)).toEqual({ primary: 'retry', secondary: null });
    expect(actionsFor(item('task-running'), true)).toEqual({ primary: 'stop', secondary: null });
    expect(actionsFor(item('gone-quiet'), true)).toEqual({ primary: 'stop', secondary: null });
    expect(actionsFor(item('cron-failed'), true)).toEqual({ primary: 'run-cron', secondary: 'pause-cron' });
    for (const kind of ['session-failed', 'session-running', 'task-finished', 'cron-finished'] as const) {
      expect(actionsFor(item(kind), true)).toEqual({ primary: null, secondary: null });
    }
  });

  it('offers no task or proposal actions with kanban off, but keeps cron actions', () => {
    for (const kind of ['review', 'proposal', 'task-failed', 'task-running', 'gone-quiet'] as const) {
      expect(actionsFor(item(kind), false)).toEqual({ primary: null, secondary: null });
    }
    expect(actionsFor(item('cron-failed'), false)).toEqual({ primary: 'run-cron', secondary: 'pause-cron' });
  });
});

describe('postAction', () => {
  const cases: Array<[AttentionKind, ActionId, string | undefined, string, unknown]> = [
    ['review', 'approve', undefined, '/api/kanban/tasks/id%2F1/approve', {}],
    ['review', 'request-changes', '  Add a test  ', '/api/kanban/tasks/id%2F1/reject', { note: 'Add a test' }],
    ['proposal', 'approve-proposal', undefined, '/api/kanban/proposals/id%2F1/approve', undefined],
    ['proposal', 'reject-proposal', undefined, '/api/kanban/proposals/id%2F1/reject', {}],
    ['task-failed', 'retry', undefined, '/api/kanban/tasks/id%2F1/execute', {}],
    ['task-running', 'stop', undefined, '/api/kanban/tasks/id%2F1/abort', {}],
    ['cron-failed', 'run-cron', undefined, '/api/crons/id%2F1/run', undefined],
    ['cron-failed', 'pause-cron', undefined, '/api/crons/id%2F1/toggle', { enabled: false }],
  ];

  it.each(cases)('%s %s posts to the right endpoint with the right body', async (kind, action, note, url, body) => {
    await postAction(item(kind), action, note);
    const call = lastCall();
    expect(call.url).toBe(url);
    expect(call.method).toBe('POST');
    expect(call.body).toEqual(body);
    if (body !== undefined) expect(call.contentType).toBe('application/json');
  });

  it('Request changes without a note never reaches the server', async () => {
    await expect(postAction(item('review'), 'request-changes', '   ')).rejects.toThrow(/note/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws the kanban error text: details, then error, then the status', async () => {
    fetchMock.mockResolvedValueOnce(respond(400, { error: 'invalid_transition', details: 'Task is not in review' }));
    await expect(postAction(item('review'), 'approve')).rejects.toThrow('Task is not in review');
    fetchMock.mockResolvedValueOnce(respond(409, { error: 'already_resolved' }));
    await expect(postAction(item('proposal'), 'approve-proposal')).rejects.toThrow('already_resolved');
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    await expect(postAction(item('task-failed'), 'retry')).rejects.toThrow('HTTP 500');
  });

  it('treats a cron answer without ok as a failure', async () => {
    fetchMock.mockResolvedValueOnce(respond(502, { ok: false, error: 'gateway down' }));
    await expect(postAction(item('cron-failed'), 'run-cron')).rejects.toThrow('gateway down');
    fetchMock.mockResolvedValueOnce(respond(200, { ok: false }));
    await expect(postAction(item('cron-failed'), 'pause-cron')).rejects.toThrow('HTTP 200');
  });
});

describe('useItemActions', () => {
  it('runs, calls onDone and stays locked after a success', async () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useItemActions(item('task-failed'), { kanbanEnabled: true, onDone }));
    expect(result.current.labelOf('retry')).toBe('Retry');

    await act(async () => {
      await result.current.run('retry');
    });

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(result.current.locked).toBe(true);
    expect(result.current.labelOf('retry')).toBe('Started');

    await act(async () => {
      await result.current.run('retry');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the error and unlocks after a failure, without onDone', async () => {
    fetchMock.mockResolvedValueOnce(respond(409, { error: 'duplicate_execution', details: 'Task is already being executed' }));
    const onDone = vi.fn();
    const { result } = renderHook(() => useItemActions(item('task-failed'), { kanbanEnabled: true, onDone }));

    await act(async () => {
      await result.current.run('retry');
    });

    expect(onDone).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Could not retry: Task is already being executed');
    expect(result.current.locked).toBe(false);
    expect(result.current.labelOf('retry')).toBe('Retry');
  });

  it('Stop asks to confirm and Request changes opens its note instead of running', () => {
    const config = { kanbanEnabled: true, onDone: vi.fn() };
    const running = renderHook(() => useItemActions(item('task-running'), config));
    act(() => running.result.current.begin('stop'));
    expect(running.result.current.confirming).toBe(true);

    const review = renderHook(() => useItemActions(item('review'), config));
    act(() => review.result.current.begin('request-changes'));
    expect(review.result.current.noteOpen).toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('has no actions without a config', () => {
    const { result } = renderHook(() => useItemActions(item('review'), undefined));
    expect(result.current.actions).toEqual({ primary: null, secondary: null });
  });
});
