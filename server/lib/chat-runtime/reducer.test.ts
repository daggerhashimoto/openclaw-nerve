import { describe, expect, it } from 'vitest';
import { buildPatchFromTimeline, createEmptyTimeline, reduceRuntimeEvent, timelineItemsInOrder } from './reducer.js';

describe('chat runtime reducer', () => {
  it('updates the same assistant item for streaming and final text', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-1', at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'hel', at: 1001 });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'hello', at: 1002 });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_final', sessionKey: 'agent:main:main', runId: 'run-1', text: 'hello world', at: 1003 });

    const assistantItems = Object.values(timeline.items).filter((item) => item.kind === 'assistant_message');
    expect(assistantItems).toHaveLength(1);
    expect(assistantItems[0]).toMatchObject({
      id: 'assistant:agent:main:main:run-1:answer',
      text: 'hello world',
      status: 'complete',
      source: 'history',
    });
  });

  it('does not regress a finalized assistant item when a stale delta arrives', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_final', sessionKey: 'agent:main:main', runId: 'run-1', text: 'final answer', at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'stale partial', at: 1001 });

    const assistantItems = Object.values(timeline.items).filter((item) => item.kind === 'assistant_message');
    expect(assistantItems).toHaveLength(1);
    expect(assistantItems[0]).toMatchObject({
      text: 'final answer',
      finalText: 'final answer',
      status: 'complete',
      source: 'history',
      isStreaming: false,
    });
  });

  it('does not regress live assistant text when an older delta arrives', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'hello', seq: 2, at: 1002 });
    const updatedAt = timeline.items['assistant:agent:main:main:run-1:answer'].updatedAt;
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'hel', seq: 1, at: 1003 });

    let assistantItem = timeline.items['assistant:agent:main:main:run-1:answer'];
    expect(assistantItem).toMatchObject({
      kind: 'assistant_message',
      text: 'hello',
      seq: 2,
      status: 'running',
      source: 'live',
      isStreaming: true,
      updatedAt,
    });

    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_final', sessionKey: 'agent:main:main', runId: 'run-1', text: 'final answer', at: 1001 });
    assistantItem = timeline.items['assistant:agent:main:main:run-1:answer'];
    expect(assistantItem).toMatchObject({
      kind: 'assistant_message',
      text: 'final answer',
      finalText: 'final answer',
      status: 'complete',
      source: 'history',
      isStreaming: false,
    });
  });

  it('applies duplicate final events idempotently', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    const finalEvent = { type: 'assistant_final' as const, sessionKey: 'agent:main:main', runId: 'run-1', text: 'final answer', at: 1000 };
    timeline = reduceRuntimeEvent(timeline, finalEvent);
    timeline = reduceRuntimeEvent(timeline, finalEvent);

    const assistantItems = Object.values(timeline.items).filter((item) => item.kind === 'assistant_message');
    expect(assistantItems).toHaveLength(1);
    expect(assistantItems[0].text).toBe('final answer');
  });

  it('reuses the default assistant item when matching history segment 0 replays after live final', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-1', at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'final', at: 1001 });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_final', sessionKey: 'agent:main:main', runId: 'run-1', text: 'final answer', at: 1002 });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      segmentIndex: 0,
      text: 'final answer',
      at: 1003,
    });

    const defaultAssistantId = 'assistant:agent:main:main:run-1:answer';
    const segmentAssistantId = 'assistant:agent:main:main:run-1:segment:0';
    const assistantItems = Object.values(timeline.items).filter((item) => item.kind === 'assistant_message');

    expect(assistantItems).toHaveLength(1);
    expect(timeline.items[defaultAssistantId]).toMatchObject({
      kind: 'assistant_message',
      text: 'final answer',
      finalText: 'final answer',
      status: 'complete',
      isStreaming: false,
      updatedAt: 1003,
    });
    expect(timeline.items[segmentAssistantId]).toBeUndefined();
    expect(timeline.turns[0].outputItemIds).toEqual([defaultAssistantId]);
  });

  it('removes a superseded default assistant item when non-matching segmented history starts', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-1', at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_final', sessionKey: 'agent:main:main', runId: 'run-1', text: 'live default final', at: 1001 });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      segmentIndex: 0,
      text: 'history segment 0',
      at: 1002,
    });

    const defaultAssistantId = 'assistant:agent:main:main:run-1:answer';
    const segment0AssistantId = 'assistant:agent:main:main:run-1:segment:0';
    const assistantItems = Object.values(timeline.items).filter((item) => item.kind === 'assistant_message');
    const assistantPatchItems = buildPatchFromTimeline(timeline)
      .filter((op) => op.op === 'upsert_item' && op.item.kind === 'assistant_message')
      .map((op) => op.item);

    expect(assistantItems).toHaveLength(1);
    expect(timeline.items[defaultAssistantId]).toBeUndefined();
    expect(timeline.items[segment0AssistantId]).toMatchObject({
      kind: 'assistant_message',
      text: 'history segment 0',
      segmentIndex: 0,
      status: 'complete',
    });
    expect(timeline.turns[0].outputItemIds).toEqual([segment0AssistantId]);
    expect(assistantPatchItems).toHaveLength(1);
    expect(assistantPatchItems[0].id).toBe(segment0AssistantId);
  });

  it('does not emit an orphan default assistant item when segmented history replaces live final output', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-1', at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_final', sessionKey: 'agent:main:main', runId: 'run-1', text: 'assistant C', at: 1001 });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      segmentIndex: 0,
      text: 'assistant A',
      at: 1002,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'tool_started',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      toolCallId: 'tool-1',
      name: 'exec',
      args: { cmd: 'pwd' },
      at: 1003,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'tool_finished',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      toolCallId: 'tool-1',
      result: 'ok',
      at: 1004,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      segmentIndex: 1,
      text: 'assistant B',
      at: 1005,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'tool_started',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      toolCallId: 'tool-2',
      name: 'read',
      args: { file: 'x' },
      at: 1006,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'tool_finished',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      toolCallId: 'tool-2',
      result: 'done',
      at: 1007,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      segmentIndex: 2,
      text: 'assistant C',
      at: 1008,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      text: 'assistant C',
      at: 1009,
    });

    const defaultAssistantId = 'assistant:agent:main:main:run-1:answer';
    const segment2AssistantId = 'assistant:agent:main:main:run-1:segment:2';
    const assistantItems = Object.values(timeline.items).filter((item) => item.kind === 'assistant_message');
    const assistantCItems = assistantItems.filter((item) => item.text === 'assistant C');
    const assistantPatchItems = buildPatchFromTimeline(timeline)
      .filter((op) => op.op === 'upsert_item' && op.item.kind === 'assistant_message')
      .map((op) => op.item);
    const orderedTopLevel = timelineItemsInOrder(timeline)
      .filter((item) => timeline.turns[0].outputItemIds.includes(item.id))
      .map((item) => `${item.kind}:${'text' in item ? item.text : item.id}`);

    expect(assistantItems).toHaveLength(3);
    expect(assistantCItems).toHaveLength(1);
    expect(timeline.items[defaultAssistantId]).toBeUndefined();
    expect(timeline.items[segment2AssistantId]).toMatchObject({
      kind: 'assistant_message',
      text: 'assistant C',
      finalText: 'assistant C',
      status: 'complete',
      segmentIndex: 2,
      updatedAt: 1009,
    });
    expect(assistantPatchItems).toHaveLength(3);
    expect(assistantPatchItems.map((item) => item.id)).toEqual([
      'assistant:agent:main:main:run-1:segment:0',
      'assistant:agent:main:main:run-1:segment:1',
      segment2AssistantId,
    ]);
    expect(orderedTopLevel).toEqual([
      'assistant_message:assistant A',
      'tool_group:tool-group:agent:main:main:run-1:0',
      'assistant_message:assistant B',
      'tool_group:tool-group:agent:main:main:run-1:1',
      'assistant_message:assistant C',
    ]);
    expect(timeline.turns[0].outputItemIds).toEqual([
      'assistant:agent:main:main:run-1:segment:0',
      'tool-group:agent:main:main:run-1:0',
      'assistant:agent:main:main:run-1:segment:1',
      'tool-group:agent:main:main:run-1:1',
      segment2AssistantId,
    ]);
  });

  it('ignores non-matching unsegmented assistant final after segmented history exists', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      segmentIndex: 0,
      text: 'assistant A',
      at: 1000,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      segmentIndex: 1,
      text: 'assistant B',
      at: 1001,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      text: 'stale live final',
      at: 1002,
    });

    const defaultAssistantId = 'assistant:agent:main:main:run-1:answer';
    const assistantItems = Object.values(timeline.items).filter((item) => item.kind === 'assistant_message');
    const assistantPatchItems = buildPatchFromTimeline(timeline)
      .filter((op) => op.op === 'upsert_item' && op.item.kind === 'assistant_message')
      .map((op) => op.item);

    expect(timeline.items[defaultAssistantId]).toBeUndefined();
    expect(assistantItems.map((item) => item.text)).toEqual(['assistant A', 'assistant B']);
    expect(timeline.turns[0].outputItemIds).toEqual([
      'assistant:agent:main:main:run-1:segment:0',
      'assistant:agent:main:main:run-1:segment:1',
    ]);
    expect(assistantPatchItems.map((item) => item.id)).toEqual([
      'assistant:agent:main:main:run-1:segment:0',
      'assistant:agent:main:main:run-1:segment:1',
    ]);
  });

  it('preserves multiple assistant history segments around completed tool groups', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      segmentIndex: 0,
      text: 'assistant A',
      at: 1000,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'tool_started',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      toolCallId: 'tool-1',
      name: 'exec',
      args: { cmd: 'pwd' },
      at: 1001,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'tool_finished',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      toolCallId: 'tool-1',
      result: 'ok',
      at: 1002,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      segmentIndex: 1,
      text: 'assistant B',
      at: 1003,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'tool_started',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      toolCallId: 'tool-2',
      name: 'read',
      args: { file: 'x' },
      at: 1004,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'tool_finished',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      toolCallId: 'tool-2',
      result: 'done',
      at: 1005,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      segmentIndex: 2,
      text: 'assistant C',
      at: 1006,
    });

    const orderedTopLevel = timelineItemsInOrder(timeline)
      .filter((item) => timeline.turns[0].outputItemIds.includes(item.id))
      .map((item) => `${item.kind}:${'text' in item ? item.text : item.id}`);

    expect(Object.values(timeline.items).filter((item) => item.kind === 'assistant_message')).toHaveLength(3);
    expect(orderedTopLevel).toEqual([
      'assistant_message:assistant A',
      'tool_group:tool-group:agent:main:main:run-1:0',
      'assistant_message:assistant B',
      'tool_group:tool-group:agent:main:main:run-1:1',
      'assistant_message:assistant C',
    ]);
  });

  it('preserves a live tool result when a later terminal event has no result payload', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, {
      type: 'tool_started',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      toolCallId: 'tool-1',
      name: 'exec',
      args: { command: 'pwd' },
      at: 1000,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'tool_finished',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      toolCallId: 'tool-1',
      result: '/Users/cd0x23/.openclaw/workspace',
      at: 1001,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'tool_finished',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      toolCallId: 'tool-1',
      at: 1002,
    });

    expect(timeline.items['tool:agent:main:main:run-1:tool-1']).toMatchObject({
      kind: 'tool_call',
      result: '/Users/cd0x23/.openclaw/workspace',
      status: 'complete',
    });
  });

  it('orders assistant history segments around tool groups and thinking while keeping duplicate segments stable', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      segmentIndex: 0,
      text: 'assistant A',
      at: 1000,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'tool_started',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      toolCallId: 'tool-1',
      name: 'exec',
      args: { cmd: 'pwd' },
      at: 1001,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      segmentIndex: 1,
      text: 'assistant B',
      at: 1002,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'tool_finished',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      toolCallId: 'tool-1',
      result: 'ok',
      at: 1003,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'thinking_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      blockIndex: 0,
      text: 'thinking',
      at: 1004,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'tool_started',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      toolCallId: 'tool-2',
      name: 'read',
      args: { file: 'x' },
      at: 1005,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'tool_finished',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      toolCallId: 'tool-2',
      result: 'done',
      at: 1006,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      segmentIndex: 2,
      text: 'assistant C',
      at: 1007,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      segmentIndex: 1,
      text: 'assistant B',
      at: 1008,
    });

    const segment0Id = 'assistant:agent:main:main:run-1:segment:0';
    const segment1Id = 'assistant:agent:main:main:run-1:segment:1';
    const segment2Id = 'assistant:agent:main:main:run-1:segment:2';
    const group0Id = 'tool-group:agent:main:main:run-1:0';
    const group1Id = 'tool-group:agent:main:main:run-1:1';
    const thinkingId = 'thinking:agent:main:main:run-1:0';
    const assistantItems = Object.values(timeline.items).filter((item) => item.kind === 'assistant_message');
    const topLevelOutputIds = timelineItemsInOrder(timeline)
      .filter((item) => timeline.turns[0].outputItemIds.includes(item.id))
      .map((item) => item.id);

    expect(assistantItems).toHaveLength(3);
    expect(timeline.items[segment1Id]).toMatchObject({
      kind: 'assistant_message',
      text: 'assistant B',
      status: 'complete',
      updatedAt: 1008,
    });
    expect(timeline.items[group0Id]).toMatchObject({
      kind: 'tool_group',
      closed: true,
      status: 'complete',
      childItemIds: ['tool:agent:main:main:run-1:tool-1'],
    });
    expect(topLevelOutputIds).toEqual([
      segment0Id,
      group0Id,
      segment1Id,
      thinkingId,
      group1Id,
      segment2Id,
    ]);
    expect(timeline.turns[0].outputItemIds).toEqual(topLevelOutputIds);
  });

  it('keeps old finalized assistant items while a new turn runs', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_final', sessionKey: 'agent:main:main', runId: 'run-old', text: 'old answer', at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_finalized', sessionKey: 'agent:main:main', runId: 'run-old', at: 1001 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-new', at: 2000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-new', text: 'new partial', at: 2001 });

    const texts = Object.values(timeline.items)
      .filter((item) => item.kind === 'assistant_message')
      .map((item) => item.text);
    expect(texts).toEqual(['old answer', 'new partial']);
  });

  it('does not reopen a finalized turn when a stale start arrives', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-1', at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_finalized', sessionKey: 'agent:main:main', runId: 'run-1', at: 1001 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-1', at: 1002 });

    expect(timeline.turns).toHaveLength(1);
    expect(timeline.turns[0]).toMatchObject({ status: 'finalized', finalizedAt: 1001 });
  });

  it('reconciles a persisted user message echo with its optimistic item', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, {
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      idempotencyKey: 'ik-1',
      text: 'hello',
      at: 1000,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      messageId: 'msg-1',
      idempotencyKey: 'ik-1',
      text: 'hello',
      at: 1001,
    });

    const userItems = Object.values(timeline.items).filter((item) => item.kind === 'user_message');
    expect(userItems).toHaveLength(1);
    expect(userItems[0]).toMatchObject({
      id: 'user:agent:main:main:ik-1',
      text: 'hello',
      messageId: 'msg-1',
      idempotencyKey: 'ik-1',
      pending: false,
      status: 'complete',
      source: 'history',
    });
    expect(timeline.items['user:agent:main:main:msg-1']).toBeUndefined();
    expect(timeline.turns[0].inputItemIds).toEqual(['user:agent:main:main:ik-1']);
  });

  it('reconciles an optimistic user message without a run id into the persisted turn', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, {
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      idempotencyKey: 'ik-1',
      text: 'hello',
      at: 1000,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      messageId: 'msg-1',
      idempotencyKey: 'ik-1',
      text: 'hello',
      at: 1001,
    });

    const userItems = Object.values(timeline.items).filter((item) => item.kind === 'user_message');
    expect(userItems).toHaveLength(1);
    expect(userItems[0]).toMatchObject({
      id: 'user:agent:main:main:ik-1',
      text: 'hello',
      messageId: 'msg-1',
      idempotencyKey: 'ik-1',
      pending: false,
      status: 'complete',
      source: 'history',
      runId: 'run-1',
    });
    expect(timeline.items['user:agent:main:main:msg-1']).toBeUndefined();
    expect(timeline.turns).toHaveLength(1);
    expect(timeline.turns[0]).toMatchObject({ runId: 'run-1' });
    expect(userItems[0].turnId).toBe(timeline.turns[0].id);
    expect(timeline.turns[0].inputItemIds).toEqual(['user:agent:main:main:ik-1']);
    expect(timeline.turns.some((turn) => turn.runId.startsWith('optimistic:'))).toBe(false);
  });

  it('preserves turn ordering after reconciling an optimistic user message without a run id', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, {
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      idempotencyKey: 'ik-1',
      text: 'user 1',
      at: 1000,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      messageId: 'msg-1',
      idempotencyKey: 'ik-1',
      text: 'user 1',
      at: 1001,
    });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_final', sessionKey: 'agent:main:main', runId: 'run-1', text: 'assistant 1', at: 1002 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-2', at: 1003 });
    timeline = reduceRuntimeEvent(timeline, { type: 'user_message_committed', sessionKey: 'agent:main:main', runId: 'run-2', messageId: 'msg-2', text: 'user 2', at: 1004 });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_final', sessionKey: 'agent:main:main', runId: 'run-2', text: 'assistant 2', at: 1005 });

    expect(timelineItemsInOrder(timeline).map((item) => `${item.kind}:${'text' in item ? item.text : ''}`)).toEqual([
      'user_message:user 1',
      'assistant_message:assistant 1',
      'user_message:user 2',
      'assistant_message:assistant 2',
    ]);

    const turnOrderIndexes = timeline.turns.map((turn) => turn.orderBase.turn);
    expect(new Set(turnOrderIndexes).size).toBe(turnOrderIndexes.length);
  });

  it('updates optimistic patch entities in place during no-runId reconciliation', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, {
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      idempotencyKey: 'ik-1',
      text: 'hello',
      at: 1000,
    });
    const optimisticTurnId = timeline.turns[0].id;
    const optimisticUserItemId = timeline.turns[0].inputItemIds[0];

    timeline = reduceRuntimeEvent(timeline, {
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      messageId: 'msg-1',
      idempotencyKey: 'ik-1',
      text: 'hello',
      at: 1001,
    });

    const patch = buildPatchFromTimeline(timeline);
    const turnOps = patch.filter((op) => op.op === 'upsert_turn');
    const itemOps = patch.filter((op) => op.op === 'upsert_item');
    const userItemOps = itemOps.filter((op) => op.item.kind === 'user_message');

    expect(turnOps).toHaveLength(1);
    expect(turnOps[0].turn).toMatchObject({ id: optimisticTurnId, runId: 'run-1' });
    expect(turnOps.some((op) => op.turn.runId.startsWith('optimistic:'))).toBe(false);
    expect(userItemOps).toHaveLength(1);
    expect(userItemOps[0].item).toMatchObject({
      id: optimisticUserItemId,
      messageId: 'msg-1',
      idempotencyKey: 'ik-1',
      status: 'complete',
      source: 'history',
    });
    expect(itemOps.some((op) => op.item.id === 'user:agent:main:main:msg-1')).toBe(false);
  });

  it('rebinds a no-runId optimistic turn when live chat starts', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, {
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      idempotencyKey: 'ik-1',
      text: 'hello',
      at: 1000,
    });
    const optimisticTurnId = timeline.turns[0].id;
    const optimisticUserItemId = timeline.turns[0].inputItemIds[0];

    timeline = reduceRuntimeEvent(timeline, {
      type: 'turn_started',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      at: 1001,
    });
    timeline = reduceRuntimeEvent(timeline, {
      type: 'assistant_delta',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      text: 'partial',
      at: 1002,
    });

    const userItems = Object.values(timeline.items).filter((item) => item.kind === 'user_message');
    const assistantItems = Object.values(timeline.items).filter((item) => item.kind === 'assistant_message');

    expect(timeline.turns).toHaveLength(1);
    expect(timeline.turns[0]).toMatchObject({
      id: optimisticTurnId,
      runId: 'run-1',
      status: 'running',
      inputItemIds: [optimisticUserItemId],
      outputItemIds: ['assistant:agent:main:main:run-1:answer'],
    });
    expect(userItems).toHaveLength(1);
    expect(userItems[0]).toMatchObject({
      id: optimisticUserItemId,
      turnId: optimisticTurnId,
      runId: 'run-1',
      idempotencyKey: 'ik-1',
      pending: true,
      status: 'provisional',
      source: 'optimistic',
    });
    expect(assistantItems).toHaveLength(1);
    expect(assistantItems[0]).toMatchObject({
      id: 'assistant:agent:main:main:run-1:answer',
      turnId: optimisticTurnId,
      runId: 'run-1',
      text: 'partial',
    });
    expect(timeline.turns.some((turn) => turn.runId.startsWith('optimistic:'))).toBe(false);
    expect(timelineItemsInOrder(timeline).map((item) => `${item.kind}:${'text' in item ? item.text : ''}`)).toEqual([
      'user_message:hello',
      'assistant_message:partial',
    ]);
  });

  it('does not downgrade a reconciled user item when a stale optimistic retry arrives', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    const optimisticEvent = {
      type: 'user_message_committed' as const,
      sessionKey: 'agent:main:main',
      idempotencyKey: 'ik-1',
      text: 'hello',
      at: 1000,
    };
    timeline = reduceRuntimeEvent(timeline, optimisticEvent);
    const optimisticTurnId = timeline.turns[0].id;
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'partial', at: 1001 });
    const realTurnId = timeline.turns.find((turn) => turn.runId === 'run-1')?.id;
    timeline = reduceRuntimeEvent(timeline, {
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      messageId: 'msg-1',
      idempotencyKey: 'ik-1',
      text: 'hello',
      at: 1002,
    });
    timeline = reduceRuntimeEvent(timeline, optimisticEvent);

    const userItemId = 'user:agent:main:main:ik-1';
    const userItems = Object.values(timeline.items).filter((item) => item.kind === 'user_message');
    const realTurn = timeline.turns.find((turn) => turn.id === realTurnId);
    const optimisticTurn = timeline.turns.find((turn) => turn.id === optimisticTurnId);
    const turnsReferencingUser = timeline.turns.filter((turn) => turn.inputItemIds.includes(userItemId));

    expect(userItems).toHaveLength(1);
    expect(userItems[0]).toMatchObject({
      id: userItemId,
      text: 'hello',
      messageId: 'msg-1',
      idempotencyKey: 'ik-1',
      pending: false,
      status: 'complete',
      source: 'history',
      turnId: realTurnId,
      runId: 'run-1',
    });
    expect(realTurn).toMatchObject({ status: 'running', inputItemIds: [userItemId] });
    expect(optimisticTurn).toMatchObject({ status: 'aborted', inputItemIds: [] });
    expect(turnsReferencingUser).toHaveLength(1);
  });

  it('merges no-runId optimistic input into an existing real run turn', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, {
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      idempotencyKey: 'ik-1',
      text: 'user 1',
      at: 1000,
    });
    const optimisticTurnId = timeline.turns[0].id;
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'partial', at: 1001 });
    const realTurnId = timeline.turns.find((turn) => turn.runId === 'run-1')?.id;
    timeline = reduceRuntimeEvent(timeline, {
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      messageId: 'msg-1',
      idempotencyKey: 'ik-1',
      text: 'user 1',
      at: 1002,
    });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_final', sessionKey: 'agent:main:main', runId: 'run-1', text: 'assistant 1', at: 1003 });

    const runTurns = timeline.turns.filter((turn) => turn.runId === 'run-1');
    const assistantItems = Object.values(timeline.items).filter((item) => item.kind === 'assistant_message');
    const userItems = Object.values(timeline.items).filter((item) => item.kind === 'user_message');

    expect(runTurns).toHaveLength(1);
    expect(runTurns[0].id).toBe(realTurnId);
    expect(runTurns[0].inputItemIds).toEqual(['user:agent:main:main:ik-1']);
    expect(runTurns[0].outputItemIds).toEqual(['assistant:agent:main:main:run-1:answer']);
    expect(new Set(runTurns[0].inputItemIds).size).toBe(runTurns[0].inputItemIds.length);
    expect(new Set(runTurns[0].outputItemIds).size).toBe(runTurns[0].outputItemIds.length);

    expect(userItems).toHaveLength(1);
    expect(userItems[0]).toMatchObject({
      id: 'user:agent:main:main:ik-1',
      text: 'user 1',
      messageId: 'msg-1',
      idempotencyKey: 'ik-1',
      status: 'complete',
      source: 'history',
      turnId: realTurnId,
      runId: 'run-1',
    });
    expect(assistantItems).toHaveLength(1);
    expect(assistantItems[0]).toMatchObject({
      id: 'assistant:agent:main:main:run-1:answer',
      text: 'assistant 1',
      finalText: 'assistant 1',
      status: 'complete',
      turnId: realTurnId,
      runId: 'run-1',
    });

    expect(timelineItemsInOrder(timeline).map((item) => `${item.kind}:${'text' in item ? item.text : ''}`)).toEqual([
      'user_message:user 1',
      'assistant_message:assistant 1',
    ]);

    const optimisticTurn = timeline.turns.find((turn) => turn.id === optimisticTurnId);
    expect(optimisticTurn).toMatchObject({
      status: 'aborted',
      inputItemIds: [],
      outputItemIds: [],
    });
  });

  it('moves a run-bound optimistic retry into an existing real run without leaving an empty optimistic turn', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, {
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      idempotencyKey: 'ik-1',
      text: 'user 1',
      at: 1000,
    });
    const optimisticTurnId = timeline.turns[0].id;
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'partial', at: 1001 });
    const realTurnId = timeline.turns.find((turn) => turn.runId === 'run-1')?.id;
    timeline = reduceRuntimeEvent(timeline, {
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      idempotencyKey: 'ik-1',
      text: 'user 1',
      at: 1002,
    });

    const userItemId = 'user:agent:main:main:ik-1';
    const userItems = Object.values(timeline.items).filter((item) => item.kind === 'user_message');
    const realTurn = timeline.turns.find((turn) => turn.id === realTurnId);
    const optimisticTurn = timeline.turns.find((turn) => turn.id === optimisticTurnId);
    const turnsReferencingUser = timeline.turns.filter((turn) => turn.inputItemIds.includes(userItemId));

    expect(userItems).toHaveLength(1);
    expect(userItems[0]).toMatchObject({
      id: userItemId,
      text: 'user 1',
      idempotencyKey: 'ik-1',
      pending: true,
      status: 'provisional',
      source: 'optimistic',
      turnId: realTurnId,
      runId: 'run-1',
    });
    expect(realTurn).toMatchObject({
      status: 'running',
      inputItemIds: [userItemId],
      outputItemIds: ['assistant:agent:main:main:run-1:answer'],
    });
    expect(optimisticTurn).toMatchObject({ status: 'aborted', inputItemIds: [], outputItemIds: [] });
    expect(turnsReferencingUser).toHaveLength(1);
  });

  it('moves a message-id user item between turns without leaving stale input references', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, {
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      runId: 'run-old',
      messageId: 'msg-1',
      text: 'hello',
      at: 1000,
    });
    const oldTurnId = timeline.turns[0].id;
    timeline = reduceRuntimeEvent(timeline, {
      type: 'user_message_committed',
      sessionKey: 'agent:main:main',
      runId: 'run-new',
      messageId: 'msg-1',
      text: 'hello',
      at: 1001,
    });

    const userItemId = 'user:agent:main:main:msg-1';
    const oldTurn = timeline.turns.find((turn) => turn.id === oldTurnId);
    const newTurn = timeline.turns.find((turn) => turn.runId === 'run-new');
    const turnsReferencingUser = timeline.turns.filter((turn) => turn.inputItemIds.includes(userItemId));

    expect(turnsReferencingUser).toHaveLength(1);
    expect(oldTurn?.inputItemIds).toEqual([]);
    expect(newTurn?.inputItemIds).toEqual([userItemId]);
    expect(timeline.items[userItemId]).toMatchObject({
      kind: 'user_message',
      turnId: newTurn?.id,
      runId: 'run-new',
      status: 'complete',
      source: 'history',
    });
  });

  it('keeps the first terminal turn state when a failed event arrives after finalization', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-1', at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_finalized', sessionKey: 'agent:main:main', runId: 'run-1', at: 1001 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_failed', sessionKey: 'agent:main:main', runId: 'run-1', error: 'late failure', at: 1002 });

    expect(timeline.turns).toHaveLength(1);
    expect(timeline.turns[0]).toMatchObject({ status: 'finalized', finalizedAt: 1001 });
  });

  it('keeps the first terminal turn state when a finalized event arrives after failure', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-1', at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_failed', sessionKey: 'agent:main:main', runId: 'run-1', error: 'boom', at: 1001 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_finalized', sessionKey: 'agent:main:main', runId: 'run-1', at: 1002 });

    expect(timeline.turns).toHaveLength(1);
    expect(timeline.turns[0]).toMatchObject({ status: 'failed', finalizedAt: 1001 });
  });

  it('keeps one tool call item when result arrives after start', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', result: 'ok', at: 1001 });

    const toolItems = Object.values(timeline.items).filter((item) => item.kind === 'tool_call');
    const groups = Object.values(timeline.items).filter((item) => item.kind === 'tool_group');
    expect(toolItems).toHaveLength(1);
    expect(toolItems[0]).toMatchObject({ id: 'tool:agent:main:main:run-1:tool-1', status: 'complete' });
    expect(groups).toHaveLength(1);
  });

  it('closes the tool group when all current child tool calls are terminal', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-2', name: 'read', args: { file: 'x' }, at: 1001 });
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', result: 'ok', at: 1002 });

    let groups = Object.values(timeline.items).filter((item) => item.kind === 'tool_group');
    expect(groups[0]).toMatchObject({ status: 'running', source: 'live', closed: false });

    timeline = reduceRuntimeEvent(timeline, { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-2', result: 'done', at: 1003 });

    groups = Object.values(timeline.items).filter((item) => item.kind === 'tool_group');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ status: 'complete', source: 'history', closed: true });
  });

  it('keeps closed tool groups closed when a later tool starts after assistant text', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', result: 'ok', at: 1001 });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'partial answer', at: 1002 });
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-2', name: 'read', args: { file: 'x' }, at: 1003 });

    const group0Id = 'tool-group:agent:main:main:run-1:0';
    const group1Id = 'tool-group:agent:main:main:run-1:1';
    const tool1Id = 'tool:agent:main:main:run-1:tool-1';
    const tool2Id = 'tool:agent:main:main:run-1:tool-2';
    const assistantId = 'assistant:agent:main:main:run-1:answer';
    const group0 = timeline.items[group0Id];
    const group1 = timeline.items[group1Id];
    const groups = Object.values(timeline.items).filter((item) => item.kind === 'tool_group');

    expect(groups).toHaveLength(2);
    expect(group0).toMatchObject({
      kind: 'tool_group',
      status: 'complete',
      source: 'history',
      closed: true,
      childItemIds: [tool1Id],
    });
    expect(group1).toMatchObject({
      kind: 'tool_group',
      status: 'running',
      source: 'live',
      closed: false,
      childItemIds: [tool2Id],
    });
    expect(timeline.turns[0].outputItemIds).toEqual([group0Id, assistantId, group1Id]);
    expect(timeline.turns[0].outputItemIds).not.toContain(tool1Id);
    expect(timeline.turns[0].outputItemIds).not.toContain(tool2Id);

    const orderedIds = timelineItemsInOrder(timeline).map((item) => item.id);
    expect(orderedIds.indexOf(group0Id)).toBeLessThan(orderedIds.indexOf(assistantId));
    expect(orderedIds.indexOf(assistantId)).toBeLessThan(orderedIds.indexOf(group1Id));
  });

  it('uses thinking as a tool group boundary while preserving output event order', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'thinking_delta', sessionKey: 'agent:main:main', runId: 'run-1', blockIndex: 0, text: 'reasoning', at: 1001 });
    timeline = reduceRuntimeEvent(timeline, { type: 'thinking_final', sessionKey: 'agent:main:main', runId: 'run-1', blockIndex: 0, text: 'reasoned fully', durationMs: 2500, at: 1002 });
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-2', name: 'read', args: { file: 'x' }, at: 1003 });

    const group0Id = 'tool-group:agent:main:main:run-1:0';
    const group1Id = 'tool-group:agent:main:main:run-1:1';
    const tool1Id = 'tool:agent:main:main:run-1:tool-1';
    const tool2Id = 'tool:agent:main:main:run-1:tool-2';
    const thinkingId = 'thinking:agent:main:main:run-1:0';
    const assistantId = 'assistant:agent:main:main:run-1:answer';
    let group0 = timeline.items[group0Id];
    let group1 = timeline.items[group1Id];

    expect(group0).toMatchObject({
      kind: 'tool_group',
      status: 'failed',
      source: 'history',
      closed: true,
      childItemIds: [tool1Id],
    });
    expect(group1).toMatchObject({
      kind: 'tool_group',
      status: 'running',
      source: 'live',
      closed: false,
      childItemIds: [tool2Id],
    });
    expect(timeline.items[thinkingId]).toMatchObject({ kind: 'thinking', text: 'reasoned fully', status: 'complete' });
    expect(timeline.turns[0].outputItemIds).toEqual([group0Id, thinkingId, group1Id]);
    expect(timeline.turns[0].outputItemIds).not.toContain(tool1Id);
    expect(timeline.turns[0].outputItemIds).not.toContain(tool2Id);

    let orderedTopLevelIds = timelineItemsInOrder(timeline)
      .filter((item) => timeline.turns[0].outputItemIds.includes(item.id))
      .map((item) => item.id);
    let orderedIds = timelineItemsInOrder(timeline).map((item) => item.id);
    expect(orderedIds.indexOf(group0Id)).toBeLessThan(orderedIds.indexOf(thinkingId));
    expect(orderedIds.indexOf(thinkingId)).toBeLessThan(orderedIds.indexOf(group1Id));
    expect(orderedTopLevelIds).toEqual([group0Id, thinkingId, group1Id]);

    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'partial answer', at: 1004 });
    group0 = timeline.items[group0Id];
    group1 = timeline.items[group1Id];
    orderedTopLevelIds = timelineItemsInOrder(timeline)
      .filter((item) => timeline.turns[0].outputItemIds.includes(item.id))
      .map((item) => item.id);
    orderedIds = timelineItemsInOrder(timeline).map((item) => item.id);

    expect(group0).toMatchObject({ status: 'failed', source: 'history', closed: true, childItemIds: [tool1Id] });
    expect(group1).toMatchObject({ source: 'history', closed: true, childItemIds: [tool2Id] });
    expect(group1).not.toMatchObject({ status: 'running' });
    expect(orderedIds.indexOf(group1Id)).toBeLessThan(orderedIds.indexOf(assistantId));
    expect(orderedTopLevelIds).toEqual([group0Id, thinkingId, group1Id, assistantId]);
  });

  it('closes an open tool group when a turn is finalized', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_finalized', sessionKey: 'agent:main:main', runId: 'run-1', at: 1001 });

    const groups = Object.values(timeline.items).filter((item) => item.kind === 'tool_group');
    const toolCalls = Object.values(timeline.items).filter((item) => item.kind === 'tool_call');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ status: 'complete', source: 'history', closed: true });
    expect(groups[0].childItemIds).toEqual(['tool:agent:main:main:run-1:tool-1']);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ status: 'complete', source: 'history', updatedAt: 1001 });
    expect(timeline.turns[0].outputItemIds).toEqual(['tool-group:agent:main:main:run-1:0']);
  });

  it('closes an open tool group as failed when a turn fails', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_failed', sessionKey: 'agent:main:main', runId: 'run-1', error: 'boom', at: 1001 });

    const groups = Object.values(timeline.items).filter((item) => item.kind === 'tool_group');
    const toolCalls = Object.values(timeline.items).filter((item) => item.kind === 'tool_call');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ status: 'failed', source: 'history', closed: true });
    expect(groups[0].childItemIds).toEqual(['tool:agent:main:main:run-1:tool-1']);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ status: 'failed', source: 'history', updatedAt: 1001 });
    expect(timeline.turns[0].outputItemIds).toEqual(['tool-group:agent:main:main:run-1:0']);
  });

  it('keeps tool calls under their group while patches still include child upserts', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: 1000 });

    expect(timeline.turns[0].outputItemIds).toEqual(['tool-group:agent:main:main:run-1:0']);

    const patchItemIds = buildPatchFromTimeline(timeline)
      .filter((op) => op.op === 'upsert_item')
      .map((op) => op.item.id);
    expect(patchItemIds).toContain('tool-group:agent:main:main:run-1:0');
    expect(patchItemIds).toContain('tool:agent:main:main:run-1:tool-1');
  });

  it('ignores late live tool starts after a turn is finalized', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', result: 'ok', at: 1001 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_finalized', sessionKey: 'agent:main:main', runId: 'run-1', at: 1002 });

    const outputItemIds = [...timeline.turns[0].outputItemIds];
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-late', name: 'exec', args: { cmd: 'late' }, at: 1003 });

    const toolItems = Object.values(timeline.items).filter((item) => item.kind === 'tool_call');
    const groups = Object.values(timeline.items).filter((item) => item.kind === 'tool_group');
    expect(toolItems).toHaveLength(1);
    expect(timeline.items['tool:agent:main:main:run-1:tool-late']).toBeUndefined();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ status: 'complete', source: 'history', closed: true });
    expect(groups[0].childItemIds).toEqual(['tool:agent:main:main:run-1:tool-1']);
    expect(timeline.turns[0].outputItemIds).toEqual(outputItemIds);
  });

  it('ignores late unknown tool finishes after a turn is finalized', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', result: 'ok', at: 1001 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_finalized', sessionKey: 'agent:main:main', runId: 'run-1', at: 1002 });

    const outputItemIds = [...timeline.turns[0].outputItemIds];
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-late', result: 'late result', at: 1003 });

    const toolItems = Object.values(timeline.items).filter((item) => item.kind === 'tool_call');
    const groups = Object.values(timeline.items).filter((item) => item.kind === 'tool_group');
    expect(toolItems).toHaveLength(1);
    expect(timeline.items['tool:agent:main:main:run-1:tool-late']).toBeUndefined();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ status: 'complete', source: 'history', closed: true });
    expect(groups[0].childItemIds).toEqual(['tool:agent:main:main:run-1:tool-1']);
    expect(timeline.turns[0].outputItemIds).toEqual(outputItemIds);
  });

  it('applies a known tool finish after a turn is finalized without reopening the group', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_finalized', sessionKey: 'agent:main:main', runId: 'run-1', at: 1001 });

    const outputItemIds = [...timeline.turns[0].outputItemIds];
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', result: 'ok', at: 1002 });

    const toolItems = Object.values(timeline.items).filter((item) => item.kind === 'tool_call');
    const groups = Object.values(timeline.items).filter((item) => item.kind === 'tool_group');
    expect(toolItems).toHaveLength(1);
    expect(toolItems[0]).toMatchObject({ id: 'tool:agent:main:main:run-1:tool-1', result: 'ok', status: 'complete', source: 'history' });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ status: 'complete', source: 'history', closed: true });
    expect(groups[0].childItemIds).toEqual(['tool:agent:main:main:run-1:tool-1']);
    expect(timeline.turns[0].outputItemIds).toEqual(outputItemIds);
  });

  it('applies a known errored tool finish after a turn is finalized without reopening the group', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_finalized', sessionKey: 'agent:main:main', runId: 'run-1', at: 1001 });

    const outputItemIds = [...timeline.turns[0].outputItemIds];
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', error: 'failed late', at: 1002 });

    const toolItems = Object.values(timeline.items).filter((item) => item.kind === 'tool_call');
    const groups = Object.values(timeline.items).filter((item) => item.kind === 'tool_group');
    expect(toolItems).toHaveLength(1);
    expect(toolItems[0]).toMatchObject({ id: 'tool:agent:main:main:run-1:tool-1', error: 'failed late', status: 'failed', source: 'history' });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ source: 'history', closed: true });
    expect(groups[0].status).not.toBe('running');
    expect(groups[0].childItemIds).toEqual(['tool:agent:main:main:run-1:tool-1']);
    expect(timeline.turns[0].outputItemIds).toEqual(outputItemIds);
  });

  it('ignores late live tool starts after a turn has failed', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', result: 'ok', at: 1001 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_failed', sessionKey: 'agent:main:main', runId: 'run-1', error: 'boom', at: 1002 });

    const outputItemIds = [...timeline.turns[0].outputItemIds];
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-late', name: 'exec', args: { cmd: 'late' }, at: 1003 });

    const toolItems = Object.values(timeline.items).filter((item) => item.kind === 'tool_call');
    const groups = Object.values(timeline.items).filter((item) => item.kind === 'tool_group');
    expect(toolItems).toHaveLength(1);
    expect(timeline.items['tool:agent:main:main:run-1:tool-late']).toBeUndefined();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ status: 'complete', source: 'history', closed: true });
    expect(groups[0].childItemIds).toEqual(['tool:agent:main:main:run-1:tool-1']);
    expect(timeline.turns[0].outputItemIds).toEqual(outputItemIds);
  });

  it('ignores late unknown tool finishes after a turn has failed', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', result: 'ok', at: 1001 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_failed', sessionKey: 'agent:main:main', runId: 'run-1', error: 'boom', at: 1002 });

    const outputItemIds = [...timeline.turns[0].outputItemIds];
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-late', result: 'late result', at: 1003 });

    const toolItems = Object.values(timeline.items).filter((item) => item.kind === 'tool_call');
    const groups = Object.values(timeline.items).filter((item) => item.kind === 'tool_group');
    expect(toolItems).toHaveLength(1);
    expect(timeline.items['tool:agent:main:main:run-1:tool-late']).toBeUndefined();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ status: 'complete', source: 'history', closed: true });
    expect(groups[0].childItemIds).toEqual(['tool:agent:main:main:run-1:tool-1']);
    expect(timeline.turns[0].outputItemIds).toEqual(outputItemIds);
  });

  it('applies a known tool finish after a turn has failed without reopening the group', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_failed', sessionKey: 'agent:main:main', runId: 'run-1', error: 'boom', at: 1001 });

    const outputItemIds = [...timeline.turns[0].outputItemIds];
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', result: 'ok', at: 1002 });

    const toolItems = Object.values(timeline.items).filter((item) => item.kind === 'tool_call');
    const groups = Object.values(timeline.items).filter((item) => item.kind === 'tool_group');
    expect(toolItems).toHaveLength(1);
    expect(toolItems[0]).toMatchObject({ id: 'tool:agent:main:main:run-1:tool-1', result: 'ok', status: 'complete', source: 'history' });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ source: 'history', closed: true });
    expect(groups[0].status).not.toBe('running');
    expect(groups[0].childItemIds).toEqual(['tool:agent:main:main:run-1:tool-1']);
    expect(timeline.turns[0].outputItemIds).toEqual(outputItemIds);
  });

  it('creates a tool item even when result arrives before start', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', result: 'late result', at: 1001 });

    const toolItems = Object.values(timeline.items).filter((item) => item.kind === 'tool_call');
    expect(toolItems).toHaveLength(1);
    expect(toolItems[0]).toMatchObject({ name: 'unknown', result: 'late result', status: 'complete' });
  });

  it('updates thinking in place from live delta to final text', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'thinking_delta', sessionKey: 'agent:main:main', runId: 'run-1', blockIndex: 0, text: 'reason', at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'thinking_final', sessionKey: 'agent:main:main', runId: 'run-1', blockIndex: 0, text: 'reasoned fully', durationMs: 2500, at: 1001 });

    const thinkingItems = Object.values(timeline.items).filter((item) => item.kind === 'thinking');
    expect(thinkingItems).toHaveLength(1);
    expect(thinkingItems[0]).toMatchObject({ text: 'reasoned fully', status: 'complete', durationMs: 2500 });
  });

  it('marks running thinking complete when the turn finalizes', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'thinking_delta', sessionKey: 'agent:main:main', runId: 'run-1', blockIndex: 0, text: 'reasoning live', at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_finalized', sessionKey: 'agent:main:main', runId: 'run-1', at: 1001 });

    const thinkingItems = Object.values(timeline.items).filter((item) => item.kind === 'thinking');
    expect(thinkingItems).toHaveLength(1);
    expect(thinkingItems[0]).toMatchObject({
      text: 'reasoning live',
      status: 'complete',
      source: 'history',
      updatedAt: 1001,
    });
  });

  it('does not regress a finalized thinking item when a stale delta arrives', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'thinking_final', sessionKey: 'agent:main:main', runId: 'run-1', blockIndex: 0, text: 'reasoned fully', durationMs: 2500, at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'thinking_delta', sessionKey: 'agent:main:main', runId: 'run-1', blockIndex: 0, text: 'stale reason', at: 1001 });

    const thinkingItems = Object.values(timeline.items).filter((item) => item.kind === 'thinking');
    expect(thinkingItems).toHaveLength(1);
    expect(thinkingItems[0]).toMatchObject({
      text: 'reasoned fully',
      status: 'complete',
      source: 'history',
      durationMs: 2500,
    });
  });
});
