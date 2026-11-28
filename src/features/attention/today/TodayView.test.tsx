import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanTask } from '@/features/kanban/types';
import type { CronJob } from '@/features/workspace/hooks/useCrons';
import type { Session } from '@/types';
import type { OpenTarget, SourceStatus } from '../types';
import type { ThreadSummary } from '../useAttentionSummaries';
import { setAttentionSegment } from '../attentionSegment';
import { AttentionView } from '../AttentionView';
import { createInlineReplies } from '../useInlineReplies';
import type { AttentionActionsConfig } from '../useAttentionActions';
import { TodayView, type TodayViewProps } from './TodayView';
import { TODAY_SECTIONS_KEY } from './todaySections';

const NOW = new Date(2026, 10, 28, 15, 0).getTime();
const HOUR = 3_600_000;
const at = (h: number, m = 0) => new Date(2026, 10, 28, h, m).getTime();
const SEGMENT_KEY = 'nerve:attention:segment';

type Polled = 'tasks' | 'proposals' | 'crons';

interface SourcesMock {
  tasks: KanbanTask[];
  proposals: never[];
  crons: CronJob[];
  sources: Record<Polled, SourceStatus>;
  refresh: () => void;
}

const sourcesMock = vi.fn<() => SourcesMock>();
const sessionMock = vi.fn(() => ({
  sessions: [] as Session[],
  sessionsLoading: false,
  agentStatus: {},
  busyState: {},
}));
const handlers = new Set<(event: { type: 'event'; event: string; payload: unknown }) => void>();
const rpc = vi.fn(async (method: string, params: Record<string, unknown>) => (
  method === 'chat.send' ? { runId: params.idempotencyKey, status: 'started' } : {}
));
const subscribe = vi.fn((handler: (event: { type: 'event'; event: string; payload: unknown }) => void) => {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
});
const gatewayMock = vi.fn(() => ({ connectionState: 'connected' as string, rpc, subscribe }));

interface SummariesArgs {
  active: boolean;
  sessionKeys: string[];
  signal: string;
}
const summariesMock = vi.fn<(args: SummariesArgs) => Record<string, ThreadSummary>>(() => ({}));

vi.mock('../useAttentionSummaries', () => ({
  useAttentionSummaries: (args: SummariesArgs) => summariesMock(args),
}));
vi.mock('../useAttentionSources', () => ({
  useAttentionSources: () => sourcesMock(),
}));
vi.mock('@/contexts/SessionContext', () => ({
  useSessionContext: () => sessionMock(),
}));
vi.mock('@/contexts/GatewayContext', () => ({
  useGateway: () => gatewayMock(),
}));

function task(overrides: Partial<KanbanTask> = {}): KanbanTask {
  const built: KanbanTask = {
    id: 't1',
    title: 'Fix the flaky retry test',
    status: 'done',
    priority: 'normal',
    assignee: 'agent:forge',
    createdBy: 'operator',
    createdAt: NOW - 20 * HOUR,
    updatedAt: at(14, 12),
    version: 1,
    labels: [],
    columnOrder: 0,
    feedback: [],
    result: 'Patched the retry backoff and reran the suite.',
    run: { sessionKey: 'agent:forge:main', startedAt: at(13), endedAt: at(14), status: 'done' },
    ...overrides,
  };
  // Fixtures pass their finish time as updatedAt; the store stamps completedAt on entering done.
  if (built.status === 'done' && !('completedAt' in overrides)) built.completedAt = built.updatedAt;
  return built;
}

function cron(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 'c1',
    name: 'Morning brief',
    enabled: true,
    scheduleKind: 'cron',
    payloadKind: 'agentTurn',
    lastStatus: 'ok',
    lastRun: new Date(at(7)).toISOString(),
    ...overrides,
  };
}

const live = (): SourceStatus => ({ state: 'live', checkedAt: NOW });

function setSources(overrides: Partial<SourcesMock> = {}) {
  const value: SourcesMock = {
    tasks: [],
    proposals: [],
    crons: [],
    sources: { tasks: live(), proposals: live(), crons: live() },
    refresh: vi.fn(),
    ...overrides,
  };
  sourcesMock.mockReturnValue(value);
  return value;
}

const FORGE_MAIN: Session = { key: 'agent:forge:main', identityName: 'Forge', updatedAt: at(14, 30) };
const SUBAGENT: Session = {
  key: 'agent:forge:subagent:fix',
  label: 'fix-retry',
  spawnedBy: 'agent:forge:main',
  status: 'done',
  endedAt: at(13, 40),
  updatedAt: at(13, 40),
};

