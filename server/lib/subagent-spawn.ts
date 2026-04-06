/**
 * Server-side subagent spawn helper.
 *
 * Owns the full lifecycle for direct child launches so the React client only
 * needs to ask the server to spawn a child and then switch focus.
 *
 * @module
 */

import { randomUUID } from 'node:crypto';
import { gatewayRpcCall } from './gateway-rpc.js';

export type SubagentCleanupMode = 'keep' | 'delete';

export interface SpawnSubagentParams {
  parentSessionKey: string;
  task: string;
  label?: string;
  model?: string;
  thinking?: string;
  cleanup?: SubagentCleanupMode;
}

export interface SpawnSubagentResult {
  sessionKey: string;
  runId?: string;
  mode: 'direct' | 'marker';
}

interface GatewaySessionSummary {
  key?: string;
  sessionKey?: string;
  status?: string;
  error?: string;
  agentState?: string;
  busy?: boolean;
  processing?: boolean;
  runId?: string;
  currentRunId?: string;
  latestRunId?: string;
}

interface LaunchMessage {
  role?: string;
  content?: unknown;
  timestamp?: number;
  ts?: number;
  createdAt?: number;
  runId?: string;
  currentRunId?: string;
  latestRunId?: string;
  meta?: { runId?: string };
  metadata?: { runId?: string };
}

interface ExtractedLaunchResult {
  started: boolean;
  resultText: string | null;
}

const ROOT_SESSION_RE = /^agent:[^:]+:main$/;
const POLL_SESSIONS_ACTIVE_MINUTES = 24 * 60;
const POLL_SESSIONS_LIMIT = 200;
const MONITOR_INITIAL_DELAY_MS = 3_000;
const MONITOR_POLL_INTERVAL_MS = 5_000;
const MONITOR_MAX_ATTEMPTS = 720;
const MARKER_DISCOVERY_TIMEOUT_MS = 60_000;
const MARKER_DISCOVERY_POLL_MS = 1_000;

const activeMonitors = new Set<string>();

function schedule(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return timer;
}

export function isTopLevelRootSessionKey(sessionKey: string): boolean {
  return ROOT_SESSION_RE.test(sessionKey);
}

function isSubagentSessionKey(sessionKey: string): boolean {
  return /^agent:[^:]+:subagent:/.test(sessionKey);
}

function isRootChildSession(sessionKey: string, parentSessionKey: string): boolean {
  const parentMatch = parentSessionKey.match(/^agent:([^:]+):main$/);
  if (!parentMatch) return false;
  return sessionKey.startsWith(`agent:${parentMatch[1]}:subagent:`);
}

function buildRequestedChildSessionKey(parentSessionKey: string): string {
  const match = parentSessionKey.match(/^agent:([^:]+):main$/);
  if (!match) {
    throw new Error(`Parent agent session must be a top-level root: ${parentSessionKey}`);
  }
  return `agent:${match[1]}:subagent:${randomUUID()}`;
}

function getSessionKey(session: GatewaySessionSummary): string | null {
  if (typeof session.sessionKey === 'string' && session.sessionKey.trim()) return session.sessionKey;
  if (typeof session.key === 'string' && session.key.trim()) return session.key;
  return null;
}

function isBusySession(session: GatewaySessionSummary): boolean {
  if (session.busy || session.processing) return true;
  const status = String(session.status ?? '').toLowerCase();
  const agentState = String(session.agentState ?? '').toLowerCase();
  return ['running', 'thinking', 'tool_use', 'streaming', 'started', 'busy', 'working'].includes(status)
    || ['running', 'thinking', 'tool_use', 'streaming', 'busy', 'working'].includes(agentState);
}

function isTerminalFailure(session: GatewaySessionSummary): boolean {
  const status = String(session.status ?? '').toLowerCase();
  return status === 'error' || status === 'failed';
}

function isTerminalSuccess(session: GatewaySessionSummary): boolean {
  const status = String(session.status ?? '').toLowerCase();
  const agentState = String(session.agentState ?? '').toLowerCase();
  return status === 'done' || (agentState === 'idle' && !session.busy && !session.processing);
}

function sessionMentionsRunId(session: GatewaySessionSummary, runId?: string): boolean {
  if (!runId) return false;
  return [session.runId, session.currentRunId, session.latestRunId].some((value) => value === runId);
}

