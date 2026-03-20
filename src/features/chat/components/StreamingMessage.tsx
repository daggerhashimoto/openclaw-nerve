import { sanitizeHtml } from '@/lib/sanitize';
import { formatElapsed } from '../utils';

interface StreamingMessageProps {
  html: string;
  elapsedMs: number;
  agentName?: string;
}

/**
 * Streaming message display with live content
 */
export function StreamingMessage({ html, elapsedMs, agentName = 'Agent' }: StreamingMessageProps) {
  return (
    <div className="msg msg-assistant streaming relative max-w-full break-words bg-message-assistant">
      <div className="flex items-center gap-2 px-4 py-2">
        <span className="cockpit-badge" data-tone="success">{agentName}</span>
        {elapsedMs > 0 && (
          <span className="ml-auto font-mono text-[0.667rem] tabular-nums text-muted-foreground">{formatElapsed(elapsedMs)}</span>
        )}
      </div>
      <div className="ml-4 border-l-2 border-green/60 px-4 pb-3 pl-6">
        <div
          className="msg-body whitespace-pre-wrap text-foreground text-[0.867rem]"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
        />
      </div>
    </div>
  );
}
