/** Tests for the Today digest's day summary service. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DAY_SUMMARY_MIN_INTERVAL_MS,
  buildDayPrompt,
  createDaySummary,
  fingerprintFacts,
  type DayFacts,
} from './attention-day-summary.js';
import type { RpcCall } from './attention-summaries.js';

function facts(overrides: Partial<DayFacts> = {}): DayFacts {
  return {
    day: '2026-11-28',
    counts: { sessions: 3, done: 2, merged: 1, cronOk: 4, cronFailed: 0 },
    done: ['14:56 PR #458 merged (Render flow cards)', '13:05 Task done: Write the brief'],
    chats: ['Linus, cli', 'Kim, telegram, needs reply (Review)'],
    missing: [],
    ...overrides,
  };
}

interface Run {
  params: Record<string, unknown>;
  options?: unknown;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

function fakeGateway() {
  const runs: Run[] = [];
  const rpc = vi.fn<RpcCall>((method, params, _timeoutMs, options) => {
    if (method !== 'agent') return Promise.reject(new Error(`unexpected ${method}`));
    return new Promise((resolve, reject) => { runs.push({ params, options, resolve, reject }); });
  });
  return { rpc, runs };
}

const ok = (text: string) => ({ status: 'ok', result: { payloads: [{ text }] } });

describe('buildDayPrompt', () => {
  it('lists the counts, the lines and what was not read, and forbids guessing', () => {
    const prompt = buildDayPrompt(facts({ missing: ['cron runs'] }));
    expect(prompt).toContain('at most three short plain sentences');
    expect(prompt).toContain('failures first');
    expect(prompt).toContain('do not say anything is open or waiting unless the facts show it');
    expect(prompt).toContain('Do not add names, numbers or events that are not listed');
    expect(prompt).toContain('No markdown');
    expect(prompt).toContain('3 sessions active, 2 things done, 1 pull requests merged, 0 cron jobs failing');
    expect(prompt).not.toContain('cron runs ok');
    expect(prompt).toContain('do not mention cron jobs that ran fine or that recovered');
    expect(prompt).toContain('14:56 PR #458 merged (Render flow cards)');
    expect(prompt).toContain('Kim, telegram, needs reply (Review)');
    expect(prompt).toContain('Not read: cron runs.');
  });
});

describe('fingerprintFacts', () => {
  it('is stable for the same facts and changes with any line', () => {
    expect(fingerprintFacts(facts())).toBe(fingerprintFacts(facts()));
    expect(fingerprintFacts(facts({ done: ['13:05 Task done: Write the brief'] }))).not.toBe(fingerprintFacts(facts()));
  });
});

describe('createDaySummary', () => {
  let tmpDir: string;
  let clock: number;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'day-summary-'));
    clock = 1_000_000;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('answers pending, then the cached text for the same facts without another run', async () => {
    const { rpc, runs } = fakeGateway();
    const service = createDaySummary({ rpc, now: () => clock, model: () => 'opencode-go/deepseek-v4.1-flash' });

    expect(await service.get(facts())).toEqual({ status: 'pending' });
    expect(await service.get(facts())).toEqual({ status: 'pending' });
    expect(runs).toHaveLength(1);
    runs[0].resolve(ok('**Summary:** One PR merged today. Kim waits on your review.'));
    await service.whenIdle();

    expect(await service.get(facts())).toEqual({ status: 'ready', text: 'One PR merged today. Kim waits on your review.', updatedAt: clock });
    expect(runs).toHaveLength(1);
  });

  it('sends a one-shot model run with the override and the final flag', async () => {
    const { rpc, runs } = fakeGateway();
    const service = createDaySummary({ rpc, now: () => clock, model: () => 'opencode-go/deepseek-v4.1-flash' });
    await service.get(facts());
    expect(runs[0].params).toMatchObject({
      agentId: 'main',
      provider: 'opencode-go',
      model: 'deepseek-v4.1-flash',
      modelRun: true,
      promptMode: 'none',
    });
    expect(String(runs[0].params.sessionKey)).toMatch(/^agent:main:explicit:model-run-/);
    expect(String(runs[0].params.message)).toContain('Day: 2026-11-28');
    expect(runs[0].options).toEqual({ expectFinal: true });
    runs[0].resolve(ok('Done.'));
    await service.whenIdle();
  });

  it('leaves the model to the agent default when no override is set', async () => {
    const { rpc, runs } = fakeGateway();
    const service = createDaySummary({ rpc, now: () => clock });
    await service.get(facts());
    expect(runs[0].params).not.toHaveProperty('provider');
    expect(runs[0].params).not.toHaveProperty('model');
    runs[0].resolve(ok('Done.'));
    await service.whenIdle();
  });

  it('keeps the last text for new facts inside the interval and writes again after it', async () => {
    const { rpc, runs } = fakeGateway();
    const service = createDaySummary({ rpc, now: () => clock });
    await service.get(facts());
    runs[0].resolve(ok('First text.'));
    await service.whenIdle();

    const changed = facts({ counts: { ...facts().counts, sessions: 5 } });
    clock += DAY_SUMMARY_MIN_INTERVAL_MS - 1;
    expect(await service.get(changed)).toEqual({ status: 'ready', text: 'First text.', updatedAt: 1_000_000 });
    expect(runs).toHaveLength(1);

    clock += 1;
    expect(await service.get(changed)).toEqual({ status: 'pending', text: 'First text.', updatedAt: 1_000_000 });
    expect(runs).toHaveLength(2);
    runs[1].resolve(ok('Second text.'));
    await service.whenIdle();
    expect(await service.get(changed)).toMatchObject({ status: 'ready', text: 'Second text.' });
  });

  it('rewrites at once inside the interval when what got done, merged or failed changes', async () => {
    const { rpc, runs } = fakeGateway();
    const service = createDaySummary({ rpc, now: () => clock });
    await service.get(facts());
    runs[0].resolve(ok('Two things done.'));
    await service.whenIdle();

    clock += 60_000;
    const fewer = facts({ counts: { ...facts().counts, done: 0 } });
    expect(await service.get(fewer)).toMatchObject({ status: 'pending', text: 'Two things done.' });
    expect(runs).toHaveLength(2);
    runs[1].resolve(ok('Nothing done yet.'));
    await service.whenIdle();
    expect(await service.get(fewer)).toMatchObject({ status: 'ready', text: 'Nothing done yet.' });

    clock += 60_000;
    const failed = facts({ counts: { ...facts().counts, done: 0, cronFailed: 1 } });
    expect((await service.get(failed)).status).toBe('pending');
    expect(runs).toHaveLength(3);
    runs[2].resolve(ok('One cron failed.'));
    await service.whenIdle();
  });

  it('answers error after a failed run and does not retry until the back-off ends', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rpc, runs } = fakeGateway();
    const service = createDaySummary({ rpc, now: () => clock, retryMs: 5_000 });
    await service.get(facts());
    runs[0].reject(new Error('no model'));
    await service.whenIdle();

    expect(await service.get(facts())).toEqual({ status: 'error' });
    expect(runs).toHaveLength(1);
    clock += 5_000;
    expect(await service.get(facts())).toEqual({ status: 'pending' });
    expect(runs).toHaveLength(2);
    runs[1].resolve(ok('Back again.'));
    await service.whenIdle();
    warn.mockRestore();
  });

  it('treats a run that returns no text as a failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rpc, runs } = fakeGateway();
    const service = createDaySummary({ rpc, now: () => clock });
    await service.get(facts());
    runs[0].resolve(ok('   '));
    await service.whenIdle();
    expect(await service.get(facts())).toEqual({ status: 'error' });
    warn.mockRestore();
  });

  it('keeps one text per day and reads it back from disk', async () => {
    const filePath = path.join(tmpDir, 'attention', 'day-summary.json');
    const first = fakeGateway();
    const service = createDaySummary({ rpc: first.rpc, filePath, now: () => clock });
    await service.get(facts());
    first.runs[0].resolve(ok('Saved text.'));
    await service.whenIdle();

    const second = fakeGateway();
    const reloaded = createDaySummary({ rpc: second.rpc, filePath, now: () => clock });
    expect(await reloaded.get(facts())).toEqual({ status: 'ready', text: 'Saved text.', updatedAt: clock });
    // Another day has its own text.
    expect(await reloaded.get(facts({ day: '2026-11-29' }))).toEqual({ status: 'pending' });
    expect(second.runs).toHaveLength(1);
    second.runs[0].resolve(ok('Next day.'));
    await reloaded.whenIdle();
  });
});
