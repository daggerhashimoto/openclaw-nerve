/**
 * Agent Registry Context
 *
 * Provides global state for the 16-agent system.
 * Loads agent registry on mount, polls agent status, and exposes agent list to all components.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { Agent, AgentHealth, AgentConnectionStatus, AgentWithStatus, AgentDepartment } from '../types/agent';

interface AgentRegistryContextValue {
  /** All registered agents */
  agents: AgentWithStatus[];
  /** Agents grouped by department */
  departments: Record<AgentDepartment, AgentWithStatus[]>;
  /** Get agent by name */
  getAgent: (name: string) => AgentWithStatus | undefined;
  /** Get agents by department */
  getAgentsByDepartment: (department: AgentDepartment) => AgentWithStatus[];
  /** Get available (connected) agents */
  availableAgents: AgentWithStatus[];
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: string | null;
  /** Refresh agent list */
  refresh: () => Promise<void>;
  /** Initialize default agents */
  initializeDefaults: () => Promise<{ ok: boolean; error?: string }>;
  /** Command an agent */
  commandAgent: (name: string, task: string, priority?: 'low' | 'normal' | 'high' | 'critical') => Promise<{ ok: boolean; sessionKey?: string; error?: string }>;
}

const AgentRegistryContext = createContext<AgentRegistryContextValue | null>(null);

const DEPARTMENTS: AgentDepartment[] = ['Executive', 'Research', 'Development', 'Content', 'Sales'];

export function AgentRegistryProvider({ children }: { children: React.ReactNode }) {
  const [agents, setAgents] = useState<AgentWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Fetch all agents from API */
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/agents');
      const data = await response.json();

      if (data.ok) {
        // Fetch health status for all agents
        const healthResponse = await fetch('/api/agents/health');
        const healthData = await healthResponse.json();

        const healthMap = new Map<string, AgentHealth>();
        if (healthData.ok && healthData.health) {
          for (const h of healthData.health as AgentHealth[]) {
            healthMap.set(h.name, h);
          }
        }

        // Combine agent data with health status
        const agentsWithStatus: AgentWithStatus[] = (data.agents as Agent[]).map(agent => ({
          ...agent,
          connectionStatus: mapHealthToConnectionStatus(healthMap.get(agent.name)),
          health: healthMap.get(agent.name),
        }));

        setAgents(agentsWithStatus);
        setError(null);
      } else {
        setError(data.error || 'Failed to load agents');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Initial load */
  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Poll agent status every 30 seconds */
  useEffect(() => {
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  /** Get agent by name */
  const getAgent = useCallback((name: string): AgentWithStatus | undefined => {
    return agents.find(a => a.name.toLowerCase() === name.toLowerCase());
  }, [agents]);

  /** Get agents by department */
  const getAgentsByDepartment = useCallback((department: AgentDepartment): AgentWithStatus[] => {
    return agents.filter(a => a.department === department);
  }, [agents]);

  /** Group agents by department */
  const departments = useMemo(() => {
    const result: Record<AgentDepartment, AgentWithStatus[]> = {} as Record<AgentDepartment, AgentWithStatus[]>;
    for (const dept of DEPARTMENTS) {
      result[dept] = agents.filter(a => a.department === dept);
    }
    return result;
  }, [agents]);

  /** Get available (connected) agents */
  const availableAgents = useMemo(() => {
    return agents.filter(a => a.connectionStatus === 'connected' || a.connectionStatus === 'connecting');
  }, [agents]);

  /** Initialize default agents */
  const initializeDefaults = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const response = await fetch('/api/agents/initialize', { method: 'POST' });
      const data = await response.json();
      if (data.ok) {
        await refresh();
        return { ok: true };
      } else {
        return { ok: false, error: data.error };
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }, [refresh]);

  /** Command an agent */
  const commandAgent = useCallback(async (
    name: string,
    task: string,
    priority: 'low' | 'normal' | 'high' | 'critical' = 'normal',
  ) => {
    try {
      const response = await fetch(`/api/agents/${name}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, priority }),
      });
      const data = await response.json();
      if (data.ok) {
        return { ok: true as const, sessionKey: data.sessionKey };
      } else {
        return { ok: false as const, error: data.error };
      }
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  }, []);

  const value: AgentRegistryContextValue = {
    agents,
    departments,
    getAgent,
    getAgentsByDepartment,
    availableAgents,
    loading,
    error,
    refresh,
    initializeDefaults,
    commandAgent,
  };

  return (
    <AgentRegistryContext.Provider value={value}>
      {children}
    </AgentRegistryContext.Provider>
  );
}

/** Hook to use agent registry context */
export function useAgentRegistry(): AgentRegistryContextValue {
  const context = useContext(AgentRegistryContext);
  if (!context) {
    throw new Error('useAgentRegistry must be used within AgentRegistryProvider');
  }
  return context;
}

/** Helper: Map health status to connection status */
function mapHealthToConnectionStatus(health?: AgentHealth): AgentConnectionStatus {
  if (!health) return 'unknown';
  if (health.gatewayReachable && health.status !== 'offline') return 'connected';
  if (health.status === 'offline') return 'disconnected';
  if (health.error) return 'error';
  return 'connecting';
}
