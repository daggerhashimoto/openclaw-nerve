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
 * Actions apply at once and send when their undo window closes (deferredActions): the item
 * turns into a one-line receipt in its own place, focus moves to the next item, and the request
 * goes out after the window, or at once when the page is hidden. A sent item stays out of sight
 * until its source has answered again; what was handled is listed at the bottom of Now.
 *
 * Triage by keyboard (useBoardKeys) moves over Failing, Waiting on you and the Agents strip in
 * board order. Items that arrive mid-look wait behind a "2 new · Show" pill (arrivals), and only
 * one note or reply field is open at a time (triage). Today stays mounted once shown.
 *
 * Order is frozen per epoch (useStableOrder). An epoch starts once per activation or Refresh,
 * and only after every enabled source has answered since then, so a cold load ranks the real
 * data and a reopen does not baseline on the answers left over from the last look. Approvals
 * are pinned first; the Start here plate keeps its item for the epoch while it is still there.
 *
 * The Now | Today choice is remembered per browser (attentionSegment).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useGateway } from '@/contexts/GatewayContext';
import { useSessionContext } from '@/contexts/SessionContext';
import { getSessionAgentId, getTopLevelAgentSessions, isPlaceholderIdentityName, isTopLevelAgentSessionKey } from '@/features/sessions/sessionKeys';
import { useAgentHues } from '@/lib/agentColors';
import { cn } from '@/lib/utils';
import { getSessionKey } from '@/types';
import { addSeen, readLastLook, readSeen, writeLastLook } from './attentionStorage';
import { buildAttention, FIRST_RUN_WINDOW_MS } from './buildAttention';
import { buildAgents } from './buildAgents';
import { checkedAt as checkedAtOf, failingItems, formatClock, gapSentences, headline, kindWord, NOT_CONNECTED, reasonFor } from './briefCopy';
import { StartHerePlate } from './AttentionCard';
import { AttentionRow } from './AttentionRow';
import { AgentsStrip } from './AgentsStrip';
import { agentNavKey } from './itemCommands';
import { placeArrivals } from './arrivals';
import { receiptText, useDeferredActions, type ActionSender, type PendingAction } from './deferredActions';
import { HandledList, ReceiptLine } from './Receipts';
import { ShortcutsPanel } from './ShortcutsPanel';
import { createComposer, findNavItem, focusNavItem, TriageProvider, type CommandHandler, type ItemCommand, type Triage } from './triage';
import { KeyHint } from './KeyHint';
import { useBoardKeys } from './useBoardKeys';
import { Clocked } from './textBits';
import { AskBox, type AskTarget, type ReplyConfig } from './AttentionReply';
import { variantClass } from './actionStyles';
import type { ItemView } from './itemPresentation';
import { useAttentionSources } from './useAttentionSources';
import { useStableOrder, type StableOrder } from './useStableOrder';
import { postAction, type ActionId, type AttentionActionsConfig } from './useAttentionActions';
import { useInlineReplies, type InlineReply } from './useInlineReplies';
import { useAttentionSummaries } from './useAttentionSummaries';
import { useAttentionSegment, type AttentionSegment } from './attentionSegment';
import { useExecApprovals } from './execApprovals';
import { KIND_WORD } from './itemPresentation';
import { TodayView } from './today/TodayView';
import { dayHeading } from './today/dayHeading';
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

/**
 * The source has answered since `at`. A sent item stays out of sight until then, so it does not
 * flash back before the refresh drops it, and an action that changed nothing shows it again.
 */
function answeredSince(status: SourceStatus, at: number): boolean {
  if (status.state === 'loading') return false;
  if (status.state !== 'live') return true;
  return (status.checkedAt ?? 0) > at;
}

/** The board's item keys inside `selector`, in board order. */
function navKeysIn(root: HTMLElement | null, selector: string): string[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(`${selector} [data-nav-key]`)].map((el) => el.dataset.navKey ?? '');
}

