/**
 * useModelEffort — Manages model and effort (thinking level) selection state.
 *
 * Handles:
 * - Gateway model catalog fetching
 * - Per-session model/effort resolution from sessions list
 * - Optimistic updates via sessions.patch RPC
 * - localStorage caching for effort per session
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useGateway } from '@/contexts/GatewayContext';
import { useSessionContext } from '@/contexts/SessionContext';
import { getSessionKey } from '@/types';
import { getSessionType } from '@/features/sessions/sessionTree';

/**
 * Duration (ms) after an optimistic model/effort change during which we ignore
 * sync-back updates from polling.  This prevents stale poll data from reverting
 * the dropdown before the gateway has applied the sessions.patch RPC.
 */
const OPTIMISTIC_LOCK_MS = 15_000;

/**
 * Delay (ms) before we poll the gateway to confirm a model change actually
 * took effect.  Gives the gateway time to apply the sessions.patch.
 */
const CONFIRM_POLL_DELAY_MS = 3_000;

const MODEL_KEY = 'oc-statusbar-model';
function getEffortKey(sessionKey?: string | null) {
  return sessionKey ? `oc-effort-${sessionKey}` : 'oc-effort-default';
}

type EffortLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
const EFFORT_OPTIONS: EffortLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

type GatewayModelInfo = { id: string; label: string; provider: string };

/** Extract the base model name from a "provider/model" ref. */
function baseModelName(ref: string): string {
  const idx = ref.indexOf('/');
  return idx >= 0 ? ref.slice(idx + 1) : ref;
}

/** Resolve a raw model string to a canonical ID from the options list. */
function resolveModelId(raw: string, options: GatewayModelInfo[]): string {
  const exact = options.find(m => m.id === raw);
  if (exact) return exact.id;
  const byLabel = options.find(m => m.label === raw);
  if (byLabel) return byLabel.id;
  const rawBase = baseModelName(raw);
  const byBaseName = options.find(m => baseModelName(m.id) === rawBase);
  if (byBaseName) return byBaseName.id;
  const bySuffix = options.find(m => m.id.endsWith('/' + raw) || raw.endsWith('/' + m.label));
  if (bySuffix) return bySuffix.id;
  return raw;
}

const FALLBACK_MODELS: GatewayModelInfo[] = [
  { id: 'anthropic/claude-opus-4-6', label: 'claude-opus-4-6', provider: 'anthropic' },
  { id: 'anthropic/claude-sonnet-4-5', label: 'claude-sonnet-4-5', provider: 'anthropic' },
  { id: 'anthropic/claude-haiku-4-5', label: 'claude-haiku-4-5', provider: 'anthropic' },
];

async function fetchGatewayModels(): Promise<GatewayModelInfo[] | null> {
  try {
    const res = await fetch('/api/gateway/models');
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: GatewayModelInfo[] };
    return Array.isArray(data.models) ? data.models : null;
  } catch {
    return null;
  }
}

