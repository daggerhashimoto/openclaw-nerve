/** Tests for streamEventHandler — event classification, deltas, and activity log. */
import { describe, it, expect } from 'vitest';
import {
  isActiveAgentState,
  classifyStreamEvent,
  extractStreamDelta,
  extractFinalMessages,
  extractFinalMessage,
  buildActivityLogEntry,
  markToolCompleted,
  appendActivityEntry,
  deriveProcessingStage,
} from './streamEventHandler';
import type { GatewayEvent } from '@/types';

describe('isActiveAgentState', () => {
  it('returns true for active states', () => {
    for (const state of ['thinking', 'processing', 'tool_use', 'executing', 'tool', 'started', 'delta']) {
      expect(isActiveAgentState(state)).toBe(true);
    }
  });

  it('returns false for inactive states', () => {
    for (const state of ['idle', 'done', 'error', 'complete', '']) {
      expect(isActiveAgentState(state)).toBe(false);
    }
  });
});

describe('classifyStreamEvent', () => {
  it('returns null for non-chat/agent events', () => {
    const event: GatewayEvent = { type: 'event', event: 'presence' };
    expect(classifyStreamEvent(event)).toBeNull();
  });

  describe('agent events', () => {
    it('classifies lifecycle start', () => {
      const event: GatewayEvent = {
        type: 'event', event: 'agent',
        payload: { stream: 'lifecycle', data: { phase: 'start' } },
      };
      const result = classifyStreamEvent(event);
      expect(result?.type).toBe('lifecycle_start');
      expect(result?.source).toBe('agent');
    });

    it('classifies lifecycle end', () => {
      const event: GatewayEvent = {
        type: 'event', event: 'agent',
        payload: { stream: 'lifecycle', data: { phase: 'end' } },
      };
      expect(classifyStreamEvent(event)?.type).toBe('lifecycle_end');
    });

    it('classifies lifecycle error as end', () => {
      const event: GatewayEvent = {
        type: 'event', event: 'agent',
        payload: { stream: 'lifecycle', data: { phase: 'error' } },
      };
      expect(classifyStreamEvent(event)?.type).toBe('lifecycle_end');
    });

    it('classifies assistant stream', () => {
      const event: GatewayEvent = {
        type: 'event', event: 'agent',
        payload: { stream: 'assistant', data: {} },
      };
      expect(classifyStreamEvent(event)?.type).toBe('assistant_stream');
    });

    it('classifies tool start events', () => {
      const event: GatewayEvent = {
        type: 'event', event: 'agent',
        payload: {
          stream: 'tool',
          data: { phase: 'start', name: 'read', toolCallId: 'tc-1' },
        },
      };
      expect(classifyStreamEvent(event)?.type).toBe('agent_tool_start');
    });

    it('classifies tool result events', () => {
      const event: GatewayEvent = {
        type: 'event', event: 'agent',
        payload: {
          stream: 'tool',
          data: { phase: 'result', toolCallId: 'tc-1' },
        },
      };
      expect(classifyStreamEvent(event)?.type).toBe('agent_tool_result');
    });

    it('ignores tool events without required fields', () => {
      const event: GatewayEvent = {
        type: 'event', event: 'agent',
        payload: { stream: 'tool', data: { phase: 'start' } },  // missing name + toolCallId
      };
      expect(classifyStreamEvent(event)?.type).toBe('ignore');
    });

    it('classifies a finished tool item as tool_item_end', () => {
      for (const phase of ['end', 'complete', 'completed']) {
        const event: GatewayEvent = {
          type: 'event', event: 'agent',
          payload: { stream: 'item', sessionKey: 'sk', data: { kind: 'tool', phase, name: 'message', toolCallId: 'tc-1' } },
        };
        expect(classifyStreamEvent(event)?.type).toBe('tool_item_end');
      }
    });

    it('ignores tool items that have not finished and non-tool items', () => {
      const started: GatewayEvent = {
        type: 'event', event: 'agent',
        payload: { stream: 'item', data: { kind: 'tool', phase: 'start', name: 'bash' } },
      };
      const analysis: GatewayEvent = {
        type: 'event', event: 'agent',
        payload: { stream: 'item', data: { kind: 'analysis', phase: 'end' } },
      };
      expect(classifyStreamEvent(started)?.type).toBe('ignore');
      expect(classifyStreamEvent(analysis)?.type).toBe('ignore');
    });

    it('classifies agent state changes', () => {
      const event: GatewayEvent = {
        type: 'event', event: 'agent',
        payload: { state: 'thinking', sessionKey: 'sk' },
      };
      const result = classifyStreamEvent(event);
      expect(result?.type).toBe('agent_state');
      expect(result?.sessionKey).toBe('sk');
    });

    it('extracts runId and seq from agent events', () => {
      const event: GatewayEvent = {
        type: 'event', event: 'agent', seq: 42,
        payload: { runId: 'r-1', seq: 5, stream: 'assistant' },
      };
      const result = classifyStreamEvent(event);
      expect(result?.runId).toBe('r-1');
      expect(result?.chatSeq).toBe(5);
      expect(result?.frameSeq).toBe(42);
    });
  });

  describe('chat events', () => {
    it('classifies chat started', () => {
      const event: GatewayEvent = {
        type: 'event', event: 'chat',
        payload: { state: 'started', sessionKey: 'sk1' },
      };
      const result = classifyStreamEvent(event);
      expect(result?.type).toBe('chat_started');
      expect(result?.sessionKey).toBe('sk1');
    });

    it('classifies chat delta', () => {
      const event: GatewayEvent = {
        type: 'event', event: 'chat',
        payload: { state: 'delta' },
      };
      expect(classifyStreamEvent(event)?.type).toBe('chat_delta');
    });

    it('classifies chat final', () => {
      const event: GatewayEvent = {
        type: 'event', event: 'chat',
        payload: { state: 'final' },
      };
      expect(classifyStreamEvent(event)?.type).toBe('chat_final');
    });

    it('classifies chat aborted', () => {
      const event: GatewayEvent = {
        type: 'event', event: 'chat',
        payload: { state: 'aborted' },
      };
      expect(classifyStreamEvent(event)?.type).toBe('chat_aborted');
    });

    it('classifies chat error', () => {
      const event: GatewayEvent = {
        type: 'event', event: 'chat',
        payload: { state: 'error', error: 'something broke' },
      };
      expect(classifyStreamEvent(event)?.type).toBe('chat_error');
    });

    it('classifies chat status as chat_status', () => {
      const event: GatewayEvent = {
        type: 'event', event: 'chat',
        payload: { state: 'status', sessionKey: 'sk1', runId: 'r-1', phase: 'preparing_context' },
      };
      const result = classifyStreamEvent(event);
      expect(result?.type).toBe('chat_status');
      expect(result?.runId).toBe('r-1');
    });

    it('ignores unknown chat states', () => {
      const event: GatewayEvent = {
        type: 'event', event: 'chat',
        payload: { state: 'unknown-state' },
      };
      expect(classifyStreamEvent(event)?.type).toBe('ignore');
    });
  });
});

