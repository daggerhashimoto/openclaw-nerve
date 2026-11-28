/**
 * Exec approval requests: an agent wants to run a command and the gateway holds it until the
 * operator decides. Read with `exec.approval.list`, kept current by the gateway's
 * `exec.approval.requested` and `exec.approval.resolved` events, and answered with
 * `exec.approval.resolve` `{ id, decision }`.
 *
 * The list answers `[{ id, request, createdAtMs, expiresAtMs, approvalKind }]`, where `request`
 * carries `command` (the full command), `commandPreview` (a shorter form), `cwd`, `host`, `agentId`, `sessionKey`, `warningText` and
 * `allowedDecisions` (a subset of allow-once, allow-always and deny). A gateway without the
 * methods answers "unknown method"; then the source is off and the board works without it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useGateway } from '@/contexts/GatewayContext';
import type { GatewayEvent } from '@/types';
import type { SourceStatus } from './types';

export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

export interface ExecApproval {
  id: string;
  /** The full command, as the gateway's own prompt shows it. */
  command: string;
  /** The gateway's shorter preview, when it differs from the command. */
  preview?: string;
  cwd?: string;
  host?: string;
  agentId?: string;
  sessionKey?: string;
  warning?: string;
  decisions: ApprovalDecision[];
  createdAt: number;
  expiresAt?: number;
}

const DECISIONS: ApprovalDecision[] = ['allow-once', 'allow-always', 'deny'];
/** Re-read this often while the board is open, in case an event was missed. */
export const APPROVALS_POLL_MS = 30_000;
const UNSUPPORTED = /unknown method|method not found|does not support|missing scope|not authorized|unauthorized|forbidden/i;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** One entry from the list or a requested event; null when it carries no id or command. */
export function normalizeApproval(raw: unknown, now = Date.now()): ExecApproval | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const id = text(entry.id);
  const request = (entry.request && typeof entry.request === 'object' ? entry.request : {}) as Record<string, unknown>;
  // The gateway's own display rule: the command (or a node run plan's text) is the command, and
  // the preview is shown beside it only when it differs. The operator sees the full command.
  const plan = (request.systemRunPlan && typeof request.systemRunPlan === 'object' ? request.systemRunPlan : {}) as Record<string, unknown>;
  const command = text(request.command) ?? text(plan.commandText) ?? text(entry.commandText) ?? text(request.commandPreview) ?? text(entry.commandPreview);
  if (!id || !command) return null;
  const previewText = text(request.commandPreview) ?? text(plan.commandPreview) ?? text(entry.commandPreview);
  const preview = previewText && previewText !== command ? previewText : undefined;
  const allowed = Array.isArray(request.allowedDecisions) ? request.allowedDecisions : entry.allowedDecisions;
  const decisions = Array.isArray(allowed)
    ? DECISIONS.filter((decision) => allowed.includes(decision))
    : ['allow-once', 'deny'] as ApprovalDecision[];
  const createdAt = typeof entry.createdAtMs === 'number' ? entry.createdAtMs : now;
  return {
    id,
    command,
    preview,
    cwd: text(request.cwd),
    host: text(request.host),
    agentId: text(request.agentId) ?? text(entry.agentId),
    sessionKey: text(request.sessionKey),
    warning: text(request.warningText),
    decisions,
    createdAt,
    expiresAt: typeof entry.expiresAtMs === 'number' ? entry.expiresAtMs : undefined,
  };
}

/** The list answer, as a bare array or wrapped in `{ approvals }`. */
export function normalizeApprovalList(raw: unknown, now = Date.now()): ExecApproval[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { approvals?: unknown }).approvals)
      ? (raw as { approvals: unknown[] }).approvals
      : [];
  return list
    .filter((entry) => !(entry && typeof entry === 'object' && 'approvalKind' in entry && (entry as { approvalKind?: unknown }).approvalKind !== 'exec'))
    .map((entry) => normalizeApproval(entry, now))
    .filter((entry): entry is ExecApproval => entry !== null);
}

export function isUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return UNSUPPORTED.test(message);
}

type Rpc = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/** Sends one decision. Only `id` and `decision` go out: the gateway's params are a closed object. */
export async function resolveApproval(rpc: Rpc | undefined, id: string, decision: ApprovalDecision): Promise<void> {
  if (typeof rpc !== 'function') throw new Error('Not connected');
  await rpc('exec.approval.resolve', { id, decision });
}

export interface ExecApprovalsState {
  approvals: ExecApproval[];
  status: SourceStatus;
  /** Reads the list again now. */
  reload: () => void;
  /** Drops one approval at once, after the operator answered it. */
  forget: (id: string) => void;
}

/**
 * Pending exec approvals while the board is open and the socket is up. Expired entries are
 * dropped on every read. `signal` changes (Refresh) read the list again.
 */
export function useExecApprovals({ active, connected, signal }: { active: boolean; connected: boolean; signal?: unknown }): ExecApprovalsState {
  const gateway = useGateway() as Partial<ReturnType<typeof useGateway>>;
  const rpc = typeof gateway.rpc === 'function' ? gateway.rpc : undefined;
  const subscribe = typeof gateway.subscribe === 'function' ? gateway.subscribe : undefined;
  const [approvals, setApprovals] = useState<ExecApproval[]>([]);
  const [status, setStatus] = useState<SourceStatus>(() => (rpc ? { state: 'loading' } : { state: 'off' }));
  const [reloads, setReloads] = useState(0);
  const rpcRef = useRef(rpc);
  useEffect(() => { rpcRef.current = rpc; }, [rpc]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);
  const forget = useCallback((id: string) => {
    setApprovals((prev) => prev.filter((approval) => approval.id !== id));
  }, []);

  const hasRpc = Boolean(rpc);
  useEffect(() => {
    if (!active || !connected || !hasRpc) return;
    let cancelled = false;
    const read = async () => {
      const call = rpcRef.current;
      if (!call) return;
      try {
        const answer = await call('exec.approval.list', {});
        if (cancelled) return;
        const now = Date.now();
        setApprovals(normalizeApprovalList(answer, now).filter((entry) => entry.expiresAt === undefined || entry.expiresAt > now));
        setStatus({ state: 'live', checkedAt: now });
      } catch (error) {
        if (cancelled) return;
        if (isUnsupportedError(error)) {
          setApprovals([]);
          setStatus({ state: 'off' });
        } else {
          setStatus({ state: 'error', error: error instanceof Error ? error.message : String(error) });
        }
      }
    };
    void read();
    const id = setInterval(() => { void read(); }, APPROVALS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, connected, hasRpc, reloads, signal]);

  // A request lands at once; a resolve (from here, a channel or another client) reads the list again.
  useEffect(() => {
    if (!subscribe) return;
    return subscribe((event: GatewayEvent) => {
      if (event.event === 'exec.approval.requested') {
        const entry = normalizeApproval(event.payload);
        if (!entry) return;
        setApprovals((prev) => [...prev.filter((approval) => approval.id !== entry.id), entry]);
      } else if (event.event === 'exec.approval.resolved') {
        const id = text((event.payload as { id?: unknown } | undefined)?.id);
        if (id) setApprovals((prev) => prev.filter((approval) => approval.id !== id));
        setReloads((n) => n + 1);
      }
    });
  }, [subscribe]);

  return { approvals, status: rpc ? status : { state: 'off' }, reload, forget };
}
