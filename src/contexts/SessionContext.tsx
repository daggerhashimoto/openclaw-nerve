/* eslint-disable react-refresh/only-export-components -- hook intentionally co-located with provider */
import { createContext, useContext, useCallback, useRef, useEffect, useState, useMemo, type ReactNode } from 'react';
import { useGateway } from './GatewayContext';
import { getSessionKey, type Session, type AgentLogEntry, type EventEntry, type GatewayEvent, type EventPayload, type AgentEventPayload, type ChatEventPayload, type ContentBlock, type SessionsListResponse, type ChatHistoryResponse, type ChatMessage, type GranularAgentState } from '@/types';
import { describeToolUse } from '@/utils/helpers';
import { buildSessionTree } from '@/features/sessions/sessionTree';
import {
  buildAgentRootSessionKey,
  getRootAgentSessionKey,
  getSessionDisplayLabel,
  getTopLevelAgentSessions,
  isSubagentSessionKey,
  isTopLevelAgentSessionKey,
  pickDefaultSessionKey,
  isRootChildSession,
} from '@/features/sessions/sessionKeys';

const BUSY_STATES = new Set(['running', 'thinking', 'tool_use', 'delta', 'started']);
const IDLE_STATES = new Set(['idle', 'done', 'error', 'final', 'aborted', 'completed']);

// sessions.list query defaults.
// Wider window + higher cap avoids dropping subagents from the sidebar in busy workspaces.
const SESSIONS_ACTIVE_MINUTES = 24 * 60; // 24h
const SESSIONS_LIMIT = 200;
const FULL_SESSIONS_LIMIT = 1000;
const SUBAGENT_DISCOVERY_TIMEOUT_MS = 60_000;
const SUBAGENT_DISCOVERY_POLL_MS = 1_000;