function setSessions(sessions: Session[]) {
  sessionMock.mockReturnValue({ sessions, sessionsLoading: false, agentStatus: {}, busyState: {} });
}

interface FetchPlan {
  runs?: Record<string, unknown[] | 'fail'>;
  day?: { status: string; text?: string } | 'fail';
}

function stubFetch(plan: FetchPlan = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 502, json: async () => body });
    const runs = /^\/api\/crons\/([^/]+)\/runs$/.exec(url);
    if (runs) {
      const entries = plan.runs?.[decodeURIComponent(runs[1])] ?? [];
      if (entries === 'fail') return reply({ ok: false, error: 'gateway down' }, false);
      return reply({ ok: true, result: { entries } });
    }
    if (/^\/api\/crons\/[^/]+\/run$/.exec(url)) return reply({ ok: true });
    if (url === '/api/attention/day-summary') {
      if (plan.day === 'fail') return reply({}, false);
      return reply({ summary: plan.day ?? { status: 'error' } });
    }
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderView(props: Partial<Parameters<typeof AttentionView>[0]> = {}) {
  const onOpen = vi.fn<(target: OpenTarget) => void>();
  const all = { active: true, compact: false, kanbanEnabled: true, onOpen, ...props };
  const utils = render(<AttentionView {...all} />);
  return { ...utils, onOpen };
}

function openToday() {
  fireEvent.click(screen.getByRole('button', { name: 'Today' }));
}

function section(name: string) {
  return screen.getByRole('heading', { level: 2, name: new RegExp(`^${name}`) }).closest('section') as HTMLElement;
}

function rowFor(text: string) {
  return [...screen.queryAllByTestId('today-row'), ...screen.queryAllByTestId('today-chat'), ...screen.queryAllByTestId('today-cron-ok-row')]
    .find((row) => row.textContent?.includes(text)) as HTMLElement;
}

/** The row's own block: its toggle, its open detail and its reply. */
function blockOf(row: HTMLElement) {
  return (row.closest('[data-testid="today-chat-row"]') ?? row.closest('[data-testid="today-failing"]') ?? row.parentElement) as HTMLElement;
}

const NAMES = new Map([['main', 'Kim'], ['forge', 'Forge'], ['linus', 'Linus']]);
const LIVE_SOURCES = { tasks: live(), crons: live(), sessions: live() };

/** Today on its own, as the Attention view hands it its data. */
function Harness(props: Partial<TodayViewProps>) {
  const [store] = useState(() => createInlineReplies({ rpc, subscribe } as unknown as Parameters<typeof createInlineReplies>[0]));
  const replies = {
    store,
    connected: true,
    connecting: false,
    nameOf: (key: string) => NAMES.get(key.split(':')[1]) ?? key.split(':')[1],
  };
  return (
    <TodayView
      active
      compact={false}
      now={NOW}
      tasks={[]}
      crons={[]}
      sources={LIVE_SOURCES}
      sessions={[]}
      agentStatus={{}}
      busyState={{}}
      needsReply={new Map()}
      agentNames={NAMES}
      replies={replies}
      disconnectedSince={null}
      onOpen={() => {}}
      onRefresh={() => {}}
      refreshSignal={0}
      {...props}
    />
  );
}

function renderToday(props: Partial<TodayViewProps> = {}) {
  const onOpen = vi.fn<(target: OpenTarget) => void>();
  const onRefresh = vi.fn();
  const all = { onOpen, onRefresh, ...props };
  const utils = render(<Harness {...all} />);
  return { ...utils, onOpen, onRefresh, rerenderToday: (next: Partial<TodayViewProps>) => utils.rerender(<Harness {...all} {...next} />) };
}

const summaries = (map: Record<string, ThreadSummary>) => (args: SummariesArgs) => (
  Object.fromEntries(args.sessionKeys.filter((key) => map[key]).map((key) => [key, map[key]]))
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  handlers.clear();
  rpc.mockClear();
  setSessions([]);
  gatewayMock.mockReturnValue({ connectionState: 'connected', rpc, subscribe });
  summariesMock.mockReset();
  summariesMock.mockImplementation(() => ({}));
  stubFetch();
});

