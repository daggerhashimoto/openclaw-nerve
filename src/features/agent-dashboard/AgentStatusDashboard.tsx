/**
 * Agent Status Dashboard
 *
 * Displays all 15 agents in a grid view with status indicators,
 * current tasks, cost information, and cost breakdown charts.
 */

import React, { useMemo, useState } from 'react';
import { useAgentRegistry } from '../../contexts/AgentRegistryContext';
import { AgentCard } from './AgentCard';
import { AgentCostChart } from './AgentCostChart';
import { AgentDetailsPanel } from './AgentDetailsPanel';
import { DepartmentFilter } from './DepartmentFilter';
import { CommandPanel } from '../orchestrator/CommandPanel';
import type { AgentDepartment, AgentWithStatus } from '../../types/agent';
import { BarChart3, Activity, DollarSign, Send } from 'lucide-react';

type ViewTab = 'agents' | 'costs' | 'command';

interface AgentStatusDashboardProps {
  /** Compact mode for smaller display */
  compact?: boolean;
}

export function AgentStatusDashboard({ compact = false }: AgentStatusDashboardProps) {
  const { agents, departments, loading, error, refresh, initializeDefaults } = useAgentRegistry();
  const [selectedDepartment, setSelectedDepartment] = useState<AgentDepartment | 'All'>('All');
  const [activeTab, setActiveTab] = useState<ViewTab>('agents');
  const [selectedAgent, setSelectedAgent] = useState<AgentWithStatus | null>(null);
  const [initializing, setInitializing] = useState(false);

  const filteredAgents = useMemo(() => {
    if (selectedDepartment === 'All') return agents;
    return agents.filter(a => a.department === selectedDepartment);
  }, [agents, selectedDepartment]);

  const stats = useMemo(() => {
    const total = agents.length;
    const connected = agents.filter(a => a.connectionStatus === 'connected').length;
    const busy = agents.filter(a => a.health?.status === 'busy').length;
    const offline = agents.filter(a => a.connectionStatus === 'disconnected').length;
    const totalCost = agents.reduce((sum, a) => sum + (a.costInput || 0) + (a.costOutput || 0), 0);

    return { total, connected, busy, offline, totalCost };
  }, [agents]);

  const handleInitialize = async () => {
    setInitializing(true);
    try {
      await initializeDefaults();
    } finally {
      setInitializing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground">Loading agents...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-4">
        <div className="text-destructive">Failed to load agents</div>
        <div className="text-sm text-muted-foreground">{error}</div>
        <button
          onClick={refresh}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty state - no agents configured
  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-4">
        <div className="text-muted-foreground">No agents configured</div>
        <button
          onClick={handleInitialize}
          disabled={initializing}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {initializing ? 'Initializing...' : 'Initialize Default Agents'}
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      {/* Header with stats */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Agent Status</h2>
          <p className="text-sm text-muted-foreground">
            {stats.connected}/{stats.total} agents online
            {stats.busy > 0 && ` • ${stats.busy} busy`}
            {stats.offline > 0 && ` • ${stats.offline} offline`}
          </p>
        </div>

        <DepartmentFilter
          selected={selectedDepartment}
          onSelect={setSelectedDepartment}
          departments={departments}
        />
      </div>

      {/* Tab navigation */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setActiveTab('agents')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'agents'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Activity className="w-4 h-4" />
          Agents
        </button>
        <button
          onClick={() => setActiveTab('costs')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'costs'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <DollarSign className="w-4 h-4" />
          Costs
        </button>
        <button
          onClick={() => setActiveTab('command')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'command'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Send className="w-4 h-4" />
          Command
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'agents' && (
        <>
          {filteredAgents.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              No agents found for selected department
            </div>
          ) : (
            <div className={`grid gap-4 ${compact ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
              {filteredAgents.map(agent => (
                <div key={agent.name} onClick={() => setSelectedAgent(agent)} className="cursor-pointer">
                  <AgentCard agent={agent} compact={compact} />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'costs' && (
        <div className="space-y-6">
          <AgentCostChart compact={compact} />
          
          {/* Cost summary by department */}
          <div className="border rounded-lg p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Cost by Department
            </h3>
            <div className="space-y-3">
              {Object.entries(departments).map(([dept, deptAgents]) => {
                const deptCost = deptAgents.reduce((sum, a) => sum + (a.costInput || 0) + (a.costOutput || 0), 0);
                const percentage = stats.totalCost > 0 ? (deptCost / stats.totalCost) * 100 : 0;
                return (
                  <div key={dept} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>{dept}</span>
                      <span className="text-muted-foreground">
                        ${deptCost.toFixed(2)}/M tokens • {deptAgents.length} agents
                      </span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary/70 transition-all duration-300"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'command' && (
        <CommandPanel 
          selectedAgent={selectedAgent || undefined}
          onCommandSent={(result) => {
            if (result.ok) {
              setActiveTab('agents');
            }
          }}
        />
      )}

      {/* Agent details modal */}
      {selectedAgent && (
        <AgentDetailsPanel
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}
