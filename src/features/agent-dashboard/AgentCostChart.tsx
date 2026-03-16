/**
 * Agent Cost Chart Component
 *
 * Displays token usage and cost breakdown by agent.
 */

import { useEffect, useState } from 'react';
import { DollarSign } from 'lucide-react';

interface AgentCostData {
  agent: string;
  department: string;
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  sessionCount: number;
}

interface CostChartProps {
  compact?: boolean;
}

export function AgentCostChart({ compact = false }: CostChartProps) {
  const [data, setData] = useState<{ agents: AgentCostData[]; totals: { totalCost: number } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCostData = async () => {
      try {
        const response = await fetch('/api/tokens/by-agent');
        const result = await response.json();
        if (result.ok) {
          setData(result);
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    fetchCostData();
    const interval = setInterval(fetchCostData, 60_000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="text-sm text-muted-foreground">Loading cost data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive">
        Failed to load cost data: {error}
      </div>
    );
  }

  if (!data || data.agents.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No token usage data available
      </div>
    );
  }

  const maxCost = Math.max(...data.agents.map(a => a.totalCost), 1);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold">Cost by Agent</span>
        </div>
        <div className="text-sm text-muted-foreground">
          Total: ${data.totals.totalCost.toFixed(2)}
        </div>
      </div>

      {/* Agent cost bars */}
      <div className="space-y-2">
        {data.agents.slice(0, compact ? 5 : undefined).map(agent => {
          const percentage = (agent.totalCost / maxCost) * 100;
          return (
            <div key={agent.agent} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{agent.agent}</span>
                <span className="text-muted-foreground">
                  ${agent.totalCost.toFixed(2)} • {agent.sessionCount} sessions
                </span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {!compact && data.agents.length > 5 && (
        <div className="text-xs text-muted-foreground text-center">
          +{data.agents.length - 5} more agents
        </div>
      )}
    </div>
  );
}