/** Repeated words are told again: a trailing no-break space makes the region's text change. */
function nextAnnouncement(previous: string, text: string): string {
  return previous === text ? `${text}\u00a0` : text;
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
 * pointer. When the plate's item leaves (or waits in its undo window), the next decision takes
 * it; `prefer` gives it back to an item whose action was undone.
 */
function usePlateKey(keys: string[], epoch: number | string, prefer: string | null): string | undefined {
  const [state, setState] = useState<{ epoch: number | string; key: string | undefined }>(() => ({ epoch, key: keys[0] }));
  let current = state;
  if (prefer !== null && state.key !== prefer && keys.includes(prefer)) {
    current = { epoch, key: prefer };
  } else if (state.epoch !== epoch || state.key === undefined || !keys.includes(state.key)) {
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
  const decideNew = useMemo(() => new Set([...approvalOrder.newKeys, ...decisionOrder.newKeys]), [approvalOrder, decisionOrder]);
  const blocked = useStableOrder(brief.blocked, currentEpoch);
  const finished = useStableOrder(brief.finished, currentEpoch);

  // Deferred sends. The sender always uses the current socket.
  const rpc = gateway.rpc;
  const sendAction = useCallback<ActionSender>(
    (item, action, note, { keepalive }) => postAction(item, action, note, rpc, { keepalive }),
    [rpc],
  );
  const deferred = useDeferredActions(sendAction);
  useSyncExternalStore(deferred.subscribe, deferred.version);
  const pendingOf = (item: AttentionItem) => deferred.pendingOf(item.key);

  const statusFor = (source: AttentionSource): SourceStatus => (
    source === 'approvals' ? approvals.status : source === 'sessions' ? SESSIONS_LIVE : polled[source]
  );
  // Sent items stay out of sight until their source answers again.
  const isHidden = (item: AttentionItem) => {
    const sent = deferred.sentOf(item.key);
    return Boolean(sent) && !answeredSince(statusFor(item.source), sent!.at);
  };

  // New arrivals wait behind the pill until shown, except in a section with nothing else in it.
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const holding = !hideNew;
  const heldOf = (items: AttentionItem[], newKeys: ReadonlySet<string>) => (
    holding ? items.filter((item) => newKeys.has(item.key) && !revealed.has(item.key) && !isHidden(item)).map((item) => item.key) : []
  );
  const settledCount = (items: AttentionItem[], newKeys: ReadonlySet<string>) => items.filter((item) => (
    !(newKeys.has(item.key) && !revealed.has(item.key)) && !isHidden(item) && !pendingOf(item)
  )).length;
  const failingStable = failingItems(blocked.items);
  const decideStable = [...approvalOrder.items, ...decisionOrder.items];
  let heldFailing = heldOf(failingStable, blocked.newKeys);
  let heldDecide = heldOf(decideStable, decideNew);
  const autoReveal = [
    ...(heldFailing.length > 0 && settledCount(failingStable, blocked.newKeys) === 0 ? heldFailing : []),
    ...(heldDecide.length > 0 && settledCount(decideStable, decideNew) === 0 ? heldDecide : []),
  ];
  if (autoReveal.length > 0) {
    const next = new Set([...revealed, ...autoReveal]);
    setRevealed(next);
    heldFailing = heldFailing.filter((key) => !next.has(key));
    heldDecide = heldDecide.filter((key) => !next.has(key));
  }
  const held = new Set([...heldFailing, ...heldDecide]);
  const heldCount = held.size;

  const visible = (items: AttentionItem[]) => items.filter((item) => !isHidden(item));
  // While the epoch still waits for its answers nothing is held, and the frozen order stands.
  const place = (stable: AttentionItem[], ranked: AttentionItem[], newKeys: ReadonlySet<string>) => (
    holding ? placeArrivals(stable, ranked, newKeys, held) : stable
  );
  const decide = visible([
    ...place(approvalOrder.items, approvalItems, approvalOrder.newKeys),
    ...place(decisionOrder.items, otherDecisions, decisionOrder.newKeys),
  ]);
  const failing = visible(failingItems(place(blocked.items, brief.blocked, blocked.newKeys)));
  const finishedItems = visible(finished.items);
  const actionable = (items: AttentionItem[]) => items.filter((item) => !pendingOf(item));
  const [preferPlate, setPreferPlate] = useState<string | null>(null);
  const plateKey = usePlateKey(actionable(decide).map((item) => item.key), decideEpoch, preferPlate);

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

  // The one polite live region: what an action did and what is next, a reply that came in.
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((text: string) => setAnnouncement((prev) => nextAnnouncement(prev, text)), []);

  // Focus moves after the render that changed the board: to an item by key, else a heading.
  const rootRef = useRef<HTMLDivElement>(null);
  // `leaving`: the item that is going; the one after it (in the last render's order) takes focus.
  const focusRequest = useRef<{ key?: string; leaving?: string; fallback: string[] } | null>(null);
  const renderedWork = useRef<string[]>([]);
  const lastNav = useRef<{ key: string; index: number } | null>(null);
  // Items whose action was taken from the plate: their receipt sits above it, and Undo gives it back.
  const [plateCommitted, setPlateCommitted] = useState<ReadonlySet<string>>(() => new Set());
  const dropPlateCommit = useCallback((key: string) => {
    setPlateCommitted((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  // After a send the sources are fetched again without a new epoch, so the rest of the board
  // keeps its order and only the acted-on item moves or leaves. An answered approval goes at once.
  const reloadApprovals = approvals.reload;
  const forgetApproval = approvals.forget;
  useEffect(() => {
    deferred.setEvents({
      onSent: (entry) => {
        dropPlateCommit(entry.key);
        if (entry.item.kind === 'approval') {
          forgetApproval(entry.item.sourceId);
          reloadApprovals();
        } else {
          refresh();
        }
      },
      onFailed: (entry, error) => {
        dropPlateCommit(entry.key);
        announce(`${error.replace(/^(Could not [^:]+):/, `$1 ‘${entry.item.title}’:`)}`);
      },
    });
  }, [deferred, forgetApproval, reloadApprovals, refresh, announce, dropPlateCommit]);

  // Board order for the keys: Failing, then Waiting on you, then the Agents strip.
  const workItems = [...actionable(failing), ...actionable(decide)];

  // An action entered its undo window: focus goes to the next item and the region says so.
  const commitNow = (item: AttentionItem, action: ActionId) => {
    const root = rootRef.current;
    const current = document.activeElement instanceof Element ? document.activeElement.closest<HTMLElement>('[data-nav-key]') : null;
    if (plateKey === item.key) setPlateCommitted((prev) => new Set([...prev, item.key]));
    // An earlier Undo's claim on the plate ends with the next action.
    setPreferPlate(null);
    // An agent line stays when its run is stopped; focus stays on it.
    if (current && current.dataset.navKey !== item.key && current.dataset.navKey?.startsWith('agent:')) {
      focusRequest.current = { key: current.dataset.navKey, fallback: [] };
      announce(`${receiptText(action, item.title)}. Undo with u.`);
      return;
    }
    const keys = navKeysIn(root, '[data-nav-group="work"]');
    const index = keys.indexOf(item.key);
    const nextKey = index >= 0 ? keys.slice(index + 1)[0] : undefined;
    const section = item.section === 'blocked' ? 'attention-failing' : 'attention-decide';
    focusRequest.current = { key: nextKey, fallback: [section, 'attention-headline'] };
    const left = workItems.filter((other) => other.key !== item.key);
    const next = nextKey ? left.find((other) => other.key === nextKey) : left[0];
    const rest = next
      ? `${left.length} left, next: ${kindWord(next)}, ${next.title}.`
      : 'Nothing else waiting.';
    announce(`${receiptText(action, item.title)}. ${rest}`);
  };
  // Not memoized: every item re-renders with the board anyway, and the handlers read the latest board.
  const actions: AttentionActionsConfig = {
    kanbanEnabled,
    rpc: gateway.rpc,
    connected,
    deferred,
    onCommit: commitNow,
    onDone: (item) => {
      if (item.kind === 'approval') reloadApprovals();
      else refresh();
    },
  };

  // Today's rows stay in place during the window (their button gives way to Undo), so its
  // actions only say what happened; focus stays where it is.
  const todayActions: AttentionActionsConfig = {
    ...actions,
    onCommit: (item, action) => announce(`${receiptText(action, item.title)}. Undo with u.`),
  };

  const replyStore = useInlineReplies();
  const connecting = connectionState === 'connecting' || connectionState === 'reconnecting';
  const nameOfSession = useCallback((key: string) => {
    const id = getSessionAgentId(key);
    const name = id ? agentNames.get(id) : undefined;
    return name && !isPlaceholderIdentityName(name) ? name : id ?? undefined;
  }, [agentNames]);
  const replies = useMemo<ReplyConfig>(
    () => ({
      store: replyStore,
      connected,
      connecting,
      nameOf: nameOfSession,
    }),
    [replyStore, connected, connecting, nameOfSession],
  );
  const askTarget: AskTarget | null = mainKey
    ? { sessionKey: mainKey, name: mainName, hue: mainId ? hueFor(mainId) : undefined }
    : null;

  // "Kim replied": a reply that finishes is told once, wherever it was asked from.
  const replyNames = useRef({ nameOf: nameOfSession, mainKey, mainName });
  useEffect(() => {
    replyNames.current = { nameOf: nameOfSession, mainKey, mainName };
  });
  useEffect(() => {
    const statuses = new Map<string, InlineReply['status']>();
    return replyStore.subscribe(() => {
      const keys = replyStore.keys();
      for (const key of [...statuses.keys()]) if (!keys.includes(key)) statuses.delete(key);
      for (const key of keys) {
        const status = replyStore.get(key)?.status;
        const before = statuses.get(key);
        if (!status || status === before) continue;
        statuses.set(key, status);
        if (before === 'working' && status === 'done') {
          const names = replyNames.current;
          const name = key === names.mainKey ? names.mainName : names.nameOf(key);
          announce(`${name ?? 'The agent'} replied`);
        }
      }
    });
  }, [replyStore, announce]);

  const markSeen = useCallback((items: AttentionItem[]) => {
    setSeen(addSeen(items.map((item) => item.key)));
  }, []);

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
  const seenFailing = failingItems(brief.seen.blocked);

  // Mark seen is immediate; focus goes on to the next item as with an action.
  const markSeenItem = useCallback((item: AttentionItem) => markSeen([item]), [markSeen]);
  const markOneSeen = (item: AttentionItem) => {
    focusRequest.current = { leaving: item.key, fallback: ['attention-failing', 'attention-headline'] };
    markSeen([item]);
  };

  // Summaries for the plate and every open row, read lazily. Asked again on Refresh, when an
  // item's event changes, and when a reply in one of the sessions finishes.
  const summaryEntries: string[] = [];
  for (const item of [plate, ...[...failing, ...rows, ...finishedItems, ...brief.seen.finished, ...seenFailing].filter((entry) => expanded.has(entry.key))]) {
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

  // Keyboard: which item the keys act on, and whether its keycaps show.
  const [navKey, setNavKey] = useState<string | null>(null);
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const hintKey = keyboardMode && !compact ? navKey : null;
  const registry = useRef(new Map<string, CommandHandler>());
  const register = useCallback((key: string, handler: CommandHandler) => {
    registry.current.set(key, handler);
    return () => {
      if (registry.current.get(key) === handler) registry.current.delete(key);
    };
  }, []);
  const [composer] = useState(() => createComposer((key) => { focusNavItem(document, key); }));

  const undo = (key?: string) => {
    const entry: PendingAction | null = deferred.undo(key);
    if (!entry) {
      if (key === undefined) announce('Nothing to undo.');
      return;
    }
    if (plateCommitted.has(entry.key)) {
      dropPlateCommit(entry.key);
      setPreferPlate(entry.key);
    }
    if (entry.action === 'request-changes' && entry.note) composer.setDraft(entry.key, 'note', entry.note);
    const line = agents.find((candidate) => candidate.stopItem?.key === entry.key);
    focusRequest.current = { key: line ? agentNavKey(line) : entry.key, fallback: [] };
    announce(`Undone. ‘${entry.item.title}’ is back.`);
  };

  const triage: Triage = { composer, register, hintKey, undo };

  const showNew = () => {
    if (heldCount === 0) return;
    setRevealed((prev) => new Set([...prev, ...held]));
    announce(heldCount === 1 ? 'Showing 1 new item.' : `Showing ${heldCount} new items.`);
  };

  useBoardKeys({
    active,
    nowShown: !showToday,
    rootRef,
    handlers: {
      move: (delta) => {
        const root = rootRef.current;
        if (!root) return;
        const items = [...root.querySelectorAll<HTMLElement>('[data-nav-key]')];
        if (items.length === 0) return;
        const current = document.activeElement instanceof Element ? document.activeElement.closest<HTMLElement>('[data-nav-key]') : null;
        const index = current ? items.indexOf(current) : -1;
        const next = index === -1
          ? (delta === 1 ? items[0] : items[items.length - 1])
          : items[Math.min(items.length - 1, Math.max(0, index + delta))];
        const key = next.dataset.navKey;
        if (key && focusNavItem(root, key)) {
          next.scrollIntoView?.({ block: 'nearest' });
        }
      },
      command: (command: ItemCommand) => {
        const current = document.activeElement instanceof Element ? document.activeElement.closest<HTMLElement>('[data-nav-key]') : null;
        const key = current?.dataset.navKey;
        if (!key) return false;
        return registry.current.get(key)?.(command) ?? false;
      },
      undo: () => undo(),
      showNew,
      focusAsk: () => rootRef.current?.querySelector<HTMLElement>('[data-ask-input]')?.focus(),
      toggleHelp: () => setHelpOpen((value) => !value),
      closeHelp: () => {
        if (!helpOpen) return false;
        setHelpOpen(false);
        return true;
      },
      switchTo: (next) => setSegment(next),
      usedKeyboard: () => setKeyboardMode(true),
    },
  });

  // Apply a focus move once the board has rendered it; when the focused item left on its own
  // (a refresh dropped it), the item now in its place takes focus.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const before = renderedWork.current;
    renderedWork.current = navKeysIn(root, '[data-nav-group="work"]');
    const request = focusRequest.current;
    if (request) {
      focusRequest.current = null;
      if (request.key && focusNavItem(root, request.key)) return;
      if (request.leaving) {
        const after = before.slice(before.indexOf(request.leaving) + 1);
        const next = after.find((key) => renderedWork.current.includes(key));
        if (next && focusNavItem(root, next)) return;
      }
      for (const id of request.fallback) {
        const el = document.getElementById(id);
        if (el && root.contains(el)) {
          el.focus();
          if (document.activeElement === el) return;
        }
      }
      return;
    }
    const last = lastNav.current;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (last && lost && !findNavItem(root, last.key)) {
      const items = [...root.querySelectorAll<HTMLElement>('[data-nav-group="work"] [data-nav-key]')];
      const next = items[Math.min(last.index, items.length - 1)];
      lastNav.current = null;
      if (next?.dataset.navKey) focusNavItem(root, next.dataset.navKey);
    }
  });

  // Which item has focus, for the keys and the keycap hints; cleared when focus leaves the board.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const root = rootRef.current;
      const target = event.target instanceof Element ? event.target : null;
      if (!root || !target || !root.contains(target)) {
        lastNav.current = null;
        setNavKey(null);
        return;
      }
      const item = target.closest<HTMLElement>('[data-nav-key]');
      const key = item?.dataset.navKey ?? null;
      setNavKey(key);
      if (item && key) {
        const work = [...root.querySelectorAll<HTMLElement>('[data-nav-group="work"] [data-nav-key]')];
        lastNav.current = { key, index: Math.max(0, work.indexOf(item)) };
      } else {
        lastNav.current = null;
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  // Today mounts on its first showing and then stays, so its open rows and drafts survive a
  // switch; each half keeps its own scroll place in the shared scroller.
  const [todayMounted, setTodayMounted] = useState(showToday);
  if (showToday && !todayMounted) setTodayMounted(true);
  const scrollBySegment = useRef<Record<AttentionSegment, number>>({ now: 0, today: 0 });
  const segmentRef = useRef(segment);
  useLayoutEffect(() => {
    if (segmentRef.current === segment) return;
    segmentRef.current = segment;
    const root = rootRef.current;
    if (root) root.scrollTop = scrollBySegment.current[segment];
  }, [segment]);

  const receiptFor = (entry: PendingAction, className?: string) => (
    <ReceiptLine key={`receipt:${entry.key}`} entry={entry} compact={compact} onUndo={undo} hints={keyboardMode && !compact} className={className} />
  );

  const renderRows = (
    items: AttentionItem[],
    order: StableOrder | { newKeys: ReadonlySet<string> } | undefined,
    // `seen`: per-row Mark seen; on board items it also moves focus on.
    options: { seen?: boolean; placement?: 'row' | 'detail'; history?: boolean; nav?: boolean } = {},
  ) => (
    <div className={compact ? 'flex flex-col' : 'flex flex-col gap-0.5'}>
      {items.map((item) => {
        const entry = options.nav ? pendingOf(item) : undefined;
        if (entry) return receiptFor(entry);
        return (
          <AttentionRow
            key={item.key}
            item={item}
            view={viewOf(item, order?.newKeys)}
            now={now}
            compact={compact}
            open={expanded.has(item.key)}
            onToggle={toggle}
            onOpen={onOpen}
            onMarkSeen={options.seen ? (options.nav ? markOneSeen : markSeenItem) : undefined}
            markSeenPlacement={options.placement}
            actions={actions}
            replies={replies}
            summary={expanded.has(item.key) ? summaryOf(item) : undefined}
            history={options.history}
            nav={options.nav}
          />
        );
      })}
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

  const failingLive = actionable(failing);
  const failingSection = (failing.length > 0 || seenFailing.length > 0 || hasNotes(effectiveSources, 'failing')) && (
    <Section
      id="attention-failing"
      title="Failing"
      count={failingLive.length}
      compact={compact}
      aside={failingLive.length > 1 ? (
        <button type="button" onClick={() => markSeen(failingLive)} className={cn(variantClass('text', compact), 'text-[0.8rem]')}>
          Mark all seen
        </button>
      ) : undefined}
    >
      {notes('failing')}
      {failing.length > 0 && (
        <div data-nav-group="work">
          {renderRows(failing, blocked, { seen: true, placement: compact ? 'detail' : 'row', nav: true })}
        </div>
      )}
      <SeenLine items={seenFailing} compact={compact} render={(items) => renderRows(items, undefined)} />
    </Section>
  );

  // A receipt for the plate's item sits above the plate that moved on; the rest keep their place.
  const plateReceipts = rows.filter((item) => pendingOf(item) && plateCommitted.has(item.key));
  const rowItems = rows.filter((item) => !plateReceipts.includes(item));
  const decideLive = actionable(decide);
  const decideSection = (
    <Section
      id="attention-decide"
      title="Waiting on you"
      count={decideLive.length}
      countTitle={RANKED}
      compact={compact}
    >
      {notes('decide')}
      <div data-nav-group="work" className="flex flex-col gap-2">
        {plateReceipts.length > 0 && (
          <div className="flex flex-col">
            {plateReceipts.map((item) => receiptFor(pendingOf(item)!))}
          </div>
        )}
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
        {rowItems.length > 0 && renderRows(rowItems, { newKeys: decideNew }, { nav: true })}
      </div>
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
  const finishedCount = finishedItems.length;
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
          <button type="button" onClick={() => markSeen(finishedItems)} className={cn(variantClass('text', compact), 'text-[0.8rem]')}>
            Mark all seen
          </button>
        )}
      </div>
      {notes('finished')}
      {sinceOpen && finishedCount > 0 && (
        <div id="attention-since-list">
          {renderRows(finishedItems, finished, { seen: true, placement: 'row', history: true })}
        </div>
      )}
      <SeenLine items={brief.seen.finished} compact={compact} render={(items) => renderRows(items, undefined, { history: true })} />
    </section>
  );

  // The heading counts what still waits: an item in its undo window, or sent and not yet
  // re-read, is not counted. Arrivals behind the pill are, since they are real.
  const counted = (items: AttentionItem[]) => items.filter((item) => !pendingOf(item) && !isHidden(item));
  const { parts, text: headlineText } = headline({ ...brief, decide: counted(brief.decide), blocked: counted(brief.blocked) }, working);
  // Today shares the header row: its date takes the place of Now's counts.
  const todayHeadlineEl = (
    <h1 className={cn('m-0 min-w-0 flex-1 font-semibold leading-tight text-foreground', compact ? 'text-[1.133rem]' : 'text-[1.2rem]')}>
      {dayHeading(now)}
    </h1>
  );

  const headlineEl = (
    <h1
      id="attention-headline"
      data-testid="attention-headline"
      tabIndex={-1}
      aria-label={headlineText}
      className={cn('m-0 min-w-0 flex-1 font-semibold leading-tight text-foreground outline-none', compact ? 'text-[1.133rem]' : 'text-[1.2rem]')}
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
  const handled = deferred.handled();

  return (
    <div
      ref={rootRef}
      className="attention-board h-full min-h-0 overflow-y-auto overscroll-contain bg-background"
      data-compact={compact}
      onScroll={(event) => {
        scrollBySegment.current[segment] = event.currentTarget.scrollTop;
      }}
      onPointerDown={() => {
        // A click elsewhere ends keyboard triage; focus moves made by the pointer are its own.
        lastNav.current = null;
        if (keyboardMode) setKeyboardMode(false);
      }}
    >
      <TriageProvider value={triage}>
        <div className={cn('mx-auto flex min-h-full w-full max-w-[1320px] flex-col', !compact && 'px-7')}>
          <header className={cn('flex flex-col gap-1', compact ? 'px-4 pb-3 pt-3' : 'pb-5 pt-4')}>
            {/* Desk: counts, tabs, time and Refresh on one row. Phone: the controls on one row and
                the counts on their own line under them, so nothing is cut at 390px. */}
            <div className={cn('flex min-w-0 items-center gap-x-3', compact ? 'flex-col items-stretch gap-y-2' : 'flex-wrap gap-y-1.5')}>
              {!compact && (showToday ? todayHeadlineEl : headlineEl)}
              <div className="flex min-w-0 items-center gap-x-3">
                <SegmentTabs segment={segment} onChange={setSegment} compact={compact} />
                {compact && <span className="flex-1" />}
                {!showToday && (
                  <span className="font-mono text-[0.733rem] tabular text-muted-foreground" title={`Checked ${checkedClock}`}>
                    {checkedClock}
                  </span>
                )}
                <button type="button" onClick={onRefresh} className={cn('shell-chip shrink-0', compact && 'min-h-11')}>
                  Refresh
                </button>
                {!compact && (
                  <button
                    type="button"
                    aria-label="Keyboard shortcuts"
                    aria-expanded={helpOpen}
                    onClick={() => setHelpOpen((value) => !value)}
                    className="shell-chip shrink-0 px-1.5!"
                  >
                    <kbd className="cockpit-kbd">?</kbd>
                  </button>
                )}
              </div>
              {compact && (showToday ? todayHeadlineEl : headlineEl)}
            </div>
            {!showToday && heldCount > 0 && (
              <button
                type="button"
                data-testid="attention-new-pill"
                onClick={showNew}
                className={cn('shell-chip mt-1 self-start', compact && 'min-h-11')}
              >
                <span className="font-mono tabular text-foreground">{heldCount}</span>
                {' new · Show'}
                <KeyHint show={keyboardMode && !compact} k="n" />
              </button>
            )}
            {!showToday && gaps.length > 0 && (
              <p className="m-0 max-w-[90ch] text-[0.8rem] leading-normal text-muted-foreground">{gaps.join(' ')}</p>
            )}
            {disconnectedSince !== null && (
              <p className="cockpit-note m-0 mt-1" role="status">
                <Clocked text={`Not connected since ${formatClock(disconnectedSince)}. Showing the last known state.`} />
              </p>
            )}
            {helpOpen && (
              <div className="mt-2">
                <ShortcutsPanel compact={compact} onClose={() => setHelpOpen(false)} />
              </div>
            )}
          </header>

          {todayMounted && (
            <div data-testid="attention-today-pane" className={cn('flex flex-1 flex-col', !showToday && 'hidden')}>
              <TodayView
                active={active && showToday}
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
                actions={todayActions}
                hideHeading
              />
            </div>
          )}
          <div data-testid="attention-now-pane" className={cn('flex flex-1 flex-col', showToday && 'hidden')}>
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
            {handled.length > 0 && (
              <div className={cn('attention-grid', compact ? 'pb-4' : 'pb-6')}>
                <HandledList receipts={handled} compact={compact} />
              </div>
            )}
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
          </div>
          <div role="status" aria-live="polite" aria-atomic="true" data-testid="attention-announcer" className="sr-only">
            {announcement}
          </div>
        </div>
      </TriageProvider>
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
        {/* Focus lands here when the last item of the section leaves. */}
        <h2 id={id} tabIndex={-1} className="m-0 text-[0.867rem] font-semibold text-foreground outline-none">{title}</h2>
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
