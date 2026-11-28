/**
 * The Attention view. Now is an urgency board: a heading that is the count of what is failing,
 * what waits on the operator and who is working; then Failing, Waiting on you (the top decision
 * on the warm Start here plate, the rest as rows that open in place), the Agents strip and Since
 * you looked; and the Ask box docked at the bottom. Today (TodayView) is the day digest.
 *
 * It reads the polled sources, the session context, cron run history and the gateway's exec
 * approvals. The only writes are the operator's own item actions (useAttentionActions); after
 * one succeeds the sources are re-read, and the item moves or leaves through the normal brief.
 *
 * Prompts (the Ask box and Reply on items) send into sessions and show replies in place
 * (useInlineReplies). They never refresh the sources or touch the Chat view's session.
 *
 * Order is frozen per epoch (useStableOrder). An epoch starts once per activation or Refresh,
 * and only after every enabled source has answered since then, so a cold load ranks the real
 * data and a reopen does not baseline on the answers left over from the last look. Approvals
 * are pinned first; the Start here plate keeps its item for the epoch while it is still there.
 *
 * The Now | Today choice is remembered per browser (attentionSegment).
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useGateway } from '@/contexts/GatewayContext';
import { useSessionContext } from '@/contexts/SessionContext';
import { getSessionAgentId, getTopLevelAgentSessions, isPlaceholderIdentityName, isTopLevelAgentSessionKey } from '@/features/sessions/sessionKeys';
import { useAgentHues } from '@/lib/agentColors';
import { cn } from '@/lib/utils';
import { getSessionKey } from '@/types';
import { addSeen, readLastLook, readSeen, writeLastLook } from './attentionStorage';
import { buildAttention, FIRST_RUN_WINDOW_MS } from './buildAttention';
import { buildAgents } from './buildAgents';
import { checkedAt as checkedAtOf, failingItems, formatClock, gapSentences, headline, NOT_CONNECTED, reasonFor } from './briefCopy';
import { StartHerePlate } from './AttentionCard';
import { AttentionRow } from './AttentionRow';
import { AgentsStrip } from './AgentsStrip';
import { Clocked } from './textBits';
import { AskBox, type AskTarget, type ReplyConfig } from './AttentionReply';
import { variantClass } from './actionStyles';
import type { ItemView } from './itemPresentation';
import { useAttentionSources } from './useAttentionSources';
import { useStableOrder, type StableOrder } from './useStableOrder';
import type { AttentionActionsConfig } from './useAttentionActions';
import { useInlineReplies } from './useInlineReplies';
import { useAttentionSummaries } from './useAttentionSummaries';
import { useAttentionSegment, type AttentionSegment } from './attentionSegment';
import { useExecApprovals } from './execApprovals';
import { KIND_WORD } from './itemPresentation';
import { TodayView } from './today/TodayView';
import { useCronRuns } from './today/useCronRuns';
import type { AttentionItem, AttentionSource, AttentionSources, OpenTarget, SourceStatus } from './types';

type Polled = 'tasks' | 'proposals' | 'crons';
type PolledStatuses = Record<Polled, SourceStatus>;

const POLLED: Polled[] = ['tasks', 'proposals', 'crons'];
const TICK_MS = 30_000;
const LOADING: SourceStatus = { state: 'loading' };
const SESSIONS_LIVE: SourceStatus = { state: 'live' };
/** A socket-fed source during a known outage; the outage notice already speaks for it. */
const DISCONNECTED: SourceStatus = { state: 'error', error: NOT_CONNECTED };
const RANKED = 'Ranked: approvals first, then deadlines, priority and age';
/** The summaries route answers this many keys per request. */
const MAX_SUMMARY_KEYS = 12;

const SOURCE_NAMES: Record<AttentionSource, string> = {
  tasks: 'Tasks',
  proposals: 'Proposals',
  crons: 'Crons',
  sessions: 'Sessions',
  approvals: 'Approvals',
};

