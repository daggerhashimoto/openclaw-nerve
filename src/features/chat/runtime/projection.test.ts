import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '@/utils/helpers';
import { projectItemCount, projectTimeline } from './projection';
import type {
  AssistantTimelineItem,
  SessionTimeline,
  SystemTimelineItem,
  ThinkingTimelineItem,
  TimelineItem,
  TimelineTurn,
  ToolCallTimelineItem,
  ToolGroupTimelineItem,
  ToolResultTimelineItem,
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

    expect(projection.messages[0]).toMatchObject({ pending: false, failed: true, tempId: 'idem-live' });
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

  it('strips voice TTS send hints from replayed user messages', () => {
    const turn = makeTurn('session-1', 'history:user:voice', 0, 'finalized');
    const timeline = makeTimeline('session-1', [turn], {
      'user-voice': userItem(
        turn,
        'user-voice',
        '[voice] hello\n\n[system: User sent a voice message. Always include a [tts:...] marker.]',
        0,
      ),
    });

    const projection = projectTimeline(timeline);

    expect(projection.messages[0]).toMatchObject({
      msgId: 'user-voice',
      role: 'user',
      rawText: 'hello',
      isVoice: true,
    });
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

  it('projects user media metadata from runtime items', () => {
    const turn = makeTurn('session-1', 'run-media', 0, 'finalized');
    const timeline = makeTimeline('session-1', [turn], {
      'user-media': {
        ...userItem(turn, 'user-media', 'please inspect', 0),
        images: [
          {
            mimeType: 'image/png',
            content: 'base64-image',
            preview: 'data:image/png;base64,base64-image',
            name: 'capture.png',
          },
        ],
        uploadAttachments: [
          {
            id: 'att-1',
            origin: 'upload',
            mode: 'inline',
            name: 'capture.png',
            mimeType: 'image/png',
            sizeBytes: 123,
            inline: {
              encoding: 'base64',
              base64: '',
              base64Bytes: 123,
              compressed: false,
            },
            policy: { forwardToSubagents: false },
          },
        ],
      },
    });

    const projection = projectTimeline(timeline);

    expect(projection.messages).toHaveLength(1);
    expect(projection.messages[0]).toMatchObject({
      msgId: 'user-media',
      role: 'user',
      rawText: 'please inspect',
      images: [{ mimeType: 'image/png', name: 'capture.png' }],
      uploadAttachments: [{ id: 'att-1', name: 'capture.png' }],
    });
  });

  it('projects image-only user runtime items as visible bubbles', () => {
    const turn = makeTurn('session-1', 'run-image-only', 0, 'finalized');
    const timeline = makeTimeline('session-1', [turn], {
      'user-image-only': {
        ...userItem(turn, 'user-image-only', '', 0),
        images: [
          {
            mimeType: 'image/png',
            content: 'base64-image',
            preview: 'data:image/png;base64,base64-image',
            name: 'capture.png',
          },
        ],
      },
    });

    const projection = projectTimeline(timeline);

    expect(projection.messages).toHaveLength(1);
    expect(projection.messages[0]).toMatchObject({
      msgId: 'user-image-only',
      role: 'user',
      rawText: '',
      images: [{ mimeType: 'image/png', name: 'capture.png' }],
    });
  });

  it('uses normal markdown rendering for media fallback user bubbles', () => {
    const turn = makeTurn('session-1', 'run-media-fallback', 0, 'finalized');
    const text = 'caption \x00TOOLRESULT_START\x00not a tool result\x00TOOLRESULT_END\x00';
    const timeline = makeTimeline('session-1', [turn], {
      'user-media-fallback': {
        ...userItem(turn, 'user-media-fallback', text, 0),
        images: [
          {
            mimeType: 'image/png',
            content: 'base64-image',
            preview: 'data:image/png;base64,base64-image',
            name: 'capture.png',
          },
        ],
      },
    });

    const projection = projectTimeline(timeline);

    expect(projection.messages[0]).toMatchObject({
      msgId: 'user-media-fallback',
      role: 'user',
      rawText: text,
    });
    expect(projection.messages[0].html).toBe(renderMarkdown(text));
    expect(projection.messages[0].html).not.toContain('tool-result-details');
  });

  it('keeps assistant TTS marker text available while hiding the marker from chat', () => {
    const turn = makeTurn('session-1', 'run-tts', 0, 'finalized');
    const timeline = makeTimeline('session-1', [turn], {
      'assistant-tts': assistantItem(turn, 'assistant-tts', 'Visible reply.\n\n[tts:Spoken reply.]', 100, false),
    });

    const projection = projectTimeline(timeline);

    expect(projection.messages).toHaveLength(1);
    expect(projection.messages[0]).toMatchObject({
      msgId: 'assistant-tts',
      role: 'assistant',
      rawText: 'Visible reply.',
      ttsText: 'Spoken reply.',
    });
    expect(projection.messages[0].html).not.toContain('[tts:');
  });

  it.each([500, 2_000, 10_000])(
    'projects only the visible tail for a %i-turn timeline while preserving total count',
    (turnCount) => {
      const timeline = makeLargeTimeline('session-scale', turnCount);

      const projection = projectTimeline(timeline, { visibleCount: 50 });

      expect(projection.totalMessages).toBe(turnCount * 2);
      expect(projection.messages).toHaveLength(50);
      expect(projection.messages[0]).toMatchObject({
        msgId: `user-${turnCount - 25}`,
        rawText: `prompt ${turnCount - 25}`,
      });
      expect(projection.messages.at(-1)).toMatchObject({
        msgId: `assistant-${turnCount - 1}`,
        rawText: `answer ${turnCount - 1}`,
      });
      expect(projection.isGenerating).toBe(false);
    },
  );

  it('keeps grouped tools and intermediate tagging intact when projecting a visible window', () => {
    const firstTurn = makeTurn('session-1', 'run-1', 0, 'finalized');
    const liveTurn = makeTurn('session-1', 'run-2', 1, 'running');
    const timeline = makeTimeline('session-1', [firstTurn, liveTurn], {
      'user-old': userItem(firstTurn, 'user-old', 'old prompt', 0),
      'assistant-old': assistantItem(firstTurn, 'assistant-old', 'old answer', 1, false),
      'user-live': userItem(liveTurn, 'user-live', 'inspect please', 10),
      'assistant-plan': assistantItem(liveTurn, 'assistant-plan', 'I will inspect.', 11, false),
      'tool-read': toolItem(liveTurn, 'tool-read', 'read', { path: '/tmp/a' }, 12, 'complete'),
      'tool-exec': toolItem(liveTurn, 'tool-exec', 'exec', { command: 'pwd' }, 13, 'complete'),
      'assistant-final': assistantItem(liveTurn, 'assistant-final', 'Done.', 100, true),
    });

    const projection = projectTimeline(timeline, { visibleCount: 3 });

    expect(projection.totalMessages).toBe(6);
    expect(projection.messages.map((message) => message.msgId)).toEqual([
      'assistant-plan',
      'tool-group:tool-read:tool-exec',
      'assistant-final',
    ]);
    expect(projection.messages[0]).toMatchObject({ intermediate: true });
    expect(projection.messages[1].toolGroup).toHaveLength(2);
    expect(projection.processingStage).toBe('streaming');
  });

  describe('totalMessages consistency (#344)', () => {
    const ATTACH_NOTE: UserTimelineItem['uploadAttachments'] = [
      {
        id: 'att-1',
        origin: 'upload',
        mode: 'inline',
        name: 'note.txt',
        mimeType: 'text/plain',
        sizeBytes: 12,
        policy: { forwardToSubagents: false },
      },
    ];
    const IMG_PNG: UserTimelineItem['images'] = [
      { mimeType: 'image/png', content: 'b64', name: 'snap.png' },
    ];

    it('excludes voice-only-no-media user items from totalMessages', () => {
      const turn = makeTurn('session-1', 'run-1', 0, 'finalized');
      const timeline = makeTimeline('session-1', [turn], {
        'user-voice-empty': userItem(turn, 'user-voice-empty', '[voice] ', 0),
        'assistant-1': assistantItem(turn, 'assistant-1', 'reply', 1, false),
      });

      const projection = projectTimeline(timeline, { visibleCount: 50 });

      expect(projection.totalMessages).toBe(projection.messages.length);
      expect(projection.totalMessages).toBe(1);
      expect(projection.messages.map((message) => message.msgId)).toEqual(['assistant-1']);
    });

    it('excludes user items that collapse to empty after webchat envelope stripping', () => {
      const envelopeOnly = [
        'Conversation info (untrusted metadata):',
        '```json',
        '{"message_id":"abc","sender":"someone"}',
        '```',
        '[Wed 2026-05-22 10:30 UTC]',
      ].join('\n');
      const turn = makeTurn('session-1', 'run-1', 0, 'finalized');
      const timeline = makeTimeline('session-1', [turn], {
        'user-envelope-only': userItem(turn, 'user-envelope-only', envelopeOnly, 0),
        'assistant-1': assistantItem(turn, 'assistant-1', 'ok', 1, false),
      });

      const projection = projectTimeline(timeline, { visibleCount: 50 });

      expect(projection.totalMessages).toBe(projection.messages.length);
      expect(projection.totalMessages).toBe(1);
    });

    it('excludes user items that collapse to empty after TTS hint stripping', () => {
      const ttsHintOnly = '[system: User sent a voice message. Always include a [tts:...] marker.]';
      const turn = makeTurn('session-1', 'run-1', 0, 'finalized');
      const timeline = makeTimeline('session-1', [turn], {
        'user-tts-only': userItem(turn, 'user-tts-only', ttsHintOnly, 0),
        'assistant-1': assistantItem(turn, 'assistant-1', 'ok', 1, false),
      });

      const projection = projectTimeline(timeline, { visibleCount: 50 });

      expect(projection.totalMessages).toBe(projection.messages.length);
      expect(projection.totalMessages).toBe(1);
    });

    it('counts user messages that fan out into multiple system-event segments', () => {
      const userWithEvent = [
        'System: [2026-05-22 10:30 UTC] sub-agent task completed',
        '',
        'please review the output',
      ].join('\n');
      const turn = makeTurn('session-1', 'run-1', 0, 'finalized');
      const timeline = makeTimeline('session-1', [turn], {
        'user-with-event': userItem(turn, 'user-with-event', userWithEvent, 0),
      });

      const projection = projectTimeline(timeline, { visibleCount: 50 });

      expect(projection.totalMessages).toBe(projection.messages.length);
      expect(projection.totalMessages).toBeGreaterThan(1);
    });

    it('keeps totalMessages and messages.length in sync for voice-only with attachments', () => {
      const turn = makeTurn('session-1', 'run-1', 0, 'finalized');
      const userWithMedia: UserTimelineItem = {
        ...userItem(turn, 'user-voice-media', '[voice] ', 0),
        uploadAttachments: ATTACH_NOTE,
      };
      const timeline = makeTimeline('session-1', [turn], {
        'user-voice-media': userWithMedia,
        'assistant-1': assistantItem(turn, 'assistant-1', 'got it', 1, false),
      });

      const projection = projectTimeline(timeline, { visibleCount: 50 });

      expect(projection.totalMessages).toBe(projection.messages.length);
      expect(projection.totalMessages).toBe(2);
    });

    const finalizedTurn = (): TimelineTurn => makeTurn('session', 'run', 0, 'finalized');
    const runningTurn = (): TimelineTurn => makeTurn('session', 'run', 0, 'running');

    const assistantSegmentItem = (
      turn: TimelineTurn,
      id: string,
      text: string,
      block: number,
      isStreaming: boolean,
    ): AssistantTimelineItem => ({
      ...assistantItem(turn, id, text, block, isStreaming),
      kind: 'assistant_segment',
    });

    it.each<{ name: string; build: () => { item: TimelineItem; expected: number } }>([
      {
        name: 'finalized assistant_message with text',
        build: () => ({ item: assistantItem(finalizedTurn(), 'a-text', 'hello', 0, false), expected: 1 }),
      },
      {
        name: 'streaming assistant_message with empty text',
        build: () => ({ item: assistantItem(runningTurn(), 'a-stream', '', 0, true), expected: 1 }),
      },
      {
        name: 'finalized assistant_message with empty text',
        build: () => ({ item: assistantItem(finalizedTurn(), 'a-empty', '', 0, false), expected: 0 }),
      },
      {
        name: 'finalized assistant_segment with text',
        build: () => ({ item: assistantSegmentItem(finalizedTurn(), 'seg-text', 'partial', 0, false), expected: 1 }),
      },
      {
        name: 'finalized assistant_segment with empty text',
        build: () => ({ item: assistantSegmentItem(finalizedTurn(), 'seg-empty', '', 0, false), expected: 0 }),
      },
      {
        name: 'thinking with text',
        build: () => ({ item: thinkingItem(finalizedTurn(), 'think', 'pondering', 0, 'complete'), expected: 1 }),
      },
      {
        name: 'thinking with empty text',
        build: () => ({ item: thinkingItem(finalizedTurn(), 'think-empty', '', 0, 'complete'), expected: 0 }),
      },
      {
        name: 'user with plain text',
        build: () => ({ item: userItem(finalizedTurn(), 'u-plain', 'hi there', 0), expected: 1 }),
      },
      {
        name: 'user voice-only with no media',
        build: () => ({ item: userItem(finalizedTurn(), 'u-voice-empty', '[voice] ', 0), expected: 0 }),
      },
      {
        name: 'user voice-only with uploadAttachments',
        build: () => ({
          item: { ...userItem(finalizedTurn(), 'u-voice-att', '[voice] ', 0), uploadAttachments: ATTACH_NOTE },
          expected: 1,
        }),
      },
      {
        name: 'user voice-only with images only',
        build: () => ({
          item: { ...userItem(finalizedTurn(), 'u-voice-img', '[voice] ', 0), images: IMG_PNG },
          expected: 1,
        }),
      },
      {
        name: 'user with TTS hint only',
        build: () => ({
          item: userItem(
            finalizedTurn(),
            'u-tts-only',
            '[system: User sent a voice message. Always include a [tts:...] marker.]',
            0,
          ),
          expected: 0,
        }),
      },
      {
        name: 'system event',
        build: () => ({ item: systemItem(finalizedTurn(), 'sys-1', 'system note', 0, 'info'), expected: 1 }),
      },
      {
        name: 'tool_result',
        build: () => ({ item: toolResultItem(finalizedTurn(), 'tr-1', 'ok', 0), expected: 1 }),
      },
    ])(
      'projectItemCount matches projected output length for $name',
      ({ build }) => {
        const { item, expected } = build();
        expect(projectItemCount(item)).toBe(expected);

        const turn = makeTurn(item.sessionKey, item.runId, 0, 'finalized');
        const timeline = makeTimeline(item.sessionKey, [turn], { [item.id]: item });
        const projection = projectTimeline(timeline, { visibleCount: 50 });
        expect(projection.messages.length).toBe(expected);
        expect(projection.totalMessages).toBe(expected);
      },
    );

    it('returns 0 from projectItemCount for tool_call and tool_group (handled by the tool-grouping branch)', () => {
      const turn = makeTurn('session', 'run', 0, 'finalized');
      const tool = toolItem(turn, 'tc-1', 'read', { path: '/tmp/a' }, 0, 'complete');
      const group = toolGroupItem(turn, 'tg-1', ['tc-1'], 0);

      expect(projectItemCount(tool)).toBe(0);
      expect(projectItemCount(group)).toBe(0);
    });

    it('keeps tool-run grouping intact across zero-projection items in the windowed branch', () => {
      const turn = makeTurn('session-1', 'run-1', 0, 'finalized');
      const timeline = makeTimeline('session-1', [turn], {
        'user-1': userItem(turn, 'user-1', 'do stuff', 0),
        'tool-1': toolItem(turn, 'tool-1', 'read', { path: '/tmp/a' }, 10, 'complete'),
        'thinking-empty': thinkingItem(turn, 'thinking-empty', '', 11, 'complete'),
        'tool-2': toolItem(turn, 'tool-2', 'exec', { command: 'pwd' }, 12, 'complete'),
        'assistant-empty': assistantItem(turn, 'assistant-empty', '', 13, false),
        'tool-3': toolItem(turn, 'tool-3', 'read', { path: '/tmp/b' }, 14, 'complete'),
        'assistant-final': assistantItem(turn, 'assistant-final', 'done', 100, false),
      });

      const windowed = projectTimeline(timeline, { visibleCount: 50 });
      const linear = projectTimeline(timeline);
      const zeroVisible = projectTimeline(timeline, { visibleCount: 0 });

      expect(windowed.totalMessages).toBe(windowed.messages.length);
      expect(windowed.totalMessages).toBe(linear.messages.length);
      expect(windowed.messages.map((m) => m.role)).toEqual(linear.messages.map((m) => m.role));
      expect(windowed.messages.map((m) => m.msgId)).toEqual(linear.messages.map((m) => m.msgId));
      expect(zeroVisible.totalMessages).toBe(linear.messages.length);
      const toolGroups = windowed.messages.filter((m) => m.toolGroup);
      expect(toolGroups).toHaveLength(1);
      expect(toolGroups[0].toolGroup).toHaveLength(3);
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

function systemItem(
  turn: TimelineTurn,
  id: string,
  text: string,
  block: number,
  severity: SystemTimelineItem['severity'],
): SystemTimelineItem {
  return {
    id,
    sessionKey: turn.sessionKey,
    turnId: turn.id,
    runId: turn.runId,
    kind: 'system_event',
    text,
    severity,
    orderKey: { turn: turn.orderBase.turn, block, sub: 0 },
    createdAt: 1_775_000_000_000 + block,
    updatedAt: 1_775_000_000_000 + block,
    status: 'complete',
    source: 'system',
  };
}

function toolResultItem(
  turn: TimelineTurn,
  id: string,
  text: string,
  block: number,
): ToolResultTimelineItem {
  return {
    id,
    sessionKey: turn.sessionKey,
    turnId: turn.id,
    runId: turn.runId,
    kind: 'tool_result',
    text,
    orderKey: { turn: turn.orderBase.turn, block, sub: 0 },
    createdAt: 1_775_000_000_000 + block,
    updatedAt: 1_775_000_000_000 + block,
    status: 'complete',
    source: 'history',
  };
}

function makeLargeTimeline(sessionKey: string, turnCount: number): SessionTimeline {
  const turns: TimelineTurn[] = [];
  const items: Record<string, TimelineItem> = {};

  for (let index = 0; index < turnCount; index++) {
    const turn = makeTurn(sessionKey, `run-${index}`, index, 'finalized');
    turns.push(turn);
    items[`user-${index}`] = userItem(turn, `user-${index}`, `prompt ${index}`, 0);
    items[`assistant-${index}`] = assistantItem(turn, `assistant-${index}`, `answer ${index}`, 1, false);
  }

  return makeTimeline(sessionKey, turns, items);
}
