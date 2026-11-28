/**
 * "What happened" summaries of agent threads for the Attention board.
 *
 * A summary is a one-shot model run (`agent` with `modelRun: true` and `promptMode: 'none'`)
 * in a throwaway explicit session, so nothing is added to the summarized thread. The model is
 * `NERVE_ATTENTION_SUMMARY_MODEL` (`provider/model`), or the thread's agent default when unset.
 *
 * Each thread is read with `chat.history` on every request; its fingerprint is the id of the
 * newest user or assistant text message. A cached summary for that fingerprint is returned as
 * is. Otherwise a generation is queued (one per thread at a time, at most two at once) and the
 * caller gets `pending` with the previous text, if any, until it lands. A failed or timed-out
 * generation is recorded and retried only after a back-off, not on every poll.
 *
 * Ready summaries live in memory and in `${NERVE_DATA_DIR:-~/.nerve}/attention/summaries.json`.
 * @module
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type SummaryStatus = 'ready' | 'pending' | 'error' | 'empty';

export interface SummaryResult {
  status: SummaryStatus;
  text?: string;
  updatedAt?: number;
}

export type RpcCall = (
  method: string,
  params: Record<string, unknown>,
  timeoutMs?: number,
  options?: { expectFinal?: boolean },
) => Promise<unknown>;

export interface AttentionSummariesOptions {
  rpc: RpcCall;
  /** Where ready summaries are persisted; omit to keep them in memory only. */
  filePath?: string;
  /** `provider/model` for the run, read at each generation. Empty means the agent's default. */
  model?: () => string | undefined;
  now?: () => number;
  timeoutMs?: number;
  /** After a failure the thread is not tried again for this long. */
  retryMs?: number;
  /** A thread that keeps changing is summarized again at most this often. */
  minIntervalMs?: number;
  concurrency?: number;
}

export interface AttentionSummaries {
  get: (sessionKeys: string[]) => Promise<Record<string, SummaryResult>>;
  /** Resolves once nothing is queued or running (tests). */
  whenIdle: () => Promise<void>;
}

export const HISTORY_LIMIT = 40;
export const SUMMARY_TIMEOUT_MS = 90_000;
export const SUMMARY_RETRY_MS = 5 * 60_000;
export const SUMMARY_MIN_INTERVAL_MS = 60_000;
export const SUMMARY_CONCURRENCY = 2;
export const SUMMARY_MAX_CHARS = 320;
const HISTORY_TIMEOUT_MS = 10_000;
const MESSAGE_MAX_CHARS = 500;
const TRANSCRIPT_MAX_CHARS = 6_000;
const MAX_STORED = 200;

// ── Transcript ───────────────────────────────────────────────────────

interface HistoryBlock {
  type?: string;
  text?: string;
  name?: string;
}

interface HistoryMessage {
  role?: string;
  content?: string | HistoryBlock[];
  text?: string;
  timestamp?: string | number;
  __openclaw?: { id?: string; seq?: number };
}

export interface Transcript {
  text: string;
  /** Changes when a new user or assistant text message arrives; tool-only activity does not. */
  fingerprint: string;
}

const TOOL_CALL_TYPES = new Set(['toolCall', 'tool_use', 'toolUse', 'functionCall']);

function blockText(content: HistoryMessage['content'], fallback?: string): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('\n');
  }
  return fallback ?? '';
}

function toolNames(content: HistoryMessage['content']): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((block) => block?.type && TOOL_CALL_TYPES.has(block.type) && typeof block.name === 'string')
    .map((block) => block.name as string);
}

