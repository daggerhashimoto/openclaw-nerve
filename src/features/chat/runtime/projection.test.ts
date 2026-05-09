import { describe, expect, it } from 'vitest';
import { projectTimeline } from './projection';
import type {
  AssistantTimelineItem,
  SessionTimeline,
  ThinkingTimelineItem,
  TimelineItem,
  TimelineTurn,
  ToolCallTimelineItem,
  ToolGroupTimelineItem,
  UserTimelineItem,
} from './types';

describe('chat runtime projection', () => {
  it('projects server ordered items into stable ChatMsg rows', () => {
    const turn = makeTurn('session-1', 'run-1', 0, 'finalized');
    const timeline = makeTimeline('session-1', [turn], {
      'user-1': userItem(turn, 'user-1', 'hello', 0),
      'thinking-1': thinkingItem(turn, 'thinking-1', 'checking', 10, 'complete'),
      'tool-group-1': toolGroupItem(turn, 'tool-group-1', ['tool-1', 'tool-2'], 20),
      'tool-1': toolItem(turn, 'tool-1', 'read', { path: '/tmp/a' }, 21, 'complete'),
      'tool-2': toolItem(turn, 'tool-2', 'exec', { command: 'pwd', workdir: '/tmp/project' }, 22, 'complete'),
      'assistant-1': assistantItem(turn, 'assistant-1', 'done', 100, false),
    });

    const projection = projectTimeline(timeline);

    expect(projection.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(projection.messages[0]).toMatchObject({ msgId: 'user-1', rawText: 'hello' });
    expect(projection.messages[1]).toMatchObject({ msgId: 'thinking-1', isThinking: true, rawText: 'checking' });
    expect(projection.messages[2].msgId).toBe('tool-group:tool-1:tool-2');
    expect(projection.messages[2].toolGroup).toHaveLength(2);
    expect(projection.messages[3]).toMatchObject({ msgId: 'assistant-1', rawText: 'done' });
    expect(projection.isGenerating).toBe(false);
    expect(projection.processingStage).toBeNull();
  });

  it('derives live status and failed optimistic user state', () => {
    const turn = makeTurn('session-1', 'run-live', 0, 'running');
    const timeline = makeTimeline('session-1', [turn], {
      'user-live': {
        ...userItem(turn, 'user-live', 'please run it', 0),
        idempotencyKey: 'idem-live',
        pending: true,
        status: 'provisional',
        source: 'optimistic',
      },
      'tool-live': toolItem(turn, 'tool-live', 'exec', { command: 'npm run test', workdir: '/repo' }, 20, 'running'),
      'assistant-live': assistantItem(turn, 'assistant-live', 'working', 100, true),
    });

    const projection = projectTimeline(timeline, {
      failedIdempotencyKeys: new Set(['idem-live']),
    });

    expect(projection.messages[0]).toMatchObject({ pending: false, failed: true });
    expect(projection.isGenerating).toBe(true);
    expect(projection.processingStage).toBe('tool_use');
    expect(projection.currentToolDescription).toContain('npm run test');
    expect(projection.activityLog).toEqual([
      expect.objectContaining({
        id: 'tool-live',
        toolName: 'exec',
        phase: 'running',
      }),
    ]);
  });

  it('does not keep finalized optimistic input pending forever', () => {
    const turn = makeTurn('session-1', 'run-final', 0, 'finalized');
    const timeline = makeTimeline('session-1', [turn], {
      'user-final': {
        ...userItem(turn, 'user-final', 'done?', 0),
        idempotencyKey: 'idem-final',
        pending: true,
        status: 'provisional',
        source: 'optimistic',
      },
      'assistant-final': assistantItem(turn, 'assistant-final', 'done', 100, false),
    });

    const projection = projectTimeline(timeline);

    expect(projection.isGenerating).toBe(false);
    expect(projection.messages[0]).toMatchObject({ pending: false, failed: false });
  });

  it('does not treat completed history-only input turns as generating', () => {
    for (const runId of ['history:user:history-user', 'optimistic:message:history-user']) {
      const turn = makeTurn('session-1', runId, 0, 'running');
      const timeline = makeTimeline('session-1', [turn], {
        'user-history': userItem(turn, 'user-history', 'old unanswered prompt', 0),
      });

      const projection = projectTimeline(timeline);

      expect(projection.isGenerating).toBe(false);
      expect(projection.processingStage).toBeNull();
      expect(projection.messages[0]).toMatchObject({ pending: false, failed: false });
    }
  });

  it('keeps concrete user-only history turns generating while live output can still attach', () => {
    const turn = makeTurn('session-1', 'run-live', 0, 'running');
    const timeline = makeTimeline('session-1', [turn], {
      'user-live': userItem(turn, 'user-live', 'current prompt', 0),
    });

    const projection = projectTimeline(timeline);

    expect(projection.isGenerating).toBe(true);
    expect(projection.processingStage).toBe('thinking');
    expect(projection.messages[0]).toMatchObject({ pending: false, failed: false });
  });

  it('does not treat failed prompt-only optimistic turns as generating', () => {
    const turn = makeTurn('session-1', 'optimistic:idempotency:failed', 0, 'running');
    const timeline = makeTimeline('session-1', [turn], {
      'user-failed': {
        ...userItem(turn, 'user-failed', 'please try', 0),
        idempotencyKey: 'idem-failed',
        pending: true,
        status: 'provisional',
        source: 'optimistic',
      },
    });

    const projection = projectTimeline(timeline, {
      failedIdempotencyKeys: new Set(['idem-failed']),
    });

    expect(projection.isGenerating).toBe(false);
    expect(projection.processingStage).toBeNull();
    expect(projection.messages[0]).toMatchObject({ pending: false, failed: true });
  });

  it('keeps thinking, grouped tools, and assistant rows stable across live assistant updates', () => {
    const turn = makeTurn('session-1', 'run-live-update', 0, 'running');
    const baseItems = {
      'user-live': userItem(turn, 'user-live', 'please inspect', 0),
      'thinking-live': thinkingItem(turn, 'thinking-live', 'I should inspect first', 10, 'complete'),
      'tool-group-live': toolGroupItem(turn, 'tool-group-live', ['tool-read', 'tool-exec'], 20),
      'tool-read': toolItem(turn, 'tool-read', 'read', { path: '/tmp/a' }, 21, 'complete'),
      'tool-exec': toolItem(turn, 'tool-exec', 'exec', { command: 'pwd', workdir: '/tmp/project' }, 22, 'complete'),
    };
    const firstProjection = projectTimeline(makeTimeline('session-1', [turn], {
      ...baseItems,
      'assistant-live': assistantItem(turn, 'assistant-live', 'working', 100, true),
    }));
    const secondProjection = projectTimeline(makeTimeline('session-1', [turn], {
      ...baseItems,
      'assistant-live': assistantItem(turn, 'assistant-live', 'working\n\nnow finalizing', 100, true),
    }));

    expect(firstProjection.messages.map((message) => message.msgId)).toEqual([
      'user-live',
      'thinking-live',
      'tool-group:tool-read:tool-exec',
      'assistant-live',
    ]);
    expect(secondProjection.messages.map((message) => message.msgId)).toEqual([
      'user-live',
      'thinking-live',
      'tool-group:tool-read:tool-exec',
      'assistant-live',
    ]);
    expect(secondProjection.messages[1]).toMatchObject({ isThinking: true, rawText: 'I should inspect first' });
    expect(secondProjection.messages[2].toolGroup).toHaveLength(2);
    expect(secondProjection.messages[3]).toMatchObject({
      role: 'assistant',
      rawText: 'working\n\nnow finalizing',
      streaming: true,
    });
  });
});

function makeTimeline(
  sessionKey: string,
  turns: TimelineTurn[],
  items: Record<string, TimelineItem>,
): SessionTimeline {
  return {
    sessionKey,
    version: 1,
    cursor: '1',
    hydrationState: 'ready',
    turns,
    items,
    updatedAt: 1_775_000_010_000,
  };
}

function makeTurn(
  sessionKey: string,
  runId: string,
  turnIndex: number,
  status: TimelineTurn['status'],
): TimelineTurn {
  return {
    id: `turn:${runId}`,
    sessionKey,
    runId,
    status,
    startedAt: 1_775_000_000_000 + turnIndex,
    finalizedAt: status === 'finalized' ? 1_775_000_020_000 : undefined,
    inputItemIds: [],
    outputItemIds: [],
    orderBase: { turn: turnIndex, block: 0, sub: 0 },
  };
}

function userItem(turn: TimelineTurn, id: string, text: string, block: number): UserTimelineItem {
  return {
    id,
    sessionKey: turn.sessionKey,
    turnId: turn.id,
    runId: turn.runId,
    kind: 'user_message',
    text,
    orderKey: { turn: turn.orderBase.turn, block, sub: 0 },
    createdAt: 1_775_000_000_000 + block,
    updatedAt: 1_775_000_000_000 + block,
    status: 'complete',
    source: 'history',
    pending: false,
  };
}

function thinkingItem(
  turn: TimelineTurn,
  id: string,
  text: string,
  block: number,
  status: ThinkingTimelineItem['status'],
): ThinkingTimelineItem {
  return {
    id,
    sessionKey: turn.sessionKey,
    turnId: turn.id,
    runId: turn.runId,
    kind: 'thinking',
    text,
    orderKey: { turn: turn.orderBase.turn, block, sub: 0 },
    createdAt: 1_775_000_000_000 + block,
    updatedAt: 1_775_000_000_000 + block,
    status,
    source: status === 'complete' ? 'history' : 'live',
  };
}

function toolGroupItem(
  turn: TimelineTurn,
  id: string,
  childItemIds: string[],
  block: number,
): ToolGroupTimelineItem {
  return {
    id,
    sessionKey: turn.sessionKey,
    turnId: turn.id,
    runId: turn.runId,
    kind: 'tool_group',
    childItemIds,
    closed: true,
    orderKey: { turn: turn.orderBase.turn, block, sub: 0 },
    createdAt: 1_775_000_000_000 + block,
    updatedAt: 1_775_000_000_000 + block,
    status: 'complete',
    source: 'history',
  };
}

function toolItem(
  turn: TimelineTurn,
  id: string,
  name: string,
  args: Record<string, unknown>,
  block: number,
  status: ToolCallTimelineItem['status'],
): ToolCallTimelineItem {
  return {
    id,
    sessionKey: turn.sessionKey,
    turnId: turn.id,
    runId: turn.runId,
    kind: 'tool_call',
    toolCallId: id,
    name,
    args,
    result: status === 'complete' ? 'ok' : undefined,
    orderKey: { turn: turn.orderBase.turn, block: 20, sub: block },
    createdAt: 1_775_000_000_000 + block,
    updatedAt: 1_775_000_000_000 + block,
    status,
    source: status === 'running' ? 'live' : 'history',
  };
}

function assistantItem(
  turn: TimelineTurn,
  id: string,
  text: string,
  block: number,
  isStreaming: boolean,
): AssistantTimelineItem {
  return {
    id,
    sessionKey: turn.sessionKey,
    turnId: turn.id,
    runId: turn.runId,
    kind: 'assistant_message',
    text,
    isStreaming,
    orderKey: { turn: turn.orderBase.turn, block, sub: 0 },
    createdAt: 1_775_000_000_000 + block,
    updatedAt: 1_775_000_000_000 + block,
    status: isStreaming ? 'running' : 'complete',
    source: isStreaming ? 'live' : 'history',
  };
}