afterEach(() => {
  setAttentionSegment('now');
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Now | Today switch', () => {
  it('opens on Now, remembers Today across mounts, and goes back', () => {
    setSources({ tasks: [task({ status: 'review' })] });
    const first = renderView();
    expect(screen.getByRole('button', { name: 'Now' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Waiting on you' })).toBeInTheDocument();

    openToday();
    expect(localStorage.getItem(SEGMENT_KEY)).toBe('today');
    expect(screen.getByRole('heading', { level: 1, name: 'Today, Sat 28 Nov' })).toBeInTheDocument();
    // Whether Now stays mounted behind Today is the view's business; the tabs say which shows.
    expect(screen.getByRole('button', { name: 'Now' })).toHaveAttribute('aria-pressed', 'false');
    first.unmount();

    renderView();
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { level: 2, name: /^Done today/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Now' }));
    expect(localStorage.getItem(SEGMENT_KEY)).toBe('now');
    expect(screen.getByRole('heading', { level: 2, name: 'Waiting on you' })).toBeInTheDocument();
  });

  it('follows a request from outside the view, as the palette sends', () => {
    setSources();
    renderView();
    act(() => setAttentionSegment('today'));
    expect(screen.getByRole('heading', { level: 2, name: /^Chats today/ })).toBeInTheDocument();
  });

  it('falls back to Now when storage cannot be read', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    setSources();
    renderView();
    expect(screen.getByRole('button', { name: 'Now' })).toHaveAttribute('aria-pressed', 'true');
    getItem.mockRestore();
  });

  it('is a 44px target on phones', () => {
    setSources();
    renderView({ compact: true });
    for (const name of ['Now', 'Today']) expect(screen.getByRole('button', { name }).className).toContain('min-h-[44px]!');
  });
});

describe('Today: facts and paragraph', () => {
  it('shows one line of facts, without cron runs ok, and a recovered failure is not failing', async () => {
    const fetchMock = stubFetch({
      runs: {
        c1: [{ ts: at(12, 3), status: 'ok' }, { ts: at(9), status: 'error', error: 'AccessDenied' }],
        c2: [{ ts: at(13), status: 'error', error: 'Timeout' }],
      },
      day: { status: 'ready', text: 'The nightly backup is failing. Forge fixed the retry test.' },
    });
    renderToday({
      sessions: [FORGE_MAIN],
      tasks: [task(), task({ id: 't2', title: 'Ship notes', feedback: [{ at: at(14, 20), by: 'agent:forge', note: 'Merged #458 as 5edad4f.' }], updatedAt: at(14, 20) })],
      crons: [cron({ lastRun: new Date(at(12, 3)).toISOString() }), cron({ id: 'c2', name: 'Nightly backup', lastRun: new Date(at(13)).toISOString(), lastStatus: 'error' })],
    });

    const facts = screen.getByTestId('today-facts');
    await waitFor(() => expect(facts).toHaveTextContent('1 chat·2 done·1 merged·1 failing'));
    expect(facts).not.toHaveTextContent('cron');
    expect(await screen.findByTestId('today-paragraph')).toHaveTextContent('The nightly backup is failing.');
    // No checked time on a normal day.
    expect(screen.queryByText(/Checked/)).toBeNull();

    const dayCall = fetchMock.mock.calls.find(([url]) => url === '/api/attention/day-summary');
    const body = JSON.parse(String((dayCall as unknown as [string, RequestInit])[1].body)) as { facts: { day: string; counts: unknown; done: string[] } };
    expect(body.facts.counts).toEqual({ sessions: 1, done: 2, merged: 1, cronFailed: 1 });
    expect(body.facts.done[0]).toBe('13:00 Cron Nightly backup failed');
    expect(body.facts.done).toContain('14:20 PR #458 merged (Ship notes)');
    expect(body.facts.done.join('\n')).not.toContain('Morning brief');
  });

  it('shows the facts alone when the paragraph cannot be written', async () => {
    stubFetch({ day: { status: 'error' } });
    renderToday({ tasks: [task()] });
    await waitFor(() => expect(screen.getByTestId('today-facts')).toHaveTextContent('1 done'));
    expect(screen.queryByTestId('today-paragraph')).toBeNull();
    expect(screen.queryByText('Summarizing the day...')).toBeNull();
  });

  it('does not ask for the paragraph while a source is still loading', async () => {
    const fetchMock = stubFetch({ day: { status: 'ready', text: 'Never asked.' } });
    renderToday({ sources: { ...LIVE_SOURCES, tasks: { state: 'loading' } } });
    expect(within(section('Done today')).getByText('Loading tasks.')).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/attention/day-summary')).toBe(false);
  });

  it('filters Done to what a fact counts, and the same fact clears it', async () => {
    stubFetch({ runs: { c2: [{ ts: at(13), status: 'error', error: 'Timeout' }] } });
    renderToday({
      sessions: [FORGE_MAIN],
      tasks: [task(), task({ id: 't2', title: 'Ship notes', feedback: [{ at: at(14, 20), by: 'agent:forge', note: 'Merged #458 as 5edad4f.' }], updatedAt: at(14, 20) })],
      crons: [cron({ id: 'c2', name: 'Nightly backup', lastRun: new Date(at(13)).toISOString(), lastStatus: 'error' })],
    });
    await screen.findByTestId('today-failing');
    const titles = () => within(section('Done today')).queryAllByTestId('today-row').map((row) => row.textContent ?? '');

    const merged = screen.getByTestId('today-fact-merged');
    fireEvent.click(merged);
    expect(merged).toHaveAttribute('aria-pressed', 'true');
    expect(titles()).toEqual([expect.stringContaining('Ship notes')]);

    fireEvent.click(screen.getByTestId('today-fact-failing'));
    expect(titles()).toEqual([expect.stringContaining('Nightly backup')]);
    expect(screen.getByTestId('today-fact-failing')).toHaveAttribute('aria-pressed', 'true');
    expect(merged).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('today-fact-failing'));
    expect(titles()).toHaveLength(3);

    fireEvent.click(screen.getByTestId('today-fact-done'));
    expect(titles()).toEqual([expect.stringContaining('Ship notes'), expect.stringContaining('Fix the flaky retry test')]);
    // Chats are never hidden by a Done filter.
    expect(within(section('Chats today')).getAllByTestId('today-chat')).toHaveLength(1);
    fireEvent.click(within(section('Done today')).getByRole('button', { name: 'Show all' }));
    expect(titles()).toHaveLength(3);
  });

  it('the chats fact opens Chats today and jumps to it', () => {
    localStorage.setItem(TODAY_SECTIONS_KEY, JSON.stringify({ desk: { chats: false } }));
    renderToday({ sessions: [FORGE_MAIN] });
    expect(within(section('Chats today')).queryAllByTestId('today-chat')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('today-fact-chats'));
    expect(within(section('Chats today')).getAllByTestId('today-chat')).toHaveLength(1);
  });
});

describe('Today: sections', () => {
  it('puts Chats in the wide column and Done in the rail, both open at the desk', () => {
    renderToday({ sessions: [FORGE_MAIN], tasks: [task()] });
    const grid = section('Chats today').closest('.attention-grid') as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.contains(section('Done today'))).toBe(true);
    expect(section('Chats today').compareDocumentPosition(section('Done today')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(section('Done today')).getAllByTestId('today-row')).toHaveLength(1);
    expect(within(section('Chats today')).getAllByTestId('today-chat')).toHaveLength(1);
  });

  it('opens Chats and collapses Done on phones, with counts and 44px targets', () => {
    renderToday({ compact: true, sessions: [FORGE_MAIN], tasks: [task()] });
    expect(within(section('Chats today')).getAllByTestId('today-chat')).toHaveLength(1);
    const done = section('Done today');
    const header = within(done).getByRole('button', { expanded: false });
    expect(header.className).toContain('min-h-11');
    expect(within(done).getByTestId('today-done-count')).toHaveTextContent('1');
    expect(within(done).queryAllByTestId('today-row')).toHaveLength(0);

    fireEvent.click(header);
    const rows = within(done).getAllByTestId('today-row');
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].className.match(/min-h-\[(\d+)px\]/)![1])).toBeGreaterThanOrEqual(44);
  });

  it('remembers a toggled section per layout across reloads, and survives storage that throws', () => {
    const phone = renderToday({ compact: true, tasks: [task()] });
    fireEvent.click(within(section('Done today')).getByRole('button', { expanded: false }));
    expect(JSON.parse(localStorage.getItem(TODAY_SECTIONS_KEY)!)).toEqual({ phone: { done: true } });
    phone.unmount();

    const again = renderToday({ compact: true, tasks: [task()] });
    expect(within(section('Done today')).getAllByTestId('today-row')).toHaveLength(1);
    again.unmount();

    // The desk keeps its own default.
    const desk = renderToday({ tasks: [task()] });
    fireEvent.click(within(section('Chats today')).getByRole('button', { expanded: true }));
    desk.unmount();
    expect(JSON.parse(localStorage.getItem(TODAY_SECTIONS_KEY)!)).toEqual({ phone: { done: true }, desk: { chats: false } });

    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    renderToday({ compact: true, tasks: [task()] });
    const done = section('Done today');
    expect(within(done).queryAllByTestId('today-row')).toHaveLength(0);
    fireEvent.click(within(done).getByRole('button', { expanded: false }));
    expect(within(done).getAllByTestId('today-row')).toHaveLength(1);
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('keeps open rows while it stays mounted', () => {
    const view = renderToday({ tasks: [task()] });
    fireEvent.click(rowFor('Fix the flaky retry test'));
    view.rerenderToday({ active: false });
    view.rerenderToday({ active: true });
    expect(rowFor('Fix the flaky retry test')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('Today: chats', () => {
  const KIM: Session = { key: 'agent:main:main', channel: 'telegram', updatedAt: at(14, 50) };
  const TUNA: Session = { key: 'agent:main:telegram:tuna:direct:42', channel: 'telegram', updatedAt: at(14, 40) };

  it('asks every chat\'s summary in one call', () => {
    renderToday({ sessions: [KIM, FORGE_MAIN, SUBAGENT, TUNA] });
    const keys = summariesMock.mock.calls.at(-1)![0].sessionKeys;
    expect([...keys].sort()).toEqual(['agent:forge:main', 'agent:forge:subagent:fix', 'agent:main:main', 'agent:main:telegram:tuna:direct:42']);
  });

  it('says what each chat is about in its first whole sentence, and whose turn it is', () => {
    const long = `Kim rewrote the deploy script for v1.6.0, moved the health check behind the restart and tested it on staging twice, so the rollback path is covered. ${'It also cleaned the logs. '.repeat(10)}Should it ship to production now?`;
    summariesMock.mockImplementation(summaries({
      'agent:main:main': { status: 'ready', text: long, lastSpeaker: 'agent', asksOperator: true },
      'agent:forge:main': { status: 'ready', text: 'Forge is fixing the retry test. It is still running.', lastSpeaker: 'operator', asksOperator: false },
      'agent:forge:subagent:fix': { status: 'ready', text: 'Patched the backoff. Want me to also bump the timeout?', lastSpeaker: 'agent', asksOperator: true },
      'agent:main:telegram:tuna:direct:42': { status: 'ready', text: 'Tuna asked about dinner. Kim answered.', lastSpeaker: 'agent', asksOperator: false },
    }));
    renderToday({
      sessions: [KIM, { ...FORGE_MAIN, hasActiveRun: true }, SUBAGENT, TUNA],
    });
    const chat = (text: string) => rowFor(text);

    const kim = chat('Kim');
    expect(within(kim).getByTestId('today-gist')).toHaveTextContent(/^Kim rewrote the deploy script for v1\.6\.0, .* so the rollback path is covered\.$/);
    expect(within(kim).getByTestId('today-turn')).toHaveTextContent('Waiting on you');
    expect(within(kim).getByText('telegram')).toBeInTheDocument();

    expect(within(chat('Forge')).getByTestId('today-turn')).toHaveTextContent('Working');
    // A subagent's question is to its parent agent, and it has ended.
    const sub = chat('fix-retry');
    expect(within(sub).queryByTestId('today-turn')).toBeNull();
    expect(sub).toHaveTextContent('Finished 13:40');
    // The agent answered without asking anything: no marker.
    const tuna = chat('Tuna asked about dinner.');
    expect(tuna).toHaveTextContent('Kim on telegram');
    expect(within(tuna).queryByTestId('today-turn')).toBeNull();
  });

  it('marks a chat the Now board holds as waiting, naming why, without a row of its own', () => {
    renderToday({ sessions: [FORGE_MAIN], needsReply: new Map([['agent:forge:main', 'Review']]) });
    const row = rowFor('Forge');
    expect(within(row).getByTestId('today-turn')).toHaveTextContent('Waiting on you');
    expect(row).toHaveTextContent('Review on Now');
    expect(screen.getAllByTestId('today-chat')).toHaveLength(1);
    expect(screen.queryAllByTestId('today-row')).toHaveLength(0);
  });

  it('opens to the whole summary, and Reply on a waiting chat sends into it', async () => {
    const text = 'Kim drafted the release notes. It wants a yes before posting them. Should it post?';
    summariesMock.mockImplementation(summaries({ 'agent:main:main': { status: 'ready', text, lastSpeaker: 'agent', asksOperator: true } }));
    const { onOpen } = renderToday({ sessions: [KIM] });
    const block = blockOf(rowFor('Kim'));
    fireEvent.click(within(block).getByRole('button', { name: 'Reply' }));
    const detail = within(block).getByTestId('today-row-detail');
    expect(within(detail).getByText(text)).toBeInTheDocument();
    expect(within(block).queryByTestId('today-gist')).toBeNull();
    const field = within(detail).getByRole('textbox', { name: 'Reply to Kim' });
    fireEvent.change(field, { target: { value: 'Yes, post them.' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(rpc.mock.calls.some(([method]) => method === 'chat.send')).toBe(true));
    const send = rpc.mock.calls.find(([method]) => method === 'chat.send')![1];
    expect(send.sessionKey).toBe('agent:main:main');
    expect(String(send.message)).toBe('Yes, post them.');
    expect(within(block).getByTestId('inline-reply')).toBeInTheDocument();

    fireEvent.click(within(detail).getByRole('button', { name: 'Open in chat' }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'session', key: 'agent:main:main' });
  });

  it('nests a finished subagent under its parent, asks the parent, and never repeats it in Done', async () => {
    renderToday({ sessions: [FORGE_MAIN, SUBAGENT] });
    const chats = within(section('Chats today')).getAllByTestId('today-chat');
    expect(chats.map((row) => row.textContent)).toEqual([expect.stringContaining('Forge'), expect.stringContaining('fix-retry')]);
    expect(within(section('Done today')).queryAllByTestId('today-row')).toHaveLength(0);
    expect(within(section('Done today')).getByText('Nothing has finished yet today.')).toBeInTheDocument();

    const sub = rowFor('fix-retry');
    fireEvent.click(sub);
    const detail = within(blockOf(sub)).getByTestId('today-row-detail');
    fireEvent.click(within(detail).getByRole('button', { name: 'Ask Forge' }));
    const field = within(detail).getByRole('textbox', { name: 'Ask Forge' });
    fireEvent.change(field, { target: { value: 'Did it pass on CI?' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(rpc.mock.calls.some(([method]) => method === 'chat.send')).toBe(true));
    const send = rpc.mock.calls.find(([method]) => method === 'chat.send')![1];
    expect(send.sessionKey).toBe('agent:forge:main');
    expect(String(send.message)).toMatch(/^About the subagent "fix-retry" \(agent:forge:subagent:fix\), which finished at 13:40\.\n\nDid it pass on CI\?$/);
    expect(screen.getAllByTestId('inline-reply')).toHaveLength(1);
  });
});

describe('Today: done', () => {
  it('pins a failing cron with Run now, which runs through the actions it is given', async () => {
    const fetchMock = stubFetch({ runs: { c2: [{ ts: at(13), status: 'error', error: 'Timeout', summary: 'Gave up after 3 tries', durationMs: 65_000 }] } });
    const onDone = vi.fn();
    const actions: AttentionActionsConfig = { kanbanEnabled: true, onDone };
    renderToday({
      tasks: [task({ updatedAt: at(14, 30) })],
      crons: [cron({ id: 'c2', name: 'Nightly backup', lastRun: new Date(at(13)).toISOString(), lastStatus: 'error', nextRun: new Date(at(16)).toISOString() })],
      actions,
    });
    const failing = await screen.findByTestId('today-failing');
    const rows = within(section('Done today')).getAllByTestId('today-row');
    expect(rows[0]).toHaveTextContent('Nightly backup');
    expect(rows[0]).toHaveTextContent('Failed 13:00');

    fireEvent.click(within(failing).getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cron-failed', sourceId: 'c2' }), 'run-cron'));
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/crons/c2/run')).toBe(true);

    fireEvent.click(rows[0]);
    const detail = within(failing).getByTestId('today-row-detail');
    expect(detail).toHaveTextContent('Timeout');
    expect(detail).toHaveTextContent('Gave up after 3 tries');
    expect(detail).toHaveTextContent('Last run 13:00 · took 1m 5s · next 16:00');
    expect(within(detail).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('without actions from the view, Run now refreshes Today when it lands', async () => {
    stubFetch({ runs: { c2: [{ ts: at(13), status: 'error' }] } });
    const { onRefresh } = renderToday({
      crons: [cron({ id: 'c2', name: 'Nightly backup', lastRun: new Date(at(13)).toISOString(), lastStatus: 'error' })],
    });
    fireEvent.click(within(await screen.findByTestId('today-failing')).getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('shows a failure that recovered as one quiet line', async () => {
    stubFetch({ runs: { c1: [{ ts: at(12, 3), status: 'ok' }, { ts: at(9), status: 'error', error: 'AccessDenied' }] } });
    renderToday({ crons: [cron({ lastRun: new Date(at(12, 3)).toISOString() })] });
    await waitFor(() => expect(rowFor('Morning brief')).toBeDefined());
    expect(screen.queryByTestId('today-failing')).toBeNull();
    const rows = within(section('Done today')).getAllByTestId('today-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Failed 09:00, recovered 12:03');
    expect(rows[0].querySelector('[data-state]')).toHaveAttribute('data-state', 'off');
  });

  it('folds successful cron runs into one line that opens to a row per job with its last run', async () => {
    stubFetch({
      runs: {
        c1: [{ ts: at(7), status: 'ok', summary: 'Brief sent to Telegram', durationMs: 4_200 }, { ts: at(6), status: 'ok' }],
        c3: [{ ts: at(14), status: 'ok' }],
      },
    });
    renderToday({
      crons: [cron({ nextRun: new Date(at(19)).toISOString() }), cron({ id: 'c3', name: 'Merge watch', lastRun: new Date(at(14)).toISOString() })],
    });
    const fold = await screen.findByTestId('today-crons-ok');
    const toggle = within(fold).getByRole('button', { name: '3 cron runs ok' });
    expect(within(fold).queryAllByTestId('today-cron-ok-row')).toHaveLength(0);
    fireEvent.click(toggle);
    const jobs = within(fold).getAllByTestId('today-cron-ok-row');
    expect(jobs.map((row) => row.textContent)).toEqual([expect.stringContaining('Merge watch1 run ok'), expect.stringContaining('Morning brief2 runs ok')]);
    fireEvent.click(jobs[1]);
    const detail = within(fold).getByTestId('today-row-detail');
    expect(within(detail).getByTestId('today-cron-output')).toHaveTextContent('Brief sent to Telegram');
    expect(detail).toHaveTextContent('Last run 07:00 · took 4s · next 19:00');
  });

  it('prints a shared time once and lines an open row\'s detail up with its title', () => {
    renderToday({
      tasks: [task({ id: 'a', title: 'First', updatedAt: at(14, 12) }), task({ id: 'b', title: 'Second', updatedAt: at(14, 12) }), task({ id: 'c', title: 'Third', updatedAt: at(11) })],
    });
    const rows = within(section('Done today')).getAllByTestId('today-row');
    const clocks = rows.map((row) => row.querySelector('.font-mono')?.textContent);
    expect(clocks).toEqual(['14:12', '', '11:00']);
    fireEvent.click(rows[0]);
    const detail = within(blockOf(rows[0])).getByTestId('today-row-detail');
    // 4px row inset + time column + gap + pane + gap.
    expect(detail.style.paddingLeft).toBe(`${0.25 + 2.75 + 0.625 + 0.667 + 0.625}rem`);
  });

  it('a task carries the pull requests it merged, and Nudge goes to its agent', async () => {
    renderToday({
      sessions: [{ key: 'agent:linus:main', identityName: 'Linus', updatedAt: at(14) }],
      tasks: [task({
        assignee: undefined,
        run: undefined,
        result: undefined,
        feedback: [{ at: at(14, 12), by: 'agent:linus', note: 'Merged #456 as 8a0b787 (https://github.com/acme/app/pull/456). Closing card.' }],
      })],
    });
    const row = rowFor('Fix the flaky retry test');
    expect(row).toHaveTextContent('Linus · merged #456');
    expect(within(section('Done today')).getAllByTestId('today-row')).toHaveLength(1);
    fireEvent.click(row);
    const detail = within(blockOf(row)).getByTestId('today-row-detail');
    expect(within(detail).getByRole('link', { name: 'Open PR #456' })).toHaveAttribute('href', 'https://github.com/acme/app/pull/456');
    fireEvent.click(within(detail).getByRole('button', { name: 'Nudge' }));
    const field = within(detail).getByRole('textbox', { name: 'Nudge Linus' });
    fireEvent.change(field, { target: { value: 'Is the device test done?' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(rpc.mock.calls.some(([method]) => method === 'chat.send')).toBe(true));
    const send = rpc.mock.calls.find(([method]) => method === 'chat.send')![1];
    expect(send.sessionKey).toBe('agent:linus:main');
    expect(String(send.message)).toBe('About the task "Fix the flaky retry test", done at 14:12.\n\nIs the device test done?');
  });

  it('asks the thread summary of an open task row with the chats', () => {
    summariesMock.mockImplementation(summaries({ 'agent:forge:main': { status: 'ready', text: 'Forge patched the backoff.' } }));
    renderToday({ tasks: [task()] });
    expect(summariesMock.mock.calls.at(-1)![0].sessionKeys).toEqual([]);
    const row = rowFor('Fix the flaky retry test');
    fireEvent.click(row);
    expect(summariesMock.mock.calls.at(-1)![0].sessionKeys).toEqual(['agent:forge:main']);
    const detail = within(blockOf(row)).getByTestId('today-row-detail');
    expect(within(detail).getByText('Patched the retry backoff and reran the suite.')).toBeInTheDocument();
    expect(within(detail).getByText('Forge patched the backoff.')).toBeInTheDocument();
  });

  it('names each source that could not be read and never reads as an empty day', async () => {
    stubFetch({ runs: { c1: 'fail' } });
    const { onOpen } = renderToday({
      crons: [cron()],
      sources: { ...LIVE_SOURCES, tasks: { state: 'error', error: 'HTTP 500' } },
    });
    const done = section('Done today');
    expect(within(done).getByText('Tasks could not be read (HTTP 500).')).toBeInTheDocument();
    expect(await within(done).findByText('Cron runs could not be read (Morning brief).')).toBeInTheDocument();
    expect(within(done).queryByText('Nothing has finished yet today.')).toBeNull();
    expect(screen.getByText(/Tasks and Cron runs could not be read, so this day may be incomplete\./)).toBeInTheDocument();
    fireEvent.click(within(done).getByRole('button', { name: 'Open Tasks' }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'source', source: 'tasks' });
  });

  it('says a quiet day is quiet once every source has answered', () => {
    renderToday();
    expect(within(section('Done today')).getByText('Nothing has finished yet today.')).toBeInTheDocument();
    expect(within(section('Chats today')).getByText('No chats yet today.')).toBeInTheDocument();
  });

  it('keeps an open row in place when a newer row arrives, and re-sorts once it closes', () => {
    const view = renderToday({ tasks: [task({ id: 'a', title: 'Older task', updatedAt: at(10) })] });
    fireEvent.click(rowFor('Older task'));
    view.rerenderToday({ tasks: [task({ id: 'a', title: 'Older task', updatedAt: at(10) }), task({ id: 'b', title: 'Newer task', updatedAt: at(14) })] });
    const titles = () => screen.getAllByTestId('today-row').map((row) => row.textContent ?? '');
    expect(titles()[0]).toContain('Older task');
    expect(titles()[1]).toContain('Newer task');
    expect(titles()[1]).toContain('New');
    fireEvent.click(rowFor('Older task'));
    expect(titles()[0]).toContain('Newer task');
  });
});

describe('Today with the gateway lost', () => {
  it('keeps the view and says it is not connected', () => {
    localStorage.setItem(SEGMENT_KEY, 'today');
    setSources({ tasks: [task()] });
    gatewayMock.mockReturnValue({ connectionState: 'connected', rpc, subscribe });
    const view = renderView();
    gatewayMock.mockReturnValue({ connectionState: 'disconnected', rpc, subscribe });
    view.rerender(<AttentionView active compact={false} kanbanEnabled onOpen={vi.fn()} />);
    expect(screen.getByText(/Not connected since/)).toBeInTheDocument();
    expect(within(section('Done today')).getAllByTestId('today-row')).toHaveLength(1);
  });
});

describe('Today: failing on a phone', () => {
  it('the failing fact opens both sections when a cron and a chat are failing', async () => {
    localStorage.setItem(TODAY_SECTIONS_KEY, JSON.stringify({ phone: { chats: false } }));
    stubFetch({ runs: { c2: [{ ts: at(13), status: 'error' }] } });
    renderToday({
      compact: true,
      sessions: [FORGE_MAIN, { ...SUBAGENT, status: undefined, endedAt: undefined }],
      agentStatus: { 'agent:forge:subagent:fix': { status: 'ERROR', since: at(14) } },
      crons: [cron({ id: 'c2', name: 'Nightly backup', lastRun: new Date(at(13)).toISOString(), lastStatus: 'error' })],
    });
    const failing = screen.getByTestId('today-fact-failing');
    expect(failing).toHaveTextContent('2 failing');
    fireEvent.click(failing);
    expect(within(section('Done today')).getAllByTestId('today-row')).toHaveLength(1);
    // The failing chat shows under its parent.
    expect(within(section('Chats today')).getAllByTestId('today-chat').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Forge'),
      expect.stringContaining('fix-retry'),
    ]);
  });
});
