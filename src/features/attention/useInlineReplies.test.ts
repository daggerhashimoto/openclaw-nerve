import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayEvent } from '@/types';
import {
  REPLY_TIMEOUT_MS,
  STOPPED_MESSAGE,
  TIMEOUT_MESSAGE,
  createInlineReplies,
  useInlineReplies,
  useInlineReply,
  type InlineReplies,
} from './useInlineReplies';

const MAIN = 'agent:main:main';
const OTHER = 'agent:forge:subagent:fix';

function fakeGateway(ack: (params: Record<string, unknown>) => Promise<unknown> = async (params) => ({
  runId: params.idempotencyKey,
  status: 'started',
})) {
  const handlers = new Set<(event: GatewayEvent) => void>();
  const rpc = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method !== 'chat.send') throw new Error(`unexpected ${method}`);
    return ack(params);
  });
  const subscribe = vi.fn((handler: (event: GatewayEvent) => void) => {
    handlers.add(handler);
    return () => { handlers.delete(handler); };
  });
  const emit = (event: string, payload: Record<string, unknown>) => {
    for (const handler of [...handlers]) handler({ type: 'event', event, payload });
  };
  return { rpc, subscribe, emit, handlers };
}

/** The idempotency key (and so the gateway run id) of the nth chat.send. */
function runIdOf(rpc: ReturnType<typeof fakeGateway>['rpc'], index = 0): string {
  return rpc.mock.calls[index][1].idempotencyKey as string;
}

