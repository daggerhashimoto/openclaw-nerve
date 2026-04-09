import { useEffect, useState } from 'react';
import type { BeadDetail } from './types';
import type { BeadLinkTarget } from './links';

interface UseBeadDetailState {
  bead: BeadDetail | null;
  loading: boolean;
  error: string | null;
}

export function useBeadDetail(target: BeadLinkTarget): UseBeadDetailState {
  const [state, setState] = useState<UseBeadDetailState>({ bead: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ bead: null, loading: true, error: null });

    const params = new URLSearchParams();
    if (target.explicitTargetPath) {
      params.set('targetPath', target.explicitTargetPath);
    }
    if (target.currentDocumentPath) {
      params.set('currentDocumentPath', target.currentDocumentPath);
    }
    if (target.workspaceAgentId) {
      params.set('workspaceAgentId', target.workspaceAgentId);
    }

    const suffix = params.toString() ? `?${params.toString()}` : '';

    void fetch(`/api/beads/${encodeURIComponent(target.beadId)}${suffix}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null) as {
          ok?: boolean;
          bead?: BeadDetail;
          details?: string;
          error?: string;
        } | null;

        if (cancelled) return;

        if (!res.ok || !data?.ok || !data.bead) {
          setState({
            bead: null,
            loading: false,
            error: data?.details || data?.error || 'Failed to load bead',
          });
          return;
        }

        setState({ bead: data.bead, loading: false, error: null });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ bead: null, loading: false, error: 'Network error' });
      });

    return () => {
      cancelled = true;
    };
  }, [target.beadId, target.currentDocumentPath, target.explicitTargetPath, target.workspaceAgentId]);

  return state;
}