type SectionId = 'failing' | 'decide' | 'agents' | 'finished';

/** Which sources feed each section, for its loading and error notes. */
const SECTION_SOURCES: Record<SectionId, AttentionSource[]> = {
  failing: ['tasks', 'crons', 'sessions'],
  decide: ['tasks', 'proposals', 'approvals'],
  agents: ['sessions'],
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

function statusOf(sources: AttentionSources, source: AttentionSource): SourceStatus {
  return (source === 'approvals' ? sources.approvals : sources[source]) ?? { state: 'off' };
}

/**
 * The plate's item for the epoch: the first decision when the epoch starts, kept while it is
 * still waiting, so a decision that arrives mid-look never swaps the warm button under the
 * pointer. When the plate's item leaves, the next decision takes it.
 */
function usePlateKey(keys: string[], epoch: number | string): string | undefined {
  const [state, setState] = useState<{ epoch: number | string; key: string | undefined }>(() => ({ epoch, key: keys[0] }));
  let current = state;
  if (state.epoch !== epoch || state.key === undefined || !keys.includes(state.key)) {
    current = { epoch, key: keys[0] };
  }
  if (current.epoch !== state.epoch || current.key !== state.key) setState(current);
  return current.key;
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
  const gateway = useGateway();
  const { connectionState } = gateway;
  const connected = connectionState === 'connected';
  const [segment, setSegment] = useAttentionSegment();
  const showToday = segment === 'today';
  const [refreshSignal, setRefreshSignal] = useState(0);

  const [prevActive, setPrevActive] = useState(active);
  const [gate, setGate] = useState<Gate>(() => ({ armed: active, baseline: null, awaitSessions: false }));
  const [epoch, setEpoch] = useState(0);
  // Read once per page session: hopping to a source and back must not reset "since you looked".
  const [lastLook] = useState(() => readLastLook());
  // The window cron run history is read for; fixed for the page session so a tick does not re-read it.
  const [runWindow] = useState(() => lastLook ?? Date.now() - FIRST_RUN_WINDOW_MS);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => readSeen());
  const [tick, setTick] = useState(() => Date.now());
  const [link, setLink] = useState<Link>(() => ({ seen: connected ? 'connected' : 'none', lostAt: null }));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [sinceOpen, setSinceOpen] = useState(false);

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

  const approvals = useExecApprovals({ active, connected, signal: refreshSignal });
  // Run history only serves Now (failing crons that recovered); Today reads its own.
  const cronRuns = useCronRuns({ active: active && !showToday, crons, cronsStatus: polled.crons, dayStart: runWindow });

  // While waiting, a source that has not answered since the gate was armed reads as loading,
  // so its old data is shown as stale and the brief can never read as clear.
  const outage = !connected && link.lostAt !== null;
  const effectiveSources = useMemo<AttentionSources>(() => {
    const pick = (source: Polled) => (
      !waiting || hasAnswered(polled[source], baseline?.[source]) ? polled[source] : LOADING
    );
    return {
      tasks: pick('tasks'),
      proposals: pick('proposals'),
      crons: pick('crons'),
      sessions: sessionsLoading ? LOADING : outage ? DISCONNECTED : SESSIONS_LIVE,
      approvals: approvals.status.state === 'off' ? approvals.status : outage ? DISCONNECTED : approvals.status,
    };
  }, [polled, waiting, baseline, sessionsLoading, outage, approvals.status]);

  // Ages stay current with the tick and with the newest answer; ranking is frozen per epoch anyway.
  const now = Math.max(tick, ...POLLED.map((source) => polled[source].checkedAt ?? 0));

  const brief = useMemo(() => buildAttention({
    now,
    lastLook,
    seen,
    tasks,
    proposals,
    crons,
    cronRuns: cronRuns.runs,
    approvals: approvals.approvals,
    sessions,
    agentStatus,
    busyState,
    sources: effectiveSources,
  }), [now, lastLook, seen, tasks, proposals, crons, cronRuns.runs, approvals.approvals, sessions, agentStatus, busyState, effectiveSources]);

  // Approvals hold an agent, so they stay first even when they arrive mid-epoch. Their first
  // answer lands just after the polled sources on a cold load; it joins the baseline (no New,
  // and the plate may still move to it) instead of reading as an arrival.
  const approvalsSettled = approvals.status.state !== 'loading' || !connected;
  const approvalItems = useMemo(() => brief.decide.filter((item) => item.kind === 'approval'), [brief]);
  const otherDecisions = useMemo(() => brief.decide.filter((item) => item.kind !== 'approval'), [brief]);
  const decideEpoch = `${currentEpoch}:${approvalsSettled ? 'settled' : 'loading'}`;
  const approvalOrder = useStableOrder(approvalItems, decideEpoch);
  const decisionOrder = useStableOrder(otherDecisions, currentEpoch);
  const decide = useMemo(() => [...approvalOrder.items, ...decisionOrder.items], [approvalOrder, decisionOrder]);
  const decideNew = useMemo(() => new Set([...approvalOrder.newKeys, ...decisionOrder.newKeys]), [approvalOrder, decisionOrder]);
  const blocked = useStableOrder(brief.blocked, currentEpoch);
  const finished = useStableOrder(brief.finished, currentEpoch);
  const plateKey = usePlateKey(decide.map((item) => item.key), decideEpoch);

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

  const agents = useMemo(
    () => buildAgents({ brief, sessions, agentStatus, busyState, agentNames, now }),
    [brief, sessions, agentStatus, busyState, agentNames, now],
  );
  const working = agents.filter((line) => line.state !== 'idle').length;

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
    for (const line of agents) if (line.agentId) ids.add(line.agentId);
    if (mainId) ids.add(mainId);
    return [...ids].sort().join('|');
  }, [brief, agents, mainId]);
  const ownerIds = useMemo(() => (ownerKey ? ownerKey.split('|') : []), [ownerKey]);
  const { hueFor } = useAgentHues(ownerIds);

  const viewOf = (item: AttentionItem, newKeys?: ReadonlySet<string>): ItemView => {
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
      isNew: !hideNew && Boolean(newKeys?.has(item.key)),
    };
  };

  // After an action the sources are fetched again without a new epoch, so the rest of the
  // board keeps its order and only the acted-on item moves or leaves.
  const reloadApprovals = approvals.reload;
  const actions = useMemo<AttentionActionsConfig>(() => ({
    kanbanEnabled,
    rpc: gateway.rpc,
    connected,
    onDone: (item) => {
      if (item.kind === 'approval') reloadApprovals();
      else refresh();
    },
  }), [kanbanEnabled, refresh, reloadApprovals, gateway.rpc, connected]);

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
  const markOneSeen = (item: AttentionItem) => markSeen([item]);

  const toggle = useCallback((item: AttentionItem) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(item.key)) next.delete(item.key);
      else next.add(item.key);
      return next;
    });
  }, []);

  const onRefresh = () => {
    setGate({ armed: true, baseline: polled, awaitSessions: false });
    setRefreshSignal((n) => n + 1);
    refresh();
  };

  // What the brief holds against each session, for Today's chat rows.
  const needsReply = useMemo(() => {
    const out = new Map<string, string>();
    for (const item of [...brief.decide, ...brief.blocked]) {
      const key = item.detail.sessionKey;
      if (key && !out.has(key)) out.set(key, KIND_WORD[item.kind]);
    }
    return out;
  }, [brief]);

  const checkedAt = checkedAtOf(brief, now);
  const checkedClock = formatClock(checkedAt);
  const allClear = brief.allClear && !waiting && connected;
  const disconnectedSince = connected ? null : link.lostAt;

  const plate = allClear ? undefined : decide.find((item) => item.key === plateKey);
  const rows = decide.filter((item) => item !== plate);
  const failing = failingItems(blocked.items);
  const seenFailing = failingItems(brief.seen.blocked);

  // Summaries for the plate and every open row, read lazily. Asked again on Refresh, when an
  // item's event changes, and when a reply in one of the sessions finishes.
  const summaryEntries: string[] = [];
  for (const item of [plate, ...[...failing, ...rows, ...finished.items, ...brief.seen.finished, ...seenFailing].filter((entry) => expanded.has(entry.key))]) {
    if (item?.detail.sessionKey) summaryEntries.push(`${item.detail.sessionKey}@${item.updatedAt}`);
  }
  const summaryId = [...new Set(summaryEntries)].slice(0, MAX_SUMMARY_KEYS).join('\n');
  const summaryKeys = useMemo(
    () => (summaryId ? summaryId.split('\n').map((entry) => entry.slice(0, entry.lastIndexOf('@'))) : []),
    [summaryId],
  );
  const repliesEnded = useSyncExternalStore(
    replyStore.subscribe,
    () => summaryKeys.map((key) => replyStore.get(key)?.endedAt ?? '').join('|'),
  );
  const summaries = useAttentionSummaries({
    active: active && !showToday,
    sessionKeys: summaryKeys,
    signal: `${currentEpoch}|${summaryId}|${repliesEnded}`,
  });
  const summaryOf = (item: AttentionItem) => (item.detail.sessionKey ? summaries[item.detail.sessionKey] : undefined);

  const renderRows = (
    items: AttentionItem[],
    order: StableOrder | { newKeys: ReadonlySet<string> } | undefined,
    options: { onMarkSeen?: (item: AttentionItem) => void; placement?: 'row' | 'detail'; history?: boolean } = {},
  ) => (
    <div className={compact ? 'flex flex-col' : 'flex flex-col gap-0.5'}>
      {items.map((item) => (
        <AttentionRow
          key={item.key}
          item={item}
          view={viewOf(item, order?.newKeys)}
          now={now}
          compact={compact}
          open={expanded.has(item.key)}
          onToggle={toggle}
          onOpen={onOpen}
          onMarkSeen={options.onMarkSeen}
          markSeenPlacement={options.placement}
          actions={actions}
          replies={replies}
          summary={expanded.has(item.key) ? summaryOf(item) : undefined}
          history={options.history}
        />
      ))}
    </div>
  );

  const notes = (section: SectionId) => (
    <SectionNotes
      sources={effectiveSources}
      relevant={SECTION_SOURCES[section]}
      showOff={section === 'decide'}
      compact={compact}
      onOpen={onOpen}
    />
  );

  const failingSection = (failing.length > 0 || seenFailing.length > 0 || hasNotes(effectiveSources, 'failing')) && (
    <Section
      id="attention-failing"
      title="Failing"
      count={failing.length}
      compact={compact}
      aside={failing.length > 1 ? (
        <button type="button" onClick={() => markSeen(failing)} className={cn(variantClass('text', compact), 'text-[0.8rem]')}>
          Mark all seen
        </button>
      ) : undefined}
    >
      {notes('failing')}
      {failing.length > 0 && renderRows(failing, blocked, { onMarkSeen: markOneSeen, placement: compact ? 'detail' : 'row' })}
      <SeenLine items={seenFailing} compact={compact} render={(items) => renderRows(items, undefined)} />
    </Section>
  );

  const decideSection = (
    <Section
      id="attention-decide"
      title="Waiting on you"
      count={decide.length}
      countTitle={RANKED}
      compact={compact}
    >
      {notes('decide')}
      {plate && (
        <div className={compact ? 'px-3' : undefined}>
          <StartHerePlate
            key={plate.key}
            item={plate}
            view={viewOf(plate, decideNew)}
            compact={compact}
            onOpen={onOpen}
            actions={actions}
            replies={replies}
            summary={summaryOf(plate)}
          />
        </div>
      )}
      {rows.length > 0 && renderRows(rows, { newKeys: decideNew })}
      {decide.length === 0 && (
        <EmptyLine compact={compact} hidden={hasNotes(effectiveSources, 'decide')}>Nothing to decide.</EmptyLine>
      )}
    </Section>
  );

  const allClearBlock = (
    <section aria-label="Nothing needs you" className="flex flex-col gap-1 border-y border-border py-4">
      <p className={cn('m-0 text-[1rem] text-foreground', compact && 'px-4')}>
        <Clocked text={`Nothing needs you. Checked tasks, proposals and crons at ${checkedClock}.`} />
      </p>
      {/* Failures marked seen stay visible as a collapsed count; they are not gone. */}
      <SeenLine items={seenFailing} compact={compact} render={(items) => renderRows(items, undefined)} />
    </section>
  );

  const agentsSection = (
    <Section id="attention-agents" title="Agents" count={working > 0 ? working : undefined} countLabel="working" compact={compact}>
      {notes('agents')}
      {agents.length > 0 ? (
        <AgentsStrip lines={agents} now={now} compact={compact} hueFor={hueFor} onOpen={onOpen} actions={actions} />
      ) : (
        <EmptyLine compact={compact} hidden={hasNotes(effectiveSources, 'agents') || sessionsLoading}>No agents yet.</EmptyLine>
      )}
    </Section>
  );

  const sinceClock = formatClock(brief.since);
  const finishedCount = finished.items.length;
  const sinceSection = (
    <section aria-labelledby="attention-since" className="flex min-w-0 flex-col gap-2">
      <div className={cn('flex flex-wrap items-center gap-x-3 border-b border-border', compact ? 'min-h-11 px-4' : 'min-h-7')}>
        <h2 id="attention-since" title={`Since ${sinceClock}`} className="m-0 text-[0.867rem] font-semibold text-foreground">
          Since you looked
        </h2>
        {finishedCount > 0 ? (
          <button
            type="button"
            aria-expanded={sinceOpen}
            aria-controls="attention-since-list"
            onClick={() => setSinceOpen((value) => !value)}
            className={cn('inline-flex cursor-pointer items-center gap-1 text-[0.8rem] text-muted-foreground hover:text-foreground', compact && 'min-h-11')}
          >
            <span className="font-mono tabular text-foreground">{finishedCount}</span>
            {' finished'}
            <span aria-hidden="true" className={cn('inline-block transition-transform duration-[120ms]', sinceOpen && 'rotate-90')}>›</span>
          </button>
        ) : (
          <span className="text-[0.8rem] text-muted-foreground">
            {hasNotes(effectiveSources, 'finished') ? '' : 'Nothing new'}
          </span>
        )}
        <span className="flex-1" />
        {finishedCount > 0 && (
          <button type="button" onClick={() => markSeen(finished.items)} className={cn(variantClass('text', compact), 'text-[0.8rem]')}>
            Mark all seen
          </button>
        )}
      </div>
      {notes('finished')}
      {sinceOpen && finishedCount > 0 && (
        <div id="attention-since-list">
          {renderRows(finished.items, finished, { onMarkSeen: markOneSeen, placement: 'row', history: true })}
        </div>
      )}
      <SeenLine items={brief.seen.finished} compact={compact} render={(items) => renderRows(items, undefined, { history: true })} />
    </section>
  );

  const { parts, text: headlineText } = headline(brief, working);
  const headlineEl = (
    <h1
      data-testid="attention-headline"
      aria-label={headlineText}
      className={cn('m-0 min-w-0 flex-1 font-semibold leading-tight text-foreground', compact ? 'text-[1.133rem]' : 'text-[1.2rem]')}
    >
      {parts.length > 0 ? parts.map((part, index) => (
        <span key={part.word} className="whitespace-nowrap">
          {index > 0 && <span aria-hidden="true" className="px-1.5 font-normal text-muted-foreground">·</span>}
          <span className={cn('font-mono tabular', part.tone === 'error' ? 'text-destructive' : part.tone === 'operator' ? 'text-operator-text' : 'text-live-text')}>
            {part.n}
          </span>
          {` ${part.word}`}
        </span>
      )) : headlineText}
    </h1>
  );
  // Loading is said in the sections it holds back; the heading line keeps the lasting gaps.
  const gaps = gapSentences(brief, { loading: false });

  return (
    <div className="attention-board h-full min-h-0 overflow-y-auto overscroll-contain bg-background" data-compact={compact}>
      <div className={cn('mx-auto flex min-h-full w-full max-w-[1320px] flex-col', !compact && 'px-7')}>
        <header className={cn('flex flex-col gap-1', compact ? 'px-4 pb-3 pt-3' : 'pb-5 pt-4')}>
          {/* Desk: counts, tabs, time and Refresh on one row. Phone: the controls on one row and
              the counts on their own line under them, so nothing is cut at 390px. */}
          <div className={cn('flex min-w-0 items-center gap-x-3', compact ? 'flex-col items-stretch gap-y-2' : 'flex-wrap gap-y-1.5')}>
            {!showToday && !compact && headlineEl}
            {showToday && !compact && <span className="flex-1" />}
            <div className="flex min-w-0 items-center gap-x-3">
              <SegmentTabs segment={segment} onChange={setSegment} compact={compact} />
              {compact && <span className="flex-1" />}
              {!showToday && (
                <>
                  <span className="font-mono text-[0.733rem] tabular text-muted-foreground" title={`Checked ${checkedClock}`}>
                    {checkedClock}
                  </span>
                  <button type="button" onClick={onRefresh} className={cn('shell-chip shrink-0', compact && 'min-h-11')}>
                    Refresh
                  </button>
                </>
              )}
            </div>
            {!showToday && compact && headlineEl}
          </div>
          {!showToday && gaps.length > 0 && (
            <p className="m-0 max-w-[90ch] text-[0.8rem] leading-normal text-muted-foreground">{gaps.join(' ')}</p>
          )}
          {disconnectedSince !== null && (
            <p className="cockpit-note m-0 mt-1" role="status">
              <Clocked text={`Not connected since ${formatClock(disconnectedSince)}. Showing the last known state.`} />
            </p>
          )}
        </header>

        {showToday ? (
          <TodayView
            active={active}
            compact={compact}
            now={now}
            tasks={tasks}
            crons={crons}
            sources={effectiveSources}
            sessions={sessions}
            agentStatus={agentStatus}
            busyState={busyState}
            needsReply={needsReply}
            agentNames={agentNames}
            replies={replies}
            disconnectedSince={disconnectedSince}
            onOpen={onOpen}
            onRefresh={onRefresh}
            refreshSignal={refreshSignal}
          />
        ) : (
          <>
            <div className={cn('attention-grid flex-1 items-start', compact ? 'pb-4' : 'pb-6')}>
              <div className={cn('flex min-w-0 flex-col', compact ? 'gap-5' : 'gap-7')}>
                {allClear ? allClearBlock : (
                  <>
                    {failingSection}
                    {decideSection}
                  </>
                )}
              </div>
              <div className={cn('flex min-w-0 flex-col', compact ? 'gap-5' : 'gap-7')}>
                {agentsSection}
                {sinceSection}
              </div>
            </div>
            {/* The Ask box docks at the bottom of the work column, like the chat composer. */}
            <div className="attention-grid pointer-events-none sticky bottom-0 z-20">
              <div className={cn('pointer-events-auto bg-background', compact ? 'px-3 pb-3 pt-2' : 'pb-4 pt-2')}>
                <AskBox
                  config={replies}
                  target={askTarget}
                  loading={sessionsLoading && connected}
                  compact={compact}
                  onOpen={onOpen}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Now | Today: a small tab control on the heading row, not a full-width switch. */
function SegmentTabs({
  segment,
  onChange,
  compact,
}: {
  segment: AttentionSegment;
  onChange: (segment: AttentionSegment) => void;
  compact: boolean;
}) {
  const option = (value: AttentionSegment, label: string) => (
    <button
      type="button"
      aria-pressed={segment === value}
      data-active={segment === value}
      onClick={() => onChange(value)}
      className={cn('shell-chip', compact && 'min-h-[44px]! px-3!')}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Attention view" className="seg-track shrink-0">
      {option('now', 'Now')}
      {option('today', 'Today')}
    </div>
  );
}

function Section({
  id,
  title,
  count,
  countLabel,
  countTitle,
  aside,
  compact,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  countLabel?: string;
  /** How the section is ordered, on hover over the count. */
  countTitle?: string;
  aside?: React.ReactNode;
  compact: boolean;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <div className={cn('flex flex-wrap items-center gap-x-2 border-b border-border', compact ? 'min-h-11 px-4' : 'min-h-7')}>
        <h2 id={id} className="m-0 text-[0.867rem] font-semibold text-foreground">{title}</h2>
        {count !== undefined && (
          <span data-testid={`${id}-count`} title={countTitle} className="font-mono text-[0.8rem] tabular text-muted-foreground">
            {countLabel ? `${count} ${countLabel}` : count}
          </span>
        )}
        <span className="flex-1" />
        {aside}
      </div>
      {children}
    </section>
  );
}

function EmptyLine({ compact, hidden, children }: { compact: boolean; hidden: boolean; children: React.ReactNode }) {
  if (hidden) return null;
  return <p className={cn('m-0 text-[0.867rem] text-muted-foreground', compact && 'px-4')}>{children}</p>;
}

/** Sources that keep a section from being trusted as empty: loading, unreadable, or (for decisions) off. */
function hasNotes(sources: AttentionSources, section: SectionId): boolean {
  return SECTION_SOURCES[section].some((source) => {
    const status = statusOf(sources, source);
    if (source === 'approvals' && status.state === 'off') return false;
    return status.state === 'loading' || status.state === 'error' || (section === 'decide' && status.state === 'off');
  });
}

function SectionNotes({
  sources,
  relevant,
  showOff,
  compact,
  onOpen,
}: {
  sources: AttentionSources;
  relevant: AttentionSource[];
  showOff: boolean;
  compact: boolean;
  onOpen: (target: OpenTarget) => void;
}) {
  const tasksOff = sources.tasks.state === 'off';
  const errors = relevant.filter((source) => {
    const status = statusOf(sources, source);
    return status.state === 'error' && status.error !== NOT_CONNECTED;
  });
  const loading = relevant.filter((source) => (
    statusOf(sources, source).state === 'loading' && !(source === 'proposals' && tasksOff)
  ));
  const off = showOff && tasksOff;
  if (errors.length === 0 && loading.length === 0 && !off) return null;

  return (
    <div className={cn('flex flex-col gap-1 text-[0.867rem] text-muted-foreground', compact && 'px-4')}>
      {errors.map((source) => {
        const error = statusOf(sources, source).error?.trim();
        const panel = source === 'crons' ? 'crons' : source === 'tasks' || source === 'proposals' ? 'tasks' : null;
        return (
          <p key={source} className="m-0 flex flex-wrap items-center gap-x-2">
            <span className="text-foreground">
              {error ? `${SOURCE_NAMES[source]} could not be read (${error}).` : `${SOURCE_NAMES[source]} could not be read.`}
            </span>
            {panel && (
              <button
                type="button"
                onClick={() => onOpen({ type: 'source', source: panel })}
                className={variantClass('text', compact)}
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
