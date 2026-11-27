/**
 * The Attention brief: what needs the operator, ranked, each item opening its source.
 * It reads the polled sources and the session context. The only writes are the operator's own
 * item actions (useAttentionActions); after one succeeds the sources are re-read, and the item
 * moves or leaves through the normal brief rather than by editing it here.
 *
 * Prompts (the board's box and Reply on items) send into sessions and show replies in place
 * (useInlineReplies). They never refresh the sources or touch the Chat view's session, so the
 * ranking stays as it was.
 *
 * Order is frozen per epoch (useStableOrder). An epoch starts once per activation or Refresh,
 * and only after every enabled source has answered since then, so a cold load ranks the real
 * data and a reopen does not baseline on the answers left over from the last look.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGateway } from '@/contexts/GatewayContext';
import { useSessionContext } from '@/contexts/SessionContext';
import { getSessionAgentId, getTopLevelAgentSessions, isPlaceholderIdentityName, isTopLevelAgentSessionKey } from '@/features/sessions/sessionKeys';
import { useAgentHues } from '@/lib/agentColors';
import { cn } from '@/lib/utils';
import { getSessionKey } from '@/types';
import { addSeen, readLastLook, readSeen, writeLastLook } from './attentionStorage';
import { buildAttention } from './buildAttention';
import { formatClock, reasonFor, sinceHeading, sourceLine, summarySentence } from './briefCopy';
import { AttentionCard, StartHereCard } from './AttentionCard';
import { AttentionRow, Clocked } from './AttentionRow';
import { AskBox, type AskTarget, type ReplyConfig } from './AttentionReply';
import type { ItemView } from './itemPresentation';
import { useAttentionSources } from './useAttentionSources';
import { useStableOrder, type StableOrder } from './useStableOrder';
import type { AttentionActionsConfig } from './useAttentionActions';
import { useInlineReplies } from './useInlineReplies';
import type { AttentionItem, AttentionSource, OpenTarget, SourceStatus } from './types';

type Polled = 'tasks' | 'proposals' | 'crons';
type PolledStatuses = Record<Polled, SourceStatus>;

const POLLED: Polled[] = ['tasks', 'proposals', 'crons'];
const TICK_MS = 30_000;
const LOADING: SourceStatus = { state: 'loading' };
const SESSIONS_LIVE: SourceStatus = { state: 'live' };
/** Sessions during a known outage; the outage notice already speaks for it in section notes. */
const SESSIONS_DISCONNECTED: SourceStatus = { state: 'error', error: 'not connected' };
const RANKED = 'Ranked: deadlines, then priority, then age';
const SESSION_CAVEAT = 'Session failures show from when this page opened.';

const SOURCE_NAMES: Record<AttentionSource, string> = {
  tasks: 'Tasks',
  proposals: 'Proposals',
  crons: 'Crons',
  sessions: 'Sessions',
};

/** Which sources feed each section, for its loading and error notes. */
const SECTION_SOURCES: Record<'decide' | 'blocked' | 'progress' | 'finished', AttentionSource[]> = {
  decide: ['tasks', 'proposals'],
  blocked: ['tasks', 'crons', 'sessions'],
  progress: ['tasks', 'sessions'],
  finished: ['tasks', 'crons'],
};

/**
 * Waiting for answers after an activation or Refresh. `baseline` holds the status objects seen
 * when it was armed; the sources hook makes a new object per response, so a source has answered
 * once its status is a different object. A null baseline (first mount) accepts any answer.
 */
interface Gate {
  armed: boolean;
  baseline: PolledStatuses | null;
  /**
   * The epoch was taken before the gateway delivered sessions (the socket was not connected
   * yet). One more epoch is taken when they arrive; nothing reads as New until then.
   */
  awaitSessions: boolean;
}

const OPEN_GATE: Gate = { armed: false, baseline: null, awaitSessions: false };
const OPEN_GATE_AWAITING_SESSIONS: Gate = { armed: false, baseline: null, awaitSessions: true };

/** What the view has seen of the gateway link; `lostAt` is set once a connection is lost or fails. */
interface Link {
  seen: 'none' | 'attempted' | 'connected';
  lostAt: number | null;
}

