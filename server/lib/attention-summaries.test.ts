/** Tests for the Attention "What happened" summaries service. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildAgentParams,
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
    expect(transcript?.fingerprint).toBe('e:25');
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
    expect(capped.length).toBeLessThanOrEqual(323);
    expect(capped.endsWith('...')).toBe(true);
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

    expect(await service.get(['agent:main:a'])).toEqual({ 'agent:main:a': { status: 'pending' } });
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

    expect((await service.get(['k'])).k).toEqual({ status: 'error' });
    clock += 60_000;
    expect((await service.get(['k'])).k).toEqual({ status: 'error' });
    expect(gw.runs).toHaveLength(1);

    clock += 300_000;
    expect((await service.get(['k'])).k).toEqual({ status: 'pending' });
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
    expect((await service.get(['k'])).k).toEqual({ status: 'error' });
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
