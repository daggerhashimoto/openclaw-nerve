/** Tests for the Attention "What happened" summaries service. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  asksOperator,
  buildAgentParams,
  buildPrompt,
  buildTranscript,
  cleanSummary,
  createAttentionSummaries,
  readAgentOutput,
  type RpcCall,
} from './attention-summaries.js';

interface Deferred {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

function msg(role: string, text: string, id: string) {
  return { role, content: [{ type: 'text', text }], __openclaw: { id } };
}

function final(text: string) {
  return { status: 'ok', result: { payloads: [{ text }] } };
}

/** A gateway whose histories are set per key and whose agent runs resolve when the test says. */
function fakeGateway() {
  const histories = new Map<string, unknown[]>();
  const runs: Array<{ params: Record<string, unknown>; deferred: Deferred; timeoutMs?: number; options?: unknown }> = [];
  const rpc = vi.fn<RpcCall>(async (method, params, timeoutMs, options) => {
    if (method === 'chat.history') {
      const messages = histories.get(params.sessionKey as string);
      if (!messages) throw new Error('unknown session');
      return { messages };
    }
    if (method === 'agent') {
      return new Promise((resolve, reject) => {
        runs.push({ params, deferred: { resolve, reject }, timeoutMs, options });
      });
    }
    throw new Error(`unexpected ${method}`);
  });
  return { rpc, histories, runs };
}

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('buildTranscript', () => {
  it('keeps user and assistant text, collapses tool-only turns and drops tool results', () => {
    const transcript = buildTranscript([
      msg('user', 'Fix the login bug', 'a'),
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'toolCall', name: 'exec' }], __openclaw: { id: 'b' } },
      { role: 'toolResult', content: [{ type: 'text', text: 'lots of output' }], __openclaw: { id: 'c' } },
      { role: 'assistant', content: [{ type: 'toolCall', name: 'read' }, { type: 'toolCall', name: 'exec' }], __openclaw: { id: 'd' } },
      msg('assistant', 'Fixed it and opened a PR.', 'e'),
      { role: 'custom', content: [{ type: 'text', text: 'internal' }] },
    ]);
    expect(transcript?.text).toBe('User: Fix the login bug\nAgent used tools: exec, read\nAgent: Fixed it and opened a PR.');
    expect(transcript?.fingerprint).toBe('v4:e:25');
  });

  it('does not change the fingerprint for tool-only activity after the last text', () => {
    const base = [msg('user', 'Go', 'a'), msg('assistant', 'Working on it', 'b')];
    const before = buildTranscript(base);
    const after = buildTranscript([...base, { role: 'assistant', content: [{ type: 'toolCall', name: 'exec' }], __openclaw: { id: 'c' } }]);
    expect(after?.fingerprint).toBe(before?.fingerprint);
  });

  it('truncates long messages and returns null when there is no text', () => {
    const long = buildTranscript([msg('user', 'x'.repeat(2_000), 'a')]);
    expect(long!.text.length).toBeLessThan(520);
    expect(long!.text.endsWith('...')).toBe(true);
    expect(buildTranscript([{ role: 'assistant', content: [{ type: 'toolCall', name: 'exec' }] }])).toBeNull();
    expect(buildTranscript(undefined)).toBeNull();
  });
});

