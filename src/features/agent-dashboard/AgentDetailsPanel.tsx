/**
 * Agent Details Panel
 *
 * Shows detailed information about a selected agent.
 */

import type { AgentWithStatus } from '../../types/agent';
import { X, DollarSign, Cpu, Calendar, Activity } from 'lucide-react';
import { AgentStatusBadge } from './AgentStatusBadge';

interface AgentDetailsPanelProps {
  agent: AgentWithStatus;
  onClose: () => void;
}

export function AgentDetailsPanel({ agent, onClose }: AgentDetailsPanelProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div 
        className="bg-background border rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-background border-b px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Activity className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{agent.name}</h2>
              <p className="text-sm text-muted-foreground">{agent.role}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-accent rounded-full"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Status */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Status</div>
              <AgentStatusBadge status={agent.connectionStatus} />
            </div>
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Department</div>
              <div className="font-medium">{agent.department}</div>
            </div>
          </div>

          {/* Model */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Cpu className="w-4 h-4" />
              <span>Model</span>
            </div>
            <div className="font-mono bg-secondary px-3 py-2 rounded-md">
              {agent.model}
            </div>
          </div>

          {/* Gateway */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="w-4 h-4" />
              <span>Gateway</span>
            </div>
            <div className="font-mono bg-secondary px-3 py-2 rounded-md text-sm">
              {agent.gatewayUrl} (Port {agent.gatewayPort})
            </div>
          </div>

          {/* Schedule */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="w-4 h-4" />
              <span>Schedule</span>
            </div>
            <div className="font-mono bg-secondary px-3 py-2 rounded-md text-sm">
              {agent.schedule}
            </div>
          </div>

          {/* Costs */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <DollarSign className="w-4 h-4" />
              <span>Pricing</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-secondary px-3 py-2 rounded-md">
                <div className="text-xs text-muted-foreground">Input</div>
                <div className="font-mono">${agent.costInput?.toFixed(2) || 'N/A'}/M tokens</div>
              </div>
              <div className="bg-secondary px-3 py-2 rounded-md">
                <div className="text-xs text-muted-foreground">Output</div>
                <div className="font-mono">${agent.costOutput?.toFixed(2) || 'N/A'}/M tokens</div>
              </div>
            </div>
          </div>

          {/* Health Status */}
          {agent.health && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Activity className="w-4 h-4" />
                <span>Health Check</span>
              </div>
              <div className="bg-secondary px-3 py-2 rounded-md space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Status:</span>
                  <span className={agent.health.status === 'offline' ? 'text-destructive' : 'text-green-600'}>
                    {agent.health.status}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Gateway:</span>
                  <span className={agent.health.gatewayReachable ? 'text-green-600' : 'text-destructive'}>
                    {agent.health.gatewayReachable ? 'Reachable' : 'Unreachable'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Last Check:</span>
                  <span className="font-mono text-xs">
                    {agent.health.lastCheck ? new Date(agent.health.lastCheck).toLocaleString() : 'Never'}
                  </span>
                </div>
                {agent.health.error && (
                  <div className="text-destructive text-sm mt-2">
                    Error: {agent.health.error}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Description */}
          {agent.description && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Activity className="w-4 h-4" />
                <span>Description</span>
              </div>
              <p className="text-sm bg-secondary px-3 py-2 rounded-md">
                {agent.description}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
