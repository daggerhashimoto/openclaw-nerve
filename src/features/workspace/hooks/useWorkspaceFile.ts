/**
 * useWorkspaceFile — Read/write a single workspace file by key.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

interface WorkspaceFileState {
  content: string | null;
  isLoading: boolean;
  error: string | null;
  exists: boolean;
}

export type WorkspaceFileSaveResult = 'saved' | 'stale' | 'error';

const INITIAL_STATE: WorkspaceFileState = {
  content: null,
  isLoading: false,
  error: null,
  exists: false,
};

/** Hook to read and write a single file in the agent workspace via the gateway API. */
export function useWorkspaceFile(agentId: string) {
  const [state, setState] = useState<WorkspaceFileState>(INITIAL_STATE);
  const abortRef = useRef<AbortController>(undefined);
  const requestVersionRef = useRef(0);
  const agentIdRef = useRef(agentId);

  useEffect(() => {
    agentIdRef.current = agentId;
    requestVersionRef.current += 1;
    abortRef.current?.abort();
    setState(INITIAL_STATE);

    return () => abortRef.current?.abort();
  }, [agentId]);

  const load = useCallback(async (key: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const requestAgentId = agentId;
    const requestVersion = ++requestVersionRef.current;
    const params = new URLSearchParams({ agentId: requestAgentId });

    setState(s => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await fetch(`/api/workspace/${key}?${params.toString()}`, { signal: controller.signal });
      if (controller.signal.aborted || requestVersionRef.current !== requestVersion || agentIdRef.current !== requestAgentId) {
        return;
      }

      if (res.status === 404) {
        setState({ content: null, isLoading: false, error: null, exists: false });
        return;
      }

      const data = await res.json() as { ok: boolean; content?: string; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to load');

      if (requestVersionRef.current !== requestVersion || agentIdRef.current !== requestAgentId) {
        return;
      }

      setState({ content: data.content ?? '', isLoading: false, error: null, exists: true });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      if (requestVersionRef.current !== requestVersion || agentIdRef.current !== requestAgentId) {
        return;
      }
      setState(s => ({ ...s, isLoading: false, error: (err as Error).message }));
    }
  }, [agentId]);

  const save = useCallback(async (key: string, content: string): Promise<WorkspaceFileSaveResult> => {
    const requestAgentId = agentId;
    const requestVersion = ++requestVersionRef.current;

    setState(s => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await fetch(`/api/workspace/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, agentId: requestAgentId }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to save');

      if (requestVersionRef.current !== requestVersion || agentIdRef.current !== requestAgentId) {
        return 'stale';
      }

      setState({ content, isLoading: false, error: null, exists: true });
      return 'saved';
    } catch (err) {
      if (requestVersionRef.current !== requestVersion || agentIdRef.current !== requestAgentId) {
        return 'stale';
      }
      setState(s => ({ ...s, isLoading: false, error: (err as Error).message }));
      return 'error';
    }
  }, [agentId]);

  return { ...state, load, save };
}