describe('whose turn it is', () => {
  it('says the agent spoke last, when, and whether it asked the operator something', () => {
    const asked = buildTranscript([
      { ...msg('user', 'Can you clean up the deploy script?', 'a'), timestamp: 1_000 },
      { ...msg('assistant', `${'I rewrote the script and checked it on staging. '.repeat(20)}Should I ship it to production now?`, 'b'), timestamp: 1_764_300_000_000 },
    ]);
    // The question sits past the 500 characters the transcript keeps of a message.
    expect(asked?.turn).toEqual({ lastSpeaker: 'agent', lastAt: 1_764_300_000_000, asksOperator: true });

    const told = buildTranscript([msg('user', 'Ship it', 'a'), msg('assistant', 'Shipped as v1.6.1.', 'b')]);
    expect(told?.turn).toEqual({ lastSpeaker: 'agent', asksOperator: false });

    const waiting = buildTranscript([msg('assistant', 'Want me to retry?', 'a'), { ...msg('user', 'Yes, retry once', 'b'), timestamp: '2026-11-28T10:00:00Z' }]);
    expect(waiting?.turn).toEqual({ lastSpeaker: 'operator', lastAt: Date.parse('2026-11-28T10:00:00Z'), asksOperator: false });
  });

  it('reads a request without a question mark, and ignores question marks in code and links', () => {
    expect(asksOperator('Two options are ready. Let me know which one to merge.')).toBe(true);
    expect(asksOperator('Draft is up. Please review the copy before I send it.')).toBe(true);
    expect(asksOperator('Fixed. The query was `SELECT * FROM t WHERE a = ?`')).toBe(false);
    expect(asksOperator('Done, see https://example.com/search?q=1')).toBe(false);
    expect(asksOperator('Asked the API "is it up?" and it said yes. All green.')).toBe(false);
    expect(asksOperator('All tests pass. Merged #458.')).toBe(false);
  });

  it('answers the turn with every status, read fresh while the text is cached', async () => {
    const gw = fakeGateway();
    gw.histories.set('k', [msg('user', 'Do it', '1'), msg('assistant', 'Did it. Anything else?', '2')]);
    const service = createAttentionSummaries({ rpc: gw.rpc });
    expect((await service.get(['k'])).k).toMatchObject({ status: 'pending', lastSpeaker: 'agent', asksOperator: true });
    await flush();
    gw.runs[0].deferred.resolve(final('It did it and asked for more.'));
    await service.whenIdle();
    expect((await service.get(['k'])).k).toMatchObject({ status: 'ready', asksOperator: true });

    // The operator answers; the turn moves at once even though the summary is not redone yet.
    gw.histories.set('k', [msg('user', 'Do it', '1'), msg('assistant', 'Did it. Anything else?', '2'), msg('user', 'No, thanks', '3')]);
    expect((await service.get(['k'])).k).toMatchObject({ lastSpeaker: 'operator', asksOperator: false, text: 'It did it and asked for more.' });
  });

  it('asks the model for a first sentence that stands alone', () => {
    expect(buildPrompt('User: hi')).toContain('The first sentence is shown alone in a list');
  });
});

describe('buildAgentParams', () => {
  it('builds a one-shot model run with a provider/model override from the env value', () => {
    const params = buildAgentParams('agent:research:main', 'PROMPT', 'opencode-go/deepseek-v4.1-flash');
    expect(params).toMatchObject({
      agentId: 'research',
      message: 'PROMPT',
      provider: 'opencode-go',
      model: 'deepseek-v4.1-flash',
      modelRun: true,
      promptMode: 'none',
      cleanupBundleMcpOnRunEnd: true,
    });
    expect(params.sessionId).toMatch(/^model-run-[0-9a-f-]{36}$/);
    expect(params.sessionKey).toBe(`agent:research:explicit:${params.sessionId as string}`);
    expect(typeof params.idempotencyKey).toBe('string');
  });

  it('sends no override when the model is unset or not provider/model', () => {
    for (const value of [undefined, '', '  ', 'just-a-model', '/x', 'x/']) {
      const params = buildAgentParams('agent:main:main', 'P', value);
      expect(params).not.toHaveProperty('provider');
      expect(params).not.toHaveProperty('model');
    }
  });

  it('falls back to main for a key without an agent', () => {
    expect(buildAgentParams('weird-key', 'P', undefined).agentId).toBe('main');
  });
});

describe('readAgentOutput and cleanSummary', () => {
  it('reads payload text and throws on a failed run', () => {
    expect(readAgentOutput(final('Done.'))).toBe('Done.');
    expect(() => readAgentOutput({ status: 'error', result: { meta: { error: { message: 'quota' } } } })).toThrow('quota');
  });

  it('strips markdown, labels and dashes, and caps the length', () => {
    expect(cleanSummary('**Summary:** The agent fixed it — tests pass.')).toBe('The agent fixed it, tests pass.');
    const capped = cleanSummary('word '.repeat(200));
    expect(capped.length).toBeLessThanOrEqual(603);
    expect(capped.endsWith('...')).toBe(true);
  });

  it('ends an over-long summary on its last finished sentence', () => {
    const sentence = 'The agent read the logs and fixed the retry. ';
    const text = cleanSummary(sentence.repeat(20));
    expect(text.length).toBeLessThanOrEqual(600);
    expect(text.endsWith('retry.')).toBe(true);
    expect(text).not.toContain('...');
  });
});