function hasAnswered(status: SourceStatus, before: SourceStatus | undefined): boolean {
  if (status.state === 'off') return true;
  if (status.state === 'loading') return false;
  return status !== before;
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

export interface AttentionViewProps {
  /** The view is on screen; sources poll only while it is. */
  active: boolean;
  /** Phone layout: one column of rows. */
  compact: boolean;
  kanbanEnabled: boolean;
  onOpen: (target: OpenTarget) => void;
}

export function AttentionView({ active, compact, kanbanEnabled, onOpen }: AttentionViewProps) {
  const { tasks, proposals, crons, sources: polled, refresh } = useAttentionSources({ active, kanbanEnabled });
  const { sessions, sessionsLoading, agentStatus, busyState } = useSessionContext();
  const { connectionState } = useGateway();
  const connected = connectionState === 'connected';

  const [prevActive, setPrevActive] = useState(active);
  const [gate, setGate] = useState<Gate>(() => ({ armed: active, baseline: null, awaitSessions: false }));
  const [epoch, setEpoch] = useState(0);
  // Read once per page session: hopping to a source and back must not reset "since you left".
  const [lastLook] = useState(() => readLastLook());
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => readSeen());
  const [tick, setTick] = useState(() => Date.now());
  const [link, setLink] = useState<Link>(() => ({ seen: connected ? 'connected' : 'none', lostAt: null }));

  // Activation and the answer gate are derived during render, as useStableOrder does, so no
  // render ever shows a reopened brief baselined on the previous look's answers.
  let currentGate = gate;
  if (active !== prevActive) {
    setPrevActive(active);
    if (active) {
      currentGate = { armed: true, baseline: polled, awaitSessions: false };
    }
  }
  // Sessions never finish loading without a gateway; do not hold the polled sources on them.
  const sessionsAnswered = !sessionsLoading || !connected;
  const answered = (source: Polled) => hasAnswered(polled[source], currentGate.baseline?.[source]);
  let currentEpoch = epoch;
  if (currentGate.armed && POLLED.every(answered) && sessionsAnswered) {
    currentGate = sessionsLoading ? OPEN_GATE_AWAITING_SESSIONS : OPEN_GATE;
    currentEpoch = epoch + 1;
  } else if (currentGate.awaitSessions && !sessionsLoading) {
    currentGate = OPEN_GATE;
    currentEpoch = epoch + 1;
  }
  if (currentGate !== gate) setGate(currentGate);
  if (currentEpoch !== epoch) setEpoch(currentEpoch);
  const waiting = currentGate.armed;
  const hideNew = waiting || currentGate.awaitSessions;
  const baseline = currentGate.baseline;

  // Last look: written when the view goes away or the page is hidden while it is open.
  useEffect(() => {
    if (!active) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') writeLastLook(Date.now());
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      writeLastLook(Date.now());
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [active]);

  // The socket starts disconnected and then connecting on every page load; only a connection
  // that was lost, or an attempt that failed, counts as not connected.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- records when the link was lost; keeps the first time across reconnect attempts
    setLink((prev) => {
      if (connectionState === 'connected') {
        return prev.seen === 'connected' && prev.lostAt === null ? prev : { seen: 'connected', lostAt: null };
      }
      if (connectionState === 'connecting' && prev.seen === 'none') return { seen: 'attempted', lostAt: null };
      const failed = prev.seen === 'connected' || (prev.seen === 'attempted' && connectionState === 'disconnected');
      return failed && prev.lostAt === null ? { ...prev, lostAt: Date.now() } : prev;
    });
  }, [connectionState]);

  // While waiting, a source that has not answered since the gate was armed reads as loading,
  // so its old data is shown as stale and the brief can never read as clear.
  const outage = !connected && link.lostAt !== null;
  const effectiveSources = useMemo<Record<AttentionSource, SourceStatus>>(() => {
    const pick = (source: Polled) => (
      !waiting || hasAnswered(polled[source], baseline?.[source]) ? polled[source] : LOADING
    );
    return {
      tasks: pick('tasks'),
      proposals: pick('proposals'),
      crons: pick('crons'),
      sessions: sessionsLoading ? LOADING : outage ? SESSIONS_DISCONNECTED : SESSIONS_LIVE,
    };
  }, [polled, waiting, baseline, sessionsLoading, outage]);

  // Ages stay current with the tick and with the newest answer; ranking is frozen per epoch anyway.
  const now = Math.max(tick, ...POLLED.map((source) => polled[source].checkedAt ?? 0));

  const brief = useMemo(() => buildAttention({
    now,
    lastLook,
    seen,
    tasks,
    proposals,
    crons,
    sessions,
    agentStatus,
    busyState,
    sources: effectiveSources,
  }), [now, lastLook, seen, tasks, proposals, crons, sessions, agentStatus, busyState, effectiveSources]);

  const decide = useStableOrder(brief.decide, currentEpoch);
  const blocked = useStableOrder(brief.blocked, currentEpoch);
  const progress = useStableOrder(brief.progress, currentEpoch);
  const finished = useStableOrder(brief.finished, currentEpoch);

  // Owners: agent ids, named by their main session's identity when it has one.
  const agentNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const session of sessions) {
      const key = getSessionKey(session);
      if (!key || !isTopLevelAgentSessionKey(key)) continue;
      const id = getSessionAgentId(key);
      if (id && session.identityName && !isPlaceholderIdentityName(session.identityName)) {
        names.set(id, session.identityName.trim());
      }
    }
    return names;
  }, [sessions]);

  // The box talks to the agent Chat opens by default: the first top-level agent, main first.
  const mainSession = useMemo(() => getTopLevelAgentSessions(sessions)[0], [sessions]);
  const mainKey = mainSession ? getSessionKey(mainSession) : '';
  const mainId = mainKey ? getSessionAgentId(mainKey) : null;
  // 'Agent' is the session context's placeholder name until the server names the main agent.
  const identityName = mainSession?.identityName?.trim();
  const mainName = identityName && !isPlaceholderIdentityName(identityName) ? identityName : undefined;

  const ownerKey = useMemo(() => {
    const ids = new Set<string>();
    for (const list of [brief.decide, brief.blocked, brief.progress, brief.finished, brief.seen.blocked, brief.seen.finished]) {
      for (const item of list) if (item.ownerId) ids.add(item.ownerId);
    }
    if (mainId) ids.add(mainId);
    return [...ids].sort().join('|');
  }, [brief, mainId]);
  const ownerIds = useMemo(() => (ownerKey ? ownerKey.split('|') : []), [ownerKey]);
  const { hueFor } = useAgentHues(ownerIds);

  const viewOf = (item: AttentionItem, order?: StableOrder): ItemView => {
    // Template text is not a name: an owner without a real identity is shown by its agent id.
    const knownName = item.ownerId ? agentNames.get(item.ownerId) : undefined;
    const ownerName = item.ownerId
      ? (knownName && !isPlaceholderIdentityName(knownName) ? knownName : item.ownerId)
      : undefined;
    return {
      reason: reasonFor(item, now, ownerName),
      ownerName,
      hue: item.ownerId ? hueFor(item.ownerId) : undefined,
      // Nothing is "New" until the epoch has a real baseline.
      isNew: !hideNew && Boolean(order?.newKeys.has(item.key)),
    };
  };

  // After an action the sources are fetched again without a new epoch, so the rest of the
  // brief keeps its order and only the acted-on item moves or leaves.
  const actions = useMemo<AttentionActionsConfig>(() => ({ kanbanEnabled, onDone: refresh }), [kanbanEnabled, refresh]);

  const replyStore = useInlineReplies();
  const connecting = connectionState === 'connecting' || connectionState === 'reconnecting';
  const replies = useMemo<ReplyConfig>(
    () => ({
      store: replyStore,
      connected,
      connecting,
      nameOf: (key: string) => {
        const id = getSessionAgentId(key);
        const name = id ? agentNames.get(id) : undefined;
        return name && !isPlaceholderIdentityName(name) ? name : id ?? undefined;
      },
    }),
    [replyStore, connected, connecting, agentNames],
  );
  const askTarget: AskTarget | null = mainKey
    ? { sessionKey: mainKey, name: mainName, hue: mainId ? hueFor(mainId) : undefined }
    : null;

  const markSeen = useCallback((items: AttentionItem[]) => {
    setSeen(addSeen(items.map((item) => item.key)));
  }, []);

  const onRefresh = () => {
    setGate({ armed: true, baseline: polled, awaitSessions: false });
    refresh();
  };

  const liveChecked = POLLED
    .filter((source) => effectiveSources[source].state === 'live')
    .map((source) => effectiveSources[source].checkedAt)
    .filter((checkedAt): checkedAt is number => typeof checkedAt === 'number');
  const checkedAt = liveChecked.length > 0 ? Math.min(...liveChecked) : undefined;
  const checkedClock = formatClock(checkedAt ?? now);
  const allClear = brief.allClear && !waiting && connected;
  const disconnectedSince = connected ? null : link.lostAt;
  const disconnected = disconnectedSince !== null;

  // Blocked, failed and finished items can be marked seen one by one; the rest and the Seen lines cannot.
  const markOneSeen = (item: AttentionItem) => markSeen([item]);

  const renderRows = (items: AttentionItem[], order?: StableOrder, onMarkSeen?: (item: AttentionItem) => void) => (
    <div className={compact ? 'flex flex-col' : 'flex flex-col gap-0.5 pt-1'}>
      {items.map((item) => (
        <AttentionRow
          key={item.key}
          item={item}
          view={viewOf(item, order)}
          compact={compact}
          onOpen={onOpen}
          onMarkSeen={onMarkSeen}
          actions={actions}
          replies={replies}
        />
      ))}
    </div>
  );

  const notes = (section: keyof typeof SECTION_SOURCES) => (
    <SectionNotes
      sources={effectiveSources}
      relevant={SECTION_SOURCES[section]}
      showOff={section === 'decide'}
      compact={compact}
      onOpen={onOpen}
    />
  );

  const [start, ...then] = decide.items;

  const decideSection = (
    <Section id="attention-decide" title="Decide now" count={String(decide.items.length)} compact={compact}
      aside={<span className="text-[0.8rem] text-muted-foreground">{compact ? 'Ranked' : RANKED}</span>}
    >
      {notes('decide')}
      {start ? (
        <>
          <div className={cn('text-[0.8rem] text-muted-foreground', compact && 'px-4')}>Start here</div>
          <div className={compact ? 'px-3' : undefined}>
            <StartHereCard
              key={start.key}
              item={start}
              view={viewOf(start, decide)}
              compact={compact}
              onOpen={onOpen}
              actions={actions}
              replies={replies}
            />
          </div>
          {then.length > 0 && (
            <>
              <div className={cn('mt-1 text-[0.8rem] text-muted-foreground', compact && 'px-4')}>Then</div>
              {compact ? renderRows(then, decide) : (
                <div className="flex flex-col gap-3">
                  {then.map((item, index) => (
                    <AttentionCard
                      key={item.key}
                      item={item}
                      view={viewOf(item, decide)}
                      rank={index + 2}
                      onOpen={onOpen}
                      actions={actions}
                      replies={replies}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <EmptyLine compact={compact} hidden={hasNotes(effectiveSources, 'decide')}>Nothing to decide.</EmptyLine>
      )}
    </Section>
  );

  const blockedSection = (
    <Section id="attention-blocked" title="Blocked or failed" count={String(blocked.items.length)} compact={compact}
      aside={(
        <>
          {!compact && <span className="text-[0.8rem] text-muted-foreground">{RANKED}</span>}
          {blocked.items.length > 0 && (
            <MarkSeenButton compact={compact} onClick={() => markSeen(blocked.items)} />
          )}
        </>
      )}
    >
      {notes('blocked')}
      {blocked.items.length > 0 ? (
        compact ? renderRows(blocked.items, blocked, markOneSeen) : (
          <div className="flex flex-wrap items-stretch gap-3">
            {blocked.items.map((item, index) => (
              <AttentionCard
                key={item.key}
                item={item}
                view={viewOf(item, blocked)}
                rank={index + 1}
                onOpen={onOpen}
                onMarkSeen={markOneSeen}
                actions={actions}
                replies={replies}
                className="flex-[1_1_300px]"
              />
            ))}
          </div>
        )
      ) : (
        <EmptyLine compact={compact} hidden={hasNotes(effectiveSources, 'blocked')}>Nothing blocked or failed.</EmptyLine>
      )}
      <SeenLine items={brief.seen.blocked} compact={compact} render={(items) => renderRows(items)} />
    </Section>
  );

  const progressSection = (
    <Section id="attention-progress" title="In progress" count={String(progress.items.length)} compact={compact}>
      {notes('progress')}
      {progress.items.length > 0
        ? renderRows(progress.items, progress)
        : <EmptyLine compact={compact} hidden={hasNotes(effectiveSources, 'progress')}>Nothing running.</EmptyLine>}
    </Section>
  );

  const finishedSection = (
    <Section id="attention-finished" title="Recently finished" count={`${finished.items.length} unseen`} compact={compact}
      aside={finished.items.length > 0
        ? <MarkSeenButton compact={compact} onClick={() => markSeen(finished.items)} />
        : undefined}
    >
      {notes('finished')}
      {finished.items.length > 0
        ? renderRows(finished.items, finished, markOneSeen)
        : <EmptyLine compact={compact} hidden={hasNotes(effectiveSources, 'finished')}>Nothing new has finished.</EmptyLine>}
      <SeenLine items={brief.seen.finished} compact={compact} render={(items) => renderRows(items)} />
    </Section>
  );

  const allClearBlock = (
    <section aria-label="Nothing needs you" className="flex flex-col gap-1 border-y border-border py-4">
      <p className={cn('m-0 text-[1rem] text-foreground', compact && 'px-4')}>
        <Clocked text={`Nothing needs you. Checked tasks, proposals and crons at ${checkedClock}.`} />
      </p>
      <p className={cn('m-0 text-[0.8rem] text-muted-foreground', compact && 'px-4')}>{SESSION_CAVEAT}</p>
      {/* Failures marked seen stay visible as a collapsed count; they are not gone. */}
      <SeenLine items={brief.seen.blocked} compact={compact} render={(items) => renderRows(items)} />
    </section>
  );

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain bg-background">
      <div
        className={cn(
          'mx-auto flex w-full max-w-[1320px] flex-col',
          compact ? 'gap-4 pb-8 pt-4' : 'gap-6 px-7 pb-6 pt-6',
        )}
      >
        {disconnectedSince !== null && (
          <p className={cn('cockpit-note m-0', compact && 'mx-3')} role="status">
            <Clocked text={`Not connected since ${formatClock(disconnectedSince)}. Showing the last known state.`} />
          </p>
        )}

        <div className={cn('flex flex-col', compact ? 'gap-4' : 'gap-6', disconnected && 'opacity-60')}>
          <section aria-label="Summary" className={cn('flex flex-col gap-1.5', compact && 'px-4')}>
            <div className="flex items-start gap-3">
              <h1 className={cn('m-0 font-semibold leading-tight text-foreground', compact ? 'text-[1.333rem]' : 'text-[1.2rem]')}>
                <Clocked text={sinceHeading(brief, lastLook, now)} />
              </h1>
              <span className="flex-1" />
              <button
                type="button"
                onClick={onRefresh}
                className={cn('shell-chip shrink-0', compact && 'min-h-11')}
              >
                Refresh
              </button>
            </div>
            {!allClear && (
              <p className="m-0 max-w-[72ch] text-[1rem] leading-relaxed text-foreground">
                <Clocked
                  text={brief.allClear
                    ? 'Nothing needed you in the last known state.'
                    : summarySentence(brief, now)}
                />
              </p>
            )}
            <p className="m-0 max-w-[90ch] text-[0.8rem] leading-normal text-muted-foreground">
              <Clocked text={sourceLine(brief, now)} />
            </p>
          </section>

          <AskBox
            config={replies}
            target={askTarget}
            loading={sessionsLoading && connected}
            compact={compact}
            onOpen={onOpen}
          />

          {compact ? (
            <div className="flex flex-col gap-2">
              {allClear ? allClearBlock : (
                <>
                  {decideSection}
                  {blockedSection}
                  {progressSection}
                </>
              )}
              {finishedSection}
            </div>
          ) : (
            <div className="flex flex-wrap items-start gap-6">
              <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-6">
                {allClear ? allClearBlock : (
                  <>
                    {decideSection}
                    {blockedSection}
                  </>
                )}
              </div>
              <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-6">
                {!allClear && progressSection}
                {finishedSection}
              </div>
            </div>
          )}

          {checkedAt !== undefined && (
            <p
              className={cn(
                'm-0 border-t border-border pt-3 text-[0.8rem] text-muted-foreground',
                compact && 'mx-4',
              )}
            >
              <Clocked text={`That is everything the live sources reported at ${checkedClock}.`} />
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  count,
  aside,
  compact,
  children,
}: {
  id: string;
  title: string;
  count: string;
  aside?: React.ReactNode;
  compact: boolean;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-2 border-b border-border',
          compact ? 'min-h-11 px-4' : 'min-h-7',
        )}
      >
        <h2 id={id} className="m-0 text-[0.867rem] font-semibold text-foreground">{title}</h2>
        <span className="font-mono text-[0.8rem] tabular text-muted-foreground">{count}</span>
        <span className="flex-1" />
        {aside}
      </div>
      {children}
    </section>
  );
}

function MarkSeenButton({ compact, onClick }: { compact: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('shell-chip text-[0.8rem]', compact && 'min-h-11')}
    >
      Mark seen
    </button>
  );
}

function EmptyLine({ compact, hidden, children }: { compact: boolean; hidden: boolean; children: React.ReactNode }) {
  if (hidden) return null;
  return <p className={cn('m-0 text-[0.867rem] text-muted-foreground', compact && 'px-4')}>{children}</p>;
}

/** Sources that keep a section from being trusted as empty: loading, unreadable, or (for Decide now) off. */
function hasNotes(sources: Record<AttentionSource, SourceStatus>, section: keyof typeof SECTION_SOURCES): boolean {
  return SECTION_SOURCES[section].some((source) => {
    const state = sources[source].state;
    return state === 'loading' || state === 'error' || (section === 'decide' && state === 'off');
  });
}

function SectionNotes({
  sources,
  relevant,
  showOff,
  compact,
  onOpen,
}: {
  sources: Record<AttentionSource, SourceStatus>;
  relevant: AttentionSource[];
  showOff: boolean;
  compact: boolean;
  onOpen: (target: OpenTarget) => void;
}) {
  const tasksOff = sources.tasks.state === 'off';
  const errors = relevant.filter((source) => (
    sources[source].state === 'error' && sources[source] !== SESSIONS_DISCONNECTED
  ));
  const loading = relevant.filter((source) => (
    sources[source].state === 'loading' && !(source === 'proposals' && tasksOff)
  ));
  const off = showOff && tasksOff;
  if (errors.length === 0 && loading.length === 0 && !off) return null;

  return (
    <div className={cn('flex flex-col gap-1 text-[0.867rem] text-muted-foreground', compact && 'px-4')}>
      {errors.map((source) => {
        const error = sources[source].error?.trim();
        const panel = source === 'crons' ? 'crons' : 'tasks';
        return (
          <p key={source} className="m-0 flex flex-wrap items-center gap-x-2">
            <span className="text-foreground">
              {error ? `${SOURCE_NAMES[source]} could not be read (${error}).` : `${SOURCE_NAMES[source]} could not be read.`}
            </span>
            {source !== 'sessions' && (
              <button
                type="button"
                onClick={() => onOpen({ type: 'source', source: panel })}
                className={cn(
                  'cursor-pointer text-foreground underline decoration-border underline-offset-4 hover:decoration-operator',
                  compact && 'min-h-11',
                )}
              >
                {panel === 'crons' ? 'Open Crons' : 'Open Tasks'}
              </button>
            )}
          </p>
        );
      })}
      {loading.length > 0 && (
        <p className="m-0">{`Loading ${joinWords(loading.map((source) => SOURCE_NAMES[source].toLowerCase()))}.`}</p>
      )}
      {off && <p className="m-0">Tasks are turned off.</p>}
    </div>
  );
}

function SeenLine({
  items,
  compact,
  render,
}: {
  items: AttentionItem[];
  compact: boolean;
  render: (items: AttentionItem[]) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex cursor-pointer items-center self-start text-[0.8rem] text-muted-foreground hover:text-foreground',
          compact ? 'min-h-11 px-4' : 'min-h-7',
        )}
      >
        {`Seen (${items.length})`}
      </button>
      {open && render(items)}
    </div>
  );
}
