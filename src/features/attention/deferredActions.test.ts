import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferredActions, UNDO_WINDOW_MS, useDeferredActions, type ActionSender } from './deferredActions';
import { postAction } from './useAttentionActions';
import type { AttentionItem } from './types';

function item(key: string, title = 'Rotate the API keys'): AttentionItem {
  return {
    key,
    source: 'tasks',
    sourceId: key,
    kind: 'review',
    section: 'decide',
    title,
    updatedAt: 0,
    priority: 'normal',
    freshness: 'live',
    open: null,
    detail: {},
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 28, 9, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('deferred actions', () => {
  it('sends when the window closes, not before', async () => {
    const send = vi.fn<ActionSender>(async () => {});
    const onSent = vi.fn();
    const store = createDeferredActions({ send });
    store.setEvents({ onSent });

    const entry = store.commit(item('t1'), 'approve');
    expect(entry?.deadline).toBe(Date.now() + UNDO_WINDOW_MS);
    expect(store.pendingOf('t1')?.status).toBe('waiting');
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS - 1);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ key: 't1' }), 'approve', undefined, { keepalive: false });
    expect(store.pendingOf('t1')).toBeUndefined();
    expect(store.sentOf('t1')?.action).toBe('approve');
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(store.handled()).toEqual([expect.objectContaining({ key: 't1', outcome: 'done', title: 'Rotate the API keys' })]);
  });

  it('a second action on a waiting item is refused', () => {
    const store = createDeferredActions({ send: vi.fn(async () => {}) });
    expect(store.commit(item('t1'), 'approve')).not.toBeNull();
    expect(store.commit(item('t1'), 'request-changes', 'No')).toBeNull();
  });

  it('undo cancels the send; without a key it takes back the latest waiting action', async () => {
    const send = vi.fn<ActionSender>(async () => {});
    const store = createDeferredActions({ send });
    store.commit(item('t1'), 'approve');
    await vi.advanceTimersByTimeAsync(1000);
    store.commit(item('t2', 'Second'), 'retry');

    expect(store.undo()?.key).toBe('t2');
    expect(store.undo('t1')?.key).toBe('t1');
    expect(store.undo()).toBeNull();
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2);
    expect(send).not.toHaveBeenCalled();
    expect(store.handled()).toEqual([]);
  });

  it('flush sends at once with keepalive, and only once', async () => {
    const send = vi.fn<ActionSender>(async () => {});
    const store = createDeferredActions({ send });
    store.commit(item('t1'), 'approve');
    store.commit(item('t2'), 'deny');

    store.flush({ keepalive: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.every(([, , , options]) => options.keepalive)).toBe(true);
    // Sending: no Undo any more.
    expect(store.undo('t1')).toBeNull();
    store.flush({ keepalive: true });
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('a failed send keeps the error for the item and lists it as handled', async () => {
    const send = vi.fn<ActionSender>(async () => { throw new Error('Task is not in review'); });
    const onFailed = vi.fn();
    const store = createDeferredActions({ send });
    store.setEvents({ onFailed });

    store.commit(item('t1'), 'approve');
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(store.pendingOf('t1')).toBeUndefined();
    expect(store.errorOf('t1')).toBe('Could not approve: Task is not in review');
    expect(store.sentOf('t1')).toBeUndefined();
    expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ key: 't1' }), 'Could not approve: Task is not in review');
    expect(store.handled()[0]).toEqual(expect.objectContaining({ outcome: 'failed', error: 'Could not approve: Task is not in review' }));

    store.clearError('t1');
    expect(store.errorOf('t1')).toBeUndefined();
  });

  it('the hook flushes on pagehide, on a hidden page and when the board goes away', () => {
    const send = vi.fn<ActionSender>(async () => {});
    const { result, unmount } = renderHook(() => useDeferredActions(send));

    act(() => { result.current.commit(item('t1'), 'approve'); });
    window.dispatchEvent(new Event('pagehide'));
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ key: 't1' }), 'approve', undefined, { keepalive: true });

    act(() => { result.current.commit(item('t2'), 'approve'); });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockRestore();
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ key: 't2' }), 'approve', undefined, { keepalive: true });

    act(() => { result.current.commit(item('t3'), 'approve'); });
    unmount();
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ key: 't3' }), 'approve', undefined, { keepalive: true });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('postAction passes keepalive to fetch only when asked', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await postAction(item('t1'), 'approve', undefined, undefined, { keepalive: true });
    await postAction(item('t1'), 'approve');
    const inits = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(([, init]) => init);
    expect(inits[0]).toEqual(expect.objectContaining({ method: 'POST', keepalive: true }));
    expect(inits[1]).not.toHaveProperty('keepalive');
  });
});
