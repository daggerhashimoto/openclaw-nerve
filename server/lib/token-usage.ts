import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createReadStream } from 'node:fs';

export interface TokenUsageEntry {
  source: string;
  cost: number;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  errorCount: number;
}

export interface SessionCostData {
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  totalMessages: number;
  entries: TokenUsageEntry[];
}

interface ProviderStats {
  cost: number;
  messages: number;
  input: number;
  output: number;
  cacheRead: number;
  errors: number;
}

interface UsageAccumulator {
  costByProvider: Record<string, ProviderStats>;
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  totalMessages: number;
}

function newProviderStats(): ProviderStats {
  return { cost: 0, messages: 0, input: 0, output: 0, cacheRead: 0, errors: 0 };
}

function asNonNegativeFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function createUsageAccumulator(): UsageAccumulator {
  return {
    costByProvider: {},
    totalCost: 0,
    totalInput: 0,
    totalOutput: 0,
    totalMessages: 0,
  };
}

export function accumulateTranscriptUsageEntry(acc: UsageAccumulator, entry: unknown): void {
  if (!entry || typeof entry !== 'object') return;

  const record = entry as {
    type?: unknown;
    provider?: unknown;
    message?: {
      provider?: unknown;
      usage?: {
        input?: unknown;
        output?: unknown;
        cacheRead?: unknown;
        cache_read?: unknown;
        cost?: { total?: unknown };
      };
    };
  };

  if (record.type === 'error') {
    const provider = typeof record.provider === 'string'
      ? record.provider
      : typeof record.message?.provider === 'string'
        ? record.message.provider
        : 'unknown';
    (acc.costByProvider[provider] ??= newProviderStats()).errors++;
    return;
  }

  if (record.type !== 'message') return;

  const message = record.message;
  if (!message?.usage || typeof message.provider !== 'string' || message.provider === 'openclaw') return;

  const cost = asNonNegativeFiniteNumber(message.usage.cost?.total);
  const input = asNonNegativeFiniteNumber(message.usage.input);
  const output = asNonNegativeFiniteNumber(message.usage.output);
  const cacheRead = asNonNegativeFiniteNumber(message.usage.cacheRead ?? message.usage.cache_read);

  acc.totalCost += cost;
  acc.totalInput += input;
  acc.totalOutput += output;
  acc.totalMessages++;

  const stats = acc.costByProvider[message.provider] ??= newProviderStats();
  stats.cost += cost;
  stats.messages++;
  stats.input += input;
  stats.output += output;
  stats.cacheRead += cacheRead;
}

export function finalizeUsageAccumulator(acc: UsageAccumulator): SessionCostData {
  const entries = Object.entries(acc.costByProvider)
    .map(([source, stats]) => ({
      source,
      cost: round4(stats.cost),
      messageCount: stats.messages,
      inputTokens: stats.input,
      outputTokens: stats.output,
      cacheReadTokens: stats.cacheRead,
      errorCount: stats.errors,
    }))
    .sort((a, b) => b.cost - a.cost);

  return {
    totalCost: round4(acc.totalCost),
    totalInput: acc.totalInput,
    totalOutput: acc.totalOutput,
    totalMessages: acc.totalMessages,
    entries,
  };
}

export function aggregateTranscriptUsageEntries(entries: unknown[]): SessionCostData {
  const acc = createUsageAccumulator();
  for (const entry of entries) accumulateTranscriptUsageEntry(acc, entry);
  return finalizeUsageAccumulator(acc);
}

export async function resolveSessionTranscriptDirs(sessionsDir: string): Promise<string[]> {
  const normalizedSessionsDir = path.resolve(sessionsDir);
  const agentDir = path.dirname(normalizedSessionsDir);
  const agentsRoot = path.dirname(agentDir);

  if (path.basename(normalizedSessionsDir) !== 'sessions' || path.basename(agentsRoot) !== 'agents') {
    return [normalizedSessionsDir];
  }

  try {
    const entries = await fs.readdir(agentsRoot, { withFileTypes: true });
    const sessionDirs = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const candidate = path.join(agentsRoot, entry.name, 'sessions');
        try {
          const stats = await fs.stat(candidate);
          return stats.isDirectory() ? candidate : null;
        } catch {
          return null;
        }
      }));

    const resolved = sessionDirs.filter((candidate): candidate is string => Boolean(candidate)).sort();
    return resolved.length > 0 ? resolved : [normalizedSessionsDir];
  } catch {
    return [normalizedSessionsDir];
  }
}

export async function scanTranscriptUsageFromDirs(sessionDirs: string[]): Promise<SessionCostData> {
  const usage = createUsageAccumulator();

  for (const sessionDir of sessionDirs) {
    try {
      const files = (await fs.readdir(sessionDir)).filter((file) => file.endsWith('.jsonl'));

      for (const file of files) {
        try {
          const rl = readline.createInterface({
            input: createReadStream(path.join(sessionDir, file)),
            crlfDelay: Infinity,
          });

          for await (const line of rl) {
            try {
              accumulateTranscriptUsageEntry(usage, JSON.parse(line));
            } catch {
              // Skip malformed transcript lines.
            }
          }
        } catch {
          // Skip unreadable files.
        }
      }
    } catch {
      // Skip missing or unreadable session dirs.
    }
  }

  return finalizeUsageAccumulator(usage);
}
