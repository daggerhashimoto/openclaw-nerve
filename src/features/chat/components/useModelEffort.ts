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

const INHERITED_MODEL_VALUE = 'primary';
const INHERITED_EFFORT_VALUE = 'thinkingDefault';

type EffortLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'adaptive';
type EffortSelection = typeof INHERITED_EFFORT_VALUE | EffortLevel;
const EFFORT_OPTIONS: EffortLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive'];

function normalizeEffortLevel(raw: string | null | undefined): EffortLevel | null {
  const normalized = raw?.toLowerCase();
  return normalized && EFFORT_OPTIONS.includes(normalized as EffortLevel)
    ? normalized as EffortLevel
    : null;
}
export type GatewayModelInfo = {
  id: string;
  label: string;
  provider: string;
  role?: 'primary' | 'fallback' | 'allowed';
};

type GatewayModelsResponse = {
  models: GatewayModelInfo[];
  error: string | null;
};

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

function modelRefsMatch(a: string | null | undefined, b: string | null | undefined, options: GatewayModelInfo[]): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const resolvedA = resolveModelId(a, options);
  const resolvedB = resolveModelId(b, options);
  if (resolvedA === resolvedB) return true;
  return baseModelName(resolvedA) === baseModelName(resolvedB);
}

export function buildSelectableModelList(
  gatewayModels: GatewayModelInfo[] | null,
  currentModel: string | null | undefined,
): GatewayModelInfo[] {
  const list = [...(gatewayModels || [])];

  if (currentModel && currentModel !== '--' && !list.some((m) => m.id === currentModel || m.label === currentModel)) {
    const base = baseModelName(currentModel);
    const hasSameBase = list.some((m) => baseModelName(m.id) === base);
    if (!hasSameBase) {
      list.push({
        id: currentModel,
        label: baseModelName(currentModel),
        provider: currentModel.includes('/') ? currentModel.split('/', 1)[0] : 'unknown',
      });
    }
  }

  const byId = new Map<string, GatewayModelInfo>();
  for (const m of list) byId.set(m.id, m);
  return Array.from(byId.values());
}

export function buildModelCatalogUiError(models: GatewayModelInfo[] | null, error: string | null | undefined): string | null {
  if ((models?.length || 0) > 0) return null;
  return error || null;
}

async function fetchGatewayModels(): Promise<GatewayModelsResponse | null> {
  try {
    const res = await fetch('/api/gateway/models');
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: GatewayModelInfo[]; error?: string | null };
    return {
      models: Array.isArray(data.models) ? data.models : [],
      error: typeof data.error === 'string' ? data.error : null,
    };
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
  selectedEffortLabel: string;
  handleModelChange: (next: string) => Promise<void>;
  handleEffortChange: (next: string) => Promise<void>;
  controlsDisabled: boolean;
  uiError: string | null;
}

