/** Tests for loadHistory — filtering, splitting, grouping, and tagging. */
import { describe, it, expect, vi } from 'vitest';
import {
  filterMessage,
  splitToolCallMessage,
  groupToolMessages,
  tagIntermediateMessages,
  processChatMessages,
  loadChatHistory,
} from './loadHistory';
import type { ChatMessage } from '@/types';
import type { ChatMsg } from '@/features/chat/types';

describe('filterMessage', () => {
  it('shows normal user messages', () => {
    expect(filterMessage({ role: 'user', content: 'Hello' })).toBe(true);
  });

  it('shows normal assistant messages', () => {
    expect(filterMessage({ role: 'assistant', content: 'Hi there' })).toBe(true);
  });

  it('passes through sub-agent completions (tagged)', () => {
    expect(filterMessage({
      role: 'user',
      content: 'A background task "cleanup" just completed.',
    })).toBe(true);
  });

  it('passes through cron completions (tagged)', () => {
    expect(filterMessage({
      role: 'user',
      content: 'A cron job "daily-check" just completed.',
    })).toBe(true);
  });

  it('passes through queued announce messages (tagged)', () => {
    expect(filterMessage({
      role: 'user',
      content: '[Queued announce messages while agent was busy] Some content',
    })).toBe(true);
  });

  it('passes through background task messages (tagged)', () => {
    expect(filterMessage({
      role: 'user',
      content: 'A background task started.',
    })).toBe(true);
  });

  it('passes through trigger blocks (tagged)', () => {
    expect(filterMessage({
      role: 'user',
      content: 'Findings:results here\nSummarize this naturally for the user.',
    })).toBe(true);
  });

  it('hides redundant Edit tool results', () => {
    expect(filterMessage({
      role: 'tool',
      content: 'Successfully replaced text in /path/file.ts.',
    })).toBe(false);
  });

  it('hides redundant Write tool results', () => {
    expect(filterMessage({
      role: 'tool',
      content: 'Successfully wrote 1234 bytes to /path/file.ts.',
    })).toBe(false);
  });

  it('shows tool results with other content', () => {
    expect(filterMessage({
      role: 'tool',
      content: 'File contents:\nfunction hello() {}',
    })).toBe(true);
  });
});

describe('splitToolCallMessage', () => {
  it('returns a single ChatMsg for simple text messages', () => {
    const msg: ChatMessage = { role: 'assistant', content: 'Simple response' };
    const result = splitToolCallMessage(msg);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    expect(result[0].rawText).toContain('Simple response');
  });

  it('splits tool_use content blocks into separate messages', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me read that file.' },
        { type: 'tool_use', name: 'read', input: { path: 'file.ts' } },
        { type: 'text', text: 'Here is the content.' },
      ],
    };
    const result = splitToolCallMessage(msg);
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.some(m => m.role === 'tool')).toBe(true);
  });

  it('strips voice markers from user messages', () => {
    const msg: ChatMessage = { role: 'user', content: '[voice] Hello world' };
    const result = splitToolCallMessage(msg);
    expect(result).toHaveLength(1);
    expect(result[0].rawText).not.toContain('[voice]');
    expect(result[0].isVoice).toBe(true);
  });

  it('returns empty array for voice-only messages with no text', () => {
    const msg: ChatMessage = { role: 'user', content: '[voice] ' };
    const result = splitToolCallMessage(msg);
    expect(result).toHaveLength(0);
  });

  it('handles thinking blocks', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: [
        { type: 'thinking', text: 'Let me think about this...' },
        { type: 'text', text: 'Here is my answer.' },
      ],
    };
    const result = splitToolCallMessage(msg);
    expect(result.some(m => m.isThinking)).toBe(true);
  });

  it('handles user messages with system events', () => {
    const msg: ChatMessage = {
      role: 'user',
      content: 'System: [2026-02-17 20:30:23 GMT+1] Agent started\nHello!',
    };
    const result = splitToolCallMessage(msg);
    expect(result.some(m => m.role === 'event')).toBe(true);
    expect(result.some(m => m.role === 'user')).toBe(true);
  });
});