describe('extractStreamDelta', () => {
  it('returns null for non-delta events', () => {
    expect(extractStreamDelta({ state: 'final' })).toBeNull();
    expect(extractStreamDelta({ state: 'started' })).toBeNull();
  });

  it('returns null when message is a string', () => {
    expect(extractStreamDelta({ state: 'delta', message: 'raw text' })).toBeNull();
  });

  it('returns null when no message', () => {
    expect(extractStreamDelta({ state: 'delta' })).toBeNull();
  });

  it('extracts text from a delta with text content block', () => {
    const payload = {
      state: 'delta',
      message: {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Hello world' }],
      },
    };
    const result = extractStreamDelta(payload);
    expect(result).not.toBeNull();
    expect(result!.text).toContain('Hello world');
  });

  // Protocol v4 gateways send the append in `deltaText` and only include a
  // `message` snapshot on the first frame of a run or on a new baseline.
  describe('deltaText appends', () => {
    const snapshot = (text: string) => ({
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text }],
    });

    it('appends deltaText to the previous text when no snapshot is present', () => {
      const result = extractStreamDelta({ state: 'delta', deltaText: ' world' }, 'Hello');
      expect(result?.text).toBe('Hello world');
      expect(result?.cleaned).toBe('Hello world');
    });

    it('starts from empty text when there is no previous text', () => {
      expect(extractStreamDelta({ state: 'delta', deltaText: 'Hi' })?.text).toBe('Hi');
    });

    it('treats a supplied snapshot as authoritative instead of appending deltaText', () => {
      const result = extractStreamDelta(
        { state: 'delta', deltaText: 'lo', message: snapshot('Hello') },
        'stale text',
      );
      expect(result?.text).toBe('Hello');
    });

    it('replaces the previous text when replace is set', () => {
      const result = extractStreamDelta({ state: 'delta', deltaText: 'Rewritten', replace: true }, 'Original');
      expect(result?.text).toBe('Rewritten');
    });

    it('clears the text on an empty replacement', () => {
      const result = extractStreamDelta({ state: 'delta', deltaText: '', replace: true }, 'Original');
      expect(result).not.toBeNull();
      expect(result?.text).toBe('');
    });

    it('strips a TTS marker that was split across two appends', () => {
      const first = extractStreamDelta({ state: 'delta', deltaText: 'Done. [tts:All fin' }, '');
      const second = extractStreamDelta({ state: 'delta', deltaText: 'ished]' }, first!.text);
      expect(second?.cleaned).toBe('Done.');
      expect(second?.ttsText).toBe('All finished');
    });

    it('accumulates a realistic frame sequence into the full text', () => {
      const frames = [
        { state: 'delta', deltaText: 'Fore', message: snapshot('Fore') },
        { state: 'delta', deltaText: 'sts absorb' },
        { state: 'delta', deltaText: ' carbon dioxide.' },
      ];
      let text = '';
      for (const frame of frames) text = extractStreamDelta(frame, text)?.text ?? text;
      expect(text).toBe('Forests absorb carbon dioxide.');
    });
  });
});

