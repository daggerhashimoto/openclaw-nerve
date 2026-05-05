import { describe, expect, it } from 'vitest';
import { adaptGatewayEvent, adaptHistorySnapshot } from './adapter.js';

describe('OpenClaw chat runtime adapter', () => {
  it('adapts chat started and delta events', () => {
    expect(adaptGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: { state: 'started', sessionKey: 'agent:main:main', runId: 'run-1' },
      seq: 3,
    })).toEqual([
      { type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-1', at: expect.any(Number), seq: 3 },
    ]);

    expect(adaptGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: {
        state: 'delta',
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      },
      seq: 4,
    })).toEqual([
      { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'hello', at: expect.any(Number), seq: 4 },
    ]);
  });

  it('adapts agent tool events', () => {
    expect(adaptGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        stream: 'tool',
        data: { phase: 'start', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' } },
      },
    })).toEqual([
      { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: expect.any(Number) },
    ]);
  });

  it('adapts assistant history content blocks into ordered runtime events', () => {
    const events = adaptHistorySnapshot('agent:main:main', [
      {
        role: 'assistant',
        runId: 'run-1',
        timestamp: 1000,
        content: [
          { type: 'thinking', thinking: 'thought' },
          { type: 'tool_use', id: 'tool-1', name: 'exec', input: { cmd: 'pwd' } },
          { type: 'text', text: 'answer' },
        ],
      },
    ]);

    expect(events.map((event) => event.type)).toEqual([
      'history_snapshot',
      'thinking_final',
      'tool_started',
      'assistant_final',
      'turn_finalized',
    ]);
  });

  it('uses thinking-block ordinals for mixed assistant history content', () => {
    const events = adaptHistorySnapshot('agent:main:main', [
      {
        role: 'assistant',
        runId: 'run-1',
        timestamp: 1000,
        content: [
          { type: 'text', text: 'before' },
          { type: 'thinking', thinking: 'first thought' },
          { type: 'tool_use', id: 'tool-1', name: 'exec', input: { cmd: 'pwd' } },
          { type: 'thinking', thinking: 'second thought' },
          { type: 'text', text: 'after' },
        ],
      },
    ]);

    expect(events
      .filter((event) => event.type === 'thinking_final')
      .map((event) => event.blockIndex)).toEqual([0, 1]);
  });

  it('uses deterministic fallback run ids for assistant history without runId', () => {
    const events = adaptHistorySnapshot('agent:main:main', [
      {
        role: 'assistant',
        messageId: 'msg-assistant',
        timestamp: 1000,
        content: 'legacy answer',
      },
      {
        role: 'assistant',
        timestamp: 1000,
        content: 'same timestamp one',
      },
      {
        role: 'assistant',
        timestamp: 1000,
        content: 'same timestamp two',
      },
    ]);

    expect(events.filter((event) => event.type === 'assistant_final')).toMatchObject([
      { type: 'assistant_final', runId: 'history:message:msg-assistant', text: 'legacy answer' },
      { type: 'assistant_final', runId: 'history:time:1000:index:1', text: 'same timestamp one' },
      { type: 'assistant_final', runId: 'history:time:1000:index:2', text: 'same timestamp two' },
    ]);
    expect(events.filter((event) => event.type === 'turn_finalized').map((event) => event.runId)).toEqual([
      'history:message:msg-assistant',
      'history:time:1000:index:1',
      'history:time:1000:index:2',
    ]);
  });

  it('uses nested OpenClaw metadata for history message identity', () => {
    const messages = [
      {
        role: 'user',
        runId: 'run-1',
        timestamp: 1000,
        content: 'hello',
        __openclaw: { id: 'msg-1', seq: 7 },
      },
      {
        role: 'assistant',
        timestamp: 1001,
        content: 'answer',
        __openclaw: { id: 'assistant-1', seq: 8 },
      },
    ] as unknown as Parameters<typeof adaptHistorySnapshot>[1];

    const events = adaptHistorySnapshot('agent:main:main', messages);

    expect(events.find((event) => event.type === 'user_message_committed')).toMatchObject({
      type: 'user_message_committed',
      messageId: 'msg-1',
    });
    expect(events.find((event) => event.type === 'assistant_final')).toMatchObject({
      type: 'assistant_final',
      runId: 'history:message:assistant-1',
      text: 'answer',
    });
  });

  it('prefers top-level history ids over nested OpenClaw metadata', () => {
    const messages = [
      {
        role: 'user',
        runId: 'run-1',
        messageId: 'top-msg-1',
        timestamp: 1000,
        content: 'hello',
        __openclaw: { id: 'nested-msg-1', seq: 7 },
      },
      {
        role: 'assistant',
        id: 'top-assistant-1',
        timestamp: 1001,
        content: 'answer',
        __openclaw: { id: 'nested-assistant-1', seq: 8 },
      },
    ] as unknown as Parameters<typeof adaptHistorySnapshot>[1];

    const events = adaptHistorySnapshot('agent:main:main', messages);

    expect(events.find((event) => event.type === 'user_message_committed')).toMatchObject({
      type: 'user_message_committed',
      messageId: 'top-msg-1',
    });
    expect(events.find((event) => event.type === 'assistant_final')).toMatchObject({
      type: 'assistant_final',
      runId: 'history:message:top-assistant-1',
      text: 'answer',
    });
  });

  it('replays tool_result content blocks as finished tool calls', () => {
    const events = adaptHistorySnapshot('agent:main:main', [
      {
        role: 'assistant',
        runId: 'run-1',
        timestamp: 1000,
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'exec', input: { cmd: 'pwd' } },
          { type: 'tool_result', toolCallId: 'tool-1', content: 'ok' },
          { type: 'text', text: 'done' },
        ],
      },
    ]);

    expect(events.filter((event) => event.type === 'tool_started' || event.type === 'tool_finished')).toEqual([
      { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: 1000 },
      { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', result: 'ok', at: 1000 },
    ]);
  });

  it('marks errored tool_result content blocks as failed tool calls', () => {
    const messages = [
      {
        role: 'assistant',
        runId: 'run-1',
        timestamp: 1000,
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'exec', input: { cmd: 'pwd' } },
          { type: 'tool_result', toolCallId: 'tool-1', result: 'bad', isError: true },
          { type: 'text', text: 'failed' },
        ],
      },
    ] as unknown as Parameters<typeof adaptHistorySnapshot>[1];

    expect(adaptHistorySnapshot('agent:main:main', messages).find((event) => event.type === 'tool_finished')).toMatchObject({
      type: 'tool_finished',
      toolCallId: 'tool-1',
      result: 'bad',
      error: expect.any(String),
    });
  });

  it('replays standalone tool history messages as finished tool calls', () => {
    const events = adaptHistorySnapshot('agent:main:main', [
      {
        role: 'tool',
        id: 'tool-1',
        timestamp: 1000,
        content: 'ok',
      },
      {
        role: 'toolResult',
        runId: 'run-2',
        id: 'tool-2',
        timestamp: 1001,
        content: [{ type: 'text', text: 'done' }],
      },
    ]);

    expect(events.filter((event) => event.type === 'tool_finished')).toEqual([
      { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'history:message:tool-1', toolCallId: 'tool-1', result: 'ok', at: 1000 },
      { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-2', toolCallId: 'tool-2', result: 'done', at: 1001 },
    ]);
  });

  it('marks errored standalone tool history messages as failed tool calls', () => {
    const messages = [
      {
        role: 'toolResult',
        runId: 'run-1',
        id: 'tool-1',
        timestamp: 1000,
        content: 'bad',
        isError: true,
      },
    ] as unknown as Parameters<typeof adaptHistorySnapshot>[1];

    expect(adaptHistorySnapshot('agent:main:main', messages).filter((event) => event.type === 'tool_finished')).toEqual([
      {
        type: 'tool_finished',
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        toolCallId: 'tool-1',
        result: 'bad',
        error: expect.any(String),
        at: 1000,
      },
    ]);
  });

  it('uses the last assistant message for mixed-role chat finals', () => {
    expect(adaptGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: {
        state: 'final',
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        messages: [
          { role: 'assistant', content: 'assistant answer' },
          { role: 'user', content: 'follow-up user text' },
        ],
      },
    })).toEqual([
      { type: 'assistant_final', sessionKey: 'agent:main:main', runId: 'run-1', text: 'assistant answer', at: expect.any(Number) },
      { type: 'turn_finalized', sessionKey: 'agent:main:main', runId: 'run-1', at: expect.any(Number) },
    ]);
  });

  it('uses post-tool assistant text as the history final answer', () => {
    const events = adaptHistorySnapshot('agent:main:main', [
      {
        role: 'assistant',
        runId: 'run-1',
        timestamp: 1000,
        content: [
          { type: 'text', text: 'I will check.' },
          { type: 'tool_use', id: 'tool-1', name: 'exec', input: { cmd: 'pwd' } },
          { type: 'tool_result', toolCallId: 'tool-1', content: '/tmp/project' },
          { type: 'text', text: 'The project is in /tmp/project.' },
        ],
      },
    ]);

    expect(events.map((event) => event.type)).toEqual([
      'history_snapshot',
      'tool_started',
      'tool_finished',
      'assistant_final',
      'turn_finalized',
    ]);
    expect(events.find((event) => event.type === 'assistant_final')).toMatchObject({
      type: 'assistant_final',
      text: 'The project is in /tmp/project.',
    });
  });

  it('skips invalid gateway payloads', () => {
    expect(adaptGatewayEvent({ type: 'event', event: 'chat', payload: { state: 'delta' } })).toEqual([]);
  });

  it('adapts chat final text before finalizing the turn', () => {
    expect(adaptGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: {
        state: 'final',
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        message: { role: 'assistant', content: 'done' },
      },
      seq: 5,
    })).toEqual([
      { type: 'assistant_final', sessionKey: 'agent:main:main', runId: 'run-1', text: 'done', at: expect.any(Number) },
      { type: 'turn_finalized', sessionKey: 'agent:main:main', runId: 'run-1', at: expect.any(Number) },
    ]);
  });

  it('maps chat aborted and error states to failed turns', () => {
    expect(adaptGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: { state: 'aborted', sessionKey: 'agent:main:main', runId: 'run-1' },
    })).toEqual([
      { type: 'turn_failed', sessionKey: 'agent:main:main', runId: 'run-1', error: 'aborted', at: expect.any(Number) },
    ]);

    expect(adaptGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: { state: 'error', sessionKey: 'agent:main:main', runId: 'run-1', error: { message: 'boom' } },
    })).toEqual([
      { type: 'turn_failed', sessionKey: 'agent:main:main', runId: 'run-1', error: 'boom', at: expect.any(Number) },
    ]);
  });

  it('adapts agent tool result events', () => {
    expect(adaptGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        stream: 'tool',
        data: { phase: 'result', toolCallId: 'tool-1', result: 'ok', error: 'stderr' },
      },
    })).toEqual([
      { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', result: 'ok', error: 'stderr', at: expect.any(Number) },
    ]);
  });

  it('marks live tool results with isError as failed tool calls', () => {
    expect(adaptGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        stream: 'tool',
        data: { phase: 'result', toolCallId: 'tool-1', result: 'bad', isError: true },
      },
    })).toEqual([
      {
        type: 'tool_finished',
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        toolCallId: 'tool-1',
        result: 'bad',
        error: expect.any(String),
        at: expect.any(Number),
      },
    ]);
  });

  it('adapts user history with message id', () => {
    expect(adaptHistorySnapshot('agent:main:main', [
      {
        role: 'user',
        runId: 'run-1',
        messageId: 'msg-1',
        timestamp: 1000,
        content: 'hello',
      },
    ])).toEqual([
      { type: 'history_snapshot', sessionKey: 'agent:main:main', messages: expect.any(Array), at: expect.any(Number) },
      { type: 'user_message_committed', sessionKey: 'agent:main:main', runId: 'run-1', messageId: 'msg-1', text: 'hello', at: 1000 },
    ]);
  });

  it('skips invalid agent payloads', () => {
    expect(adaptGatewayEvent({ type: 'event', event: 'agent', payload: { stream: 'tool' } })).toEqual([]);
    expect(adaptGatewayEvent({ type: 'event', event: 'agent' })).toEqual([]);
  });
});
