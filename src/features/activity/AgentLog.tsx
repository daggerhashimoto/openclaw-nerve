import type { ReactNode } from 'react';
import { Brain, Sparkles, Zap, CheckCircle, XCircle, Ban, Clock, Link, Lock, Unlock, Wrench } from 'lucide-react';
import type { AgentLogEntry } from '@/types';

const iconMap: Record<string, ReactNode> = {
  '🧠': <Brain size={12} />,
  '✦': <Sparkles size={12} />,
  '⚡': <Zap size={12} />,
  '✅': <CheckCircle size={12} />,
  '❌': <XCircle size={12} />,
  '⛔': <Ban size={12} />,
  '⏰': <Clock size={12} />,
  '🔗': <Link size={12} />,
  '🔐': <Lock size={12} />,
  '🔓': <Unlock size={12} />,
  '🔧': <Wrench size={12} />,
};

interface AgentLogProps {
  entries: AgentLogEntry[];
  glow?: boolean;
}

/** Scrollable log of agent activity entries with optional glow effect. */
export function AgentLog({ entries, glow }: AgentLogProps) {
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className={`panel-header border-l-[3px] border-l-green${glow ? ' tab-glow' : ''}`}>
        <span className="panel-label text-green">
          <span className="panel-diamond">◆</span>
          AGENT LOG
        </span>
      </div>
      <div className="flex-1 overflow-y-auto" role="log" aria-label="Agent activity log">
        {entries.map((e, i) => {
          const ts = new Date(e.ts);
          const timeStr = ts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return (
            <div key={`${e.ts}-${i}`} className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 text-[0.667rem]">
              <span className="text-muted-foreground shrink-0 text-[0.6rem] w-11 tabular-nums">{timeStr}</span>
              <span className="shrink-0 text-[0.733rem] flex items-center" aria-hidden="true">{iconMap[e.icon] || e.icon}</span>
              <span className="flex-1 text-foreground overflow-hidden text-ellipsis whitespace-nowrap">{e.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