async function fetchGatewaySessionInfo(sessionKey?: string): Promise<{ model?: string; thinking?: string } | null> {
  try {
    const params = sessionKey ? `?sessionKey=${encodeURIComponent(sessionKey)}` : '';
    const res = await fetch(`/api/gateway/session-info${params}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export interface UseModelEffortReturn {
  modelOptions: { value: string; label: string }[];
  effortOptions: { value: string; label: string }[];
  selectedModel: string;
  selectedEffort: string;
  handleModelChange: (next: string) => Promise<void>;
  handleEffortChange: (next: string) => Promise<void>;
  controlsDisabled: boolean;
  uiError: string | null;
}

/** Hook to manage the model reasoning effort level (low/medium/high). */
export function useModelEffort(): UseModelEffortReturn {
  const { rpc, connectionState, model, thinking } = useGateway();
  const { currentSession, sessions, updateSession } = useSessionContext();

  const [gatewayModels, setGatewayModels] = useState<GatewayModelInfo[] | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);

  // Fix 1: Optimistic lock — timestamp until which we ignore sync-back updates
  const modelLockUntilRef = useRef<number>(0);
  const effortLockUntilRef = useRef<number>(0);
  // Track pending confirmation timers so we can clean them up
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const modelOptionsList = useMemo(() => {
    const models = (gatewayModels && gatewayModels.length > 0) ? gatewayModels : FALLBACK_MODELS;
    const list = [...models];

    // Add the gateway's reported model to the list if it isn't already present.
    // BUT: don't add it if an available model with the same base name already
    // exists under a different provider — that would create a phantom option
    // that fails when selected (e.g. "openai-codex/gpt-5.2-codex" when only
    // "openai/gpt-5.2-codex" has auth).
    if (model && model !== '--' && !list.some((m) => m.id === model || m.label === model)) {
      const base = baseModelName(model);
      const hasSameBase = list.some((m) => baseModelName(m.id) === base);
      if (!hasSameBase) {
        list.push({
          id: model,
          label: model.includes('/') ? model.split('/', 2)[1] : model,
          provider: model.includes('/') ? model.split('/', 1)[0] : 'unknown',
        });
      }
    }

    const byId = new Map<string, GatewayModelInfo>();
    for (const m of list) byId.set(m.id, m);
    return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
  }, [gatewayModels, model]);

  const [selectedModel, setSelectedModel] = useState<string>(model || '--');
  const [prevModelSource, setPrevModelSource] = useState<string | null>(null);

  // Cache of actual models per session (fetched from transcript/cron payload).
  // Keyed by session key → resolved model ID. Survives session switches so
  // we don't re-fetch when switching back to a previously visited session.
  const [resolvedSessionModels, setResolvedSessionModels] = useState<Record<string, string>>({});
  const [selectedEffort, setSelectedEffort] = useState<EffortLevel>(() => {
    try {
      const saved = localStorage.getItem(getEffortKey(currentSession)) as EffortLevel | null;
      return saved && EFFORT_OPTIONS.includes(saved) ? saved : 'low';
    } catch {
      return 'low';
    }
  });
  const [prevEffortSource, setPrevEffortSource] = useState<string | null>(null);

  // Resolve current session's model.
  // Priority: resolved cache (from transcript/cron) → session.model from gateway
  const currentSessionModel = useMemo(() => {
    // Check cached resolved model first (accurate for cron/subagent sessions)
    const cached = resolvedSessionModels[currentSession];
    if (cached) return resolveModelId(cached, modelOptionsList);

    // Fall back to session.model from sessions.list (correct for main, default for others)
    const s = sessions.find(sess => getSessionKey(sess) === currentSession);
    const raw = s?.model;
    if (!raw) return null;
    return resolveModelId(raw, modelOptionsList);
  }, [sessions, currentSession, modelOptionsList, resolvedSessionModels]);

  // Resolve current session's thinking level
  const currentSessionThinking = useMemo(() => {
    const s = sessions.find(sess => getSessionKey(sess) === currentSession);
    const raw = (s?.thinkingLevel || s?.thinking)?.toLowerCase();
    if (raw && EFFORT_OPTIONS.includes(raw as EffortLevel)) return raw as EffortLevel;
    return null;
  }, [sessions, currentSession]);

  // Sync model dropdown when switching sessions (setState-during-render pattern)
  //
  // Resolve the gateway-reported model to a canonical ID from our options list.
  // Handles bare model names, full provider/model refs, and cross-provider
  // mismatches (e.g. gateway says "openai-codex/gpt-5.2" but only "openai/gpt-5.2"
  // is available).
  const rawModelSource = currentSessionModel || model || '--';
  let modelSource = rawModelSource;
  if (modelSource !== '--' && !modelOptionsList.some(m => m.id === modelSource)) {
    const byLabel = modelOptionsList.find(m => m.label === modelSource);
    const srcBase = baseModelName(modelSource);
    const byBaseName = modelOptionsList.find(m => baseModelName(m.id) === srcBase);
    const bySuffix = modelOptionsList.find(m => m.id.endsWith('/' + modelSource));
    if (byLabel) modelSource = byLabel.id;
    else if (byBaseName) modelSource = byBaseName.id;
    else if (bySuffix) modelSource = bySuffix.id;
  }

  // Include currentSession in the source key so switching sessions always
  // triggers sync-back, even when both sessions report the same default model.
  const modelSourceKey = `${currentSession}:${modelSource}`;
  if (modelSourceKey !== prevModelSource) {
    setPrevModelSource(modelSourceKey);
    // Fix 1: Only sync from server if NOT in optimistic lock period.
    // After a manual model change we hold off on sync-back for OPTIMISTIC_LOCK_MS
    // so that stale poll data doesn't revert the dropdown.
    if (modelSource !== '--' && Date.now() > modelLockUntilRef.current) {
      setSelectedModel(modelSource);
    }
  }

  // Sync effort dropdown from gateway thinking level (setState-during-render pattern)
  const effortSource = `${currentSession}:${currentSessionThinking ?? thinking ?? ''}`;
  if (effortSource !== prevEffortSource) {
    setPrevEffortSource(effortSource);
    // Fix 1: Respect optimistic lock for effort changes too
    if (Date.now() <= effortLockUntilRef.current) {
      // Skip — we're in the grace period after a manual effort change
    } else if (currentSessionThinking) {
      setSelectedEffort(currentSessionThinking);
      try { localStorage.setItem(getEffortKey(currentSession), currentSessionThinking); } catch { /* ignore */ }
    } else if (thinking && thinking !== '--' && EFFORT_OPTIONS.includes(thinking as EffortLevel)) {
      setSelectedEffort(thinking as EffortLevel);
      try { localStorage.setItem(getEffortKey(currentSession), thinking); } catch { /* ignore */ }
    }
  }

  // Clear optimistic locks when switching sessions so a manual model change
  // on one session doesn't block sync-back on another. Uses setState-during-render
  // pattern so the lock is cleared BEFORE the sync-back check runs.
  const [prevSessionForLock, setPrevSessionForLock] = useState(currentSession);
  if (currentSession !== prevSessionForLock) {
    setPrevSessionForLock(currentSession);
    modelLockUntilRef.current = 0;
    effortLockUntilRef.current = 0;
  }

  // Cleanup confirmation timer on unmount
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }
    };
  }, []);

  // Load gateway model catalog on mount
  useEffect(() => {
    fetchGatewayModels()
      .then((models) => setGatewayModels(models && models.length > 0 ? models : []))
      .catch((err) => {
        console.warn('[useModelEffort] Failed to fetch gateway models:', err);
        setGatewayModels([]);
      });
  }, []);

  // Fetch per-session info when session changes
  useEffect(() => {
    const signal = { cancelled: false };
    (async () => {
      const sessionInfo = await fetchGatewaySessionInfo(currentSession || undefined);
      if (signal.cancelled) return;

      if (sessionInfo?.thinking && !currentSessionThinking) {
        const level = sessionInfo.thinking.toLowerCase() as EffortLevel;
        if (EFFORT_OPTIONS.includes(level)) {
          setSelectedEffort(level);
          try { localStorage.setItem(getEffortKey(currentSession), level); } catch { /* ignore */ }
        }
      }

      // For child sessions, resolve the actual model from cron payload or transcript
      if (!currentSession) return;
      const sessionType = getSessionType(currentSession);
      if (sessionType === 'main') return;

      let resolvedModel: string | null = null;

      if (sessionType === 'cron') {
        // Cron parent: look up the job's payload.model
        const jobIdMatch = currentSession.match(/:cron:([^:]+)$/);
        if (jobIdMatch) {
          try {
            const res = await fetch('/api/crons');
            if (signal.cancelled) return;
            const data = await res.json();
            if (data.ok) {
              const jobs = data.result?.jobs || data.result?.details?.jobs || [];
              const job = jobs.find((j: { id: string }) => j.id === jobIdMatch[1]);
              if (job?.payload?.model) resolvedModel = job.payload.model;
            }
          } catch { /* ignore */ }
        }
      } else {
        // Cron-run or subagent: read model from session transcript
        const parts = currentSession.split(':');
        const sessionId = parts[parts.length - 1];
        if (sessionId && /^[0-9a-f-]{36}$/.test(sessionId)) {
          try {
            const res = await fetch(`/api/sessions/${sessionId}/model`);
            if (signal.cancelled) return;
            const data = await res.json() as { ok: boolean; model?: string | null; missing?: boolean };
            if (data.ok && data.model != null) resolvedModel = data.model;
          } catch { /* ignore */ }
        }
      }

      if (resolvedModel && !signal.cancelled) {
        // Cache the resolved model — this feeds into currentSessionModel which
        // drives the render-time sync. No optimistic lock needed because the
        // cache makes currentSessionModel return the correct value directly.
        setResolvedSessionModels(prev => ({ ...prev, [currentSession]: resolvedModel }));
      }
    })().catch((err) => {
      console.warn('[useModelEffort] Failed to fetch session info:', err);
    });
    return () => { signal.cancelled = true; };
  }, [currentSession, currentSessionThinking, modelOptionsList]);

  const controlsDisabled = connectionState !== 'connected' || !currentSession;

  // Model change strategy:
  // 1. Try WS RPC sessions.patch (fast, direct)
  // 2. If WS fails, try cross-provider fallback via WS
  // 3. If all WS attempts fail, fall back to HTTP /api/gateway/session-patch
  //    (uses session_status tool — proven reliable)

  const handleModelChange = useCallback(async (nextInput: string) => {
    let next = nextInput;
    if (controlsDisabled) return;
    setUiError(null);

    const prev = selectedModel;
    setSelectedModel(next);
    // Lock sync-back so polling doesn't revert the optimistic update
    modelLockUntilRef.current = Date.now() + OPTIMISTIC_LOCK_MS;
    try { localStorage.setItem(MODEL_KEY, next); } catch { /* ignore */ }

    // Cancel any pending confirmation poll from a previous rapid change
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }

    try {
      let wsSucceeded = false;

      // Attempt 1: WS RPC (fast path)
      try {
        await rpc('sessions.patch', { key: currentSession, model: next });
        wsSucceeded = true;
      } catch (patchErr) {
        // Attempt 2: Cross-provider fallback via WS
        const nextBase = baseModelName(next);
        const alt = modelOptionsList.find(m => m.id !== next && baseModelName(m.id) === nextBase);
        if (alt) {
          try {
            await rpc('sessions.patch', { key: currentSession, model: alt.id });
            next = alt.id;
            setSelectedModel(next);
            try { localStorage.setItem(MODEL_KEY, next); } catch { /* ignore */ }
            wsSucceeded = true;
          } catch {
            // WS completely broken — fall through to HTTP
          }
        }

        if (!wsSucceeded) {
          console.info('[useModelEffort] WS RPC failed, falling back to HTTP:', (patchErr as Error).message);
        }
      }

      // Attempt 3: HTTP fallback (reliable path via session_status tool)
      if (!wsSucceeded) {
        const res = await fetch('/api/gateway/session-patch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionKey: currentSession, model: next }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error || `HTTP ${res.status}`);
        }
      }

      // Optimistically update the session object so that
      // SessionContext.refreshSessions() doesn't overwrite with stale data
      if (currentSession) {
        updateSession(currentSession, { model: next });
      }

      // Schedule a confirmation poll to verify the change took effect
      confirmTimerRef.current = setTimeout(async () => {
        confirmTimerRef.current = null;
        try {
          const info = await fetchGatewaySessionInfo(currentSession || undefined);
          if (info?.model) {
            const infoBase = baseModelName(info.model);
            const confirmed = modelOptionsList.find(m =>
              m.id === info.model || m.label === info.model ||
              baseModelName(m.id) === infoBase || m.id.endsWith('/' + info.model)
            );
            if (confirmed) {
              setSelectedModel(confirmed.id);
            }
          }
        } catch {
          // Non-critical — the optimistic value remains
        } finally {
          modelLockUntilRef.current = 0;
        }
      }, CONFIRM_POLL_DELAY_MS);
    } catch (err) {
      const errMsg = (err as Error).message || 'Unknown error';
      console.warn('[useModelEffort] All model change attempts failed:', errMsg);
      setSelectedModel(prev);
      modelLockUntilRef.current = 0;
      try { localStorage.setItem(MODEL_KEY, prev); } catch { /* ignore */ }
      setUiError(`Model: ${errMsg}`);
    }
  }, [controlsDisabled, selectedModel, rpc, currentSession, updateSession, modelOptionsList]);

  const handleEffortChange = useCallback(async (next: string) => {
    if (controlsDisabled) return;
    setUiError(null);

    const prev = selectedEffort;
    const nextEffort = next as EffortLevel;
    setSelectedEffort(nextEffort);
    effortLockUntilRef.current = Date.now() + OPTIMISTIC_LOCK_MS;
    try { localStorage.setItem(getEffortKey(currentSession), nextEffort); } catch { /* ignore */ }

    try {
      const thinkingValue = nextEffort === 'off' ? null : nextEffort;
      try {
        await rpc('sessions.patch', { key: currentSession, thinkingLevel: thinkingValue });
      } catch (wsErr) {
        // WS failed — effort doesn't have an HTTP fallback (session_status
        // doesn't support thinkingLevel), so retry WS once after a short delay
        console.info('[useModelEffort] WS effort change failed, retrying:', (wsErr as Error).message);
        await new Promise(r => setTimeout(r, 1000));
        await rpc('sessions.patch', { key: currentSession, thinkingLevel: thinkingValue });
      }
      if (currentSession) {
        updateSession(currentSession, { thinkingLevel: nextEffort });
      }
      setTimeout(() => { effortLockUntilRef.current = 0; }, CONFIRM_POLL_DELAY_MS);
    } catch (err) {
      const errMsg = (err as Error).message || 'Unknown error';
      console.warn('[useModelEffort] All effort change attempts failed:', errMsg);
      setSelectedEffort(prev);
      effortLockUntilRef.current = 0;
      try { localStorage.setItem(getEffortKey(currentSession), prev); } catch { /* ignore */ }
      setUiError(`Effort: ${errMsg}`);
    }
  }, [controlsDisabled, selectedEffort, rpc, currentSession, updateSession]);

  const modelOptions = useMemo(
    () => modelOptionsList.map((m) => ({ value: m.id, label: m.label })),
    [modelOptionsList],
  );

  const effortOptions = useMemo(
    () => EFFORT_OPTIONS.map((lvl) => ({ value: lvl, label: lvl })),
    [],
  );

  return {
    modelOptions,
    effortOptions,
    selectedModel,
    selectedEffort,
    handleModelChange,
    handleEffortChange,
    controlsDisabled,
    uiError,
  };
}
