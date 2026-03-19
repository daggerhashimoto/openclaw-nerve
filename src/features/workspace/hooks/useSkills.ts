/**
 * useSkills — Fetch skills list from the server.
 */

import { useState, useCallback, useEffect, useRef } from 'react';

export interface SkillMissing {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
  os?: string[];
}

export interface Skill {
  name: string;
  description: string;
  emoji: string;
  eligible: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  source: string;
  bundled: boolean;
  homepage?: string;
  missing?: SkillMissing;
}

/** Hook to fetch installed skills and their missing-dependency status from the gateway. */
export function useSkills(agentId: string = 'main') {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController>(undefined);
  const requestVersionRef = useRef(0);
  const agentIdRef = useRef(agentId);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const requestAgentId = agentId;
    const requestVersion = ++requestVersionRef.current;
    const params = new URLSearchParams({ agentId: requestAgentId });

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/skills?${params.toString()}`, { signal: controller.signal });
      if (controller.signal.aborted || requestVersionRef.current !== requestVersion || agentIdRef.current !== requestAgentId) {
        return;
      }

      const data = (await res.json()) as { ok: boolean; skills?: Skill[]; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to fetch skills');

      if (requestVersionRef.current !== requestVersion || agentIdRef.current !== requestAgentId) {
        return;
      }

      setSkills(data.skills || []);
      setIsLoading(false);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return;
      }
      if (requestVersionRef.current !== requestVersion || agentIdRef.current !== requestAgentId) {
        return;
      }
      setError((err as Error).message);
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    agentIdRef.current = agentId;
    requestVersionRef.current += 1;
    abortRef.current?.abort();
    setSkills([]);
    setIsLoading(false);
    setError(null);
    void refresh();

    return () => abortRef.current?.abort();
  }, [agentId, refresh]);

  return { skills, isLoading, error, refresh };
}
