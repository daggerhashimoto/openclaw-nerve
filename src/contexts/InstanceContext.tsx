/* eslint-disable react-refresh/only-export-components -- hooks intentionally co-located with provider */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addInstanceHeaderToFetch, routeApiPath } from '@/lib/apiRouting';

export interface DiscoveredInstance {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  createdAt: string | null;
  hasGatewayToken: boolean;
  availability?: 'ready' | 'initializing' | 'unreachable';
  gateway?: 'ok' | 'unreachable';
}

interface InstanceContextValue {
  instances: DiscoveredInstance[];
  instancesLoading: boolean;
  activeInstanceId: string | null;
  setActiveInstanceId: (id: string | null) => void;
  refreshInstances: () => Promise<void>;
  routeApiPath: (pathWithQuery: string) => string;
}

const InstanceContext = createContext<InstanceContextValue | null>(null);

export function InstanceProvider({ children }: { children: ReactNode }) {
  const [instances, setInstances] = useState<DiscoveredInstance[]>([]);
  const [instancesLoading, setInstancesLoading] = useState(true);
  const [activeInstanceId, setActiveInstanceIdState] = useState<string | null>(null);
  const activeInstanceIdRef = useRef<string | null>(null);

  const setActiveInstanceId = useCallback((id: string | null) => {
    // Keep ref in sync immediately so global fetch routing doesn't lag one switch behind.
    activeInstanceIdRef.current = id;
    setActiveInstanceIdState(id);
  }, []);

  useEffect(() => {
    activeInstanceIdRef.current = activeInstanceId;
  }, [activeInstanceId]);

  const refreshInstances = useCallback(async () => {
    try {
      const resp = await fetch('/api/instances');
      if (!resp.ok) return;
      const payload = await resp.json() as { instances?: DiscoveredInstance[] };
      const next = Array.isArray(payload.instances) ? payload.instances : [];
      setInstances(next);

      // Fall back to master if selected instance disappeared.
      if (activeInstanceIdRef.current && !next.some((instance) => instance.id === activeInstanceIdRef.current)) {
        setActiveInstanceId(null);
      }
    } catch {
      // Keep stale values; do not fail UI flows on transient discovery issues.
    } finally {
      setInstancesLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshInstances();
    const interval = window.setInterval(() => {
      void refreshInstances();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [refreshInstances]);

  useEffect(() => {
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const routed = addInstanceHeaderToFetch(
        input,
        init,
        activeInstanceIdRef.current,
        window.location.origin,
      );
      return originalFetch(routed.input, routed.init);
    }) as typeof fetch;

    return () => {
      globalThis.fetch = originalFetch;
    };
  }, []);

  const routeCurrentApiPath = useCallback((pathWithQuery: string) => {
    return routeApiPath(pathWithQuery, activeInstanceId);
  }, [activeInstanceId]);

  const value = useMemo<InstanceContextValue>(() => ({
    instances,
    instancesLoading,
    activeInstanceId,
    setActiveInstanceId,
    refreshInstances,
    routeApiPath: routeCurrentApiPath,
  }), [instances, instancesLoading, activeInstanceId, refreshInstances, routeCurrentApiPath]);

  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>;
}

export function useInstances() {
  const ctx = useContext(InstanceContext);
  if (!ctx) throw new Error('useInstances must be used within InstanceProvider');
  return ctx;
}

export function useInstancesOptional() {
  return useContext(InstanceContext);
}