describe('groupToolMessages', () => {
  it('returns non-tool messages unchanged', () => {
    const msgs: ChatMsg[] = [
      { role: 'user', html: '', rawText: 'hi', timestamp: new Date() },
      { role: 'assistant', html: '', rawText: 'hello', timestamp: new Date() },
    ];
    const result = groupToolMessages(msgs);
    expect(result).toHaveLength(2);
  });

  it('groups consecutive tool messages', () => {
    const msgs: ChatMsg[] = [
      { role: 'tool', html: '', rawText: '**tool:** `read`\n```json\n{}\n```', timestamp: new Date() },
      { role: 'tool', html: '', rawText: '**tool:** `write`\n```json\n{}\n```', timestamp: new Date() },
    ];
    const result = groupToolMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].toolGroup).toBeDefined();
    expect(result[0].toolGroup).toHaveLength(2);
  });

  it('does not group a single tool message', () => {
    const msgs: ChatMsg[] = [
      { role: 'tool', html: '', rawText: '**tool:** `read`\n```json\n{}\n```', timestamp: new Date() },
    ];
    const result = groupToolMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].toolGroup).toBeUndefined();
  });

  it('flushes tool buffer before non-tool message', () => {
    const msgs: ChatMsg[] = [
      { role: 'tool', html: '', rawText: '**tool:** `read`\n```json\n{}\n```', timestamp: new Date() },
      { role: 'tool', html: '', rawText: '**tool:** `write`\n```json\n{}\n```', timestamp: new Date() },
      { role: 'assistant', html: '', rawText: 'Done!', timestamp: new Date() },
    ];
    const result = groupToolMessages(msgs);
    expect(result).toHaveLength(2);
  });
});

describe('tagIntermediateMessages', () => {
  it('marks assistant messages before tools as intermediate', () => {
    const msgs: ChatMsg[] = [
      { role: 'assistant', html: '', rawText: 'Let me check...', timestamp: new Date() },
      { role: 'tool', html: '', rawText: 'result', timestamp: new Date() },
      { role: 'assistant', html: '', rawText: 'Here you go.', timestamp: new Date() },
    ];
    const result = tagIntermediateMessages(msgs);
    expect(result[0].intermediate).toBe(true);
    expect(result[2].intermediate).toBeFalsy();
  });

  it('does not mark the last assistant message as intermediate', () => {
    const msgs: ChatMsg[] = [
      { role: 'assistant', html: '', rawText: 'Final answer.', timestamp: new Date() },
    ];
    const result = tagIntermediateMessages(msgs);
    expect(result[0].intermediate).toBeFalsy();
  });

  it('does not mark thinking messages as intermediate', () => {
    const msgs: ChatMsg[] = [
      { role: 'assistant', html: '', rawText: 'thinking...', timestamp: new Date(), isThinking: true },
      { role: 'tool', html: '', rawText: 'result', timestamp: new Date() },
    ];
    const result = tagIntermediateMessages(msgs);
    expect(result[0].intermediate).toBeFalsy();
  });

  it('does not mutate input array', () => {
    const msgs: ChatMsg[] = [
      { role: 'assistant', html: '', rawText: 'Check', timestamp: new Date() },
      { role: 'tool', html: '', rawText: 'result', timestamp: new Date() },
    ];
    const result = tagIntermediateMessages(msgs);
    expect(msgs[0].intermediate).toBeUndefined();
    expect(result[0].intermediate).toBe(true);
  });
});

describe('processChatMessages', () => {
  it('runs the full pipeline: filter → split → group → tag', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    const result = processChatMessages(msgs);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.every(m => m.msgId)).toBe(true);
  });

  it('tags background task notifications as system notifications', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'A background task "x" just completed.' },
      { role: 'assistant', content: 'Hello' },
    ];
    const result = processChatMessages(msgs);
    const sysMsg = result.find(m => m.rawText.includes('background task'));
    expect(sysMsg).toBeDefined();
    expect(sysMsg!.isSystemNotification).toBe(true);
  });

  it('handles empty input', () => {
    expect(processChatMessages([])).toHaveLength(0);
  });
});

describe('loadChatHistory', () => {
  it('loads and processes messages via RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ],
    });

    const result = await loadChatHistory({ rpc, sessionKey: 'sk-1' });
    expect(rpc).toHaveBeenCalledWith('chat.history', { sessionKey: 'sk-1', limit: 100 });
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('handles empty response', async () => {
    const rpc = vi.fn().mockResolvedValue({ messages: [] });
    const result = await loadChatHistory({ rpc, sessionKey: 'sk-1' });
    expect(result).toHaveLength(0);
  });

  it('handles null response', async () => {
    const rpc = vi.fn().mockResolvedValue(null);
    const result = await loadChatHistory({ rpc, sessionKey: 'sk-1' });
    expect(result).toHaveLength(0);
  });

  it('respects custom limit', async () => {
    const rpc = vi.fn().mockResolvedValue({ messages: [] });
    await loadChatHistory({ rpc, sessionKey: 'sk', limit: 50 });
    expect(rpc).toHaveBeenCalledWith('chat.history', { sessionKey: 'sk', limit: 50 });
  });

  it('propagates RPC errors', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('network error'));
    await expect(loadChatHistory({ rpc, sessionKey: 'sk' })).rejects.toThrow('network error');
  });
});
