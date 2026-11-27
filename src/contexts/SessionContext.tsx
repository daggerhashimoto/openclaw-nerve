/* eslint-disable react-refresh/only-export-components -- hook intentionally co-located with provider */
import { createContext, useContext, useCallback, useRef, useEffect, useState, useMemo, type ReactNode } from 'react';
import { useGateway } from './GatewayContext';
import { useSettings } from './SettingsContext';
import { getSessionKey, type Session, type AgentLogEntry, type EventEntry, type GatewayEvent, type EventPayload, type AgentEventPayload, type ChatEventPayload, type ContentBlock, type SessionsListResponse, type ChatHistoryResponse, type ChatMessage, type GranularAgentState } from '@/types';
import { playPing } from '@/features/voice/audio-feedback';
import { describeToolUse } from '@/utils/helpers';
import { HeartbeatRuns } from '@/features/chat/operations/heartbeatRuns';
import { buildSessionTree } from '@/features/sessions/sessionTree';
import { getSessionDeleteRefusal } from '@/features/sessions/sessionDeletion';
import { unpinSessions, unpinSessionsMatching } from '@/features/sessions/pinnedSessions';
import {
  buildAgentRootSessionKey,
  extractIdentityName,
  getAgentRegistrationName,
  getRootAgentSessionKey,
  getSessionDisplayLabel,
  getTopLevelAgentSessions,
  isSubagentSessionKey,
  isTopLevelAgentSessionKey,
  pickDefaultSessionKey,
  getRootAgentId,
  getSessionAgentId,
  isPlaceholderIdentityName,
} from '@/features/sessions/sessionKeys';

const BUSY_STATES = new Set(['running', 'thinking', 'tool_use', 'delta', 'started']);
const IDLE_STATES = new Set(['idle', 'done', 'error', 'final', 'aborted', 'completed']);
const TERMINAL_PING_DEDUP_MS = 5_000;

// Use the full session list for the sidebar so older root chats stay visible.
const FULL_SESSIONS_LIMIT = 1000;
const MAIN_SESSION_KEY = 'agent:main:main';
const SESSIONS_SPAWNED_LIMIT = 500;
/** How long a reported missing sessions.json holds before the hidden cron list is asked again. */
const HIDDEN_STORE_RECHECK_MS = 5 * 60_000;
/** How often agent identities are re-read, so a rename reaches labels without a reload. */
const IDENTITY_REFRESH_MS = 60_000;
/** A workspace identity file stays fresh this long before it is read again. */
const IDENTITY_FILE_TTL_MS = 5 * 60_000;
/** A file with no usable Name is retried this often, in case it is filled in later. */
const IDENTITY_FILE_RETRY_MS = 60_000;

// A refresh keeps a row's old object unless one of these differs, so every field the agents
// column, the fleet pane and the session info panel read has to be here (run state included).
const DIFFED_SESSION_FIELDS = [
  'state', 'agentState', 'status', 'busy', 'processing', 'updatedAt',
  'totalTokens', 'inputTokens', 'outputTokens', 'contextTokens', 'model', 'thinking', 'thinkingLevel', 'thinkingDefault',
  'label', 'displayName', 'channel', 'parentSessionKey', 'parentId',
] as const satisfies readonly (keyof Session)[];

/** `sessions.list` rebuilds these arrays every poll; compare their contents, not references. */
function sameThinkingLevels(
  a: Session['thinkingLevels'],
  b: Session['thinkingLevels'],
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((level, i) => level.id === b[i]?.id && level.label === b[i]?.label);
}

function sameThinkingOptions(a: Session['thinkingOptions'], b: Session['thinkingOptions']): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((level, i) => level === b[i]);
}

export type SubagentCleanupMode = 'keep' | 'delete';

export interface SpawnSessionOpts {
  kind: 'root' | 'subagent';
  task: string;
  model?: string;
  thinking?: string;
  label?: string;
  cleanup?: SubagentCleanupMode;
  agentName?: string;
  parentSessionKey?: string;
}

/** How an agent leaves OpenClaw: with its files kept on disk, or with them moved to the Trash. */
export interface RemoveAgentOpts {
  deleteFiles: boolean;
}

/**
 * What the remove dialog says about an agent, from agents.list: where its workspace is, another
 * agent whose workspace overlaps it, and whether it is the only configured agent. agents.delete
 * never moves a workspace to the Trash when it overlaps a remaining agent's (it sits inside it,
 * holds it, or is the same folder), and refuses to remove the only agent.
 */
export interface AgentRemovalInfo {
  path: string;
  overlap?: { agentId: string; relation: 'inside' | 'contains' | 'same' };
  isOnlyAgent: boolean;
}

const trimTrailingSlashes = (path: string): string => path.replace(/\/+$/, '') || '/';

/** The agent's workspace in an agents.list answer, or null when the answer does not list it. */
export function findAgentRemovalInfo(answer: unknown, agentId: string): AgentRemovalInfo | null {
  const agents = (answer as { agents?: unknown } | null)?.agents;
  if (!Array.isArray(agents)) return null;
  const isOnlyAgent = agents.filter((agent) => typeof agent?.id === 'string').length === 1;
  const workspaces = agents
    .filter((agent): agent is { id: string; workspace: string } => (
      typeof agent?.id === 'string' && typeof agent?.workspace === 'string' && agent.workspace !== ''
    ))
    .map((agent) => ({ id: agent.id, path: trimTrailingSlashes(agent.workspace) }));
  const own = workspaces.find((agent) => agent.id === agentId);
  if (!own) return null;
  const others = workspaces.filter((agent) => agent.id !== agentId);
  const isInside = (inner: string, outer: string) => outer === '/' || inner.startsWith(`${outer}/`);
  const same = others.find((agent) => agent.path === own.path);
  if (same) return { path: own.path, overlap: { agentId: same.id, relation: 'same' }, isOnlyAgent };
  const holder = others.find((agent) => isInside(own.path, agent.path));
  if (holder) return { path: own.path, overlap: { agentId: holder.id, relation: 'inside' }, isOnlyAgent };
  const held = others.find((agent) => isInside(agent.path, own.path));
  if (held) return { path: own.path, overlap: { agentId: held.id, relation: 'contains' }, isOnlyAgent };
  return { path: own.path, isOnlyAgent };
}

/** Agent identity names from an agents.list answer, dropping empty and template stand-ins. */
export function readAgentIdentityNames(answer: unknown): Record<string, string> {
  const agents = (answer as { agents?: unknown } | null)?.agents;
  if (!Array.isArray(agents)) return {};
  const names: Record<string, string> = {};
  for (const agent of agents) {
    const record = agent as { id?: unknown; identity?: { name?: unknown } } | null;
    const id = typeof record?.id === 'string' ? record.id.trim() : '';
    const rawName = typeof record?.identity?.name === 'string' ? record.identity.name.trim() : '';
    if (id && rawName && !isPlaceholderIdentityName(rawName)) names[id] = rawName;
  }
  return names;
}

