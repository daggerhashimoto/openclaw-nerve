/**
 * Agent Selector Component
 *
 * Dropdown selector for choosing the active agent.
 */

import { useMemo, useState } from 'react';
import { useAgentRegistry } from '@/contexts/AgentRegistryContext';
import { Brain, ChevronDown, Check } from 'lucide-react';
import type { AgentWithStatus } from '@/types/agent';

interface AgentSelectorProps {
  currentAgent?: string;
  onAgentChange: (agentName: string) => void;
  compact?: boolean;
}

export function AgentSelector({ currentAgent, onAgentChange, compact = false }: AgentSelectorProps) {
  const { agents, loading } = useAgentRegistry();
  const [open, setOpen] = useState(false);

  const selectedAgent = useMemo(() => {
    return agents.find(a => a.name === currentAgent) || agents[0];
  }, [agents, currentAgent]);

  const availableAgents = useMemo(() => {
    return agents.filter(a => a.enabled);
  }, [agents]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground">
        <Brain className="w-4 h-4 animate-pulse" />
        <span>Loading agents...</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 ${
          compact ? 'px-2 py-1' : 'px-3 py-1.5'
        } bg-secondary/50 hover:bg-secondary border border-border rounded-md text-sm transition-colors`}
      >
        <Brain className="w-4 h-4 text-primary" />
        <span className="font-medium">{selectedAgent?.name || 'Select Agent'}</span>
        <ChevronDown className="w-3 h-3 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-md shadow-lg z-50 min-w-[220px] max-h-[400px] overflow-y-auto">
          <div className="p-2 space-y-1">
            {availableAgents.map(agent => (
              <button
                key={agent.name}
                onClick={() => {
                  onAgentChange(agent.name);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between ${
                  agent.name === currentAgent
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-secondary'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Check className={`w-4 h-4 ${agent.name === currentAgent ? 'opacity-100' : 'opacity-0'}`} />
                  <div>
                    <div className="font-medium">{agent.name}</div>
                    <div className="text-xs text-muted-foreground">{agent.role}</div>
                  </div>
                </div>
                <div className={`w-2 h-2 rounded-full ${
                  agent.connectionStatus === 'connected' ? 'bg-green-500' : 'bg-gray-500'
                }`} title={agent.connectionStatus} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Agent Status Indicator
 *
 * Shows a simple status dot for an agent.
 */
export function AgentStatusIndicator({ agent }: { agent: AgentWithStatus }) {
  return (
    <div className="flex items-center gap-2" title={`${agent.name}: ${agent.connectionStatus}`}>
      <div className={`w-2 h-2 rounded-full ${
        agent.connectionStatus === 'connected' ? 'bg-green-500' :
        agent.connectionStatus === 'connecting' ? 'bg-yellow-500' :
        agent.connectionStatus === 'error' ? 'bg-red-500' :
        'bg-gray-500'
      }`} />
      <span className="text-xs text-muted-foreground">{agent.name}</span>
    </div>
  );
}
