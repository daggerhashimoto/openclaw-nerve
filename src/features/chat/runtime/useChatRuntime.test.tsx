import { StrictMode, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatRuntime } from './useChatRuntime';
import type { TimelinePatch, TimelineSnapshot, TimelineTurn, UserTimelineItem } from './types';

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  private eventListeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: MessageEvent) => void) {
    const handlers = this.eventListeners.get(type) ?? [];
    handlers.push(handler);
    this.eventListeners.set(type, handlers);
  }

  removeEventListener(type: string, handler: (event: MessageEvent) => void) {
    const handlers = this.eventListeners.get(type) ?? [];
    const index = handlers.indexOf(handler);
    if (index !== -1) handlers.splice(index, 1);
  }

  dispatch(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const handler of this.eventListeners.get(type) ?? []) handler(event);
  }

  close() {
    this.readyState = 2;
    const index = MockEventSource.instances.indexOf(this);
    if (index !== -1) MockEventSource.instances.splice(index, 1);
  }

  static latest(): MockEventSource {
    const latest = MockEventSource.instances[MockEventSource.instances.length - 1];
    if (!latest) throw new Error('expected EventSource instance');
    return latest;
  }

  static reset() {
    MockEventSource.instances = [];
  }
}

describe('useChatRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.reset();
    global.EventSource = MockEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    vi.useRealTimers();
    MockEventSource.reset();
    vi.restoreAllMocks();
  });

  it('opens a session replay stream and projects snapshots', () => {
    const { result, unmount } = renderHook(() => useChatRuntime({ sessionKey: 'session-1' }));

    expect(MockEventSource.latest().url).toBe('/api/chat-runtime/stream?sessionKey=session-1&cursor=0');

    act(() => {
      MockEventSource.latest().dispatch('snapshot', makeSnapshot('session-1', '4', 'hello replay'));
    });

    expect(result.current.cursor).toBe('4');
    expect(result.current.messages).toEqual([
      expect.objectContaining({ msgId: 'user-1', role: 'user', rawText: 'hello replay' }),
    ]);

    unmount();
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('reconnects with the latest cursor after errors', async () => {
    renderHook(() => useChatRuntime({ sessionKey: 'session-1', reconnectBaseDelayMs: 25 }));

    act(() => {
      MockEventSource.latest().dispatch('patch', makePatch('session-1', '7', 'after cursor'));
    });
    expect(MockEventSource.latest().url).toContain('cursor=0');

    act(() => {
      MockEventSource.latest().onerror?.();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });

    expect(MockEventSource.latest().url).toBe('/api/chat-runtime/stream?sessionKey=session-1&cursor=7');
  });

  it('schedules one reconnect timer after a stream error under Strict Mode', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    );
    renderHook(() => useChatRuntime({ sessionKey: 'session-1', reconnectBaseDelayMs: 25 }), { wrapper });

    act(() => {
      MockEventSource.latest().onerror?.();
    });

    expect(vi.getTimerCount()).toBe(1);
  });

  it('ignores events from a closed stream after switching sessions', () => {
    const { result, rerender } = renderHook(
      ({ sessionKey }) => useChatRuntime({ sessionKey }),
      { initialProps: { sessionKey: 'session-1' } },
    );

    const oldStream = MockEventSource.latest();
    act(() => {
      oldStream.dispatch('snapshot', makeSnapshot('session-1', '3', 'old session'));
    });
    expect(result.current.messages[0]).toMatchObject({ rawText: 'old session' });

    rerender({ sessionKey: 'session-2' });
    const newStream = MockEventSource.latest();
    expect(newStream.url).toBe('/api/chat-runtime/stream?sessionKey=session-2&cursor=0');

    act(() => {
      oldStream.dispatch('patch', makePatch('session-1', '4', 'stale old session'));
      newStream.dispatch('snapshot', makeSnapshot('session-2', '1', 'new session'));
    });

    expect(result.current.cursor).toBe('1');
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'user', rawText: 'new session' }),
    ]);
  });
});

function makeSnapshot(sessionKey: string, cursor: string, text: string): TimelineSnapshot {
  const turn = makeTurn(sessionKey, 'run-1');
  return {
    type: 'snapshot',
    sessionKey,
    cursor,
    reason: 'initial',
    timeline: {
      sessionKey,
      version: Number(cursor),
      cursor,
      hydrationState: 'ready',
      turns: [turn],
      items: {
        'user-1': makeUser(turn, 'user-1', text),
      },
      updatedAt: 1_775_000_000_000,
    },
  };
}

function makePatch(sessionKey: string, cursor: string, text: string): TimelinePatch {
  const turn = makeTurn(sessionKey, 'run-1');
  return {
    sessionKey,
    cursor,
    createdAt: 1_775_000_000_000,
    ops: [
      { op: 'upsert_turn', turn },
      { op: 'upsert_item', item: makeUser(turn, 'user-1', text) },
    ],
  };
}

function makeTurn(sessionKey: string, runId: string): TimelineTurn {
  return {
    id: `turn:${runId}`,
    sessionKey,
    runId,
    status: 'running',
    startedAt: 1_775_000_000_000,
    inputItemIds: ['user-1'],
    outputItemIds: [],
    orderBase: { turn: 0, block: 0, sub: 0 },
  };
}

function makeUser(turn: TimelineTurn, id: string, text: string): UserTimelineItem {
  return {
    id,
    sessionKey: turn.sessionKey,
    turnId: turn.id,
    runId: turn.runId,
    kind: 'user_message',
    text,
    orderKey: { turn: 0, block: 0, sub: 0 },
    createdAt: 1_775_000_000_000,
    updatedAt: 1_775_000_000_000,
    status: 'complete',
    source: 'history',
    pending: false,
  };
}
