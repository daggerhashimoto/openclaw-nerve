/**
 * Agent Command Panel
 *
 * UI for JARVIS to command other agents.
 */

import React, { useState } from 'react';
import { useAgentRegistry } from '../../contexts/AgentRegistryContext';
import { Send, Clock, AlertCircle, CheckCircle } from 'lucide-react';
import type { AgentWithStatus } from '../../types/agent';

interface CommandPanelProps {
  /** Pre-selected agent */
  selectedAgent?: AgentWithStatus;
  /** Callback when command is sent */
  onCommandSent?: (result: { ok: boolean; sessionKey?: string }) => void;
}

type Priority = 'low' | 'normal' | 'high' | 'critical';

export function CommandPanel({ selectedAgent, onCommandSent }: CommandPanelProps) {
  const { agents, commandAgent } = useAgentRegistry();
  const [selectedAgentName, setSelectedAgentName] = useState(selectedAgent?.name || '');
  const [task, setTask] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [deadline, setDeadline] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string; sessionKey?: string } | null>(null);

  const availableAgents = agents.filter(a => a.connectionStatus === 'connected');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgentName || !task) return;

    setSending(true);
    setResult(null);

    try {
      const response = await commandAgent(selectedAgentName, task, priority);
      if (response.ok) {
        setResult({
          ok: true,
          message: `Task sent to ${selectedAgentName}`,
          sessionKey: response.sessionKey,
        });
        onCommandSent?.({ ok: true, sessionKey: response.sessionKey });
        setTask('');
      } else {
        setResult({ ok: false, message: response.error });
      }
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setSending(false);
    }
  };

  const priorityColors: Record<Priority, string> = {
    low: 'bg-blue-500',
    normal: 'bg-green-500',
    high: 'bg-yellow-500',
    critical: 'bg-red-500',
  };

  const priorityEstimates: Record<Priority, string> = {
    low: '~3 hours',
    normal: '~1 hour',
    high: '~30 minutes',
    critical: '~15 minutes',
  };

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Send className="w-5 h-5 text-primary" />
        <h3 className="font-semibold">Command Agent</h3>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Agent Selection */}
        <div>
          <label className="block text-sm font-medium mb-1">Agent</label>
          <select
            value={selectedAgentName}
            onChange={(e) => setSelectedAgentName(e.target.value)}
            className="w-full bg-background border rounded-md px-3 py-2 text-sm"
            disabled={sending}
          >
            <option value="">Select an agent...</option>
            {availableAgents.map(agent => (
              <option key={agent.name} value={agent.name}>
                {agent.name} - {agent.role}
              </option>
            ))}
          </select>
        </div>

        {/* Task */}
        <div>
          <label className="block text-sm font-medium mb-1">Task</label>
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe the task..."
            className="w-full bg-background border rounded-md px-3 py-2 text-sm min-h-[100px]"
            disabled={sending}
            required
          />
        </div>

        {/* Priority */}
        <div>
          <label className="block text-sm font-medium mb-2">Priority</label>
          <div className="flex gap-2">
            {(['low', 'normal', 'high', 'critical'] as Priority[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                  priority === p
                    ? `${priorityColors[p]} text-white`
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                <div className="capitalize">{p}</div>
                <div className="text-[10px] opacity-75">{priorityEstimates[p]}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Deadline (optional) */}
        <div>
          <label className="block text-sm font-medium mb-1">
            Deadline (optional)
          </label>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="w-full bg-background border rounded-md px-3 py-2 text-sm"
            disabled={sending}
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={sending || !selectedAgentName || !task}
          className="w-full bg-primary text-primary-foreground py-2 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {sending ? (
            <>
              <Clock className="w-4 h-4 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Send Command
            </>
          )}
        </button>
      </form>

      {/* Result */}
      {result && (
        <div className={`p-3 rounded-md flex items-start gap-2 ${
          result.ok ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'
        }`}>
          {result.ok ? (
            <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          )}
          <div className="text-sm">
            {result.message}
            {result.sessionKey && (
              <div className="text-xs opacity-75 mt-1">
                Session: {result.sessionKey}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
