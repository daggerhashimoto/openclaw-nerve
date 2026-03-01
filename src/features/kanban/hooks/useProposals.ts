import { useState, useEffect, useCallback, useRef } from 'react';

/* ── Proposal types (frontend-only, mirrors backend KanbanProposal) ── */

export interface KanbanProposal {
  id: string;
  type: 'create' | 'update';
  payload: Record<string, unknown>;
  sourceSessionKey?: string;
  proposedBy: string;
  proposedAt: number;
  status: 'pending' | 'approved' | 'rejected';
  version: number;
  resolvedAt?: number;
  resolvedBy?: string;
  reason?: string;
  resultTaskId?: string;
}

interface ProposalsResponse {
  proposals: KanbanProposal[];
}

export function useProposals() {
  const [proposals, setProposals] = useState<KanbanProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const fetchProposals = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/kanban/proposals?status=pending', { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ProposalsResponse = await res.json();
      setProposals(data.proposals);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // Silent errors on polls
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  /* Initial fetch + poll every 5s */
  useEffect(() => {
    fetchProposals();
    const id = setInterval(() => fetchProposals({ silent: true }), 5_000);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [fetchProposals]);

  const pendingCount = proposals.length;

  const approveProposal = useCallback(async (id: string) => {
    const res = await fetch(`/api/kanban/proposals/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.details || body.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    // Remove from local state immediately
    setProposals((prev) => prev.filter((p) => p.id !== id));
    return data;
  }, []);

  const rejectProposal = useCallback(async (id: string, reason?: string) => {
    const res = await fetch(`/api/kanban/proposals/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.details || body.error || `HTTP ${res.status}`);
    }
    // Remove from local state immediately
    setProposals((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return {
    proposals,
    pendingCount,
    loading,
    approveProposal,
    rejectProposal,
    refetch: fetchProposals,
  };
}