function sameIdentityNames(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

interface SessionContextValue {
  sessions: Session[];
  sessionsLoading: boolean;
  currentSession: string;
  setCurrentSession: (key: string) => void;
  busyState: Record<string, boolean>;
  agentStatus: Record<string, GranularAgentState>;
  unreadSessions: Record<string, boolean>;
  markSessionRead: (key: string) => void;
  abortSession: (sessionKey: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  deleteSession: (sessionKey: string) => Promise<void>;
  /** Removes a top-level agent through agents.delete; rejects with the gateway's refusal and changes nothing then. */
  removeAgent: (agentId: string, opts: RemoveAgentOpts) => Promise<void>;
  /** The agent's workspace from agents.list, or null when the gateway does not answer with it. */
  getAgentRemovalInfo: (agentId: string) => Promise<AgentRemovalInfo | null>;
  spawnSession: (opts: SpawnSessionOpts) => Promise<void>;
  renameSession: (sessionKey: string, label: string) => Promise<void>;
  updateSession: (sessionKey: string, updates: Partial<Session>) => void;
  agentLogEntries: AgentLogEntry[];
  eventEntries: EventEntry[];
  agentName: string;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { connectionState, rpc, subscribe } = useGateway();
  const { soundEnabled } = useSettings();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [currentSession, setCurrentSessionRaw] = useState('');
  const [agentLogEntries, setAgentLogEntries] = useState<AgentLogEntry[]>([]);
  const [eventEntries, setEventEntries] = useState<EventEntry[]>([]);
  const [agentStatus, setAgentStatus] = useState<Record<string, GranularAgentState>>({});
  const [agentName, setAgentName] = useState('Agent');
  const [defaultAgentWorkspaceRoot, setDefaultAgentWorkspaceRoot] = useState<string | null>(null);
  const [rootIdentityNames, setRootIdentityNames] = useState<Record<string, string>>({});
  const [rootIdentityMisses, setRootIdentityMisses] = useState<Record<string, true>>({});
  // What agents.list reports, by agent id: the gateway's own view outranks a workspace file.
  const [gatewayIdentityNames, setGatewayIdentityNames] = useState<Record<string, string>>({});
  const identityAttemptedAtRef = useRef<Record<string, number>>({});
  // Bumped by the poll and by a refresh, so identities are re-read without waiting for a reload.
  const [identityRevision, setIdentityRevision] = useState(0);
  const [unreadSessionKeys, setUnreadSessionKeys] = useState<Set<string>>(new Set());
  const unreadSessionKeysRef = useRef(unreadSessionKeys);
  const soundEnabledRef = useRef(soundEnabled);
  const logStateRef = useRef<Record<string, boolean>>({});
  const toolSeenRef = useRef<Map<string, number>>(new Map());
  const terminalPingSeenRef = useRef<Map<string, number>>(new Map());
  const doneTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const delayedRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const missingSessionRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // Refreshes overlap (events, the poll, spawn and delete all start one). Each takes a number when it
  // starts; one that answers after a later refresh has landed is an older snapshot and is dropped, and
  // one that started before a delete landed leaves the deleted rows out (key -> refreshes started by then).
  const deletedBeforeRefreshRef = useRef(new Map<string, number>());
  // Removed agents, by id: a refresh that started before a removal drops every session of that agent.
  const removedAgentsBeforeRefreshRef = useRef(new Map<string, number>());
  const refreshStartedRef = useRef(0);
  const refreshLandedRef = useRef(0);
  const [heartbeatRuns] = useState(() => new HeartbeatRuns());

  // Derive busyState from agentStatus for backward compatibility. A failed run is over, not busy.
  const busyState = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const [key, state] of Object.entries(agentStatus)) {
      result[key] = state.status !== 'IDLE' && state.status !== 'DONE' && state.status !== 'ERROR';
    }
    return result;
  }, [agentStatus]);
  
  // Derive unreadSessions as a stable Record<string, boolean> for consumers
  const unreadSessions = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const key of unreadSessionKeys) {
      result[key] = true;
    }
    return result;
  }, [unreadSessionKeys]);

  useEffect(() => {
    unreadSessionKeysRef.current = unreadSessionKeys;
  }, [unreadSessionKeys]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const markSessionRead = useCallback((key: string) => {
    if (!unreadSessionKeysRef.current.has(key)) return;
    const next = new Set(unreadSessionKeysRef.current);
    next.delete(key);
    unreadSessionKeysRef.current = next;
    setUnreadSessionKeys(next);
  }, []);

  const setCurrentSession = useCallback((key: string) => {
    currentSessionRef.current = key;
    setCurrentSessionRaw(key);
    markSessionRead(key);
  }, [markSessionRead]);

  // Cron sessions read from the gateway's sessions.json, for older gateways that leave them out
  // of sessions.list. Current OpenClaw writes no such file and lists cron sessions itself; when
  // the server reports the file missing and this page has never found it, it asks again only
  // every few minutes, in case an older gateway creates the file later. A file it has read
  // before is only briefly missing (an older gateway rewriting it), so that keeps being asked
  // on every refresh.
  const hiddenStoreMissingAtRef = useRef<number | null>(null);
  const hiddenStoreSeenRef = useRef(false);
  // Only the newest answer may start or end the pause: an older "missing" landing after a newer
  // "found" must not hide the file's cron sessions for five minutes.
  const hiddenRequestSeqRef = useRef(0);
  const fetchHiddenCronSessions = useCallback(async (activeMinutes: number, limit: number): Promise<Session[]> => {
    // Once any answer has found the file, nothing pauses: that answer may have landed after a
    // newer "missing" one had already started the pause.
    const missingAt = hiddenStoreMissingAtRef.current;
    // A monotonic clock, so a system clock change cannot stretch the pause
    if (!hiddenStoreSeenRef.current && missingAt !== null && performance.now() - missingAt < HIDDEN_STORE_RECHECK_MS) return [];
    const seq = ++hiddenRequestSeqRef.current;
    try {
      const params = new URLSearchParams({
        activeMinutes: String(activeMinutes),
        limit: String(limit),
      });
      const res = await fetch(`/api/sessions/hidden?${params.toString()}`);
      if (!res.ok) return [];
      const data = await res.json() as { ok?: boolean; sessions?: Session[]; storeMissing?: boolean };
      if (!data.storeMissing) hiddenStoreSeenRef.current = true;
      if (seq === hiddenRequestSeqRef.current) {
        hiddenStoreMissingAtRef.current = data.storeMissing && !hiddenStoreSeenRef.current ? performance.now() : null;
      }
      return Array.isArray(data.sessions) ? data.sessions : [];
    } catch {
      return [];
    }
  }, []);

  const mergeSessionLists = useCallback((primary: Session[], supplemental: Session[]): Session[] => {
    if (supplemental.length === 0) return primary;
    const merged = [...primary];
    const seen = new Set(primary.map(getSessionKey));
    for (const session of supplemental) {
      const key = getSessionKey(session);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(session);
    }
    return merged;
  }, []);

  // Fetch agent name from server-info on mount
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/server-info', { signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json() as { agentName?: string; defaultAgentWorkspaceRoot?: string | null };
        if (data.agentName) {
          setAgentName(data.agentName);
        }
        setDefaultAgentWorkspaceRoot(
          typeof data.defaultAgentWorkspaceRoot === 'string' && data.defaultAgentWorkspaceRoot.trim()
            ? data.defaultAgentWorkspaceRoot
            : null,
        );
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          // silent fail - use default
        }
      }
    })();
    return () => controller.abort();
  }, []);
  const sessionsRef = useRef(sessions);
  
  // Identities are re-read on a timer: a rename in config or in IDENTITY.md must not need a reload.
  useEffect(() => {
    if (connectionState !== 'connected') return;
    const iv = setInterval(() => setIdentityRevision((value) => value + 1), IDENTITY_REFRESH_MS);
    return () => clearInterval(iv);
  }, [connectionState]);

  // agents.list reports the identity the gateway itself holds. It outranks a workspace file and
  // reaches the labels without that file being fetched again.
  useEffect(() => {
    if (connectionState !== 'connected') return;
    let cancelled = false;
    void (async () => {
      try {
        const names = readAgentIdentityNames(await rpc('agents.list', {}));
        if (!cancelled) {
          setGatewayIdentityNames((prev) => (sameIdentityNames(prev, names) ? prev : names));
        }
      } catch {
        // Keep the names from the last answer; the workspace fallback still covers unknown agents.
      }
    })();
    return () => { cancelled = true; };
  }, [connectionState, identityRevision, rpc]);

  // Workspace identity files are the fallback for agents the gateway does not register. A read
  // stays fresh for a while and a missing Name is retried on a bounded interval, so a placeholder
  // or an old name is never kept forever. Neither source may store template text.
  useEffect(() => {
    const now = Date.now();
    const rootAgentIds = Array.from(new Set(
      sessions
        .map((session) => getSessionKey(session))
        .filter(isTopLevelAgentSessionKey)
        .map((sessionKey) => getRootAgentId(sessionKey))
        .filter((rootId): rootId is string => Boolean(rootId) && rootId !== 'main'),
    )).filter((rootId) => {
      if (gatewayIdentityNames[rootId]) return false;
      const attemptedAt = identityAttemptedAtRef.current[rootId] ?? 0;
      const freshFor = rootIdentityNames[rootId] ? IDENTITY_FILE_TTL_MS : IDENTITY_FILE_RETRY_MS;
      return now - attemptedAt >= freshFor;
    });

    if (rootAgentIds.length === 0) return;

    const controller = new AbortController();
    void Promise.all(rootAgentIds.map(async (rootId) => {
      try {
        const params = new URLSearchParams({ agentId: rootId });
        const res = await fetch(`/api/workspace/identity?${params.toString()}`, { signal: controller.signal });
        if (res.status === 404) {
          // A deleted identity file must clear the old label, not look like a read
          // that can be retried forever without ever becoming a miss.
          return { rootId, kind: 'miss' as const };
        }
        if (!res.ok) return null;
        const data = await res.json() as { ok?: boolean; content?: string };
        const identityName = typeof data.content === 'string' ? extractIdentityName(data.content) : null;
        if (identityName && !isPlaceholderIdentityName(identityName)) {
          return { rootId, identityName, kind: 'hit' as const };
        }
        return { rootId, kind: 'miss' as const };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return null;
        return null;
      }
    })).then((results) => {
      if (controller.signal.aborted) return;
      const resolved = results.filter((result): result is NonNullable<typeof result> => Boolean(result));
      if (resolved.length === 0) return;
      // Only an applied read starts its retry window. A batch aborted because
      // another root was still pending must not leave discarded roots stamped.
      const attemptedAt = Date.now();
      for (const result of resolved) identityAttemptedAtRef.current[result.rootId] = attemptedAt;

      setRootIdentityMisses((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const result of resolved) {
          if (result.kind === 'hit') {
            if (!next[result.rootId]) continue;
            delete next[result.rootId];
            changed = true;
            continue;
          }
          if (next[result.rootId]) continue;
          next[result.rootId] = true;
          changed = true;
        }
        return changed ? next : prev;
      });

      setRootIdentityNames((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const result of resolved) {
          if (result.kind === 'hit') {
            if (next[result.rootId] === result.identityName) continue;
            next[result.rootId] = result.identityName;
            changed = true;
            continue;
          }
          // A file that lost its name must not leave the old label behind.
          if (next[result.rootId] === undefined) continue;
          delete next[result.rootId];
          changed = true;
        }
        return changed ? next : prev;
      });
    });

    return () => controller.abort();
  }, [gatewayIdentityNames, identityRevision, rootIdentityMisses, rootIdentityNames, sessions]);

  // A gateway name outranks a workspace file; either is dropped when it is only template text.
  const resolvedIdentityNames = useMemo(() => {
    const names = { ...rootIdentityNames };
    for (const [rootId, name] of Object.entries(gatewayIdentityNames)) {
      if (!isPlaceholderIdentityName(name)) names[rootId] = name;
    }
    return names;
  }, [gatewayIdentityNames, rootIdentityNames]);

  const displaySessions = useMemo(() => sessions.map((session) => {
    const sessionKey = getSessionKey(session);
    if (!isTopLevelAgentSessionKey(sessionKey)) return session;

    const rootId = getRootAgentId(sessionKey);
    if (!rootId) return session;

    const candidate = resolvedIdentityNames[rootId]
      ?? (rootId === 'main' ? agentName : undefined);
    const identityName = candidate && !isPlaceholderIdentityName(candidate) ? candidate : undefined;
    if (rootId !== 'main' && !identityName) {
      if (!session.identityName) return session;
      const rest = { ...session };
      delete rest.identityName;
      return rest;
    }
    if (!identityName || session.identityName === identityName) return session;
    return { ...session, identityName };
  }), [agentName, resolvedIdentityNames, sessions]);

  useEffect(() => {
    sessionsRef.current = displaySessions;
  }, [displaySessions]);
  
  const currentSessionRef = useRef(currentSession);
  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  const markSessionUnread = useCallback((sessionKey: string) => {
    if (!sessionKey || currentSessionRef.current === sessionKey || unreadSessionKeysRef.current.has(sessionKey)) return;
    const next = new Set(unreadSessionKeysRef.current);
    next.add(sessionKey);
    unreadSessionKeysRef.current = next;
    setUnreadSessionKeys(next);
  }, []);

  const pingSession = useCallback((sessionKey: string, runId?: string) => {
    if (!sessionKey || currentSessionRef.current === sessionKey || !soundEnabledRef.current) return;
    const now = Date.now();
    const dedupeKey = runId ? `${sessionKey}:${runId}` : sessionKey;
    const lastPingAt = terminalPingSeenRef.current.get(dedupeKey);
    if (lastPingAt && now - lastPingAt < TERMINAL_PING_DEDUP_MS) return;
    terminalPingSeenRef.current.set(dedupeKey, now);
    playPing();
  }, []);

  const findDescendantSessionKeys = useCallback((sessionKey: string, sourceSessions: Session[] = sessionsRef.current) => {
    const roots = buildSessionTree(sourceSessions);
    const queue = [...roots];
    let targetNode: (typeof roots)[number] | null = null;

    while (queue.length > 0) {
      const node = queue.shift()!;
      if (node.key === sessionKey) {
        targetNode = node;
        break;
      }
      queue.push(...node.children);
    }

    if (!targetNode) return [] as string[];

    const descendants: string[] = [];
    const collectPostOrder = (node: (typeof roots)[number]) => {
      for (const child of node.children) collectPostOrder(child);
      descendants.push(node.key);
    };
    for (const child of targetNode.children) collectPostOrder(child);

    return descendants;
  }, []);

  // Null when the gateway could not be asked, so a refresh can tell a failure from an answer.
  const fetchAuthoritativeSessions = useCallback(async (): Promise<Session[] | null> => {
    if (connectionState !== 'connected') return null;
    try {
      const [res, hiddenCronSessions] = await Promise.all([
        rpc('sessions.list', { limit: FULL_SESSIONS_LIMIT }) as Promise<SessionsListResponse>,
        fetchHiddenCronSessions(24 * 60, FULL_SESSIONS_LIMIT),
      ]);

      const baseSessions = mergeSessionLists(res?.sessions ?? [], hiddenCronSessions);
      const spawnedByRoots = new Set<string>([MAIN_SESSION_KEY]);
      for (const rootSession of getTopLevelAgentSessions(baseSessions)) {
        spawnedByRoots.add(getSessionKey(rootSession));
      }

      // Keep active child sessions visible even when the full sessions.list
      // result lags behind the recent spawn/discovery flow.
      const spawnedSessionLists = await Promise.all(
        [...spawnedByRoots].map(async (rootSessionKey) => {
          try {
            const spawnedRes = await rpc('sessions.list', { spawnedBy: rootSessionKey, limit: SESSIONS_SPAWNED_LIMIT }) as SessionsListResponse;
            return spawnedRes?.sessions ?? [];
          } catch (err) {
            console.debug('[SessionContext] Failed to fetch spawned sessions for root:', rootSessionKey, err);
            return [];
          }
        }),
      );

      return spawnedSessionLists.reduce(
        (acc, spawnedSessions) => mergeSessionLists(acc, spawnedSessions),
        baseSessions,
      );
    } catch (err) {
      console.debug('[SessionContext] Failed to fetch authoritative session list:', err);
      return null;
    }
  }, [connectionState, fetchHiddenCronSessions, mergeSessionLists, rpc]);

  // Spawn and delete fall back to the list on screen when the gateway cannot be asked.
  const listAuthoritativeSessions = useCallback(
    async () => (await fetchAuthoritativeSessions()) ?? sessionsRef.current,
    [fetchAuthoritativeSessions],
  );

  const setGranularStatus = useCallback((sessionKey: string, state: GranularAgentState) => {
    if (!sessionKey) return;
    // Cancel any pending DONE→IDLE timeout for this session
    if (doneTimeoutsRef.current[sessionKey]) {
      clearTimeout(doneTimeoutsRef.current[sessionKey]);
      delete doneTimeoutsRef.current[sessionKey];
    }
    // If transitioning to DONE, schedule auto-transition to IDLE after 3s
    if (state.status === 'DONE') {
      // Mark subagent sessions as unread when they complete (unless currently viewing)
      if (isSubagentSessionKey(sessionKey)) {
        markSessionUnread(sessionKey);
      }
      doneTimeoutsRef.current[sessionKey] = setTimeout(() => {
        setAgentStatus(prev => {
          const current = prev[sessionKey];
          // Only transition if still in DONE state
          if (!current || current.status !== 'DONE') return prev;
          return { ...prev, [sessionKey]: { status: 'IDLE', since: Date.now() } };
        });
        delete doneTimeoutsRef.current[sessionKey];
      }, 3000);
    }
    setAgentStatus(prev => {
      const existing = prev[sessionKey];
      // Optimization: skip update if status/tool haven't changed
      if (existing && existing.status === state.status && existing.toolName === state.toolName) return prev;
      return { ...prev, [sessionKey]: state };
    });
  }, [markSessionUnread]);

  const shouldLogTool = useCallback((toolId: string) => {
    if (!toolId) return false;
    const now = Date.now();
    const map = toolSeenRef.current;
    const DEDUP_MS = 5 * 60 * 1000;
    const last = map.get(toolId);
    if (last && now - last < DEDUP_MS) return false;
    map.set(toolId, now);
    // Prune expired entries when map grows too large
    if (map.size > 500) {
      for (const [key, ts] of map) {
        if (now - ts > DEDUP_MS) map.delete(key);
      }
    }
    return true;
  }, []);

  const addAgentLogEntry = useCallback((icon: string, text: string) => {
    const entry: AgentLogEntry = { icon, text, ts: Date.now() };
    setAgentLogEntries(prev => [entry, ...prev].slice(0, 100));
    fetch('/api/agentlog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    }).catch(() => {});
  }, []);

  const friendlyName = useCallback((sk: string) => {
    if (!sk) return 'unknown';
    const sess = sessionsRef.current.find(s => getSessionKey(s) === sk);
    if (sess) return getSessionDisplayLabel(sess, agentName);
    if (isSubagentSessionKey(sk)) return 'sub-agent ' + sk.split(':').pop()?.slice(0, 8);
    return sk.split(':').pop() || sk;
  }, [agentName]);

  const rpcRef = useRef(rpc);
  
  useEffect(() => {
    rpcRef.current = rpc;
  }, [rpc]);

  const addEvent = useCallback((msg: GatewayEvent) => {
    const evt = msg.event || 'response';
    const p = (msg.payload || {}) as EventPayload;

    const chatStateDescs: Record<string, string> = {
      delta: 'Response streaming', final: 'Response complete',
      error: 'Chat error', aborted: 'Response aborted',
    };

    let badge = 'SYSTEM', badgeCls = 'badge-system', desc = evt;

    if (evt.startsWith('chat')) {
      badge = 'CHAT'; badgeCls = p.state === 'error' ? 'badge-error' : 'badge-chat';
      desc = chatStateDescs[p.state || ''] || (p.sessionKey ? 'Message from ' + p.sessionKey : 'Chat event');
    } else if (evt.startsWith('agent')) {
      badge = 'AGENT'; badgeCls = 'badge-agent';
      const ap = p as AgentEventPayload;
      if (ap.stream === 'lifecycle') {
        const phase = String((ap.data as Record<string, unknown> | undefined)?.phase || '');
        desc = 'Agent lifecycle: ' + (phase || 'unknown');
      } else if (ap.stream === 'assistant') {
        desc = 'Agent assistant output';
      } else {
        const state = p.state || p.agentState || '';
        desc = state ? 'Agent state: ' + state : 'Agent event';
      }
    } else if (evt.startsWith('cron')) {
      badge = 'CRON'; badgeCls = 'badge-cron';
      desc = p.name ? 'Cron job: ' + p.name : 'Cron job triggered';
    } else if (evt === 'connect.challenge') {
      desc = 'Connection challenge received';
    } else if (evt.startsWith('presence')) {
      desc = 'Presence update';
    } else if (evt.startsWith('exec.approval')) {
      desc = 'Exec approval ' + (evt.includes('request') ? 'requested' : 'resolved');
    } else if (evt.includes('error')) {
      badge = 'ERROR'; badgeCls = 'badge-error';
      desc = (typeof p.message === 'string' ? p.message : p.error) || 'Error occurred';
    }

    setEventEntries(prev => [{ badge, badgeCls, desc, ts: new Date() }, ...prev].slice(0, 50));
  }, []);

  const feedAgentLog = useCallback((evt: string, p: EventPayload) => {
    const sk = p.sessionKey || '';
    const name = friendlyName(sk);
    const isSubagent = isSubagentSessionKey(sk);
    const isMain = isTopLevelAgentSessionKey(sk);

    const processToolBlocks = (blocks: ContentBlock[]) => {
      for (const block of blocks) {
        if (block.type !== 'tool_use' && block.type !== 'toolCall') continue;
        if (!block.name) continue;
        let toolInput: Record<string, unknown> = typeof block.input === 'object' && block.input ? block.input : {};
        if (!toolInput || Object.keys(toolInput).length === 0) {
          const args = block.arguments;
          if (typeof args === 'string') {
            try { toolInput = JSON.parse(args); } catch { toolInput = {}; }
          } else if (typeof args === 'object' && args) {
            toolInput = args;
          }
        }
        const toolId = String(block.id || block.toolCallId || block.name);
        if (shouldLogTool(toolId)) {
          const desc = describeToolUse(block.name, toolInput);
          if (desc) addAgentLogEntry('🔧', desc);
        }
      }
    };

    const processMessages = (msgs: ChatMessage[]) => {
      for (const m of msgs) {
        if (m.role === 'assistant' && Array.isArray(m.content)) {
          processToolBlocks(m.content as ContentBlock[]);
        }
      }
    };

    // Handle lifecycle events from CLI agents (Codex, Claude Code CLI)
    if (evt === 'agent') {
      const ap = p as AgentEventPayload;
      if (ap.stream === 'lifecycle') {
        const phase = (ap.data as Record<string, unknown> | undefined)?.phase;
        if (phase === 'start') {
          logStateRef.current['_conv_' + sk] = true;
          addAgentLogEntry(isMain ? '🧠' : '⚡', isMain ? 'thinking…' : isSubagent ? 'spawned ' + name : name + ' started');
        } else if (phase === 'end') {
          addAgentLogEntry(isMain ? '✦' : '✅', isMain ? 'finished response' : name + ' completed');
          delete logStateRef.current['_conv_' + sk];
        } else if (phase === 'error') {
          addAgentLogEntry('❌', isMain ? 'generation failed' : name + ' failed');
          delete logStateRef.current['_conv_' + sk];
        }
        return;
      }
    }

    if (evt === 'chat') {
      if ((p.state === 'delta' || p.state === 'started') && !logStateRef.current['_conv_' + sk]) {
        logStateRef.current['_conv_' + sk] = true;
        addAgentLogEntry(isMain ? '🧠' : '⚡', isMain ? 'thinking…' : isSubagent ? 'spawned ' + name : name + ' started');
      }
      if (Array.isArray(p.content)) processToolBlocks(p.content as ContentBlock[]);
      if (Array.isArray(p.messages)) processMessages(p.messages as ChatMessage[]);
      if (p.state === 'final') {
        if (sk && rpcRef.current) {
          rpcRef.current('chat.history', { sessionKey: sk, limit: 10 })
            .then((res: unknown) => processMessages((res as ChatHistoryResponse)?.messages || []))
            .catch(() => {});
        }
        addAgentLogEntry(isMain ? '✦' : '✅', isMain ? 'finished response' : name + ' completed');
        delete logStateRef.current['_conv_' + sk];
      } else if (p.state === 'error' || p.state === 'aborted') {
        const icon = p.state === 'error' ? '❌' : '⛔';
        const verb = p.state === 'error' ? 'failed' : 'aborted';
        addAgentLogEntry(icon, isMain ? (p.state === 'error' ? 'generation failed' : 'response aborted') : name + ' ' + verb);
        delete logStateRef.current['_conv_' + sk];
      }
    } else if (evt === 'cron') {
      addAgentLogEntry('⏰', 'cron: ' + (p.name || 'scheduled task fired'));
    } else if (evt === 'connect.challenge') {
      addAgentLogEntry('🔗', 'connected to gateway');
    } else if (evt.includes('error')) {
      addAgentLogEntry('❌', (typeof p.message === 'string' ? p.message : p.error) || 'something went wrong');
    } else if (evt === 'exec.approval.requested') {
      addAgentLogEntry('🔐', 'requesting exec approval');
    } else if (evt === 'exec.approval.resolved') {
      addAgentLogEntry('🔓', 'exec approved');
    }
  }, [addAgentLogEntry, friendlyName, shouldLogTool]);

  const refreshSessions = useCallback(async () => {
    if (!mountedRef.current || connectionState !== 'connected') return;
    const refreshId = ++refreshStartedRef.current;
    try {
      const answer = await fetchAuthoritativeSessions();
      if (!mountedRef.current || !answer || refreshId <= refreshLandedRef.current) return;
      refreshLandedRef.current = refreshId;
      const deletedBefore = deletedBeforeRefreshRef.current;
      const removedAgentsBefore = removedAgentsBeforeRefreshRef.current;
      const newSessions = answer.filter((session) => {
        const key = getSessionKey(session);
        const agentId = getSessionAgentId(key);
        return refreshId > (deletedBefore.get(key) ?? 0)
          && refreshId > ((agentId && removedAgentsBefore.get(agentId)) || 0);
      });
      for (const [key, startedBy] of deletedBefore) {
        if (startedBy <= refreshId) deletedBefore.delete(key);
      }
      for (const [agentId, startedBy] of removedAgentsBefore) {
        if (startedBy <= refreshId) removedAgentsBefore.delete(agentId);
      }
      const nextCurrentSession = pickDefaultSessionKey(newSessions, currentSessionRef.current);
      
      // Smart diffing: preserve object references for unchanged sessions.
      // This prevents unnecessary re-renders in child components.
      setSessions(prev => {
        // Fast path: if lengths differ, structure changed
        if (prev.length !== newSessions.length) return newSessions;
        
        // Create lookup for efficient comparison
        const prevMap = new Map(prev.map(s => [getSessionKey(s), s]));
        
        let hasChanges = false;
        const merged = newSessions.map(newSession => {
          const key = getSessionKey(newSession);
          const existing = prevMap.get(key);
          
          // If session doesn't exist in prev, it's new
          if (!existing) {
            hasChanges = true;
            return newSession;
          }
          
          const changed = DIFFED_SESSION_FIELDS.some((field) => existing[field] !== newSession[field])
            || !sameThinkingLevels(existing.thinkingLevels, newSession.thinkingLevels)
            || !sameThinkingOptions(existing.thinkingOptions, newSession.thinkingOptions);
          
          if (changed) {
            hasChanges = true;
            return newSession;
          }
          
          // No change - keep the existing reference
          return existing;
        });
        
        // If nothing changed, return the same array reference
        return hasChanges ? merged : prev;
      });
      setCurrentSession(nextCurrentSession);
    } catch (err) {
      console.debug('[SessionContext] Failed to refresh sessions:', err);
    } finally {
      if (mountedRef.current) {
        setSessionsLoading(false);
      }
    }
  }, [connectionState, fetchAuthoritativeSessions, setCurrentSession]);

  const refreshSessionsRef = useRef(refreshSessions);
  refreshSessionsRef.current = refreshSessions;

  // Update session in list from WebSocket event data
  const updateSessionFromEvent = useCallback((sessionKey: string, updates: Partial<Session>) => {
    setSessions(prev => {
      const idx = prev.findIndex(s => getSessionKey(s) === sessionKey);
      if (idx === -1) {
        // New session appeared that we don't have - schedule a refresh
        // Use setTimeout to avoid calling during render
        if (missingSessionRefreshTimeoutRef.current === null) {
          missingSessionRefreshTimeoutRef.current = setTimeout(() => {
            missingSessionRefreshTimeoutRef.current = null;
            void refreshSessionsRef.current();
          }, 100);
        }
        return prev;
      }
      
      // Check if the update actually changes anything
      const existing = prev[idx];
      const hasChanges = Object.entries(updates).some(
        ([key, value]) => existing[key as keyof Session] !== value
      );
      
      // If nothing changed, return the same array reference
      if (!hasChanges) return prev;
      
      // Update only the changed session, preserving other references
      return prev.map((s, i) => {
        if (i !== idx) return s;
        return { ...s, ...updates, lastActivity: Date.now() };
      });
    });
  }, []);

  // Extract session updates (state + token data) from a typed agent event payload
  const extractSessionUpdates = useCallback((state: string | undefined, payload: AgentEventPayload | ChatEventPayload): Partial<Session> => {
    const updates: Partial<Session> = {};
    if (state) updates.state = state;
    if ('totalTokens' in payload && typeof payload.totalTokens === 'number') updates.totalTokens = payload.totalTokens;
    if ('contextTokens' in payload && typeof payload.contextTokens === 'number') updates.contextTokens = payload.contextTokens;
    return updates;
  }, []);

  const scheduleDelayedRefresh = useCallback(() => {
    if (delayedRefreshTimeoutRef.current) {
      clearTimeout(delayedRefreshTimeoutRef.current);
    }
    delayedRefreshTimeoutRef.current = setTimeout(() => {
      delayedRefreshTimeoutRef.current = null;
      void refreshSessionsRef.current();
    }, 1500);
  }, []);

  // Subscribe to gateway events for granular status tracking + session state sync + agent log + event log
  useEffect(() => {
    const unsub = subscribe((msg: GatewayEvent) => {
      const evt = msg.event;
      const p = (msg.payload || {}) as EventPayload;

      addEvent(msg);

      // A heartbeat is not work to show: it leaves the session dark and the agent log alone.
      if (heartbeatRuns.observe(msg)) return;

      // Session granular status tracking + state sync from agent/chat events
      if ((evt === 'agent' || evt === 'chat') && p.sessionKey) {
        const sk = p.sessionKey;
        const typedPayload = evt === 'agent'
          ? (msg.payload || {}) as AgentEventPayload
          : (msg.payload || {}) as ChatEventPayload;

        // Handle lifecycle events from CLI agents (Codex, Claude Code CLI)
        if (evt === 'agent') {
          const ap = typedPayload as AgentEventPayload;

          if (ap.stream === 'lifecycle') {
            const phase = (ap.data as Record<string, unknown> | undefined)?.phase;
            if (phase === 'start') {
              setGranularStatus(sk, { status: 'THINKING', since: Date.now() });
            } else if (phase === 'end') {
              setGranularStatus(sk, { status: 'DONE', since: Date.now() });
              if (isTopLevelAgentSessionKey(sk)) {
                markSessionUnread(sk);
                pingSession(sk, eventRunId(ap));
              }
              refreshSessions();
              scheduleDelayedRefresh();
            } else if (phase === 'error') {
              setGranularStatus(sk, { status: 'ERROR', since: Date.now() });
              if (isTopLevelAgentSessionKey(sk)) {
                markSessionUnread(sk);
                pingSession(sk, eventRunId(ap));
              }
              refreshSessions();
            }
          } else if (ap.stream === 'tool' && ap.data) {
            if (ap.data.phase === 'start' && ap.data.name) {
              const toolDesc = describeToolUse(ap.data.name, ap.data.args || {});
              setGranularStatus(sk, {
                status: 'THINKING',
                toolName: ap.data.name,
                toolDescription: toolDesc || undefined,
                since: Date.now(),
              });
            } else if (ap.data.phase === 'result') {
              setGranularStatus(sk, { status: 'THINKING', since: Date.now() });
            }
          } else if (ap.stream === 'assistant') {
            setGranularStatus(sk, { status: 'STREAMING', since: Date.now() });
          }
        }

        // Handle chat events
        if (evt === 'chat') {
          const cp = typedPayload as ChatEventPayload;
          const state = cp.state || '';

          if (state === 'started') {
            setGranularStatus(sk, { status: 'THINKING', since: Date.now() });
            if (isTopLevelAgentSessionKey(sk)) {
              markSessionUnread(sk);
            }
          } else if (state === 'delta') {
            setGranularStatus(sk, { status: 'STREAMING', since: Date.now() });
          } else if (state === 'final') {
            setGranularStatus(sk, { status: 'DONE', since: Date.now() });
            if (isTopLevelAgentSessionKey(sk)) {
              markSessionUnread(sk);
              pingSession(sk, eventRunId(cp));
            }
            refreshSessions();
            // Delayed refresh to catch token counts that may not be available immediately.
            scheduleDelayedRefresh();
          } else if (state === 'error') {
            setGranularStatus(sk, { status: 'ERROR', since: Date.now() });
            if (isTopLevelAgentSessionKey(sk)) {
              markSessionUnread(sk);
              pingSession(sk, eventRunId(cp));
            }
          } else if (state === 'aborted') {
            setGranularStatus(sk, { status: 'IDLE', since: Date.now() });
          }
        }

        // Also handle legacy state strings for backward compatibility
        const state = evt === 'agent'
          ? ((typedPayload as AgentEventPayload).state || (typedPayload as AgentEventPayload).agentState || '')
          : ((typedPayload as ChatEventPayload).state || '');

        // Map legacy state strings to granular status (only if not already handled above)
        if (evt === 'agent' && !(typedPayload as AgentEventPayload).stream) {
          if (BUSY_STATES.has(state)) {
            setGranularStatus(sk, { status: 'THINKING', since: Date.now() });
          } else if (IDLE_STATES.has(state)) {
            if (state === 'error') {
              setGranularStatus(sk, { status: 'ERROR', since: Date.now() });
            } else if (state === 'aborted') {
              setGranularStatus(sk, { status: 'IDLE', since: Date.now() });
            } else {
              setGranularStatus(sk, { status: 'DONE', since: Date.now() });
            }
            if (state === 'final' || state === 'done' || state === 'completed') {
              refreshSessions();
            }
          }
        }

        const updates = extractSessionUpdates(state || undefined, typedPayload);
        if (Object.keys(updates).length > 0) {
          updateSessionFromEvent(sk, updates);
        }
      }

      feedAgentLog(evt, p);
    });

    return () => {
      unsub();
    };
  }, [subscribe, addEvent, setGranularStatus, markSessionUnread, pingSession, feedAgentLog, updateSessionFromEvent, extractSessionUpdates, refreshSessions, scheduleDelayedRefresh, heartbeatRuns]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const key of Object.keys(doneTimeoutsRef.current)) {
        clearTimeout(doneTimeoutsRef.current[key]);
      }
      doneTimeoutsRef.current = {};
      if (delayedRefreshTimeoutRef.current) {
        clearTimeout(delayedRefreshTimeoutRef.current);
        delayedRefreshTimeoutRef.current = null;
      }
      if (missingSessionRefreshTimeoutRef.current) {
        clearTimeout(missingSessionRefreshTimeoutRef.current);
        missingSessionRefreshTimeoutRef.current = null;
      }
    };
  }, []);

  // A reconnect may have missed lifecycle events, so the granular statuses held across the gap
  // are suspect: a retained DONE could hide a run that started while we were away, and a retained
  // THINKING could keep a pane lit for a run that ended. Drop them all and let the refreshed
  // session snapshot decide until new events arrive.
  const wasConnectedRef = useRef(false);
  useEffect(() => {
    if (connectionState !== 'connected') return;
    if (wasConnectedRef.current) {
      for (const key of Object.keys(doneTimeoutsRef.current)) {
        clearTimeout(doneTimeoutsRef.current[key]);
      }
      doneTimeoutsRef.current = {};
      setAgentStatus({});
    }
    wasConnectedRef.current = true;
  }, [connectionState]);

  // Poll sessions when connected (reduced to 30s - WebSocket events provide real-time updates)
  useEffect(() => {
    if (connectionState !== 'connected') return;
    void refreshSessionsRef.current();
    // Polling is now just a fallback for catching missed updates
    const iv = setInterval(() => {
      void refreshSessionsRef.current();
    }, 30000);
    return () => clearInterval(iv);
  }, [connectionState]);

  // Load agent log on mount
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/agentlog', { signal: controller.signal });
        const entries = await res.json().catch(() => null) as AgentLogEntry[] | null;
        if (Array.isArray(entries)) {
          setAgentLogEntries(entries.slice().reverse().slice(0, 100));
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.debug('[SessionContext] Failed to load agent log:', err.message);
        }
      }
    })();
    return () => controller.abort();
  }, []);

  // Drops sessions the gateway no longer has: their rows, pins and unread marks, and the current
  // session when it was one of them.
  const forgetDeletedSessions = useCallback((deletedKeys: string[]) => {
    if (deletedKeys.length === 0) return;
    // A refresh still in flight may hold a snapshot from before these deletes and would bring the rows back.
    for (const key of deletedKeys) deletedBeforeRefreshRef.current.set(key, refreshStartedRef.current);
    const shouldReplaceCurrent = deletedKeys.includes(currentSessionRef.current);
    const remaining = sessionsRef.current.filter(s => !deletedKeys.includes(getSessionKey(s)));
    setSessions(prev => prev.filter(s => !deletedKeys.includes(getSessionKey(s))));
    // A deleted session's status goes too: a key can come back (an agent re-created with the same
    // id) and must not show the old run.
    for (const key of deletedKeys) {
      if (doneTimeoutsRef.current[key]) {
        clearTimeout(doneTimeoutsRef.current[key]);
        delete doneTimeoutsRef.current[key];
      }
    }
    setAgentStatus(prev => {
      if (!deletedKeys.some((key) => key in prev)) return prev;
      const next = { ...prev };
      for (const key of deletedKeys) delete next[key];
      return next;
    });
    // A deleted session's pin goes with it; pins of sessions merely missing from a refresh stay.
    unpinSessions(deletedKeys);
    if (unreadSessionKeysRef.current.size > 0) {
      const next = new Set(unreadSessionKeysRef.current);
      for (const key of deletedKeys) next.delete(key);
      unreadSessionKeysRef.current = next;
      setUnreadSessionKeys(next);
    }
    if (shouldReplaceCurrent) {
      setCurrentSession(pickDefaultSessionKey(remaining));
    }
  }, [setCurrentSession]);

  const deleteSession = useCallback(async (sessionKey: string) => {
    const authoritativeSessions = await listAuthoritativeSessions();
    const descendants = findDescendantSessionKeys(sessionKey, authoritativeSessions);
    const keysToDelete = [...descendants, sessionKey];
    // The target is deleted last, so a gateway refusal would only arrive after every child is gone.
    const refusal = getSessionDeleteRefusal(keysToDelete);
    if (refusal) throw new Error(refusal);

    const deletedKeys: string[] = [];
    try {
      for (const key of keysToDelete) {
        await rpc('sessions.delete', { key, deleteTranscript: true });
        deletedKeys.push(key);
      }
    } finally {
      // Mirror what the gateway actually deleted, also when a later delete in the tree failed.
      forgetDeletedSessions(deletedKeys);
    }
  }, [findDescendantSessionKeys, forgetDeletedSessions, listAuthoritativeSessions, rpc]);

  const removeAgent = useCallback(async (agentId: string, opts: RemoveAgentOpts) => {
    // agents.delete takes the agent's sessions, crons and (with deleteFiles) its files with it.
    await rpc('agents.delete', { agentId, deleteFiles: opts.deleteFiles });
    const isTheAgents = (key: string) => getSessionAgentId(key) === agentId;
    // A refresh already in flight may hold sessions of this agent, also ones the list never showed.
    removedAgentsBeforeRefreshRef.current.set(agentId, refreshStartedRef.current);
    forgetDeletedSessions(sessionsRef.current.map(getSessionKey).filter(isTheAgents));
    // Its pins, unread marks and statuses go too, also those of sessions the list was not showing.
    unpinSessionsMatching(isTheAgents);
    if ([...unreadSessionKeysRef.current].some(isTheAgents)) {
      const next = new Set([...unreadSessionKeysRef.current].filter((key) => !isTheAgents(key)));
      unreadSessionKeysRef.current = next;
      setUnreadSessionKeys(next);
    }
    for (const key of Object.keys(doneTimeoutsRef.current)) {
      if (!isTheAgents(key)) continue;
      clearTimeout(doneTimeoutsRef.current[key]);
      delete doneTimeoutsRef.current[key];
    }
    setAgentStatus(prev => {
      const keys = Object.keys(prev).filter(isTheAgents);
      if (keys.length === 0) return prev;
      const next = { ...prev };
      for (const key of keys) delete next[key];
      return next;
    });
    // An agent re-created with this id reads its identity afresh.
    const withoutAgent = <T,>(prev: Record<string, T>): Record<string, T> => {
      if (!(agentId in prev)) return prev;
      const next = { ...prev };
      delete next[agentId];
      return next;
    };
    setRootIdentityNames(withoutAgent);
    setRootIdentityMisses(withoutAgent);
    setGatewayIdentityNames(withoutAgent);
    delete identityAttemptedAtRef.current[agentId];
    setIdentityRevision((value) => value + 1);
    await refreshSessions();
  }, [forgetDeletedSessions, refreshSessions, rpc]);

  const getAgentRemovalInfo = useCallback(async (agentId: string) => {
    try {
      return findAgentRemovalInfo(await rpc('agents.list', {}), agentId);
    } catch (err) {
      console.debug('[SessionContext] Failed to look up the agent workspace:', err);
      return null;
    }
  }, [rpc]);

  const spawnSession = useCallback(async (opts: SpawnSessionOpts) => {
    const authoritativeSessions = await listAuthoritativeSessions();

    if (opts.kind === 'root') {
      const rootName = opts.agentName?.trim();
      if (!rootName) throw new Error('Agent name is required');

      const sessionKey = buildAgentRootSessionKey(
        rootName,
        authoritativeSessions.map(getSessionKey),
      );
      // Register agent in config (ignore if already registered)
      const agentId = getRootAgentId(sessionKey);
      const registrationName = getAgentRegistrationName(rootName, sessionKey);
      const workspacePath = defaultAgentWorkspaceRoot
        ? `${defaultAgentWorkspaceRoot.replace(/\/+$/, '')}/${agentId}`
        : `~/.openclaw/workspace-${agentId}`;
      try {
        await rpc('agents.create', { name: registrationName, workspace: workspacePath });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('already exists')) throw err;
      }
      const thinkingLevel = opts.thinking ?? null;

      await rpc('sessions.patch', {
        key: sessionKey,
        label: rootName,
        model: opts.model,
        thinkingLevel,
      });

      const idempotencyKey = `spawn-root-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await rpc('chat.send', {
        sessionKey,
        message: opts.task,
        deliver: false,
        idempotencyKey,
      });

      await refreshSessions();
      setCurrentSession(sessionKey);
      return;
    }

    const fallbackRootSession = getTopLevelAgentSessions(sessionsRef.current)[0];
    const parentSessionKey = opts.parentSessionKey
      || getRootAgentSessionKey(currentSessionRef.current)
      || (fallbackRootSession ? getSessionKey(fallbackRootSession) : '');
    if (!parentSessionKey) {
      throw new Error('Create a top-level agent before launching a subagent');
    }

    const res = await fetch('/api/sessions/spawn-subagent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentSessionKey,
        task: opts.task,
        label: opts.label,
        model: opts.model,
        thinking: opts.thinking,
        cleanup: opts.cleanup ?? 'keep',
      }),
    });

    const data = await res.json().catch(() => null) as { ok?: boolean; sessionKey?: string; error?: string } | null;
    if (!res.ok || !data?.ok || !data.sessionKey) {
      throw new Error(data?.error ?? 'Failed to spawn subagent');
    }

    await refreshSessions();
    setCurrentSession(data.sessionKey);
  }, [defaultAgentWorkspaceRoot, listAuthoritativeSessions, rpc, refreshSessions, setCurrentSession]);

  const renameSession = useCallback(async (sessionKey: string, label: string) => {
    await rpc('sessions.patch', { key: sessionKey, label });
    updateSessionFromEvent(sessionKey, { label });
  }, [rpc, updateSessionFromEvent]);

  const abortSession = useCallback(async (sessionKey: string) => {
    try {
      await rpc('chat.abort', { sessionKey });
    } catch (err) {
      console.error('[SessionContext] Failed to abort session:', err);
    }
  }, [rpc]);

  const value = useMemo<SessionContextValue>(() => ({
    sessions: displaySessions,
    sessionsLoading,
    currentSession,
    setCurrentSession,
    busyState,
    agentStatus,
    unreadSessions,
    markSessionRead,
    abortSession,
    refreshSessions,
    deleteSession,
    removeAgent,
    getAgentRemovalInfo,
    spawnSession,
    renameSession,
    updateSession: updateSessionFromEvent,
    agentLogEntries,
    eventEntries,
    agentName,
  }), [
    displaySessions, sessionsLoading, currentSession, setCurrentSession, busyState, agentStatus,
    unreadSessions, markSessionRead,
    abortSession, refreshSessions, deleteSession, removeAgent, getAgentRemovalInfo, spawnSession, renameSession,
    updateSessionFromEvent, agentLogEntries, eventEntries, agentName,
  ]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionContext() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSessionContext must be used within SessionProvider');
  return ctx;
}

function eventRunId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const direct = stringValue(record.runId) ?? stringValue(record.id);
  if (direct) return direct;
  const data = record.data;
  if (!data || typeof data !== 'object') return undefined;
  const dataRecord = data as Record<string, unknown>;
  return stringValue(dataRecord.runId) ?? stringValue(dataRecord.id);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