describe('createAttentionSummaries', () => {
  let tmpDir: string;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attention-summaries-'));
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warn.mockRestore();
    vi.useRealTimers();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('generates in the background, then answers from the cache for the same fingerprint', async () => {
    const gw = fakeGateway();
    gw.histories.set('agent:main:a', [msg('user', 'Do it', '1'), msg('assistant', 'Did it', '2')]);
    const service = createAttentionSummaries({ rpc: gw.rpc, model: () => 'opencode-go/deepseek-v4.1-flash' });

    expect(await service.get(['agent:main:a'])).toEqual({
      'agent:main:a': { status: 'pending', lastSpeaker: 'agent', asksOperator: false },
    });
    await flush();
    expect(gw.runs).toHaveLength(1);
    expect(gw.runs[0].options).toEqual({ expectFinal: true });
    expect(gw.runs[0].params).toMatchObject({ provider: 'opencode-go', model: 'deepseek-v4.1-flash', modelRun: true });
    expect(gw.runs[0].params.message).toContain('User: Do it\nAgent: Did it');

    gw.runs[0].deferred.resolve(final('You asked it to do it. It did.'));
    await service.whenIdle();

    const ready = await service.get(['agent:main:a']);
    expect(ready['agent:main:a']).toMatchObject({ status: 'ready', text: 'You asked it to do it. It did.' });
    expect(gw.runs).toHaveLength(1);
  });

  it('regenerates when the thread has a new message, keeping the old text while pending', async () => {
    let clock = 1_000_000;
    const gw = fakeGateway();
    gw.histories.set('k', [msg('user', 'Go', '1')]);
    const service = createAttentionSummaries({ rpc: gw.rpc, now: () => clock });

    await service.get(['k']);
    await flush();
    gw.runs[0].deferred.resolve(final('First.'));
    await service.whenIdle();

    gw.histories.set('k', [msg('user', 'Go', '1'), msg('assistant', 'Gone', '2')]);
    clock += 61_000;
    expect((await service.get(['k'])).k).toMatchObject({ status: 'pending', text: 'First.' });
    await flush();
    expect(gw.runs).toHaveLength(2);
    gw.runs[1].deferred.resolve(final('Second.'));
    await service.whenIdle();
    expect((await service.get(['k'])).k).toMatchObject({ status: 'ready', text: 'Second.' });
  });

  it('does not regenerate a changing thread more often than the minimum interval', async () => {
    let clock = 1_000_000;
    const gw = fakeGateway();
    gw.histories.set('k', [msg('user', 'Go', '1')]);
    const service = createAttentionSummaries({ rpc: gw.rpc, now: () => clock });
    await service.get(['k']);
    await flush();
    gw.runs[0].deferred.resolve(final('First.'));
    await service.whenIdle();

    gw.histories.set('k', [msg('user', 'Go', '1'), msg('assistant', 'More', '2')]);
    clock += 10_000;
    expect((await service.get(['k'])).k).toMatchObject({ status: 'pending', text: 'First.' });
    await flush();
    expect(gw.runs).toHaveLength(1);

    clock += 51_000;
    expect((await service.get(['k'])).k).toMatchObject({ status: 'pending', text: 'First.' });
    await flush();
    expect(gw.runs).toHaveLength(2);
    gw.runs[1].deferred.resolve(final('Second.'));
    await service.whenIdle();
  });

  it('dedupes in-flight work per session', async () => {
    const gw = fakeGateway();
    gw.histories.set('k', [msg('user', 'Go', '1')]);
    const service = createAttentionSummaries({ rpc: gw.rpc });
    await Promise.all([service.get(['k']), service.get(['k']), service.get(['k', 'k'])]);
    await flush();
    expect(gw.runs).toHaveLength(1);
    gw.runs[0].deferred.resolve(final('Once.'));
    await service.whenIdle();
  });

  it('runs at most two generations at once', async () => {
    const gw = fakeGateway();
    const keys = ['a', 'b', 'c', 'd'];
    for (const key of keys) gw.histories.set(key, [msg('user', `Task ${key}`, key)]);
    const service = createAttentionSummaries({ rpc: gw.rpc });

    const first = await service.get(keys);
    expect(Object.values(first).every((result) => result.status === 'pending')).toBe(true);
    await flush();
    expect(gw.runs).toHaveLength(2);

    gw.runs[0].deferred.resolve(final('A.'));
    await flush();
    expect(gw.runs).toHaveLength(3);
    gw.runs[1].deferred.resolve(final('B.'));
    gw.runs[2].deferred.resolve(final('C.'));
    await flush();
    expect(gw.runs).toHaveLength(4);
    gw.runs[3].deferred.resolve(final('D.'));
    await service.whenIdle();

    const done = await service.get(keys);
    expect(keys.map((key) => done[key].text)).toEqual(['A.', 'B.', 'C.', 'D.']);
  });

  it('records an error and retries only after the back-off', async () => {
    let clock = 1_000_000;
    const gw = fakeGateway();
    gw.histories.set('k', [msg('user', 'Go', '1')]);
    const service = createAttentionSummaries({ rpc: gw.rpc, now: () => clock, retryMs: 300_000 });

    await service.get(['k']);
    await flush();
    gw.runs[0].deferred.reject(new Error('invalid agent params: unexpected property modelRun'));
    await service.whenIdle();

    expect((await service.get(['k'])).k).toMatchObject({ status: 'error' });
    clock += 60_000;
    expect((await service.get(['k'])).k).toMatchObject({ status: 'error' });
    expect(gw.runs).toHaveLength(1);

    clock += 300_000;
    expect((await service.get(['k'])).k).toMatchObject({ status: 'pending' });
    await flush();
    expect(gw.runs).toHaveLength(2);
    gw.runs[1].deferred.resolve(final('Recovered.'));
    await service.whenIdle();
  });

  it('times out a run that never answers and records it as an error', async () => {
    vi.useFakeTimers();
    const gw = fakeGateway();
    gw.histories.set('k', [msg('user', 'Go', '1')]);
    const service = createAttentionSummaries({ rpc: gw.rpc, timeoutMs: 90_000 });

    await service.get(['k']);
    await vi.advanceTimersByTimeAsync(0);
    expect(gw.runs).toHaveLength(1);
    expect(gw.runs[0].timeoutMs).toBeGreaterThanOrEqual(90_000);

    await vi.advanceTimersByTimeAsync(90_000);
    await service.whenIdle();
    expect((await service.get(['k'])).k).toMatchObject({ status: 'error' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  });

  it('answers empty for a thread with no text and error when history cannot be read', async () => {
    const gw = fakeGateway();
    gw.histories.set('quiet', [{ role: 'assistant', content: [{ type: 'toolCall', name: 'exec' }] }]);
    const service = createAttentionSummaries({ rpc: gw.rpc });
    const result = await service.get(['quiet', 'missing']);
    expect(result).toEqual({ quiet: { status: 'empty' }, missing: { status: 'error' } });
    expect(gw.runs).toHaveLength(0);
  });

  it('persists ready summaries and reads them back', async () => {
    const filePath = path.join(tmpDir, 'attention', 'summaries.json');
    const gw = fakeGateway();
    gw.histories.set('k', [msg('user', 'Go', '1')]);
    const first = createAttentionSummaries({ rpc: gw.rpc, filePath });
    await first.get(['k']);
    await flush();
    gw.runs[0].deferred.resolve(final('Saved.'));
    await first.whenIdle();

    const stored = JSON.parse(await fs.readFile(filePath, 'utf-8')) as { entries: Record<string, { text: string }> };
    expect(stored.entries.k.text).toBe('Saved.');

    const second = createAttentionSummaries({ rpc: gw.rpc, filePath });
    expect((await second.get(['k'])).k).toMatchObject({ status: 'ready', text: 'Saved.' });
    expect(gw.runs).toHaveLength(1);
  });
});
