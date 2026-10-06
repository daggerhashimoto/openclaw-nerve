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

  it('hides exact internal assistant control replies', () => {
    expect(filterMessage({ role: 'assistant', content: 'NO_REPLY' })).toBe(false);
    expect(filterMessage({ role: 'assistant', content: '  HEARTBEAT_OK\n' })).toBe(false);
    expect(filterMessage({ role: 'assistant', content: '{"action":"NO_REPLY"}' })).toBe(false);
    expect(filterMessage({ role: 'assistant', content: '{"action":"NO_REPLY","reason":"idle"}' })).toBe(false);
    expect(filterMessage({ role: 'assistant', content: 'NO_REPLY NO_REPLY' })).toBe(false);
  });

  it('hides internal compaction and memory-flush status rows', () => {
    expect(filterMessage({ role: 'assistant', content: 'Compaction complete.' })).toBe(false);
    expect(filterMessage({ role: 'assistant', content: 'Memory flush completed' })).toBe(false);
    expect(filterMessage({ role: 'system', content: 'checkpoint saved' })).toBe(false);
  });

  it('hides messages marked internal by OpenClaw metadata', () => {
    expect(filterMessage({
      role: 'assistant',
      content: 'The compacted context has been saved.',
      __openclaw: { kind: 'session.compaction_complete' },
    })).toBe(false);

    expect(filterMessage({
      role: 'assistant',
      content: 'Memory state synchronized.',
      kind: 'memory-flush',
    } as ChatMessage)).toBe(false);
  });

  it('shows substantive assistant progress messages even when they mention compaction or memory', () => {
    expect(filterMessage({
      role: 'assistant',
      content: 'I compacted the notes and pushed the branch. Next I am running the focused tests.',
    })).toBe(true);
    expect(filterMessage({
      role: 'assistant',
      content: 'Memory sync is still running, so I am waiting for the next event before refreshing history.',
    })).toBe(true);
  });

  it('hides pure internal wake bundles', () => {
    expect(filterMessage({
      role: 'user',
      content: 'System (untrusted): [2026-04-16 18:27:55 GMT+3] Exec completed (wild-orb, code 0) :: done\n\nAn async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally. Do not relay it to the user unless explicitly requested.\nCurrent time: Thursday, April 16th, 2026 - 6:29 PM (Europe/Istanbul) / 2026-04-16 15:29 UTC',
    })).toBe(false);
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

  it('extracts upload manifest attachments from user transcript messages', () => {
    const msg: ChatMessage = {
      role: 'user',
      content: 'Please use these files.\n\n<nerve-upload-manifest>{"version":1,"attachments":[{"id":"att-upload","origin":"upload","mode":"inline","name":"small.png","mimeType":"image/png","sizeBytes":120000,"inline":{"encoding":"base64","base64":"","base64Bytes":98000,"compressed":true},"preparation":{"sourceMode":"inline","finalMode":"inline","outcome":"optimized_inline","reason":"Inline image stayed within context-safe budget.","originalMimeType":"image/png","originalSizeBytes":120000},"policy":{"forwardToSubagents":false}},{"id":"att-path","origin":"server_path","mode":"file_reference","name":"capture.mov","mimeType":"video/quicktime","sizeBytes":8000000,"reference":{"kind":"local_path","path":"/workspace/capture.mov","uri":"file:///workspace/capture.mov"},"preparation":{"sourceMode":"file_reference","finalMode":"file_reference","outcome":"file_reference_ready","reason":"Sent as a validated workspace path.","originalMimeType":"video/quicktime","originalSizeBytes":8000000},"policy":{"forwardToSubagents":true}}]}</nerve-upload-manifest>',
    };
    const result = splitToolCallMessage(msg);
    expect(result).toHaveLength(1);
    expect(result[0].rawText).toBe('Please use these files.');
    expect(result[0].uploadAttachments).toHaveLength(2);
    expect(result[0].uploadAttachments?.[0].origin).toBe('upload');
    expect(result[0].uploadAttachments?.[1].origin).toBe('server_path');
    expect(result[0].uploadAttachments?.[1].reference?.path).toBe('/workspace/capture.mov');
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

  it('handles user messages with timestamped system events', () => {
    const msg: ChatMessage = {
      role: 'user',
      content: 'System: [2026-02-17 20:30:23 GMT+1] Agent started\nHello!',
    };
    const result = splitToolCallMessage(msg);
    expect(result.some(m => m.role === 'event')).toBe(true);
    expect(result.some(m => m.role === 'user')).toBe(true);
  });

  it('handles untrusted system-event prefixes from newer OpenClaw builds', () => {
    const msg: ChatMessage = {
      role: 'user',
      content: 'System (untrusted): [2026-04-16 18:11:51 GMT+3] Exec completed (gentle-l, code 0) :: done',
    };
    const result = splitToolCallMessage(msg);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('event');
    expect(result[0].rawText).toContain('System (untrusted): [2026-04-16 18:11:51 GMT+3] Exec completed');
  });

  it('strips async exec follow-up instructions from injected system-event bundles', () => {
    const msg: ChatMessage = {
      role: 'user',
      content: 'System (untrusted): [2026-04-16 18:11:51 GMT+3] Exec completed (gentle-l, code 0) :: done\n\nAn async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally. Do not relay it to the user unless explicitly requested.\nCurrent time: Thursday, April 16th, 2026 - 6:12 PM (Europe/Istanbul) / 2026-04-16 15:12 UTC',
    };
    const result = splitToolCallMessage(msg);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('event');
    expect(result[0].rawText).not.toContain('An async command you ran earlier has completed.');
    expect(result[0].rawText).not.toContain('Current time:');
  });

  it('strips standalone follow-up lines like "Handle the result internally."', () => {
    const msg: ChatMessage = {
      role: 'user',
      content: 'System (untrusted): [2026-04-16 18:11:51 GMT+3] Exec completed (gentle-l, code 0) :: done\nHandle the result internally.\nDo not relay it to the user unless explicitly requested.',
    };
    const result = splitToolCallMessage(msg);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('event');
    expect(result[0].rawText).not.toContain('Handle the result internally.');
  });

  it('preserves later user text and paragraph breaks after a system event bundle', () => {
    const msg: ChatMessage = {
      role: 'user',
      content: 'System (untrusted): [2026-04-16 18:11:51 GMT+3] Exec completed (gentle-l, code 0) :: done\n\nAn async command you ran earlier has completed.\nCurrent time: Thursday, April 16th, 2026 - 6:12 PM (Europe/Istanbul) / 2026-04-16 15:12 UTC\nHello there\n\nSecond paragraph',
    };
    const result = splitToolCallMessage(msg);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('event');
    expect(result[1].role).toBe('user');
    expect(result[1].rawText).toBe('Hello there\n\nSecond paragraph');
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

  it('drops internal wake bundles and silent control replies from rendered history', () => {
    const msgs: ChatMessage[] = [
      { role: 'assistant', content: 'Already did it' },
      {
        role: 'user',
        content: 'System (untrusted): [2026-04-16 18:27:55 GMT+3] Exec completed (wild-orb, code 0) :: done\nSystem (untrusted): [2026-04-16 18:28:54 GMT+3] Exec completed (rapid-sa, code 0) :: https://github.com/daggerhashimoto/openclaw-nerve/pull/278\n\nAn async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally. Do not relay it to the user unless explicitly requested.\nCurrent time: Thursday, April 16th, 2026 - 6:29 PM (Europe/Istanbul) / 2026-04-16 15:29 UTC',
      },
      { role: 'assistant', content: 'NO_REPLY' },
    ];
    const result = processChatMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    expect(result[0].rawText).toBe('Already did it');
  });

  it('drops internal compaction and memory rows from rendered history', () => {
    const result = processChatMessages([
      { role: 'user', content: 'Please continue with the Nerve fixes.' },
      {
        role: 'assistant',
        content: 'Compaction complete.',
        __openclaw: { kind: 'session.compaction_complete', id: 'compaction-1' },
      },
      { role: 'assistant', content: '{"action":"NO_REPLY"}' },
      {
        role: 'assistant',
        content: 'I am updating the chat adapter now.',
        __openclaw: { mirrorIdentity: 'run-1:assistant:final' },
      },
    ], { sessionKey: 'agent:main:main' });

    expect(result.map((m) => m.rawText)).toEqual([
      'Please continue with the Nerve fixes.',
      'I am updating the chat adapter now.',
    ]);
  });

  it('removes embedded runtime context while retaining assistant prose', () => {
    const result = processChatMessages([
      {
        role: 'assistant',
        content: 'I will keep working.\n<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>\n{"token":"secret"}\n<<<END_OPENCLAW_INTERNAL_CONTEXT>>>\nVisible follow-up.',
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].rawText).toBe('I will keep working.\n\nVisible follow-up.');
    expect(result[0].rawText).not.toContain('BEGIN_OPENCLAW_INTERNAL_CONTEXT');
    expect(result[0].html).not.toContain('BEGIN_OPENCLAW_INTERNAL_CONTEXT');
  });

  it('handles empty input', () => {
    expect(processChatMessages([])).toHaveLength(0);
  });

  it('preserves legacy MediaPath and MediaUrl images as extracted images', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'legacy image payload',
        MediaPath: '/root/.openclaw/workspace/legacy/screenshot.png',
        MediaUrls: ['https://example.com/generated.png'],
      },
    ];

    const result = processChatMessages(msgs);

    expect(result).toHaveLength(1);
    expect(result[0].extractedImages).toEqual([
      { url: '/api/files?path=%2Froot%2F.openclaw%2Fworkspace%2Flegacy%2Fscreenshot.png', alt: 'screenshot.png' },
      { url: 'https://example.com/generated.png', alt: 'generated.png' },
    ]);
  });

  it('does not synthesize omitted transcript image URLs without a persisted timestamp', () => {
    const result = processChatMessages([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'generated image' },
          { type: 'image', omitted: true, mimeType: 'image/png' },
        ],
      },
    ], { sessionKey: 'agent:main:main' });

    expect(result).toHaveLength(1);
    expect(result[0].extractedImages).toBeUndefined();
  });

  it('deduplicates merged image references while preserving order', () => {
    const result = processChatMessages([
      {
        role: 'assistant',
        content: '![generated](https://example.com/generated.png)\n![other](https://example.com/other.png)',
        MediaUrls: ['https://example.com/generated.png'],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].extractedImages?.map((img) => img.url)).toEqual([
      'https://example.com/generated.png',
      'https://example.com/other.png',
    ]);
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

  it('hydrates omitted transcript images through the session media route', async () => {
    const rpc = vi.fn().mockResolvedValue({
      messages: [
        {
          role: 'assistant',
          timestamp: 1775131617235,
          content: [
            { type: 'text', text: 'generated image' },
            { type: 'image', omitted: true, mimeType: 'image/png' },
          ],
        },
      ],
    });

    const result = await loadChatHistory({ rpc, sessionKey: 'agent:main:main' });

    expect(result).toHaveLength(1);
    expect(result[0].extractedImages).toEqual([
      {
        url: '/api/sessions/media?sessionKey=agent%3Amain%3Amain&timestamp=1775131617235&imageIndex=0',
        alt: 'message-1775131617235-image-0.png',
      },
    ]);
  });
});
