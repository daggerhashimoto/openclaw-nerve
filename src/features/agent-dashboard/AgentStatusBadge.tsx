/**
 * Agent Status Badge Component
 *
 * Displays a colored badge indicating agent connection status.
 */

import React from 'react';
import type { AgentConnectionStatus } from '../../types/agent';
import { CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';

interface AgentStatusBadgeProps {
  status: AgentConnectionStatus;
}

const statusConfig: Record<AgentConnectionStatus, {
  label: string;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  connected: {
    label: 'Online',
    color: 'bg-green-500 text-white',
    icon: CheckCircle2,
  },
  disconnected: {
    label: 'Offline',
    color: 'bg-red-500 text-white',
    icon: XCircle,
  },
  connecting: {
    label: 'Connecting',
    color: 'bg-yellow-500 text-white',
    icon: Loader2,
  },
  error: {
    label: 'Error',
    color: 'bg-orange-500 text-white',
    icon: AlertTriangle,
  },
  unknown: {
    label: 'Unknown',
    color: 'bg-gray-500 text-white',
    icon: AlertTriangle,
  },
};

export function AgentStatusBadge({ status }: AgentStatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.unknown;
  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.color}`}>
      <Icon className={`w-3.5 h-3.5 ${status === 'connecting' ? 'animate-spin' : ''}`} />
      {config.label}
    </div>
  );
}