/** Hook to manage the model reasoning effort level selection. */
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

  const [selectedModel, setSelectedModel] = useState<string>(model || '--');
  const [prevModelSource, setPrevModelSource] = useState<string | null>(null);

  // Cache of actual models per session (fetched from transcript/cron payload).
  // Keyed by session key → resolved model ID. Survives session switches so
  // we don't re-fetch when switching back to a previously visited session.
  const [resolvedSessionModels, setResolvedSessionModels] = useState<Record<string, string>>({});
  const [resolvedSessionThinking, setResolvedSessionThinking] = useState<Record<string, EffortLevel>>({});

  const rawCurrentSessionModel = useMemo(() => {
    const cached = resolvedSessionModels[currentSession];
    if (cached) return cached;

    const s = sessions.find(sess => getSessionKey(sess) === currentSession);
    return s?.model || null;
  }, [sessions, currentSession, resolvedSessionModels]);

  const modelOptionsList = useMemo(
    () => buildSelectableModelList(gatewayModels, rawCurrentSessionModel || model),
    [gatewayModels, rawCurrentSessionModel, model],
  );
  const primaryModelId = useMemo(
    () => gatewayModels?.find((entry) => entry.role === 'primary')?.id || null,
    [gatewayModels],
  );
  const [selectedEffort, setSelectedEffort] = useState<EffortSelection>(() => {
    try {
      const saved = localStorage.getItem(getEffortKey(currentSession)) as EffortSelection | null;
      return saved && (saved === INHERITED_EFFORT_VALUE || EFFORT_OPTIONS.includes(saved as EffortLevel))
        ? saved
        : INHERITED_EFFORT_VALUE;
    } catch {
      return INHERITED_EFFORT_VALUE;
    }
  });
  const [prevEffortSource, setPrevEffortSource] = useState<string | null>(null);

  // Resolve current session's model.
  // Priority: resolved cache (from transcript/cron) → session.model from gateway
  const currentSessionModel = useMemo(() => {
    const sessionRecord = sessions.find(sess => getSessionKey(sess) === currentSession);

    // Check cached resolved model first (accurate for cron/subagent sessions)
    const raw = resolvedSessionModels[currentSession] || sessionRecord?.model;
    if (!raw) return null;

    if (modelRefsMatch(raw, primaryModelId, modelOptionsList)) {
      return INHERITED_MODEL_VALUE;
    }

    return resolveModelId(raw, modelOptionsList);
  }, [sessions, currentSession, modelOptionsList, resolvedSessionModels, primaryModelId]);

  // Resolve current session's thinking level.
  // Prefer explicit overrides. If no explicit override exists, surface
  // the inherited default selector state (thinkingDefault).
  const currentSessionThinking = useMemo(() => {
    const s = sessions.find(sess => getSessionKey(sess) === currentSession);

    const explicit = normalizeEffortLevel(s?.thinkingLevel);
    if (explicit) {
      return explicit;
    }

    const effective = normalizeEffortLevel(s?.thinking);
    const inheritedDefault = normalizeEffortLevel(thinking);
    if (effective && inheritedDefault && effective !== inheritedDefault) {
      return effective;
    }

    return null;
  }, [sessions, currentSession, thinking]);

  const inheritedEffortLabel = useMemo<EffortSelection>(() => {
    const s = sessions.find(sess => getSessionKey(sess) === currentSession);
    return resolvedSessionThinking[currentSession]
      || normalizeEffortLevel(s?.thinking)
      || normalizeEffortLevel(thinking)
      || INHERITED_EFFORT_VALUE;
  }, [sessions, currentSession, thinking, resolvedSessionThinking]);

  const selectedEffortLabel = selectedEffort === INHERITED_EFFORT_VALUE
    ? inheritedEffortLabel
    : selectedEffort;

  // Sync model dropdown when switching sessions (setState-during-render pattern)
  //
  // Resolve the gateway-reported model to a canonical ID from our options list.
  // Handles bare model names, full provider/model refs, and cross-provider
  // mismatches (e.g. gateway says "openai-codex/gpt-5.2" but only "openai/gpt-5.2"
  // is available).
  const rawModelSource = currentSessionModel || model || '--';
  let modelSource = rawModelSource;

  if (modelSource !== '--' && modelRefsMatch(modelSource, primaryModelId, modelOptionsList)) {
    modelSource = INHERITED_MODEL_VALUE;
  } else if (modelSource !== '--' && modelSource !== INHERITED_MODEL_VALUE && !modelOptionsList.some(m => m.id === modelSource)) {
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
  const effortSource = `${currentSession}:${currentSessionThinking ?? INHERITED_EFFORT_VALUE}`;
  if (effortSource !== prevEffortSource) {
    setPrevEffortSource(effortSource);
    // Fix 1: Respect optimistic lock for effort changes too
    if (Date.now() <= effortLockUntilRef.current) {
      // Skip — we're in the grace period after a manual effort change
    } else {
      const nextEffortSelection = currentSessionThinking || INHERITED_EFFORT_VALUE;
      setSelectedEffort(nextEffortSelection);
      try { localStorage.setItem(getEffortKey(currentSession), nextEffortSelection); } catch { /* ignore */ }
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
      .then((result) => {
        if (!result) {
          setGatewayModels([]);
          setUiError('Could not load configured models');
          return;
        }
        setGatewayModels(result.models);
        setUiError(buildModelCatalogUiError(result.models, result.error));
      })
      .catch((err) => {
        console.warn('[useModelEffort] Failed to fetch gateway models:', err);
        setGatewayModels([]);
        setUiError('Could not load configured models');
      });
  }, []);

  // Fetch per-session info when session changes
  useEffect(() => {
    const signal = { cancelled: false };
    (async () => {
      if (signal.cancelled || !currentSession) return;

      let resolvedModel: string | null = null;
      let resolvedThinking: EffortLevel | null = null;

      try {
        const info = await fetchGatewaySessionInfo(currentSession);
        if (signal.cancelled) return;
        resolvedThinking = normalizeEffortLevel(info?.thinking);
      } catch (err) {
        console.warn('[useModelEffort] Failed to fetch gateway session info:', err);
      }

      try {
        const res = await fetch(`/api/sessions/runtime?sessionKey=${encodeURIComponent(currentSession)}`);
        if (signal.cancelled) return;
        const data = await res.json() as { ok: boolean; model?: string | null; thinking?: string | null; missing?: boolean };
        if (data.ok) {
          if (data.model != null) resolvedModel = data.model;
          if (!resolvedThinking) resolvedThinking = normalizeEffortLevel(data.thinking);
        }
      } catch { /* ignore */ }

      if (resolvedThinking && !signal.cancelled) {
        setResolvedSessionThinking(prev => prev[currentSession] === resolvedThinking
          ? prev
          : { ...prev, [currentSession]: resolvedThinking });
      }

      // For child sessions, resolve the actual model from cron payload or transcript
      const sessionType = getSessionType(currentSession);
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
  }, [currentSession, modelOptionsList]);

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

    const selectingInheritedPrimary = nextInput === INHERITED_MODEL_VALUE;
    let patchModel: string | null = selectingInheritedPrimary ? null : next;

    try {
      let wsSucceeded = false;

      // Attempt 1: WS RPC (fast path)
      try {
        await rpc('sessions.patch', { key: currentSession, model: patchModel });
        wsSucceeded = true;
      } catch (patchErr) {
        // For inherited-default model selection, some gateways may reject null model.
        // In that case, fall back to explicitly setting the configured primary model ID.
        if (selectingInheritedPrimary && primaryModelId) {
          try {
            await rpc('sessions.patch', { key: currentSession, model: primaryModelId });
            patchModel = primaryModelId;
            wsSucceeded = true;
          } catch {
            // Keep failing through to HTTP fallback.
          }
        }

        // Attempt 2: Cross-provider fallback via WS
        if (!wsSucceeded && !selectingInheritedPrimary) {
          const nextBase = baseModelName(next);
          const alt = modelOptionsList.find(m => m.id !== next && baseModelName(m.id) === nextBase);
          if (alt) {
            try {
              await rpc('sessions.patch', { key: currentSession, model: alt.id });
              next = alt.id;
              patchModel = alt.id;
              setSelectedModel(next);
              try { localStorage.setItem(MODEL_KEY, next); } catch { /* ignore */ }
              wsSucceeded = true;
            } catch {
              // WS completely broken — fall through to HTTP
            }
          }
        }

        if (!wsSucceeded) {
          console.info('[useModelEffort] WS RPC failed, falling back to HTTP:', (patchErr as Error).message);
        }
      }

      // Attempt 3: HTTP fallback (reliable path via session_status tool)
      if (!wsSucceeded) {
        const fallbackModel = selectingInheritedPrimary ? (primaryModelId || model || null) : patchModel;
        if (!fallbackModel) {
          throw new Error('No primary model is available to apply inherited default model state');
        }
        const res = await fetch('/api/gateway/session-patch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionKey: currentSession, model: fallbackModel }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error || `HTTP ${res.status}`);
        }
      }

      // Optimistically update the session object so that
      // SessionContext.refreshSessions() doesn't overwrite with stale data
      if (currentSession) {
        const optimisticModel = selectingInheritedPrimary
          ? (primaryModelId || patchModel || model || undefined)
          : (patchModel || next);
        updateSession(currentSession, { model: optimisticModel });
      }

      // Schedule a confirmation poll to verify the change took effect
      confirmTimerRef.current = setTimeout(async () => {
        confirmTimerRef.current = null;
        try {
          const info = await fetchGatewaySessionInfo(currentSession || undefined);
          if (info?.model) {
            if (modelRefsMatch(info.model, primaryModelId, modelOptionsList)) {
              setSelectedModel(INHERITED_MODEL_VALUE);
            } else {
              const infoBase = baseModelName(info.model);
              const confirmed = modelOptionsList.find(m =>
                m.id === info.model || m.label === info.model ||
                baseModelName(m.id) === infoBase || m.id.endsWith('/' + info.model)
              );
              if (confirmed) {
                setSelectedModel(confirmed.id);
              }
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
  }, [controlsDisabled, selectedModel, rpc, currentSession, updateSession, modelOptionsList, primaryModelId, model]);

  const handleEffortChange = useCallback(async (next: string) => {
    if (controlsDisabled) return;
    setUiError(null);

    const prev = selectedEffort;
    const nextEffort = next as EffortSelection;
    setSelectedEffort(nextEffort);
    effortLockUntilRef.current = Date.now() + OPTIMISTIC_LOCK_MS;
    try { localStorage.setItem(getEffortKey(currentSession), nextEffort); } catch { /* ignore */ }

    try {
      const isInheritedDefault = nextEffort === INHERITED_EFFORT_VALUE;
      const thinkingValue = isInheritedDefault ? null : nextEffort;
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
        updateSession(currentSession, {
          thinkingLevel: isInheritedDefault ? undefined : nextEffort,
        });
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

  const modelOptions = useMemo(() => {
    const configured = modelOptionsList.map((m) => ({ value: m.id, label: m.label }));
    return [{ value: INHERITED_MODEL_VALUE, label: INHERITED_MODEL_VALUE }, ...configured];
  }, [modelOptionsList]);

  const effortOptions = useMemo(
    () => [
      {
        value: INHERITED_EFFORT_VALUE,
        label: inheritedEffortLabel === INHERITED_EFFORT_VALUE
          ? 'default'
          : `${inheritedEffortLabel} (default)`,
      },
      ...EFFORT_OPTIONS.map((lvl) => ({ value: lvl, label: lvl })),
    ],
    [inheritedEffortLabel],
  );

  return {
    modelOptions,
    effortOptions,
    selectedModel,
    selectedEffort,
    selectedEffortLabel,
    handleModelChange,
    handleEffortChange,
    controlsDisabled,
    uiError,
  };
}
