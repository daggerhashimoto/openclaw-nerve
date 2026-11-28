import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUMMARIES_URL, useAttentionSummaries } from './useAttentionSummaries';

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function bodies(): Array<{ sessionKeys: string[] }> {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useAttentionSummaries', () => {
  it('asks once for every key, polls while any is pending and stops when none are', async () => {
    fetchMock
      .mockResolvedValueOnce(respond(200, { summaries: { a: { status: 'pending' }, b: { status: 'ready', text: 'B done.' } } }))
      .mockResolvedValueOnce(respond(200, { summaries: { a: { status: 'pending' }, b: { status: 'ready', text: 'B done.' } } }))
      .mockResolvedValueOnce(respond(200, { summaries: { a: { status: 'ready', text: 'A done.' }, b: { status: 'ready', text: 'B done.' } } }));

    const { result } = renderHook(() => useAttentionSummaries({ active: true, sessionKeys: ['a', 'b', 'a'], signal: '1' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(SUMMARIES_URL);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
    expect(bodies()[0]).toEqual({ sessionKeys: ['a', 'b'] });
    expect(result.current.a).toEqual({ status: 'pending' });
    expect(result.current.b).toEqual({ status: 'ready', text: 'B done.' });

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.a).toEqual({ status: 'ready', text: 'A done.' });

    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('asks again when the signal changes', async () => {
    fetchMock.mockImplementation(async () => respond(200, { summaries: { a: { status: 'ready', text: 'A.' } } }));
    const { rerender } = renderHook(
      ({ signal }) => useAttentionSummaries({ active: true, sessionKeys: ['a'], signal }),
      { initialProps: { signal: '1' } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rerender({ signal: '1' });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender({ signal: '2' });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('requests nothing while inactive or with no keys', async () => {
    renderHook(() => useAttentionSummaries({ active: false, sessionKeys: ['a'], signal: '1' }));
    renderHook(() => useAttentionSummaries({ active: true, sessionKeys: [], signal: '1' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is quiet when the endpoint fails: no summaries and no retry loop', async () => {
    fetchMock.mockResolvedValue(respond(404, { error: 'Not found' }));
    const { result } = renderHook(() => useAttentionSummaries({ active: true, sessionKeys: ['a'], signal: '1' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({});
  });

  it('ignores malformed entries', async () => {
    fetchMock.mockResolvedValue(respond(200, { summaries: { a: { status: 'weird' }, b: 'nope' } }));
    const { result } = renderHook(() => useAttentionSummaries({ active: true, sessionKeys: ['a', 'b'], signal: '1' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toEqual({});
  });

  it('passes whose turn it is through, and drops malformed turn fields', async () => {
    fetchMock.mockResolvedValue(respond(200, { summaries: {
      a: { status: 'ready', text: 'A.', lastSpeaker: 'agent', lastAt: 5, asksOperator: true },
      b: { status: 'ready', text: 'B.', lastSpeaker: 'robot', lastAt: 'soon', asksOperator: 'yes' },
    } }));
    const { result } = renderHook(() => useAttentionSummaries({ active: true, sessionKeys: ['a', 'b'], signal: '1' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toEqual({
      a: { status: 'ready', text: 'A.', lastSpeaker: 'agent', lastAt: 5, asksOperator: true },
      b: { status: 'ready', text: 'B.' },
    });
  });
});
