/**
 * Agent Card Component
 *
 * Displays a single agent's status, role, and key information.
 */

import React from 'react';
import type { AgentWithStatus } from '../../types/agent';
import { AgentStatusBadge } from './AgentStatusBadge';
import { Brain, TrendingUp, Code, FileText, Target } from 'lucide-react';

interface AgentCardProps {
  agent: AgentWithStatus;
  compact?: boolean;
}

const departmentIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  Executive: Brain,
  Research: TrendingUp,
  Development: Code,
  Content: FileText,
  Sales: Target,
};

export function AgentCard({ agent, compact = false }: AgentCardProps) {
  const Icon = departmentIcons[agent.department] || Brain;

  return (
    <div className={`border rounded-lg p-4 bg-card hover:bg-accent/50 transition-colors ${agent.connectionStatus !== 'connected' ? 'opacity-60' : ''}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-muted-foreground" />
          <div>
            <h3 className="font-semibold text-lg">{agent.name}</h3>
            <p className="text-xs text-muted-foreground">{agent.role}</p>
          </div>
        </div>
        <AgentStatusBadge status={agent.connectionStatus} />
      </div>

      {/* Department badge */}
      <div className="mb-3">
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
          {agent.department}
        </span>
      </div>

      {/* Model */}
      {!compact && (
        <div className="mb-3 text-sm">
          <span className="text-muted-foreground">Model: </span>
          <span className="font-mono">{agent.model}</span>
        </div>
      )}

      {/* Health status */}
      {!compact && agent.health && (
        <div className="mb-3 text-sm">
          <span className="text-muted-foreground">Status: </span>
          <span className={agent.health.status === 'offline' ? 'text-destructive' : 'text-green-600'}>
            {agent.health.status}
          </span>
          {agent.health.error && (
            <p className="text-xs text-destructive mt-1">{agent.health.error}</p>
          )}
        </div>
      )}

      {/* Schedule */}
      {!compact && (
        <div className="mb-3 text-sm">
          <span className="text-muted-foreground">Schedule: </span>
          <span className="font-mono text-xs">{agent.schedule}</span>
        </div>
      )}

      {/* Cost info */}
      {!compact && (agent.costInput || agent.costOutput) && (
        <div className="pt-3 border-t text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Input:</span>
            <span className="font-mono">${agent.costInput?.toFixed(2) || 'N/A'}/M</span>
          </div>
          <div className="flex justify-between">
            <span>Output:</span>
            <span className="font-mono">${agent.costOutput?.toFixed(2) || 'N/A'}/M</span>
          </div>
        </div>
      )}

      {/* Description */}
      {!compact && agent.description && (
        <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
          {agent.description}
        </p>
      )}
    </div>
  );
}
