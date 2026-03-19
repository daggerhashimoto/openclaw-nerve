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

/** Hook to read and write a single file in the agent workspace via the gateway API. */
export function useWorkspaceFile(agentId: string) {
  const [state, setState] = useState<WorkspaceFileState>({
    content: null,
    isLoading: false,
    error: null,
    exists: false,
  });
  const abortRef = useRef<AbortController>(undefined);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const load = useCallback(async (key: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params = new URLSearchParams({ agentId });

    setState(s => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await fetch(`/api/workspace/${key}?${params.toString()}`, { signal: controller.signal });
      if (res.status === 404) {
        setState({ content: null, isLoading: false, error: null, exists: false });
        return;
      }
      const data = await res.json() as { ok: boolean; content?: string; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to load');
      setState({ content: data.content ?? '', isLoading: false, error: null, exists: true });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setState(s => ({ ...s, isLoading: false, error: (err as Error).message }));
    }
  }, [agentId]);

  const save = useCallback(async (key: string, content: string): Promise<boolean> => {
    setState(s => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await fetch(`/api/workspace/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, agentId }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to save');
      setState({ content, isLoading: false, error: null, exists: true });
      return true;
    } catch (err) {
      setState(s => ({ ...s, isLoading: false, error: (err as Error).message }));
      return false;
    }
  }, [agentId]);

  return { ...state, load, save };
}
