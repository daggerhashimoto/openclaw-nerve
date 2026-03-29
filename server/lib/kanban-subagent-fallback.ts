/**
 * Server-side Kanban subagent launch helper.
 *
 * Kanban tasks should run as subagents under an existing top-level agent root,
 * not as new top-level sessions. This mirrors the frontend spawn-subagent flow:
 *
 * 1. List sessions to confirm the parent root exists and snapshot existing children
 * 2. chat.send a [spawn-subagent] message into the parent root session
 * 3. Return run metadata so the caller can poll for the spawned child session
 *
 * @module
 */

import { randomUUID } from 'node:crypto';
import { resolveKanbanAssigneeRootSessionKey } from './kanban-assignee.js';
import { gatewayRpcCall } from './gateway-rpc.js';

const PARENT_SESSIONS_ACTIVE_MINUTES = 7 * 24 * 60;
const PARENT_ROOT_LOOKUP_SESSIONS_LIMIT = 1000;

interface GatewaySessionSummary {
  key?: string;
  sessionKey?: string;
}

export interface KanbanFallbackLaunchResult {
  /** Deterministic correlation key stored on the task run link. */
  sessionKey: string;
  /** Existing top-level agent root that owns the spawned child. */
  parentSessionKey: string;
  /** Snapshot of known session keys before spawn, used to discover the new child. */
  knownSessionKeysBefore: string[];
  /** Optional runId returned by chat.send. */
  runId?: string;
}

/**
 * Generate a deterministic Kanban run correlation key from a launch label.
 *
 * Historical note: the run link field is still named `sessionKey`, but for
 * Kanban execution this value is only a stable run correlation key. The real
 * spawned child session key is attached later as `childSessionKey`.
 */
export function buildKanbanFallbackRunKey(label: string): string {
  const normalized = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `kanban-root:${normalized}`;
}

/** Resolve the owning top-level worker root session for a task assignee. */
export function resolveKanbanFallbackParentSessionKey(assignee?: string): string | null {
  return resolveKanbanAssigneeRootSessionKey(assignee);
}

function getSessionKey(session: GatewaySessionSummary): string | null {
  if (typeof session.sessionKey === 'string' && session.sessionKey.trim()) return session.sessionKey;
  if (typeof session.key === 'string' && session.key.trim()) return session.key;
  return null;
}

function buildSpawnSubagentMessage(params: {
  task: string;
  label: string;
  model?: string;
  thinking?: string;
}): string {
  const lines = ['[spawn-subagent]'];
  lines.push(`task: ${params.task}`);
  lines.push(`label: ${params.label}`);
  if (params.model) lines.push(`model: ${params.model}`);
  if (params.thinking && params.thinking !== 'off') lines.push(`thinking: ${params.thinking}`);
  lines.push('mode: run');
  lines.push('cleanup: keep');
  return lines.join('\n');
}

/**
 * Launch a Kanban task as a subagent under an existing top-level agent root.
 */
export async function launchKanbanFallbackSubagentViaRpc(params: {
  label: string;
  task: string;
  parentSessionKey: string;
  model?: string;
  thinking?: string;
}): Promise<KanbanFallbackLaunchResult> {
  const sessionKey = buildKanbanFallbackRunKey(params.label);

  const sessionsResponse = await gatewayRpcCall('sessions.list', {
    activeMinutes: PARENT_SESSIONS_ACTIVE_MINUTES,
    limit: PARENT_ROOT_LOOKUP_SESSIONS_LIMIT,
  }) as { sessions?: GatewaySessionSummary[] };

  const sessions = Array.isArray(sessionsResponse.sessions) ? sessionsResponse.sessions : [];
  const knownSessionKeysBefore = sessions
    .map(getSessionKey)
    .filter((value): value is string => typeof value === 'string');

  if (!knownSessionKeysBefore.includes(params.parentSessionKey)) {
    throw new Error(`Parent agent session not found: ${params.parentSessionKey}`);
  }

  const idempotencyKey = `kanban-subagent-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const message = buildSpawnSubagentMessage({
    task: params.task,
    label: params.label,
    model: params.model,
    thinking: params.thinking,
  });

  const chatSendResponse = await gatewayRpcCall('chat.send', {
    sessionKey: params.parentSessionKey,
    message,
    idempotencyKey,
  }) as { runId?: string };

  return {
    sessionKey,
    parentSessionKey: params.parentSessionKey,
    knownSessionKeysBefore,
    runId: chatSendResponse.runId,
  };
}
