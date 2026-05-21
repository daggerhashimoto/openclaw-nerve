import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  aggregateTranscriptUsageEntries,
  resolveSessionTranscriptDirs,
  scanTranscriptUsageFromDirs,
} from './token-usage.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('aggregateTranscriptUsageEntries', () => {
  it('ignores negative cost totals from transcript usage while keeping the provider row', () => {
    const result = aggregateTranscriptUsageEntries([
      {
        type: 'message',
        message: {
          provider: 'openrouter',
          usage: {
            input: 123,
            output: 45,
            cost: { total: -38_063_010 },
          },
        },
      },
    ]);

    expect(result.totalCost).toBe(0);
    expect(result.totalInput).toBe(123);
    expect(result.totalOutput).toBe(45);
    expect(result.totalMessages).toBe(1);
    expect(result.entries).toEqual([
      {
        source: 'openrouter',
        cost: 0,
        messageCount: 1,
        inputTokens: 123,
        outputTokens: 45,
        cacheReadTokens: 0,
        errorCount: 0,
      },
    ]);
  });

  it('ignores non-finite cost totals instead of polluting provider totals', () => {
    const result = aggregateTranscriptUsageEntries([
      {
        type: 'message',
        message: {
          provider: 'openrouter',
          usage: {
            input: 10,
            output: 5,
            cost: { total: Number.NaN },
          },
        },
      },
      {
        type: 'message',
        message: {
          provider: 'openrouter',
          usage: {
            input: 20,
            output: 7,
            cost: { total: 0.5 },
          },
        },
      },
    ]);

    expect(result.totalCost).toBe(0.5);
    expect(result.entries).toEqual([
      {
        source: 'openrouter',
        cost: 0.5,
        messageCount: 2,
        inputTokens: 30,
        outputTokens: 12,
        cacheReadTokens: 0,
        errorCount: 0,
      },
    ]);
  });

  it('ignores +/-Infinity cost totals while preserving token and message counts', () => {
    const result = aggregateTranscriptUsageEntries([
      {
        type: 'message',
        message: {
          provider: 'openrouter',
          usage: {
            input: 3,
            output: 2,
            cost: { total: Number.POSITIVE_INFINITY },
          },
        },
      },
      {
        type: 'message',
        message: {
          provider: 'openrouter',
          usage: {
            input: 4,
            output: 1,
            cost: { total: Number.NEGATIVE_INFINITY },
          },
        },
      },
    ]);

    expect(result.totalCost).toBe(0);
    expect(result.entries).toEqual([
      {
        source: 'openrouter',
        cost: 0,
        messageCount: 2,
        inputTokens: 7,
        outputTokens: 3,
        cacheReadTokens: 0,
        errorCount: 0,
      },
    ]);
  });
});

describe('resolveSessionTranscriptDirs', () => {
  it('expands a main agent sessions path to all sibling agent session dirs', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'nerve-token-usage-'));
    tempDirs.push(root);

    const mainSessionsDir = path.join(root, 'agents', 'main', 'sessions');
    const designerSessionsDir = path.join(root, 'agents', 'designer', 'sessions');
    const cronnerSessionsDir = path.join(root, 'agents', 'cronner', 'sessions');
    mkdirSync(mainSessionsDir, { recursive: true });
    mkdirSync(designerSessionsDir, { recursive: true });
    mkdirSync(cronnerSessionsDir, { recursive: true });

    await expect(resolveSessionTranscriptDirs(mainSessionsDir)).resolves.toEqual([
      cronnerSessionsDir,
      designerSessionsDir,
      mainSessionsDir,
    ]);
  });
});

describe('scanTranscriptUsageFromDirs', () => {
  it('aggregates provider usage across sibling agent session dirs, not just main', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'nerve-token-usage-'));
    tempDirs.push(root);

    const mainSessionsDir = path.join(root, 'agents', 'main', 'sessions');
    const designerSessionsDir = path.join(root, 'agents', 'designer', 'sessions');
    mkdirSync(mainSessionsDir, { recursive: true });
    mkdirSync(designerSessionsDir, { recursive: true });

    writeFileSync(
      path.join(mainSessionsDir, 'main.jsonl'),
      `${JSON.stringify({
        type: 'message',
        message: {
          provider: 'openai-codex',
          usage: { input: 11, output: 7, cost: { total: 0.25 } },
        },
      })}\n`,
    );

    writeFileSync(
      path.join(designerSessionsDir, 'designer.jsonl'),
      `${JSON.stringify({
        type: 'message',
        message: {
          provider: 'openrouter',
          usage: { input: 101, output: 19, cost: { total: 0.5 } },
        },
      })}\n`,
    );

    await expect(scanTranscriptUsageFromDirs([mainSessionsDir, designerSessionsDir])).resolves.toEqual({
      totalCost: 0.75,
      totalInput: 112,
      totalOutput: 26,
      totalMessages: 2,
      entries: [
        {
          source: 'openrouter',
          cost: 0.5,
          messageCount: 1,
          inputTokens: 101,
          outputTokens: 19,
          cacheReadTokens: 0,
          errorCount: 0,
        },
        {
          source: 'openai-codex',
          cost: 0.25,
          messageCount: 1,
          inputTokens: 11,
          outputTokens: 7,
          cacheReadTokens: 0,
          errorCount: 0,
        },
      ],
    });
  });
});
