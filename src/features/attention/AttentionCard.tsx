import { Pane } from '@/components/ui/Pane';
import { cn } from '@/lib/utils';
import { formatClock } from './briefCopy';
import { KIND_WORD, paneFor, sourceTag, type ItemView } from './itemPresentation';
import { MarkItemSeenButton, NewTag, ReasonText } from './AttentionRow';
import type { AttentionItem, OpenTarget } from './types';

const RESULT_EXCERPT = 240;

const CARD = 'relative flex min-w-0 flex-col gap-2 rounded-[3px] px-3.5 py-3';
const META = 'font-mono text-[0.8rem] tabular text-muted-foreground';

function excerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > RESULT_EXCERPT ? `${trimmed.slice(0, RESULT_EXCERPT).trimEnd()}...` : trimmed;
}

/** "Run finished at 06:52", in words that never claim the work was checked. */
function runLine(item: AttentionItem): string | null {
  const { runStatus, runEndedAt } = item.detail;
  if (!runStatus) return null;
  const at = runEndedAt !== undefined ? ` at ${formatClock(runEndedAt)}` : '';
  switch (runStatus) {
    case 'done':
      return `Run finished${at}`;
    case 'error':
      return `Run failed${at}`;
    case 'aborted':
      return `Run aborted${at}`;
    case 'running':
      return 'Run still running';
  }
}

/** The one line under the title that says what the source knows. */
function CardDetail({ item, view }: { item: AttentionItem; view: ItemView }) {
  const { detail } = item;
  if (detail.error) {
    return <p className="m-0 break-words font-mono text-[0.8rem] text-destructive">{detail.error}</p>;
  }
  if (item.kind === 'proposal' && detail.proposalChange) {
    return <p className="m-0 text-[0.867rem] text-muted-foreground">Changes {detail.proposalChange}</p>;
  }
  if (item.kind === 'gone-quiet' && detail.quietSince !== undefined) {
    const who = view.ownerName ?? 'The agent';
    return (
      <p className="m-0 text-[0.867rem] text-muted-foreground">
        <ReasonText
          text={`${who} has not touched it since ${formatClock(detail.quietSince)}.`}
          ownerName={view.ownerName}
          hue={view.hue}
        />
      </p>
    );
  }
  return null;
}

function KindLine({ item, view, lead }: { item: AttentionItem; view: ItemView; lead: React.ReactNode }) {
  const pane = paneFor(item.kind);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.8rem]">
      <Pane state={pane.state} hue={pane.state === 'off' ? view.hue : undefined} label={pane.label} />
      {lead}
      <span className="min-w-0 text-muted-foreground">
        <ReasonText text={view.reason} ownerName={view.ownerName} hue={view.hue} />
      </span>
      {view.isNew && <NewTag />}
      <span className="flex-1" />
      <span className={META}>{sourceTag(item)}</span>
    </div>
  );
}

interface AttentionCardProps {
  item: AttentionItem;
  view: ItemView;
  /** Position in its section, 1-based. */
  rank: number;
  onOpen: (target: OpenTarget) => void;
  /** Blocked and failed cards only: adds a Mark seen button that sits above the card's hit area. */
  onMarkSeen?: (item: AttentionItem) => void;
  className?: string;
}

/** A ranked card. The title is the button; its hit area covers the whole card. */
export function AttentionCard({ item, view, rank, onOpen, onMarkSeen, className }: AttentionCardProps) {
  return (
    <article className={cn(CARD, 'nerve-task-card', item.freshness !== 'live' && 'opacity-80', className)}>
      <KindLine
        item={item}
        view={view}
        lead={(
          <>
            <span className={META}>{rank}</span>
            <span className="font-semibold text-foreground">{KIND_WORD[item.kind]}</span>
          </>
        )}
      />
      <h3 className="m-0 text-[1rem] font-semibold leading-snug text-foreground">
        <button
          type="button"
          onClick={() => onOpen(item.open)}
          className="cursor-pointer text-left after:absolute after:inset-0 after:rounded-[3px] after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
        >
          {item.title}
        </button>
      </h3>
      <CardDetail item={item} view={view} />
      {onMarkSeen && (
        <div className="flex justify-end">
          <MarkItemSeenButton item={item} compact={false} onMarkSeen={onMarkSeen} className="relative z-10" />
        </div>
      )}
    </article>
  );
}

interface StartHereCardProps {
  item: AttentionItem;
  view: ItemView;
  compact: boolean;
  onOpen: (target: OpenTarget) => void;
}

/** The top decision: what the source already has, no evidence claims, and one warm button. */
export function StartHereCard({ item, view, compact, onOpen }: StartHereCardProps) {
  const { detail } = item;
  const run = runLine(item);
  const sessionKey = detail.sessionKey;
  const action = item.kind === 'proposal' ? 'Open proposal' : 'Open review';

  return (
    <section
      aria-label="Start here"
      className={cn(CARD, 'plate plate-operator gap-2.5 px-4 py-4', item.freshness !== 'live' && 'opacity-80')}
    >
      <KindLine
        item={item}
        view={view}
        lead={<span className="font-semibold text-foreground">{KIND_WORD[item.kind]}</span>}
      />
      <h3 className="m-0 text-[1.2rem] font-semibold leading-tight text-foreground">{item.title}</h3>

      {detail.result && (
        <p className="m-0 border-l-2 border-border pl-3 text-[0.867rem] leading-relaxed text-muted-foreground">
          {excerpt(detail.result)}
        </p>
      )}
      <CardDetail item={item} view={view} />

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[0.867rem] text-muted-foreground">
        {run && <span className="font-mono text-[0.8rem] tabular">{run}</span>}
        <span>No evidence attached</span>
      </div>

      <div
        className={cn(
          'mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3',
          compact && 'flex-col items-stretch',
        )}
      >
        <button
          type="button"
          onClick={() => onOpen(item.open)}
          className={cn(
            'send-btn inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[3px] border-none bg-primary px-3.5 text-[0.867rem] font-semibold text-primary-foreground transition-[filter] duration-[120ms] hover:brightness-110',
            compact ? 'min-h-11 w-full' : 'min-h-8',
          )}
        >
          {action}
        </button>
        {sessionKey && (
          <button
            type="button"
            onClick={() => onOpen({ type: 'session', key: sessionKey })}
            className={cn(
              'cursor-pointer text-[0.867rem] text-foreground underline decoration-border underline-offset-4 hover:decoration-operator',
              compact && 'min-h-11',
            )}
          >
            Open session
          </button>
        )}
      </div>
    </section>
  );
}