async function sendAndAck(store: InlineReplies, sessionKey: string, text: string) {
  await act(async () => {
    await store.send(sessionKey, text, 'board');
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createInlineReplies', () => {
  it('sends with chat.send into the given session', async () => {
    const gateway = fakeGateway();
    const store = createInlineReplies(gateway);

    await sendAndAck(store, MAIN, '  What is blocking the release?  ');

    expect(gateway.rpc).toHaveBeenCalledTimes(1);
    const [method, params] = gateway.rpc.mock.calls[0];
    expect(method).toBe('chat.send');
    expect(params).toMatchObject({ sessionKey: MAIN, message: 'What is blocking the release?', deliver: false });
    expect(typeof params.idempotencyKey).toBe('string');
    expect(store.get(MAIN)).toMatchObject({ prompt: 'What is blocking the release?', status: 'working', origin: 'board' });
    expect(store.isBusy(MAIN)).toBe(true);
  });

  it('refuses empty text and a second send while one is in flight', async () => {
    const gateway = fakeGateway();
    const store = createInlineReplies(gateway);

    expect(await store.send(MAIN, '   ', 'board')).toBe(false);
    await sendAndAck(store, MAIN, 'First');
    expect(await store.send(MAIN, 'Second', 'item')).toBe(false);
    expect(gateway.rpc).toHaveBeenCalledTimes(1);
    expect(store.get(MAIN)?.prompt).toBe('First');
  });

  it('accumulates deltas and completes on the final', async () => {
    const gateway = fakeGateway();
    const store = createInlineReplies(gateway);
    await sendAndAck(store, MAIN, 'Status?');
    const runId = runIdOf(gateway.rpc);

    gateway.emit('chat', { sessionKey: MAIN, runId, state: 'delta', seq: 1, deltaText: 'Two tasks ' });
    gateway.emit('chat', { sessionKey: MAIN, runId, state: 'delta', seq: 2, deltaText: 'wait on you.' });
    expect(store.get(MAIN)).toMatchObject({ status: 'working', text: 'Two tasks wait on you.' });

    gateway.emit('chat', {
      sessionKey: MAIN,
      runId,
      state: 'final',
      seq: 3,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Two tasks wait on you.\n\n[tts: Two tasks wait on you.]' }] },
    });
    expect(store.get(MAIN)).toMatchObject({ status: 'done', text: 'Two tasks wait on you.', error: null });
    expect(store.isBusy(MAIN)).toBe(false);
    // Nothing in flight, so the store stops listening.
    expect(gateway.handlers.size).toBe(0);
  });

  it('keeps the streamed text when the final carries none', async () => {
    const gateway = fakeGateway();
    const store = createInlineReplies(gateway);
    await sendAndAck(store, MAIN, 'Status?');
    const runId = runIdOf(gateway.rpc);

    gateway.emit('chat', { sessionKey: MAIN, runId, state: 'delta', seq: 1, deltaText: 'All clear.' });
    gateway.emit('chat', { sessionKey: MAIN, runId, state: 'final', seq: 2 });
    expect(store.get(MAIN)).toMatchObject({ status: 'done', text: 'All clear.' });
  });

  it('ignores frames for other sessions and other runs', async () => {
    const gateway = fakeGateway();
    const store = createInlineReplies(gateway);
    await sendAndAck(store, MAIN, 'Status?');
    const runId = runIdOf(gateway.rpc);

    gateway.emit('chat', { sessionKey: OTHER, runId, state: 'delta', seq: 1, deltaText: 'other session' });
    gateway.emit('chat', { sessionKey: MAIN, runId: 'hb-1', state: 'delta', seq: 1, deltaText: 'heartbeat' });
    gateway.emit('chat', { sessionKey: MAIN, runId: 'hb-1', state: 'final', seq: 2, message: 'HEARTBEAT_OK' });
    gateway.emit('chat', { sessionKey: MAIN, state: 'delta', seq: 1, deltaText: 'no run id' });

    expect(store.get(MAIN)).toMatchObject({ status: 'working', text: '' });
  });

  it('takes frames that arrive before the ack, since the run id is the send key', async () => {
    let resolveAck: (value: unknown) => void = () => {};
    const gateway = fakeGateway(() => new Promise((resolve) => { resolveAck = resolve; }));
    const store = createInlineReplies(gateway);

    let sent: Promise<boolean> = Promise.resolve(false);
    act(() => { sent = store.send(MAIN, 'Quick one', 'board'); });
    const runId = runIdOf(gateway.rpc);
    gateway.emit('chat', { sessionKey: MAIN, runId, state: 'final', seq: 1, message: 'Done already.' });
    expect(store.get(MAIN)).toMatchObject({ status: 'done', text: 'Done already.' });

    await act(async () => {
      resolveAck({ runId, status: 'started' });
      await sent;
    });
    expect(store.get(MAIN)?.status).toBe('done');
  });

  it('follows the ack run id when the gateway names a different one', async () => {
    const gateway = fakeGateway(async () => ({ runId: 'gateway-run', status: 'started' }));
    const store = createInlineReplies(gateway);
    await sendAndAck(store, MAIN, 'Status?');

    gateway.emit('chat', { sessionKey: MAIN, runId: 'gateway-run', state: 'final', seq: 1, message: 'Fine.' });
    expect(store.get(MAIN)).toMatchObject({ status: 'done', text: 'Fine.' });
  });

  it('surfaces a run error with its reason', async () => {
    const gateway = fakeGateway();
    const store = createInlineReplies(gateway);
    await sendAndAck(store, MAIN, 'Status?');
    const runId = runIdOf(gateway.rpc);

    gateway.emit('chat', { sessionKey: MAIN, runId, state: 'error', seq: 1, errorMessage: 'rate limited' });
    expect(store.get(MAIN)).toMatchObject({ status: 'error', error: 'rate limited' });
    expect(store.isBusy(MAIN)).toBe(false);
  });

  it('surfaces an abort as stopped', async () => {
    const gateway = fakeGateway();
    const store = createInlineReplies(gateway);
    await sendAndAck(store, MAIN, 'Status?');

    gateway.emit('chat', { sessionKey: MAIN, runId: runIdOf(gateway.rpc), state: 'aborted', seq: 1 });
    expect(store.get(MAIN)).toMatchObject({ status: 'error', error: STOPPED_MESSAGE });
  });

  it('surfaces a rejected send', async () => {
    const gateway = fakeGateway(async () => { throw new Error('Disconnected'); });
    const store = createInlineReplies(gateway);
    await sendAndAck(store, MAIN, 'Status?');

    expect(store.get(MAIN)).toMatchObject({ status: 'error', error: 'Could not send: Disconnected' });
    expect(store.isBusy(MAIN)).toBe(false);
  });

  it('times out after 90 seconds without a frame, and any frame of the run resets the clock', async () => {
    const gateway = fakeGateway();
    const store = createInlineReplies(gateway);
    await sendAndAck(store, MAIN, 'Run the audit');
    const runId = runIdOf(gateway.rpc);

    act(() => { vi.advanceTimersByTime(REPLY_TIMEOUT_MS - 1_000); });
    gateway.emit('agent', { sessionKey: MAIN, runId, stream: 'tool', data: { phase: 'start', name: 'exec', toolCallId: 't1' } });
    act(() => { vi.advanceTimersByTime(REPLY_TIMEOUT_MS - 1_000); });
    expect(store.get(MAIN)?.status).toBe('working');

    act(() => { vi.advanceTimersByTime(1_000); });
    expect(store.get(MAIN)).toMatchObject({ status: 'error', error: TIMEOUT_MESSAGE });
    expect(store.isBusy(MAIN)).toBe(false);
  });

  it('follows the active run when the send is steered into it', async () => {
    let resolveAck: (value: unknown) => void = () => {};
    const gateway = fakeGateway(() => new Promise((resolve) => { resolveAck = resolve; }));
    const store = createInlineReplies(gateway);

    let sent: Promise<boolean> = Promise.resolve(false);
    act(() => { sent = store.send(MAIN, 'Also check the logs', 'board'); });
    const runId = runIdOf(gateway.rpc);
    // The gateway finishes the steered send at once, before its ack.
    gateway.emit('chat', { sessionKey: MAIN, runId, state: 'final', seq: 1 });
    expect(store.get(MAIN)?.status).toBe('working');
    await act(async () => {
      resolveAck({ runId, status: 'ok' });
      await sent;
    });
    expect(store.get(MAIN)?.status).toBe('working');

    gateway.emit('chat', { sessionKey: MAIN, runId: 'active-run', state: 'delta', seq: 7, deltaText: 'The logs show ' });
    gateway.emit('chat', { sessionKey: MAIN, runId: 'active-run', state: 'delta', seq: 8, deltaText: 'a timeout.' });
    expect(store.get(MAIN)?.text).toBe('The logs show a timeout.');
    gateway.emit('chat', { sessionKey: MAIN, runId: 'active-run', state: 'final', seq: 9, message: 'The logs show a timeout.' });
    expect(store.get(MAIN)).toMatchObject({ status: 'done', text: 'The logs show a timeout.' });
    // Other sessions stay ignored even while following any run.
    expect(gateway.handlers.size).toBe(0);
  });

  it('an empty final of a run that was not steered completes with no text', async () => {
    let resolveAck: (value: unknown) => void = () => {};
    const gateway = fakeGateway(() => new Promise((resolve) => { resolveAck = resolve; }));
    const store = createInlineReplies(gateway);

    let sent: Promise<boolean> = Promise.resolve(false);
    act(() => { sent = store.send(MAIN, 'Nothing to say?', 'board'); });
    const runId = runIdOf(gateway.rpc);
    gateway.emit('chat', { sessionKey: MAIN, runId, state: 'final', seq: 1 });
    await act(async () => {
      resolveAck({ runId, status: 'started' });
      await sent;
    });
    expect(store.get(MAIN)).toMatchObject({ status: 'done', text: '' });
  });

  it('dismiss forgets the reply', async () => {
    const gateway = fakeGateway();
    const store = createInlineReplies(gateway);
    await sendAndAck(store, MAIN, 'Status?');
    gateway.emit('chat', { sessionKey: MAIN, runId: runIdOf(gateway.rpc), state: 'final', seq: 1, message: 'Fine.' });

    store.dismiss(MAIN);
    expect(store.get(MAIN)).toBeUndefined();
  });
});

const gatewayMock = vi.fn();
vi.mock('@/contexts/GatewayContext', () => ({
  useGateway: () => gatewayMock(),
}));

describe('useInlineReplies', () => {
  it('re-renders the surface for its session and origin as the reply streams', async () => {
    const gateway = fakeGateway();
    gatewayMock.mockReturnValue({ ...gateway, connectionState: 'connected' });
    const { result } = renderHook(() => {
      const store = useInlineReplies();
      return {
        store,
        board: useInlineReply(store, MAIN, 'board'),
        item: useInlineReply(store, MAIN, 'item'),
        other: useInlineReply(store, OTHER, 'board'),
      };
    });

    await act(async () => {
      await result.current.store.send(MAIN, 'Status?', 'board');
    });
    act(() => {
      gateway.emit('chat', { sessionKey: MAIN, runId: runIdOf(gateway.rpc), state: 'delta', seq: 1, deltaText: 'Working on it' });
    });

    expect(result.current.board).toMatchObject({ status: 'working', text: 'Working on it' });
    expect(result.current.item).toBeUndefined();
    expect(result.current.other).toBeUndefined();
  });
});