export interface SpawnSessionOpts {
  kind: 'root' | 'subagent';
  task: string;
  model?: string;
  thinking?: string;
  label?: string;
  agentName?: string;
  parentSessionKey?: string;
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
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [currentSession, setCurrentSessionRaw] = useState('');
  const [agentLogEntries, setAgentLogEntries] = useState<AgentLogEntry[]>([]);
  const [eventEntries, setEventEntries] = useState<EventEntry[]>([]);
  const [agentStatus, setAgentStatus] = useState<Record<string, GranularAgentState>>({});
  const [agentName, setAgentName] = useState('Agent');
  const [unreadSessionKeys, setUnreadSessionKeys] = useState<Set<string>>(new Set());
  const logStateRef = useRef<Record<string, boolean>>({});
  const toolSeenRef = useRef<Map<string, number>>(new Map());
  const doneTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const delayedRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive busyState from agentStatus for backward compatibility
  const busyState = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const [key, state] of Object.entries(agentStatus)) {
      result[key] = state.status !== 'IDLE' && state.status !== 'DONE';
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

  const markSessionRead = useCallback((key: string) => {
    setUnreadSessionKeys(prev => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const setCurrentSession = useCallback((key: string) => {
    setCurrentSessionRaw(key);
    markSessionRead(key);
  }, [markSessionRead]);

  const fetchHiddenCronSessions = useCallback(async (activeMinutes: number, limit: number): Promise<Session[]> => {
    try {
      const params = new URLSearchParams({
        activeMinutes: String(activeMinutes),
        limit: String(limit),
      });
      const res = await fetch(`/api/sessions/hidden?${params.toString()}`);
      if (!res.ok) return [];
      const data = await res.json() as { ok?: boolean; sessions?: Session[] };
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
        const data = await res.json();
        if (data.agentName) {
          setAgentName(data.agentName);
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          // silent fail - use default
        }
      }
    })();
    return () => controller.abort();
  }, []);
  const sessionsRef = useRef(sessions);
  
  // Update refs in effect to avoid render-time mutations
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  
  const currentSessionRef = useRef(currentSession);
  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

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

  const listAuthoritativeSessions = useCallback(async () => {
    if (connectionState !== 'connected') return sessionsRef.current;
    try {
      const [res, hiddenCronSessions] = await Promise.all([
        rpc('sessions.list', { limit: FULL_SESSIONS_LIMIT }) as Promise<SessionsListResponse>,
        fetchHiddenCronSessions(24 * 60, FULL_SESSIONS_LIMIT),
      ]);
      return mergeSessionLists(res?.sessions ?? [], hiddenCronSessions);
    } catch (err) {
      console.debug('[SessionContext] Failed to fetch authoritative session list:', err);
      return sessionsRef.current;
    }
  }, [connectionState, fetchHiddenCronSessions, mergeSessionLists, rpc]);

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
      if (isSubagentSessionKey(sessionKey) && currentSessionRef.current !== sessionKey) {
        setUnreadSessionKeys(prev => {
          if (prev.has(sessionKey)) return prev;
          const next = new Set(prev);
          next.add(sessionKey);
          return next;
        });
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
  }, []);

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
      badge = 'CHAT'; badgeCls = 'badge-chat';
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
    } else if (evt === 'exec.approval.request') {
      addAgentLogEntry('🔐', 'requesting exec approval');
    } else if (evt === 'exec.approval.resolved') {
      addAgentLogEntry('🔓', 'exec approved');
    }
  }, [addAgentLogEntry, friendlyName, shouldLogTool]);

  const refreshSessions = useCallback(async () => {
    if (connectionState !== 'connected') return;
    try {
      const [res, hiddenCronSessions] = await Promise.all([
        rpc('sessions.list', { activeMinutes: SESSIONS_ACTIVE_MINUTES, limit: SESSIONS_LIMIT }) as Promise<SessionsListResponse>,
        fetchHiddenCronSessions(SESSIONS_ACTIVE_MINUTES, SESSIONS_LIMIT),
      ]);
      const newSessions = mergeSessionLists(res?.sessions || [], hiddenCronSessions);
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
          
          // Compare relevant fields to detect changes
          const changed = (
            existing.state !== newSession.state ||
            existing.totalTokens !== newSession.totalTokens ||
            existing.contextTokens !== newSession.contextTokens ||
            existing.model !== newSession.model ||
            existing.thinking !== newSession.thinking ||
            existing.thinkingLevel !== newSession.thinkingLevel ||
            existing.label !== newSession.label ||
            existing.displayName !== newSession.displayName ||
            existing.parentId !== newSession.parentId
          );
          
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
      setCurrentSessionRaw(nextCurrentSession);
    } catch (err) {
      console.debug('[SessionContext] Failed to refresh sessions:', err);
    } finally {
      setSessionsLoading(false);
    }
  }, [connectionState, fetchHiddenCronSessions, mergeSessionLists, rpc]);

  // Update session in list from WebSocket event data
  const updateSessionFromEvent = useCallback((sessionKey: string, updates: Partial<Session>) => {
    setSessions(prev => {
      const idx = prev.findIndex(s => getSessionKey(s) === sessionKey);
      if (idx === -1) {
        // New session appeared that we don't have - schedule a refresh
        // Use setTimeout to avoid calling during render
        setTimeout(() => refreshSessions(), 100);
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
  }, [refreshSessions]);

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
      refreshSessions();
    }, 1500);
  }, [refreshSessions]);

  // Subscribe to gateway events for granular status tracking + session state sync + agent log + event log
  useEffect(() => {
    const unsub = subscribe((msg: GatewayEvent) => {
      const evt = msg.event;
      const p = (msg.payload || {}) as EventPayload;

      addEvent(msg);

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
              refreshSessions();
              scheduleDelayedRefresh();
            } else if (phase === 'error') {
              setGranularStatus(sk, { status: 'ERROR', since: Date.now() });
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
          } else if (state === 'delta') {
            setGranularStatus(sk, { status: 'STREAMING', since: Date.now() });
          } else if (state === 'final') {
            setGranularStatus(sk, { status: 'DONE', since: Date.now() });
            refreshSessions();
            // Delayed refresh to catch token counts that may not be available immediately.
            scheduleDelayedRefresh();
          } else if (state === 'error') {
            setGranularStatus(sk, { status: 'ERROR', since: Date.now() });
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

    // Cleanup: cancel all pending DONE→IDLE timeouts
    return () => {
      unsub();
      for (const key of Object.keys(doneTimeoutsRef.current)) {
        clearTimeout(doneTimeoutsRef.current[key]);
      }
      doneTimeoutsRef.current = {};
      if (delayedRefreshTimeoutRef.current) {
        clearTimeout(delayedRefreshTimeoutRef.current);
        delayedRefreshTimeoutRef.current = null;
      }
    };
  }, [subscribe, addEvent, setGranularStatus, feedAgentLog, updateSessionFromEvent, extractSessionUpdates, refreshSessions, scheduleDelayedRefresh]);

  // Poll sessions when connected (reduced to 30s - WebSocket events provide real-time updates)
  useEffect(() => {
    if (connectionState !== 'connected') return;
    refreshSessions();
    // Polling is now just a fallback for catching missed updates
    const iv = setInterval(() => refreshSessions(), 30000);
    return () => clearInterval(iv);
  }, [connectionState, refreshSessions]);

  // Load agent log on mount
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/agentlog', { signal: controller.signal });
        const entries: AgentLogEntry[] = await res.json();
        setAgentLogEntries(entries.slice().reverse().slice(0, 100));
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.debug('[SessionContext] Failed to load agent log:', err.message);
        }
      }
    })();
    return () => controller.abort();
  }, []);

  const deleteSession = useCallback(async (sessionKey: string) => {
    const authoritativeSessions = await listAuthoritativeSessions();
    const descendants = findDescendantSessionKeys(sessionKey, authoritativeSessions);
    const keysToDelete = [...descendants, sessionKey];
    const shouldReplaceCurrent = keysToDelete.includes(currentSessionRef.current);
    const remaining = sessionsRef.current.filter(s => !keysToDelete.includes(getSessionKey(s)));
    const nextCurrentSession = shouldReplaceCurrent ? pickDefaultSessionKey(remaining) : currentSessionRef.current;

    for (const key of keysToDelete) {
      await rpc('sessions.delete', { key, deleteTranscript: true });
    }

    setSessions(prev => prev.filter(s => !keysToDelete.includes(getSessionKey(s))));
    setUnreadSessionKeys(prev => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      for (const key of keysToDelete) next.delete(key);
      return next;
    });
    if (shouldReplaceCurrent) {
      if (nextCurrentSession) {
        setCurrentSession(nextCurrentSession);
      } else {
        setCurrentSessionRaw('');
      }
    }
  }, [findDescendantSessionKeys, listAuthoritativeSessions, rpc, setCurrentSession]);

  const spawnSession = useCallback(async (opts: SpawnSessionOpts) => {
    const authoritativeSessions = await listAuthoritativeSessions();
    const before = new Set(authoritativeSessions.map(getSessionKey));

    if (opts.kind === 'root') {
      const rootName = opts.agentName?.trim();
      if (!rootName) throw new Error('Agent name is required');

      const sessionKey = buildAgentRootSessionKey(
        rootName,
        authoritativeSessions.map(getSessionKey),
      );
      const thinkingLevel = opts.thinking && opts.thinking !== 'off' ? opts.thinking : null;

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
    const lines = ['[spawn-subagent]'];
    lines.push(`task: ${opts.task}`);
    if (opts.label) lines.push(`label: ${opts.label}`);
    if (opts.model) lines.push(`model: ${opts.model}`);
    if (opts.thinking && opts.thinking !== 'off') lines.push(`thinking: ${opts.thinking}`);
    const idempotencyKey = `spawn-subagent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await rpc('chat.send', { sessionKey: parentSessionKey, message: lines.join('\n'), idempotencyKey });

    // A spawned child can take a while to appear in sessions.list for non-main
    // roots, even after the parent agent accepts the request.
    const deadline = Date.now() + SUBAGENT_DISCOVERY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const res = await rpc('sessions.list', { activeMinutes: SESSIONS_ACTIVE_MINUTES, limit: SESSIONS_LIMIT }) as SessionsListResponse;
        const fresh = res?.sessions ?? [];
        const newSession = fresh.find((session) => {
          const sessionKey = getSessionKey(session);
          return isSubagentSessionKey(sessionKey) && isRootChildSession(sessionKey, parentSessionKey) && !before.has(sessionKey);
        });
        if (newSession) {
          await refreshSessions();
          setCurrentSession(getSessionKey(newSession));
          return;
        }
      } catch { /* keep polling */ }
      await new Promise(r => setTimeout(r, SUBAGENT_DISCOVERY_POLL_MS));
    }
    await refreshSessions();
    throw new Error('Timed out waiting for the new subagent session to appear');
  }, [listAuthoritativeSessions, rpc, refreshSessions, setCurrentSession]);

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
    sessions,
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
    spawnSession,
    renameSession,
    updateSession: updateSessionFromEvent,
    agentLogEntries,
    eventEntries,
    agentName,
  }), [
    sessions, sessionsLoading, currentSession, setCurrentSession, busyState, agentStatus,
    unreadSessions, markSessionRead,
    abortSession, refreshSessions, deleteSession, spawnSession, renameSession,
    updateSessionFromEvent, agentLogEntries, eventEntries, agentName,
  ]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionContext() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSessionContext must be used within SessionProvider');
  return ctx;
}