describe('extractFinalMessages', () => {
  it('returns messages array when present', () => {
    const msgs = [
      { role: 'assistant' as const, content: 'response 1' },
      { role: 'assistant' as const, content: 'response 2' },
    ];
    const result = extractFinalMessages({ state: 'final', messages: msgs });
    expect(result).toHaveLength(2);
  });

  it('wraps single message in array', () => {
    const msg = { role: 'assistant' as const, content: 'hello' };
    const result = extractFinalMessages({ state: 'final', message: msg });
    expect(result).toHaveLength(1);
  });

  it('creates synthetic message from string content', () => {
    const payload = { state: 'final', message: 'plain text' } as Record<string, unknown>;
    const result = extractFinalMessages(payload);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
  });

  it('creates synthetic message from content blocks', () => {
    const blocks = [{ type: 'text' as const, text: 'content block' }];
    const result = extractFinalMessages({ state: 'final', content: blocks });
    expect(result).toHaveLength(1);
  });

  it('returns empty array when no content', () => {
    expect(extractFinalMessages({ state: 'final' })).toHaveLength(0);
  });
});

describe('extractFinalMessage', () => {
  it('returns null when no messages', () => {
    expect(extractFinalMessage({ state: 'final' })).toBeNull();
  });

  it('extracts the last assistant message', () => {
    const msgs = [
      { role: 'user' as const, content: 'question' },
      { role: 'assistant' as const, content: 'answer 1' },
      { role: 'assistant' as const, content: 'answer 2' },
    ];
    const result = extractFinalMessage({ state: 'final', messages: msgs });
    expect(result).not.toBeNull();
    expect(result!.text).toContain('answer 2');
  });
});

