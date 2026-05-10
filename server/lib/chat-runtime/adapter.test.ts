import { describe, expect, it } from 'vitest';
import { adaptGatewayEvent, adaptHistorySnapshot } from './adapter.js';
import { createEmptyTimeline, reduceRuntimeEvent, timelineItemsInOrder } from './reducer.js';

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

  it('adapts current OpenClaw item-stream tool events', () => {
    expect(adaptGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        stream: 'item',
        data: {
          itemId: 'tool:call-1',
          phase: 'start',
          kind: 'tool',
          title: 'exec pwd (in ~/.openclaw/workspace)',
          status: 'running',
          name: 'exec',
          meta: 'pwd (in ~/.openclaw/workspace)',
          toolCallId: 'call-1',
        },
      },
    })).toEqual([
      {
        type: 'tool_started',
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        toolCallId: 'call-1',
        name: 'exec',
        args: { command: 'pwd (in ~/.openclaw/workspace)' },
        at: expect.any(Number),
      },
    ]);

    expect(adaptGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        stream: 'item',
        data: {
          itemId: 'tool:call-1',
          phase: 'end',
          kind: 'tool',
          title: 'exec pwd (in ~/.openclaw/workspace)',
          status: 'completed',
          name: 'exec',
          meta: 'pwd (in ~/.openclaw/workspace)',
          toolCallId: 'call-1',
        },
      },
    })).toEqual([
      {
        type: 'tool_finished',
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        toolCallId: 'call-1',
        at: expect.any(Number),
      },
    ]);
  });

  it('adapts current OpenClaw command-output completions without command sibling duplication', () => {
    expect(adaptGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        stream: 'item',
        data: {
          itemId: 'command:call-1',
          phase: 'start',
          kind: 'command',
          title: 'command pwd (in ~/.openclaw/workspace)',
          status: 'running',
          name: 'exec',
          toolCallId: 'call-1',
        },
      },
    })).toEqual([]);

    expect(adaptGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        stream: 'command_output',
        data: {
          itemId: 'command:call-1',
          phase: 'end',
          title: 'command pwd (in ~/.openclaw/workspace)',
          toolCallId: 'call-1',
          name: 'exec',
          output: '/Users/cd0x23/.openclaw/workspace',
          status: 'completed',
          exitCode: 0,
        },
      },
    })).toEqual([
      {
        type: 'tool_finished',
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        toolCallId: 'call-1',
        result: '/Users/cd0x23/.openclaw/workspace',
        at: expect.any(Number),
      },
    ]);
  });

  it('adapts current OpenClaw live thinking stream events', () => {
    expect(adaptGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        stream: 'thinking',
        data: {
          text: 'I should inspect the project first.',
          delta: ' first.',
        },
      },
    })).toEqual([
      {
        type: 'thinking_delta',
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        blockIndex: 0,
        text: 'I should inspect the project first.',
        at: expect.any(Number),
      },
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

  it('preserves user image content blocks from history snapshots', () => {
    const events = adaptHistorySnapshot('agent:main:main', [
      {
        role: 'user',
        messageId: 'msg-user-image',
        timestamp: 1000,
        content: [
          { type: 'text', text: 'look at this' },
          { type: 'image', data: 'aW5saW5lLWJhc2U2NA==', mimeType: 'image/png', name: 'inline.png' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'c291cmNlLWJhc2U2NA==', filename: 'source.jpg' } },
          { type: 'image', data: 'aW5s\n aW5lLWJhc2U2NA==', mimeType: 'image/png', name: 'folded.png' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '-_8', filename: 'urlsafe.png' } },
          { type: 'image', data: 'not base64?', mimeType: 'image/gif', name: 'broken.gif' },
        ],
      },
    ] as unknown as Parameters<typeof adaptHistorySnapshot>[1]);

    expect(events.find((event) => event.type === 'user_message_committed')).toMatchObject({
      type: 'user_message_committed',
      text: 'look at this',
      images: [
        {
          mimeType: 'image/png',
          content: 'aW5saW5lLWJhc2U2NA==',
          preview: 'data:image/png;base64,aW5saW5lLWJhc2U2NA==',
          name: 'inline.png',
        },
        {
          mimeType: 'image/jpeg',
          content: 'c291cmNlLWJhc2U2NA==',
          preview: 'data:image/jpeg;base64,c291cmNlLWJhc2U2NA==',
          name: 'source.jpg',
        },
        {
          mimeType: 'image/png',
          content: 'aW5saW5lLWJhc2U2NA==',
          preview: 'data:image/png;base64,aW5saW5lLWJhc2U2NA==',
          name: 'folded.png',
        },
        {
          mimeType: 'image/png',
          content: '+/8=',
          preview: 'data:image/png;base64,+/8=',
          name: 'urlsafe.png',
        },
      ],
    });

    let timeline = createEmptyTimeline('agent:main:main');
    for (const event of events) timeline = reduceRuntimeEvent(timeline, event);

    const userItem = timelineItemsInOrder(timeline).find((item) => item.kind === 'user_message');
    expect(userItem).toMatchObject({
      kind: 'user_message',
      images: [
        { mimeType: 'image/png', content: 'aW5saW5lLWJhc2U2NA==', name: 'inline.png' },
        { mimeType: 'image/jpeg', content: 'c291cmNlLWJhc2U2NA==', name: 'source.jpg' },
        { mimeType: 'image/png', content: 'aW5saW5lLWJhc2U2NA==', name: 'folded.png' },
        { mimeType: 'image/png', content: '+/8=', name: 'urlsafe.png' },
      ],
    });
  });

  it('preserves omitted user image blocks as session media references', () => {
    const events = adaptHistorySnapshot('agent:main:main', [
      {
        role: 'user',
        messageId: 'msg-user-omitted-image',
        timestamp: 1775131617235,
        content: [
          { type: 'text', text: 'look at the omitted image' },
          { type: 'image', omitted: true, mimeType: 'image/png' },
        ],
      },
    ]);

    expect(events.find((event) => event.type === 'user_message_committed')).toMatchObject({
      type: 'user_message_committed',
      text: 'look at the omitted image',
      images: [
        {
          mimeType: 'image/png',
          content: '',
          preview: '/api/sessions/media?sessionKey=agent%3Amain%3Amain&timestamp=1775131617235&imageIndex=0',
          name: 'message-1775131617235-image-0.png',
        },
      ],
    });
  });

  it('does not synthesize omitted user image references without a persisted timestamp', () => {
    const events = adaptHistorySnapshot('agent:main:main', [
      {
        role: 'user',
        messageId: 'msg-user-untimed-image',
        content: [
          { type: 'text', text: 'untimed omitted image' },
          { type: 'image', omitted: true, mimeType: 'image/png' },
        ],
      },
    ]);

    expect(events.find((event) => event.type === 'user_message_committed')).toMatchObject({
      type: 'user_message_committed',
      text: 'untimed omitted image',
    });
    expect(events.find((event) => event.type === 'user_message_committed')).not.toHaveProperty('images');
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
    expect(events.filter((event) => event.type === 'turn_finalized').map((event) => event.runId)).toEqual([
      'history:message:tool-1',
      'run-2',
    ]);
  });

  it('keeps same-run standalone tool history open until every tool result is replayed', () => {
    const events = adaptHistorySnapshot('agent:main:main', [
      {
        role: 'toolResult',
        runId: 'run-1',
        id: 'tool-1',
        timestamp: 1000,
        content: 'first result',
      },
      {
        role: 'toolResult',
        runId: 'run-1',
        id: 'tool-2',
        timestamp: 1001,
        content: 'second result',
      },
    ]);
    let timeline = createEmptyTimeline('agent:main:main');

    for (const event of events) timeline = reduceRuntimeEvent(timeline, event);

    const toolItems = Object.values(timeline.items).filter((item) => item.kind === 'tool_call');
    expect(events.filter((event) => event.type === 'turn_finalized')).toEqual([
      { type: 'turn_finalized', sessionKey: 'agent:main:main', runId: 'run-1', at: 1001 },
    ]);
    expect(toolItems).toMatchObject([
      { toolCallId: 'tool-1', result: 'first result', status: 'complete' },
      { toolCallId: 'tool-2', result: 'second result', status: 'complete' },
    ]);
    expect(timeline.turns).toMatchObject([
      { runId: 'run-1', status: 'finalized' },
    ]);
  });

  it('does not leave standalone tool history turns running after hydration', () => {
    const events = adaptHistorySnapshot('agent:main:main', [
      {
        role: 'tool',
        id: 'tool-orphan',
        timestamp: 1000,
        content: 'orphan result',
      },
    ]);
    let timeline = createEmptyTimeline('agent:main:main');

    for (const event of events) timeline = reduceRuntimeEvent(timeline, event);

    expect(timeline.turns).toEqual([
      expect.objectContaining({
        runId: 'history:message:tool-orphan',
        status: 'finalized',
      }),
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

    const events = adaptHistorySnapshot('agent:main:main', messages);
    expect(events.filter((event) => event.type === 'tool_finished')).toEqual([
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
    expect(events.find((event) => event.type === 'turn_finalized')).toMatchObject({
      runId: 'run-1',
    });
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

  it('replays assistant history text segments around tool groups in content order', () => {
    const events = adaptHistorySnapshot('agent:main:main', [
      {
        role: 'assistant',
        runId: 'run-1',
        timestamp: 1000,
        content: [
          { type: 'text', text: 'assistant A' },
          { type: 'tool_use', id: 'tool-1', name: 'exec', input: { cmd: 'pwd' } },
          { type: 'tool_result', toolCallId: 'tool-1', content: '/tmp/project' },
          { type: 'text', text: 'assistant B' },
          { type: 'tool_use', id: 'tool-2', name: 'read', input: { file: 'package.json' } },
          { type: 'tool_result', toolCallId: 'tool-2', content: 'package contents' },
          { type: 'text', text: 'assistant C' },
        ],
      },
    ]);

    expect(events.map((event) => event.type)).toEqual([
      'history_snapshot',
      'assistant_final',
      'tool_started',
      'tool_finished',
      'assistant_final',
      'tool_started',
      'tool_finished',
      'assistant_final',
      'turn_finalized',
    ]);
    expect(events.filter((event) => event.type === 'assistant_final')).toMatchObject([
      { type: 'assistant_final', text: 'assistant A', segmentIndex: 0 },
      { type: 'assistant_final', text: 'assistant B', segmentIndex: 1 },
      { type: 'assistant_final', text: 'assistant C', segmentIndex: 2 },
    ]);

    let timeline = createEmptyTimeline('agent:main:main');
    for (const event of events) timeline = reduceRuntimeEvent(timeline, event);

    const topLevelOutput = timelineItemsInOrder(timeline)
      .filter((item) => timeline.turns[0].outputItemIds.includes(item.id))
      .map((item) => `${item.kind}:${'text' in item ? item.text : item.id}`);
    expect(topLevelOutput).toEqual([
      'assistant_message:assistant A',
      'tool_group:tool-group:agent:main:main:run-1:0',
      'assistant_message:assistant B',
      'tool_group:tool-group:agent:main:main:run-1:1',
      'assistant_message:assistant C',
    ]);
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

  it('adapts thinking blocks from chat final assistant content before finalizing the turn', () => {
    expect(adaptGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: {
        state: 'final',
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'reasoned through it' },
            { type: 'text', text: 'done' },
          ],
        },
      },
    })).toEqual([
      { type: 'thinking_final', sessionKey: 'agent:main:main', runId: 'run-1', blockIndex: 0, text: 'reasoned through it', at: expect.any(Number) },
      { type: 'assistant_final', sessionKey: 'agent:main:main', runId: 'run-1', segmentIndex: 0, text: 'done', at: expect.any(Number) },
      { type: 'turn_finalized', sessionKey: 'agent:main:main', runId: 'run-1', at: expect.any(Number) },
    ]);
  });

  it('uses the last assistant message when chat final messages include thinking content', () => {
    expect(adaptGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: {
        state: 'final',
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: 'older' }] },
          { role: 'user', content: 'follow-up user text' },
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'latest reasoning' },
              { type: 'text', text: 'latest answer' },
            ],
          },
        ],
      },
    })).toEqual([
      { type: 'thinking_final', sessionKey: 'agent:main:main', runId: 'run-1', blockIndex: 0, text: 'latest reasoning', at: expect.any(Number) },
      { type: 'assistant_final', sessionKey: 'agent:main:main', runId: 'run-1', segmentIndex: 0, text: 'latest answer', at: expect.any(Number) },
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

  it('keeps concrete user-only history runs open for live streaming after hydrate', () => {
    const events = adaptHistorySnapshot('agent:main:main', [
      {
        role: 'user',
        runId: 'run-live',
        messageId: 'msg-live',
        timestamp: 1000,
        content: 'start work',
      },
    ]);

    expect(events.filter((event) => event.type === 'turn_finalized' && event.runId === 'run-live')).toEqual([]);

    let timeline = createEmptyTimeline('agent:main:main');
    for (const event of events) timeline = reduceRuntimeEvent(timeline, event);

    timeline = reduceRuntimeEvent(timeline, {
      type: 'thinking_delta',
      sessionKey: 'agent:main:main',
      runId: 'run-live',
      blockIndex: 0,
      text: 'reasoning live',
      at: 1001,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_delta',
      sessionKey: 'agent:main:main',
      runId: 'run-live',
      text: 'partial answer',
      at: 1002,
    });

    expect(timeline.turns.find((turn) => turn.runId === 'run-live')?.status).toBe('running');
    expect(timelineItemsInOrder(timeline).map((item) => `${item.kind}:${'text' in item ? item.text : ''}`)).toEqual([
      'user_message:start work',
      'thinking:reasoning live',
      'assistant_message:partial answer',
    ]);
  });

  it('finalizes persisted user-only history turns', () => {
    const events = adaptHistorySnapshot('agent:main:main', [
      {
        role: 'user',
        messageId: 'msg-1',
        timestamp: 1000,
        content: 'hello',
      },
      {
        role: 'assistant',
        messageId: 'answer-1',
        timestamp: 1001,
        content: 'answer',
      },
    ]);

    expect(events).toContainEqual({
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      runId: 'history:user:msg-1',
      messageId: 'msg-1',
      text: 'hello',
      at: 1000,
    });
    expect(events.filter((event) => event.type === 'turn_finalized').map((event) => event.runId)).toEqual([
      'history:message:answer-1',
      'history:user:msg-1',
    ]);
  });

  it('skips invalid agent payloads', () => {
    expect(adaptGatewayEvent({ type: 'event', event: 'agent', payload: { stream: 'tool' } })).toEqual([]);
    expect(adaptGatewayEvent({ type: 'event', event: 'agent' })).toEqual([]);
  });
});
