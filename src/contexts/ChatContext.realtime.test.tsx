/**
 * Regression tests for realtime chat against OpenClaw protocol v4 gateways.
 *
 * Frame shapes mirror what a 2026.9 gateway actually sends: `status` instead of
 * `started`, appends in `deltaText` with a snapshot only on the first frame,
 * run-level chat seq numbers shared with agent events, connection-level frame
 * seq numbers that cover every event, and a late second `final` that delivers
 * an interim reply after the run has already settled.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { GatewayEvent } from '@/types';
import type { useChat as UseChat } from './ChatContext';

type ChatApi = ReturnType<typeof UseChat>;

const SESSION = 'agent:main:main';
const RUN = 'run-1';
const NOW = 1_700_000_015_000; // middle of a 30s bucket, keeps message signatures stable

function textMessage(text: string, timestamp: number) {
  return { role: 'assistant', content: [{ type: 'text', text }], timestamp };
}

describe('ChatContext realtime handling (protocol v4)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup(history: unknown[] = []) {
    let handler: ((msg: GatewayEvent) => void) | null = null;
    const subscribeMock = vi.fn((h: (msg: GatewayEvent) => void) => {
      handler = h;
      return () => {};
    });
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.send') return { runId: RUN, status: 'started' };
      if (method === 'chat.history') return { messages: history };
      return {};
    });

    vi.doMock('./GatewayContext', () => ({
      useGateway: () => ({
        connectionState: 'disconnected',
        rpc: rpcMock,
        subscribe: subscribeMock,
      }),
    }));

    vi.doMock('./SessionContext', () => ({
      useSessionContext: () => ({
        currentSession: SESSION,
        sessions: [],
      }),
    }));

    const speakMock = vi.fn();
    vi.doMock('./SettingsContext', () => ({
      useSettings: () => ({
        soundEnabled: false,
        speak: speakMock,
      }),
    }));

    const { ChatProvider, useChat } = await import('./ChatContext');
    let chat: ChatApi | null = null;

    function Consumer() {
      const value = useChat();
      useEffect(() => {
        chat = value;
      }, [value]);
      return null;
    }

    render(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(handler).not.toBeNull());

    const emit = (event: string, payload: Record<string, unknown>, seq?: number) => {
      act(() => {
        handler!({ type: 'event', event, payload, ...(seq !== undefined ? { seq } : {}) });
      });
    };
    const historyCalls = () => rpcMock.mock.calls.filter(([method]) => method === 'chat.history').length;

    return { emit, historyCalls, getChat: () => chat!, rpcMock, speakMock };
  }

  const chat = (payload: Record<string, unknown>) => ({ sessionKey: SESSION, runId: RUN, ...payload });

  it('treats the first status frame as the start of the turn', async () => {
    const { emit, getChat } = await setup();

    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));

    await waitFor(() => expect(getChat().isGenerating).toBe(true));
  });

  it('streams the full text when later frames carry only deltaText', async () => {
    const { emit, getChat } = await setup();

    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
    emit('chat', chat({ state: 'delta', seq: 33, deltaText: 'Fore', message: textMessage('Fore', NOW) }));
    emit('chat', chat({ state: 'delta', seq: 37, deltaText: 'sts absorb' }));
    emit('chat', chat({ state: 'delta', seq: 55, deltaText: ' carbon dioxide.' }));

    await waitFor(() => expect(getChat().stream.html).toContain('Forests absorb carbon dioxide.'));
  });

  it('does not recover history for normal frame and chat seq jumps', async () => {
    const { emit, historyCalls } = await setup();

    // Contiguous connection frames; chat seq jumps because agent events share the run counter.
    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }), 7);
    emit('sessions.changed', { sessionKey: SESSION, reason: 'patch' }, 8);
    emit('agent', { sessionKey: SESSION, runId: RUN, seq: 6, stream: 'lifecycle', data: { phase: 'start' } }, 9);
    emit('tick', {}, 10);
    emit('chat', chat({ state: 'delta', seq: 33, deltaText: 'Fore', message: textMessage('Fore', NOW) }), 11);
    emit('session.message', { sessionKey: SESSION }, 12);
    emit('chat', chat({ state: 'delta', seq: 37, deltaText: 'sts' }), 13);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(historyCalls()).toBe(0);
  });

  it('still recovers history when connection frames are actually missing', async () => {
    const { emit, historyCalls } = await setup();

    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }), 7);
    emit('chat', chat({ state: 'delta', seq: 2, deltaText: 'Hi', message: textMessage('Hi', NOW) }), 9);

    await waitFor(() => expect(historyCalls()).toBeGreaterThan(0));
  });

  it('refreshes history when a tool item finishes, including the message tool', async () => {
    const { emit, historyCalls } = await setup();

    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
    emit('agent', {
      sessionKey: SESSION,
      runId: RUN,
      seq: 20,
      stream: 'item',
      data: { kind: 'tool', phase: 'end', name: 'message', toolCallId: 'tc-1', status: 'completed' },
    });

    await waitFor(() => expect(historyCalls()).toBeGreaterThan(0));
  });

  it('keeps the newer transcript when an older history refresh answers last', async () => {
    const { emit, getChat, rpcMock } = await setup();
    const base = rpcMock.getMockImplementation()!;
    const reads: Array<(value: unknown) => void> = [];
    rpcMock.mockImplementation((method: string) => (
      method === 'chat.history' ? new Promise((resolve) => { reads.push(resolve); }) : base(method)
    ));
    const prompt = { role: 'user', content: 'Check the disk', timestamp: NOW, __openclaw: { id: 'e1' } };
    const interim = { role: 'assistant', content: [{ type: 'text', text: 'Checking it now.' }], timestamp: NOW + 1_000, __openclaw: { id: 'e2', runId: RUN } };
    const toolResult = (toolCallId: string) => ({ sessionKey: SESSION, runId: RUN, stream: 'tool', data: { phase: 'result', name: 'exec', toolCallId } });

    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
    // Two tool results in one turn: the second refresh starts while the first read is still out.
    emit('agent', toolResult('t1'));
    await waitFor(() => expect(reads).toHaveLength(1));
    emit('agent', toolResult('t2'));
    await waitFor(() => expect(reads).toHaveLength(2));

    await act(async () => {
      reads[1]({ messages: [prompt, interim] });
    });
    await waitFor(() => expect(getChat().messages.map((m) => m.rawText)).toEqual(['Check the disk', 'Checking it now.']));

    // The first read, taken before the interim reply was committed, answers last.
    await act(async () => {
      reads[0]({ messages: [prompt] });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(getChat().messages.map((m) => m.rawText)).toEqual(['Check the disk', 'Checking it now.']);
  });

  it('names a web search in the activity log once its result says what was searched', async () => {
    const { emit, getChat } = await setup();
    const tool = (data: Record<string, unknown>) => ({ sessionKey: SESSION, runId: RUN, stream: 'tool', data });

    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
    // Frames captured from the gateway: the start has no query, the result does.
    emit('agent', tool({ phase: 'start', name: 'web_search', itemId: 'exec-1', toolCallId: 'exec-1', args: { queryUnavailable: true } }));
    await waitFor(() => expect(getChat().activityLog.map((e) => e.description)).toEqual(['searching the web']));

    emit('agent', tool({
      phase: 'result', name: 'web_search', itemId: 'exec-1', toolCallId: 'exec-1', status: 'completed', isError: false,
      meta: 'for "OpenClaw gateway release notes"', result: { status: 'completed', query: 'OpenClaw gateway release notes' },
    }));
    await waitFor(() => expect(getChat().activityLog).toMatchObject([
      { description: 'searching: OpenClaw gateway release notes', phase: 'completed' },
    ]));
  });

  it('shows an image the agent delivered with its reply, which only history carries', async () => {
    // Captured from the gateway: the webchat final carries the reply text, and the delivered
    // image is written to the transcript as a gateway-hosted image block.
    const imagePath = '/api/chat/media/outgoing/agent%3Amain%3Amain/9f6ffd21-93cd-402d-b568-00f5562daa41/full';
    const history = [
      { role: 'user', content: 'Make an image', timestamp: NOW },
      {
        role: 'assistant',
        timestamp: NOW + 25_000,
        content: [
          { type: 'text', text: 'Here it is.' },
          { type: 'image', url: imagePath, openUrl: imagePath, alt: 'codex-image-generation-2.png', mimeType: 'image/png' },
        ],
      },
    ];
    const { emit, getChat } = await setup(history);

    await act(async () => {
      await getChat().handleSend('Make an image');
    });
    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
    emit('chat', chat({ state: 'final', seq: 75, stopReason: 'stop', message: textMessage('Here it is.', NOW + 25_000) }));

    await waitFor(() => {
      const reply = getChat().messages.find((m) => m.rawText === 'Here it is.');
      expect(reply?.extractedImages).toEqual([
        { url: `/api/chat-media?path=${encodeURIComponent(imagePath)}`, alt: 'codex-image-generation-2.png' },
      ]);
    });
    expect(getChat().messages.filter((m) => m.rawText === 'Here it is.')).toHaveLength(1);
  });

  /** The idempotency key the nth chat.send carried. */
  function sentKey(rpcMock: { mock: { calls: unknown[][] } }, nth = 0): string {
    const sends = rpcMock.mock.calls.filter(([method]) => method === 'chat.send');
    return (sends[nth][1] as { idempotencyKey: string }).idempotencyKey;
  }

  const earlier = { role: 'user', content: 'Earlier', timestamp: NOW - 60_000, __openclaw: { id: 'e1' } };

  it('keeps a prompt still sending through a history reload, then shows its recorded copy once', async () => {
    const history: unknown[] = [earlier];
    const { getChat, rpcMock } = await setup(history);
    const base = rpcMock.getMockImplementation()!;
    let ack!: (value: unknown) => void;
    rpcMock.mockImplementation((method: string) => (
      method === 'chat.send' ? new Promise((resolve) => { ack = resolve; }) : base(method)
    ));

    let sending!: Promise<void>;
    act(() => {
      sending = getChat().handleSend('Hello');
    });
    await act(async () => {
      await getChat().loadHistory();
    });
    expect(getChat().messages.map((m) => [m.rawText, Boolean(m.pending)])).toEqual([['Earlier', false], ['Hello', true]]);

    // The gateway records the prompt under the send key, then history is read again.
    history.push({ role: 'user', content: 'Hello', timestamp: NOW + 400, idempotencyKey: `${sentKey(rpcMock)}:user`, __openclaw: { id: 'e2' } });
    await act(async () => {
      await getChat().loadHistory();
    });
    expect(getChat().messages.map((m) => [m.rawText, Boolean(m.pending)])).toEqual([['Earlier', false], ['Hello', false]]);

    await act(async () => {
      ack({ runId: RUN, status: 'started' });
      await sending;
    });
    expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Hello']);
  });

  it('keeps a prompt that failed to send through a history reload, still failed', async () => {
    const { getChat, rpcMock } = await setup([earlier]);
    const base = rpcMock.getMockImplementation()!;
    rpcMock.mockImplementation((method: string) => (
      method === 'chat.send' ? Promise.reject(new Error('Disconnected')) : base(method)
    ));

    await act(async () => {
      await getChat().handleSend('Hello');
    });
    await act(async () => {
      await getChat().loadHistory();
    });

    const rows = getChat().messages;
    expect(rows.map((m) => m.rawText)).toEqual(['Earlier', 'Hello']);
    expect(rows[1].failed).toBe(true);
  });

  it('keeps the live stream intact when history is recovered mid-run', async () => {
    const history: unknown[] = [earlier];
    const { emit, getChat, rpcMock, historyCalls } = await setup(history);

    await act(async () => {
      await getChat().loadHistory();
    });
    const loads = historyCalls();
    await act(async () => {
      await getChat().handleSend('Write about forests');
    });
    history.push(
      { role: 'user', content: 'Write about forests', timestamp: NOW + 300, idempotencyKey: `${sentKey(rpcMock)}:user`, __openclaw: { id: 'e2' } },
      { role: 'assistant', content: [{ type: 'text', text: 'Forests absorb carbon dioxide.' }], timestamp: NOW + 900, __openclaw: { id: 'e3', runId: RUN } },
    );
    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }), 7);
    emit('chat', chat({ state: 'delta', seq: 33, deltaText: 'Forests absorb carbon dioxide.', message: textMessage('Forests absorb carbon dioxide.', NOW) }), 8);
    // Frame 9 never arrives: recovery reads history while the reply is still streaming.
    emit('chat', chat({ state: 'delta', seq: 37, deltaText: ' They also' }), 10);

    await waitFor(() => expect(historyCalls()).toBeGreaterThan(loads));
    await waitFor(() => expect(getChat().stream.isRecovering).toBe(false));

    expect(getChat().stream.html).toContain('Forests absorb carbon dioxide. They also');
    // The recorded prompt replaced the local one; the streamed text stays out of the transcript.
    expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Write about forests']);
  });

  it('shows the reply once when history brought a compaction row before the live final (#376)', async () => {
    const reply = 'Task 10 audit is verified complete.';
    const history: unknown[] = [earlier];
    const { emit, getChat, rpcMock, historyCalls } = await setup(history);

    await act(async () => {
      await getChat().loadHistory();
    });
    await act(async () => {
      await getChat().handleSend('Audit task 10');
    });
    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }), 7);
    emit('chat', chat({ state: 'delta', seq: 33, deltaText: reply, message: textMessage(reply, NOW) }), 8);

    // The gateway records the reply, then compacts the session before the final goes out.
    history.push(
      { role: 'user', content: 'Audit task 10', timestamp: NOW + 200, idempotencyKey: `${sentKey(rpcMock)}:user`, __openclaw: { id: 'e2' } },
      { role: 'assistant', content: [{ type: 'text', text: reply }], timestamp: NOW + 1000, __openclaw: { id: 'e3', runId: RUN } },
      { role: 'system', content: [{ type: 'text', text: 'Compaction' }], timestamp: NOW + 2000, __openclaw: { id: 'e4', kind: 'compaction' } },
    );
    // A frame goes missing, so history is recovered while the reply is still the stream.
    const loadsBeforeGap = historyCalls();
    emit('chat', chat({ state: 'delta', seq: 40, deltaText: '' }), 10);
    await waitFor(() => expect(historyCalls()).toBeGreaterThan(loadsBeforeGap));
    // The recovery finishes with the reply still in the stream; the compaction row stays hidden (#374).
    await waitFor(() => expect(getChat().stream.isRecovering).toBe(false));
    expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Audit task 10']);

    emit('chat', chat({ state: 'final', seq: 75, stopReason: 'stop', message: textMessage(reply, NOW + 3000) }), 11);
    expect(getChat().messages.filter((m) => m.rawText === reply)).toHaveLength(1);

    // The final schedules one more history read; afterwards every row shows once, in history order.
    const loadsAfterFinal = historyCalls();
    await waitFor(() => expect(historyCalls()).toBeGreaterThan(loadsAfterFinal));
    await waitFor(() => {
      expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Audit task 10', reply]);
    });
  });

  it('does not append the live final after the compaction row that follows its history copy (#376)', async () => {
    const reply = 'Task 10 audit is verified complete.';
    const history: unknown[] = [earlier];
    const { emit, getChat, rpcMock, historyCalls } = await setup(history);

    await act(async () => {
      await getChat().loadHistory();
    });
    await act(async () => {
      await getChat().handleSend('Audit task 10');
    });
    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }), 7);
    history.push(
      { role: 'user', content: 'Audit task 10', timestamp: NOW + 200, idempotencyKey: `${sentKey(rpcMock)}:user`, __openclaw: { id: 'e2' } },
      { role: 'assistant', content: [{ type: 'text', text: reply }], timestamp: NOW + 1000, __openclaw: { id: 'e3', runId: RUN } },
      { role: 'system', content: [{ type: 'text', text: 'Compaction' }], timestamp: NOW + 2000, __openclaw: { id: 'e4', kind: 'compaction' } },
    );
    // Nothing streamed, and a frame goes missing: the recovery brings the reply (the compaction row stays hidden, #374).
    const loadsBeforeGap = historyCalls();
    emit('agent', { sessionKey: SESSION, runId: RUN, seq: 5, stream: 'tool', data: { phase: 'start', name: 'exec', toolCallId: 't1' } }, 9);
    await waitFor(() => expect(historyCalls()).toBeGreaterThan(loadsBeforeGap));
    await waitFor(() => expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Audit task 10', reply]));

    emit('chat', chat({ state: 'final', seq: 75, stopReason: 'stop', message: textMessage(reply, NOW + 3000) }), 10);
    expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Audit task 10', reply]);

    const loadsAfterFinal = historyCalls();
    await waitFor(() => expect(historyCalls()).toBeGreaterThan(loadsAfterFinal));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Audit task 10', reply]);
  });

  /** Sends a prompt and lets a recovery bring its reply, recorded as the run's terminal one, before the final. */
  async function replyShownBeforeItsFinal(reply: string) {
    const history: unknown[] = [earlier];
    const harness = await setup(history);
    const { emit, getChat, rpcMock, historyCalls } = harness;

    await act(async () => {
      await getChat().loadHistory();
    });
    await act(async () => {
      await getChat().handleSend('Audit task 10');
    });
    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }), 7);
    history.push(
      { role: 'user', content: 'Audit task 10', timestamp: NOW + 200, idempotencyKey: `${sentKey(rpcMock)}:user`, __openclaw: { id: 'e2', runId: RUN } },
      { role: 'assistant', content: [{ type: 'text', text: reply }], timestamp: NOW + 1000, stopReason: 'stop', __openclaw: { id: 'e3', runId: RUN, runTerminal: true } },
      { role: 'system', content: [{ type: 'text', text: 'Compaction' }], timestamp: NOW + 2000, __openclaw: { id: 'e4', kind: 'compaction' } },
    );
    const loadsBeforeGap = historyCalls();
    emit('agent', { sessionKey: SESSION, runId: RUN, seq: 5, stream: 'tool', data: { phase: 'start', name: 'exec', toolCallId: 't1' } }, 9);
    await waitFor(() => expect(historyCalls()).toBeGreaterThan(loadsBeforeGap));
    await waitFor(() => expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Audit task 10', reply]));

    return { ...harness, history };
  }

  it('shows the reply once when its final comes minutes after history showed it (#376)', async () => {
    const reply = 'Task 10 audit is verified complete.';
    const { emit, getChat, historyCalls } = await replyShownBeforeItsFinal(reply);

    // The compaction held the end of the run back: the final is stamped 85s after the reply.
    emit('chat', chat({ state: 'final', seq: 75, stopReason: 'stop', message: textMessage(reply, NOW + 86_000) }), 10);
    expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Audit task 10', reply]);

    const loadsAfterFinal = historyCalls();
    await waitFor(() => expect(historyCalls()).toBeGreaterThan(loadsAfterFinal));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Audit task 10', reply]);
  });

  it('shows the reply once when its final comes after the next prompt, even if the refresh fails (#376)', async () => {
    const reply = 'Task 10 audit is verified complete.';
    const { emit, getChat, rpcMock, historyCalls, history } = await replyShownBeforeItsFinal(reply);
    const base = rpcMock.getMockImplementation()!;
    let historyFails = false;
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'chat.send') return { runId: 'run-2', status: 'started' };
      if (method === 'chat.history' && historyFails) {
        historyFails = false;
        throw new Error('Disconnected');
      }
      return base(method);
    });

    // The operator answers the reply on screen before its run has ended.
    await act(async () => {
      await getChat().handleSend('Thanks, next one');
    });
    history.push({ role: 'user', content: 'Thanks, next one', timestamp: NOW + 4000, idempotencyKey: `${sentKey(rpcMock, 1)}:user`, __openclaw: { id: 'e5', runId: 'run-2' } });

    historyFails = true;
    const loadsAfterSend = historyCalls();
    emit('chat', chat({ state: 'final', seq: 75, stopReason: 'stop', message: textMessage(reply, NOW + 3000) }), 10);
    expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Audit task 10', reply, 'Thanks, next one']);
    await waitFor(() => expect(historyCalls()).toBeGreaterThan(loadsAfterSend));

    // The next run ends without a tool call, so its final is the next history read.
    history.push({ role: 'assistant', content: [{ type: 'text', text: 'On it.' }], timestamp: NOW + 5000, stopReason: 'stop', __openclaw: { id: 'e6', runId: 'run-2', runTerminal: true } });
    const loadsBeforeNextFinal = historyCalls();
    emit('chat', { sessionKey: SESSION, runId: 'run-2', state: 'final', seq: 20, stopReason: 'stop', message: textMessage('On it.', NOW + 5000) }, 11);
    await waitFor(() => expect(historyCalls()).toBeGreaterThan(loadsBeforeNextFinal));
    await waitFor(() => {
      expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Audit task 10', reply, 'Thanks, next one', 'On it.']);
    });
  });

  it('reconciles a late final for a settled run from history instead of appending it', async () => {
    const history = [
      { role: 'user', content: 'Write about clouds', timestamp: NOW },
      textMessage('Clouds form.', NOW + 3000),
      textMessage('Rain falls.', NOW + 6000),
    ];
    const { emit, getChat } = await setup(history);

    await act(async () => {
      await getChat().handleSend('Write about clouds');
    });

    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
    emit('chat', chat({ state: 'delta', seq: 33, deltaText: 'Rain falls.', message: textMessage('Rain falls.', NOW + 6000) }));
    emit('chat', chat({ state: 'final', seq: 75, stopReason: 'stop', message: textMessage('Rain falls.', NOW + 6000) }));

    await waitFor(() => {
      expect(getChat().messages.map((m) => m.rawText)).toEqual(['Write about clouds', 'Rain falls.']);
    });

    // Late delivery of the interim reply for the same, already finalized run.
    emit('chat', chat({ state: 'final', seq: 1, message: textMessage('Clouds form.', NOW + 6100) }));

    await waitFor(() => {
      expect(getChat().messages.map((m) => m.rawText)).toEqual([
        'Write about clouds',
        'Clouds form.',
        'Rain falls.',
      ]);
    });
  });
  describe('speaking a voice reply', () => {
    const spoken = 'Here is the chart.';
    const reply = `${spoken}\n\n[tts:${spoken}]`;
    const lifecycle = (phase: 'start' | 'end', seq: number) => (
      { sessionKey: SESSION, runId: RUN, seq, stream: 'lifecycle', data: { phase } }
    );

    it('speaks the reply when its final arrives before the run ends', async () => {
      const { emit, speakMock } = await setup();

      emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
      emit('agent', lifecycle('start', 2));
      emit('chat', chat({ state: 'delta', seq: 33, deltaText: spoken, message: textMessage(spoken, NOW) }));
      emit('chat', chat({ state: 'final', seq: 75, stopReason: 'stop', message: textMessage(reply, NOW + 3000) }));
      emit('agent', lifecycle('end', 76));

      expect(speakMock).toHaveBeenCalledTimes(1);
      expect(speakMock).toHaveBeenCalledWith(spoken);
    });

    it('stays silent for another run\'s final after the run on screen ended', async () => {
      const { emit, speakMock } = await setup();

      emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
      emit('agent', lifecycle('start', 2));
      emit('agent', lifecycle('end', 74));
      emit('chat', { sessionKey: SESSION, runId: 'run-2', state: 'final', seq: 5, stopReason: 'stop', message: textMessage(reply, NOW + 3000) });

      expect(speakMock).not.toHaveBeenCalled();
    });

    // A 2026.9 gateway sends the run's lifecycle end just before the chat final.
    it('speaks the reply when the run ends just before its final arrives', async () => {
      const { emit, speakMock } = await setup();

      emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
      emit('agent', lifecycle('start', 2));
      emit('chat', chat({ state: 'delta', seq: 33, deltaText: spoken, message: textMessage(spoken, NOW) }));
      emit('agent', lifecycle('end', 74));
      emit('chat', chat({ state: 'final', seq: 75, stopReason: 'stop', message: textMessage(reply, NOW + 3000) }));

      expect(speakMock).toHaveBeenCalledTimes(1);
      expect(speakMock).toHaveBeenCalledWith(spoken);
    });

    // A newer run's own lifecycle end would replace the ended run, so the newer turn
    // here settles through chat frames alone before the ended run's final turns up.
    it('stays silent for the ended run\'s late final once a newer turn has settled', async () => {
      const { emit, speakMock } = await setup();
      const next = 'The next answer.';
      const nextRun = (payload: Record<string, unknown>) => ({ sessionKey: SESSION, runId: 'run-2', ...payload });

      emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
      emit('agent', lifecycle('start', 2));
      emit('chat', chat({ state: 'delta', seq: 33, deltaText: spoken, message: textMessage(spoken, NOW) }));
      emit('agent', lifecycle('end', 74));
      emit('chat', nextRun({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
      emit('chat', nextRun({ state: 'delta', seq: 3, deltaText: next, message: textMessage(next, NOW + 5000) }));
      emit('chat', nextRun({ state: 'final', seq: 5, stopReason: 'stop', message: textMessage(`${next}\n\n[tts:${next}]`, NOW + 6000) }));
      emit('chat', chat({ state: 'final', seq: 75, stopReason: 'stop', message: textMessage(reply, NOW + 3000) }));

      expect(speakMock).toHaveBeenCalledTimes(1);
      expect(speakMock).toHaveBeenCalledWith(next);
    });

    it('stays silent for the ended run\'s late final once a newer turn that began with a delta has settled', async () => {
      const { emit, speakMock } = await setup();
      const next = 'The next answer.';
      const nextRun = (payload: Record<string, unknown>) => ({ sessionKey: SESSION, runId: 'run-2', ...payload });

      emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
      emit('agent', lifecycle('start', 2));
      emit('chat', chat({ state: 'delta', seq: 33, deltaText: spoken, message: textMessage(spoken, NOW) }));
      emit('agent', lifecycle('end', 74));
      emit('chat', nextRun({ state: 'delta', seq: 3, deltaText: next, message: textMessage(next, NOW + 5000) }));
      emit('chat', nextRun({ state: 'final', seq: 5, stopReason: 'stop', message: textMessage(`${next}\n\n[tts:${next}]`, NOW + 6000) }));
      emit('chat', chat({ state: 'final', seq: 75, stopReason: 'stop', message: textMessage(reply, NOW + 3000) }));

      expect(speakMock).toHaveBeenCalledTimes(1);
      expect(speakMock).toHaveBeenCalledWith(next);
    });

    it('stays silent for the ended run\'s late final once a turn sent from Nerve has settled', async () => {
      const { emit, speakMock, getChat, rpcMock } = await setup();
      const next = 'The next answer.';
      const nextRun = (payload: Record<string, unknown>) => ({ sessionKey: SESSION, runId: 'run-2', ...payload });
      const base = rpcMock.getMockImplementation()!;
      rpcMock.mockImplementation(async (method: string) => (
        method === 'chat.send' ? { runId: 'run-2', status: 'started' } : base(method)
      ));

      emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
      emit('agent', lifecycle('start', 2));
      emit('chat', chat({ state: 'delta', seq: 33, deltaText: spoken, message: textMessage(spoken, NOW) }));
      emit('agent', lifecycle('end', 74));
      await act(async () => {
        await getChat().handleSend('And the next one?');
      });
      emit('chat', nextRun({ state: 'delta', seq: 3, deltaText: next, message: textMessage(next, NOW + 5000) }));
      emit('chat', nextRun({ state: 'final', seq: 5, stopReason: 'stop', message: textMessage(`${next}\n\n[tts:${next}]`, NOW + 6000) }));
      emit('chat', chat({ state: 'final', seq: 75, stopReason: 'stop', message: textMessage(reply, NOW + 3000) }));

      expect(speakMock).toHaveBeenCalledTimes(1);
      expect(speakMock).toHaveBeenCalledWith(next);
    });
  });
});