function getMessageTimestamp(message: LaunchMessage): number | undefined {
  const value = message.timestamp ?? message.ts ?? message.createdAt;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getMessageRunId(message: LaunchMessage): string | undefined {
  const direct = [message.runId, message.currentRunId, message.latestRunId, message.meta?.runId, message.metadata?.runId]
    .find((value) => typeof value === 'string' && value.trim());
  return typeof direct === 'string' ? direct : undefined;
}

function getTextContent(content: unknown): string | null {
  if (typeof content === 'string') {
    const text = content.trim();
    return text ? text : null;
  }
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => {
      if (!part || typeof part !== 'object') return null;
      const candidate = part as { type?: string; text?: string };
      if (candidate.type !== 'text' || typeof candidate.text !== 'string') return null;
      return candidate.text;
    })
    .filter((value): value is string => Boolean(value))
    .join('')
    .trim();
  return text || null;
}

function trimReportText(text: string, maxChars = 4_000): string {
  const normalized = text.trim();
  if (!normalized) return 'Completed (no result text)';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 13).trimEnd()}\n\n[truncated]`;
}

export function buildSpawnSubagentMarkerMessage(params: {
  task: string;
  label?: string;
  model?: string;
  thinking?: string;
  cleanup: SubagentCleanupMode;
}): string {
  const lines = ['[spawn-subagent]'];
  lines.push(`task: ${params.task}`);
  if (params.label) lines.push(`label: ${params.label}`);
  if (params.model) lines.push(`model: ${params.model}`);
  if (params.thinking && params.thinking !== 'off') lines.push(`thinking: ${params.thinking}`);
  lines.push('mode: run');
  lines.push(`cleanup: ${params.cleanup}`);
  return lines.join('\n');
}

export function isUnsupportedDirectSpawnError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.trim();
  return message === 'unknown method: sessions.create' || message === 'unknown method: sessions.send';
}

export function buildSubagentParentCompletionMessage(params: {
  parentSessionKey: string;
  childSessionKey: string;
  label?: string;
  outcome: 'completed' | 'failed';
  result?: string;
  error?: string;
}): string {
  const lines = [
    'Subagent child session completion report.',
    '',
    'Use this as context from work that ran under this root. This is a completion update, not a fresh task unless follow-up is needed.',
    '',
    `Parent root: ${params.parentSessionKey}`,
    `Child session: ${params.childSessionKey}`,
  ];

  if (params.label) lines.push(`Label: ${params.label}`);
  lines.push(`Outcome: ${params.outcome}`);

  if (params.outcome === 'completed') {
    lines.push('', 'Result:', trimReportText(params.result ?? 'Completed (no result text)'));
  } else {
    lines.push('', 'Error:', trimReportText(params.error ?? 'Child session failed'));
  }

  return lines.join('\n');
}

async function reportSubagentResultToParent(params: {
  parentSessionKey: string;
  childSessionKey: string;
  label?: string;
  outcome: 'completed' | 'failed';
  result?: string;
  error?: string;
}): Promise<void> {
  const suffix = params.outcome === 'completed' ? 'done' : 'failed';
  await gatewayRpcCall('sessions.send', {
    key: params.parentSessionKey,
    message: buildSubagentParentCompletionMessage(params),
    idempotencyKey: `subagent-parent-report:${params.childSessionKey}:${suffix}`,
  });
}

export function extractAssistantResultForLaunch(
  rawMessages: Array<Record<string, unknown>>,
  options: { runId?: string; launchTimestamp: number },
): ExtractedLaunchResult {
  const messages = rawMessages as LaunchMessage[];

  if (options.runId) {
    const runMessages = messages.filter((message) => getMessageRunId(message) === options.runId);
    const runAssistant = [...runMessages]
      .reverse()
      .map((message) => ({ role: message.role, text: getTextContent(message.content) }))
      .find((message) => message.role === 'assistant' && message.text)?.text ?? null;

    if (runAssistant) {
      return { started: true, resultText: runAssistant };
    }
    if (runMessages.length > 0) {
      return { started: true, resultText: null };
    }
  }

  const firstPostLaunchIndex = messages.findIndex((message) => {
    const timestamp = getMessageTimestamp(message);
    if (typeof timestamp === 'number') return timestamp >= options.launchTimestamp;
    return message.role === 'user';
  });

  if (firstPostLaunchIndex === -1) {
    return { started: false, resultText: null };
  }

  let endIndex = messages.length;
  for (let index = firstPostLaunchIndex + 1; index < messages.length; index += 1) {
    if (messages[index]?.role === 'user') {
      endIndex = index;
      break;
    }
  }

  const launchSlice = messages.slice(firstPostLaunchIndex, endIndex);
  const lastAssistantText = [...launchSlice]
    .reverse()
    .map((message) => ({ role: message.role, text: getTextContent(message.content) }))
    .find((message) => message.role === 'assistant' && message.text)?.text ?? null;

  return {
    started: launchSlice.length > 0,
    resultText: lastAssistantText,
  };
}

export function pickMarkerSpawnedChildSession(
  sessions: GatewaySessionSummary[],
  parentSessionKey: string,
  knownSessionKeysBefore: Set<string>,
): GatewaySessionSummary | null {
  const candidates = sessions.filter((session) => {
    const sessionKey = getSessionKey(session);
    if (!sessionKey) return false;
    if (!isSubagentSessionKey(sessionKey)) return false;
    if (!isRootChildSession(sessionKey, parentSessionKey)) return false;
    return !knownSessionKeysBefore.has(sessionKey);
  });

  return candidates[0] ?? null;
}

function startCompletionMonitor(params: {
  parentSessionKey: string;
  childSessionKey: string;
  label?: string;
  cleanup: SubagentCleanupMode;
  runId?: string;
  launchTimestamp: number;
}): void {
  if (activeMonitors.has(params.childSessionKey)) return;
  activeMonitors.add(params.childSessionKey);

  let attempts = 0;
  let observedRunStart = false;

  const finish = async (outcome: 'completed' | 'failed', details: { result?: string; error?: string }) => {
    activeMonitors.delete(params.childSessionKey);

    let reportSent = false;
    try {
      await reportSubagentResultToParent({
        parentSessionKey: params.parentSessionKey,
        childSessionKey: params.childSessionKey,
        label: params.label,
        outcome,
        ...details,
      });
      reportSent = true;
    } catch (error) {
      console.warn(`[subagent-spawn] Failed to report ${outcome} for ${params.childSessionKey}:`, error);
    }

    if (reportSent && params.cleanup === 'delete') {
      try {
        await gatewayRpcCall('sessions.delete', {
          key: params.childSessionKey,
          deleteTranscript: true,
        });
      } catch (error) {
        console.warn(`[subagent-spawn] Failed to delete child ${params.childSessionKey}:`, error);
      }
    }
  };

  const poll = async () => {
    attempts += 1;
    if (attempts > MONITOR_MAX_ATTEMPTS) {
      await finish('failed', { error: 'Subagent timed out (polling limit reached)' });
      return;
    }

    try {
      const listResponse = await gatewayRpcCall('sessions.list', {
        activeMinutes: POLL_SESSIONS_ACTIVE_MINUTES,
        limit: POLL_SESSIONS_LIMIT,
      }) as { sessions?: GatewaySessionSummary[] };
      const sessions = Array.isArray(listResponse.sessions) ? listResponse.sessions : [];
      const session = sessions.find((candidate) => getSessionKey(candidate) === params.childSessionKey);

      if (!session) {
        schedule(() => { void poll(); }, MONITOR_POLL_INTERVAL_MS);
        return;
      }

      if (sessionMentionsRunId(session, params.runId) || isBusySession(session)) {
        observedRunStart = true;
      }

      if (isTerminalFailure(session)) {
        await finish('failed', { error: session.error || 'Child session failed' });
        return;
      }

      if (!isTerminalSuccess(session)) {
        schedule(() => { void poll(); }, MONITOR_POLL_INTERVAL_MS);
        return;
      }

      const historyResponse = await gatewayRpcCall('sessions.get', {
        key: params.childSessionKey,
        limit: 20,
        includeTools: true,
      }) as { messages?: Array<Record<string, unknown>> };
      const messages = Array.isArray(historyResponse.messages) ? historyResponse.messages : [];
      const extracted = extractAssistantResultForLaunch(messages, {
        runId: params.runId,
        launchTimestamp: params.launchTimestamp,
      });

      if (extracted.started) {
        observedRunStart = true;
      }

      if (!observedRunStart) {
        schedule(() => { void poll(); }, MONITOR_POLL_INTERVAL_MS);
        return;
      }

      await finish('completed', {
        result: extracted.resultText ?? 'Completed (no result text)',
      });
    } catch (error) {
      console.warn(`[subagent-spawn] Poll error for ${params.childSessionKey}:`, error);
      schedule(() => { void poll(); }, MONITOR_POLL_INTERVAL_MS);
    }
  };

  schedule(() => { void poll(); }, MONITOR_INITIAL_DELAY_MS);
}

async function launchDirect(params: SpawnSubagentParams): Promise<SpawnSubagentResult> {
  if (!isTopLevelRootSessionKey(params.parentSessionKey)) {
    throw new Error(`parentSessionKey must be a top-level root session key (agent:<id>:main): ${params.parentSessionKey}`);
  }

  const requestedKey = buildRequestedChildSessionKey(params.parentSessionKey);
  const createResponse = await gatewayRpcCall('sessions.create', {
    key: requestedKey,
    parentSessionKey: params.parentSessionKey,
    ...(params.label ? { label: params.label } : {}),
    ...(params.model ? { model: params.model } : {}),
  }) as { key?: string; sessionKey?: string };

  const sessionKey = typeof createResponse.key === 'string' && createResponse.key.trim()
    ? createResponse.key
    : typeof createResponse.sessionKey === 'string' && createResponse.sessionKey.trim()
      ? createResponse.sessionKey
      : requestedKey;

  const launchTimestamp = Date.now();

  const sendResponse = await gatewayRpcCall('sessions.send', {
    key: sessionKey,
    message: params.task,
    ...(params.thinking ? { thinking: params.thinking } : {}),
    idempotencyKey: `subagent-spawn:${Date.now()}:${randomUUID().slice(0, 8)}`,
  }) as { runId?: string };

  startCompletionMonitor({
    parentSessionKey: params.parentSessionKey,
    childSessionKey: sessionKey,
    label: params.label,
    cleanup: params.cleanup ?? 'keep',
    runId: sendResponse.runId,
    launchTimestamp,
  });

  return {
    sessionKey,
    runId: sendResponse.runId,
    mode: 'direct',
  };
}

async function launchViaMarker(params: SpawnSubagentParams): Promise<SpawnSubagentResult> {
  const snapshotResponse = await gatewayRpcCall('sessions.list', {
    activeMinutes: POLL_SESSIONS_ACTIVE_MINUTES,
    limit: POLL_SESSIONS_LIMIT,
  }) as { sessions?: GatewaySessionSummary[] };
  const snapshotSessions = Array.isArray(snapshotResponse.sessions) ? snapshotResponse.sessions : [];
  const knownSessionKeysBefore = new Set(
    snapshotSessions
      .map(getSessionKey)
      .filter((value): value is string => Boolean(value)),
  );

  await gatewayRpcCall('chat.send', {
    sessionKey: params.parentSessionKey,
    message: buildSpawnSubagentMarkerMessage({
      task: params.task,
      label: params.label,
      model: params.model,
      thinking: params.thinking,
      cleanup: params.cleanup ?? 'keep',
    }),
    idempotencyKey: `subagent-marker:${Date.now()}:${randomUUID().slice(0, 8)}`,
  });

  const deadline = Date.now() + MARKER_DISCOVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      schedule(resolve, MARKER_DISCOVERY_POLL_MS);
    });

    const listResponse = await gatewayRpcCall('sessions.list', {
      activeMinutes: POLL_SESSIONS_ACTIVE_MINUTES,
      limit: POLL_SESSIONS_LIMIT,
    }) as { sessions?: GatewaySessionSummary[] };
    const sessions = Array.isArray(listResponse.sessions) ? listResponse.sessions : [];
    const spawned = pickMarkerSpawnedChildSession(sessions, params.parentSessionKey, knownSessionKeysBefore);
    const spawnedKey = spawned ? getSessionKey(spawned) : null;
    if (spawnedKey) {
      return {
        sessionKey: spawnedKey,
        mode: 'marker',
      };
    }
  }

  throw new Error('Timed out waiting for the new subagent session to appear');
}

export async function spawnSubagent(params: SpawnSubagentParams): Promise<SpawnSubagentResult> {
  if (!isTopLevelRootSessionKey(params.parentSessionKey)) {
    throw new Error(`parentSessionKey must be a top-level root session key (agent:<id>:main): ${params.parentSessionKey}`);
  }

  try {
    return await launchDirect(params);
  } catch (error) {
    if (!isUnsupportedDirectSpawnError(error)) {
      throw error;
    }
    return launchViaMarker(params);
  }
}

export function __resetSubagentSpawnTestState(): void {
  activeMonitors.clear();
}
