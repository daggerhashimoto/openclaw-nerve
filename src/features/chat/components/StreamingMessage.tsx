import { nameHueStyle } from '@/lib/agentColors';
import { Pane } from '@/components/ui/Pane';
import { sanitizeHtml } from '@/lib/sanitize';
import { formatClock } from '../utils';

interface StreamingMessageProps {
  html: string;
  elapsedMs: number;
  agentName?: string;
  /** Identity hue of the agent family; colours the name. */
  agentHue?: string;
}

/**
 * The agent's message while it is being written: a live pane leads the header
 * line, and the streaming cursor at the end of the prose comes from CSS
 * (.streaming .msg-body::after).
 */
export function StreamingMessage({ html, elapsedMs, agentName = 'Agent', agentHue }: StreamingMessageProps) {
  return (
    <div className="msg msg-assistant streaming relative max-w-full break-words pb-1 pl-6 pt-2">
      <div className="flex min-h-[var(--row-unit)] items-center gap-2 text-[0.867rem]">
        <Pane state="live" size="sm" className="absolute left-0 top-[1.1rem]" />
        <span className={`msg-speaker min-w-0 truncate font-display font-semibold text-foreground ${agentHue ? 'name-hued' : ''}`} style={nameHueStyle(agentHue)}>{agentName}</span>
        <span className="shrink-0 text-live-text">Writing</span>
        {elapsedMs > 0 && (
          <span className="shrink-0 font-mono text-[0.8rem] tabular text-live-text">{formatClock(elapsedMs)}</span>
        )}
      </div>
      <div
        className="msg-body mt-0.5 whitespace-pre-wrap text-foreground"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
      />
    </div>
  );
}