function squash(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}...` : flat;
}

function markerOf(message: HistoryMessage, index: number): string {
  const meta = message.__openclaw;
  if (meta?.id) return meta.id;
  if (typeof meta?.seq === 'number') return `seq${meta.seq}`;
  if (message.timestamp !== undefined) return `ts${message.timestamp}`;
  return `i${index}`;
}

/**
 * User and assistant text as compact lines, oldest first. A run of tool-only assistant turns
 * becomes one "Agent used tools" line; tool results, thinking and custom entries are dropped.
 * Returns null when the thread has nothing to summarize.
 */
export function buildTranscript(messages: unknown): Transcript | null {
  if (!Array.isArray(messages)) return null;
  const lines: string[] = [];
  let pendingTools: string[] = [];
  let lastText: { marker: string; length: number } | null = null;

  const flushTools = () => {
    if (pendingTools.length === 0) return;
    const unique = [...new Set(pendingTools)].slice(0, 8);
    lines.push(`Agent used tools: ${unique.join(', ')}`);
    pendingTools = [];
  };

  (messages as HistoryMessage[]).forEach((message, index) => {
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) return;
    const text = squash(blockText(message.content, message.text), MESSAGE_MAX_CHARS);
    if (message.role === 'assistant' && !text) {
      pendingTools.push(...toolNames(message.content));
      return;
    }
    if (!text) return;
    flushTools();
    lines.push(`${message.role === 'user' ? 'User' : 'Agent'}: ${text}`);
    lastText = { marker: markerOf(message, index), length: text.length };
  });
  flushTools();

  const newest = lastText as { marker: string; length: number } | null;
  if (!newest) return null;

  // Keep the newest lines that fit.
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (size + line.length + 1 > TRANSCRIPT_MAX_CHARS && kept.length > 0) break;
    kept.unshift(line);
    size += line.length + 1;
  }
  return { text: kept.join('\n'), fingerprint: `${newest.marker}:${newest.length}` };
}

// ── Model run ────────────────────────────────────────────────────────

export function buildPrompt(transcript: string): string {
  return [
    'You summarize an agent chat thread for its operator, who has not read it.',
    'Write at most two short plain sentences: what was asked, what the agent did, and where it stands now, including anything waiting on the operator.',
    'No markdown, no lists, no preamble, and do not quote the transcript.',
    '',
    'Transcript, oldest first:',
    transcript,
  ].join('\n');
}

/** `provider/model` split at the first slash; anything else means no override. */
export function parseModelRef(value: string | undefined): { provider: string; model: string } | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  return { provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) };
}

const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** The agent a session key belongs to (`agent:<id>:...`), `main` otherwise. */
export function agentIdOf(sessionKey: string): string {
  const match = /^agent:([^:]+):/.exec(sessionKey);
  const id = match?.[1];
  return id && AGENT_ID_RE.test(id) ? id : 'main';
}

/** Params for the gateway `agent` method, as `openclaw infer model run --gateway` sends them. */
export function buildAgentParams(sessionKey: string, prompt: string, modelRef: string | undefined): Record<string, unknown> {
  const agentId = agentIdOf(sessionKey);
  const sessionId = `model-run-${randomUUID()}`;
  const override = parseModelRef(modelRef);
  return {
    agentId,
    sessionId,
    sessionKey: `agent:${agentId}:explicit:${sessionId}`,
    message: prompt,
    ...(override ? { provider: override.provider, model: override.model } : {}),
    modelRun: true,
    promptMode: 'none',
    cleanupBundleMcpOnRunEnd: true,
    idempotencyKey: randomUUID(),
  };
}

interface AgentFinal {
  status?: string;
  summary?: string;
  result?: {
    payloads?: Array<{ text?: unknown }>;
    meta?: { error?: { message?: string } };
  };
}

/** The final `agent` response's text, or a thrown error for a failed run. */
export function readAgentOutput(response: unknown): string {
  const final = (response ?? {}) as AgentFinal;
  if (final.status && final.status !== 'ok' && final.status !== 'completed') {
    throw new Error(final.result?.meta?.error?.message || final.summary || `Model run ${final.status}`);
  }
  const payloads = Array.isArray(final.result?.payloads) ? final.result.payloads : [];
  return payloads
    .map((payload) => (typeof payload?.text === 'string' ? payload.text : ''))
    .filter(Boolean)
    .join('\n');
}

/** Plain text for the card: markdown marks and labels removed, dashes made commas, length capped. */
export function cleanSummary(raw: string, maxChars = SUMMARY_MAX_CHARS): string {
  let text = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*(summary|what happened)\s*:\s*/i, '')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars);
    const space = cut.lastIndexOf(' ');
    text = `${(space > maxChars / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}...`;
  }
  return text;
}

/**
 * One one-shot model run as `sessionKey`'s agent, raced against `timeoutMs`: the cleaned text,
 * or a thrown error for a failed, empty or timed-out run.
 */
export async function runOneShot(
  rpc: RpcCall,
  { sessionKey, prompt, modelRef, timeoutMs, maxChars = SUMMARY_MAX_CHARS, what = 'Summary' }: {
    sessionKey: string;
    prompt: string;
    modelRef: string | undefined;
    timeoutMs: number;
    maxChars?: number;
    what?: string;
  },
): Promise<string> {
  const params = buildAgentParams(sessionKey, prompt, modelRef);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
  });
  try {
    const response = await Promise.race([
      rpc('agent', params, timeoutMs + 5_000, { expectFinal: true }),
      timeout,
    ]);
    const text = cleanSummary(readAgentOutput(response), maxChars);
    if (!text) throw new Error('The model returned no text');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// ── Service ──────────────────────────────────────────────────────────

interface CacheEntry {
  fingerprint: string;
  text: string;
  updatedAt: number;
}

interface ErrorEntry {
  message: string;
  retryAt: number;
}

interface Job {
  sessionKey: string;
  fingerprint: string;
  transcript: string;
}

export function defaultSummariesPath(): string {
  const root = process.env.NERVE_DATA_DIR || path.join(os.homedir() || process.cwd(), '.nerve');
  return path.join(root, 'attention', 'summaries.json');
}

export function createAttentionSummaries(options: AttentionSummariesOptions): AttentionSummaries {
  const {
    rpc,
    filePath,
    model = () => undefined,
    now = Date.now,
    timeoutMs = SUMMARY_TIMEOUT_MS,
    retryMs = SUMMARY_RETRY_MS,
    minIntervalMs = SUMMARY_MIN_INTERVAL_MS,
    concurrency = SUMMARY_CONCURRENCY,
  } = options;

  const cache = new Map<string, CacheEntry>();
  const errors = new Map<string, ErrorEntry>();
  const inFlight = new Set<string>();
  const queue: Job[] = [];
  let running = 0;
  let idleWaiters: Array<() => void> = [];
  let loaded: Promise<void> | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  const load = () => {
    if (!loaded) {
      loaded = (async () => {
        if (!filePath) return;
        try {
          const raw = JSON.parse(await fs.promises.readFile(filePath, 'utf-8')) as { entries?: Record<string, CacheEntry> };
          for (const [key, entry] of Object.entries(raw.entries ?? {})) {
            if (entry && typeof entry.fingerprint === 'string' && typeof entry.text === 'string' && typeof entry.updatedAt === 'number') {
              cache.set(key, entry);
            }
          }
        } catch {
          // Missing or unreadable: start empty.
        }
      })();
    }
    return loaded;
  };

  const persist = () => {
    if (!filePath) return;
    if (cache.size > MAX_STORED) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      for (const [key] of oldest.slice(0, cache.size - MAX_STORED)) cache.delete(key);
    }
    const body = JSON.stringify({ version: 1, entries: Object.fromEntries(cache) });
    writeChain = writeChain.then(async () => {
      try {
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        const tmp = `${filePath}.tmp`;
        await fs.promises.writeFile(tmp, body);
        await fs.promises.rename(tmp, filePath);
      } catch (err) {
        console.warn('[attention-summaries] could not save summaries:', (err as Error).message);
      }
    });
  };

  const settleIdle = () => {
    if (running > 0 || queue.length > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  };

  const generate = (job: Job): Promise<string> => runOneShot(rpc, {
    sessionKey: job.sessionKey,
    prompt: buildPrompt(job.transcript),
    modelRef: model(),
    timeoutMs,
  });

  const pump = () => {
    while (running < concurrency && queue.length > 0) {
      const job = queue.shift()!;
      running += 1;
      void generate(job)
        .then((text) => {
          cache.set(job.sessionKey, { fingerprint: job.fingerprint, text, updatedAt: now() });
          errors.delete(job.sessionKey);
          persist();
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          errors.set(job.sessionKey, { message, retryAt: now() + retryMs });
          console.warn(`[attention-summaries] ${job.sessionKey}: ${message}`);
        })
        .finally(() => {
          running -= 1;
          inFlight.delete(job.sessionKey);
          pump();
          settleIdle();
        });
    }
  };

  const one = async (sessionKey: string): Promise<SummaryResult> => {
    const cached = cache.get(sessionKey);
    const previous = cached ? { text: cached.text, updatedAt: cached.updatedAt } : {};

    let transcript: Transcript | null;
    try {
      const history = await rpc('chat.history', { sessionKey, limit: HISTORY_LIMIT }, HISTORY_TIMEOUT_MS) as { messages?: unknown };
      transcript = buildTranscript(history?.messages);
    } catch {
      return cached ? { status: 'ready', ...previous } : { status: 'error' };
    }
    if (!transcript) return { status: 'empty' };
    if (cached?.fingerprint === transcript.fingerprint) return { status: 'ready', ...previous };
    if (inFlight.has(sessionKey)) return { status: 'pending', ...previous };

    const failed = errors.get(sessionKey);
    if (failed && now() < failed.retryAt) return { status: cached ? 'ready' : 'error', ...previous };
    // Too soon after the last summary: keep the old text and let the client poll past the interval.
    if (cached && now() - cached.updatedAt < minIntervalMs) return { status: 'pending', ...previous };

    inFlight.add(sessionKey);
    queue.push({ sessionKey, fingerprint: transcript.fingerprint, transcript: transcript.text });
    pump();
    return { status: 'pending', ...previous };
  };

  return {
    get: async (sessionKeys) => {
      await load();
      const entries = await Promise.all(sessionKeys.map(async (key) => [key, await one(key)] as const));
      return Object.fromEntries(entries);
    },
    whenIdle: async () => {
      if (running > 0 || queue.length > 0) await new Promise<void>((resolve) => idleWaiters.push(resolve));
      await writeChain;
    },
  };
}