describe('buildActivityLogEntry', () => {
  it('builds an entry from a tool start event', () => {
    const entry = buildActivityLogEntry({
      stream: 'tool',
      data: { phase: 'start', name: 'read', toolCallId: 'tc-1', args: { path: 'file.ts' } },
    });
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe('tc-1');
    expect(entry!.toolName).toBe('read');
    expect(entry!.phase).toBe('running');
    expect(entry!.startedAt).toBeGreaterThan(0);
  });

  it('returns null when phase is not start', () => {
    expect(buildActivityLogEntry({
      stream: 'tool',
      data: { phase: 'result', toolCallId: 'tc-1' },
    })).toBeNull();
  });

  it('returns null when name is missing', () => {
    expect(buildActivityLogEntry({
      stream: 'tool',
      data: { phase: 'start', toolCallId: 'tc-1' },
    })).toBeNull();
  });

  it('returns null when toolCallId is missing', () => {
    expect(buildActivityLogEntry({
      stream: 'tool',
      data: { phase: 'start', name: 'read' },
    })).toBeNull();
  });

  it('returns null when data is missing', () => {
    expect(buildActivityLogEntry({})).toBeNull();
  });
});

describe('markToolCompleted', () => {
  it('marks the matching tool as completed', () => {
    const log = [
      { id: 'tc-1', toolName: 'read', description: 'Reading', startedAt: 1, phase: 'running' as const },
      { id: 'tc-2', toolName: 'write', description: 'Writing', startedAt: 2, phase: 'running' as const },
    ];
    const updated = markToolCompleted(log, 'tc-1');
    expect(updated[0].phase).toBe('completed');
    expect(updated[0].completedAt).toBeGreaterThan(0);
    expect(updated[1].phase).toBe('running');
  });

  it('returns unchanged log when id not found', () => {
    const log = [
      { id: 'tc-1', toolName: 'read', description: 'Reading', startedAt: 1, phase: 'running' as const },
    ];
    const updated = markToolCompleted(log, 'tc-999');
    expect(updated[0].phase).toBe('running');
  });
});

describe('appendActivityEntry', () => {
  it('appends entry to log', () => {
    const log = [{ id: '1', toolName: 'a', description: 'a', startedAt: 1, phase: 'running' as const }];
    const entry = { id: '2', toolName: 'b', description: 'b', startedAt: 2, phase: 'running' as const };
    const result = appendActivityEntry(log, entry);
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe('2');
  });

  it('caps at maxEntries', () => {
    const log = Array.from({ length: 6 }, (_, i) => ({
      id: String(i), toolName: 'x', description: 'x', startedAt: i, phase: 'running' as const,
    }));
    const entry = { id: '7', toolName: 'x', description: 'x', startedAt: 7, phase: 'running' as const };
    const result = appendActivityEntry(log, entry, 6);
    expect(result).toHaveLength(6);
    expect(result[5].id).toBe('7');
    expect(result[0].id).toBe('1'); // oldest dropped
  });
});

describe('deriveProcessingStage', () => {
  it('returns thinking for thinking state', () => {
    expect(deriveProcessingStage('thinking')).toBe('thinking');
  });

  it('returns thinking for processing state', () => {
    expect(deriveProcessingStage('processing')).toBe('thinking');
  });

  it('returns tool_use for tool states', () => {
    expect(deriveProcessingStage('tool_use')).toBe('tool_use');
    expect(deriveProcessingStage('executing')).toBe('tool_use');
    expect(deriveProcessingStage('tool')).toBe('tool_use');
  });

  it('returns null for unknown states', () => {
    expect(deriveProcessingStage('idle')).toBeNull();
    expect(deriveProcessingStage('done')).toBeNull();
  });
});
