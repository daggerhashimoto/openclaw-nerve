import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanTask } from '@/features/kanban/types';
import type { CronJob } from '@/features/workspace/hooks/useCrons';
import type { Session } from '@/types';
import type { OpenTarget, SourceStatus } from '../types';
import type { ThreadSummary } from '../useAttentionSummaries';
import { setAttentionSegment } from '../attentionSegment';
import { AttentionView } from '../AttentionView';

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
  return [...screen.getAllByTestId('today-row'), ...screen.queryAllByTestId('today-chat')]
    .find((row) => row.textContent?.includes(text)) as HTMLElement;
}

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
    expect(screen.queryByRole('heading', { level: 2, name: 'Waiting on you' })).toBeNull();
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

describe('Today', () => {
  beforeEach(() => {
    localStorage.setItem(SEGMENT_KEY, 'today');
  });

  it('shows the facts strip and the paragraph from the server', async () => {
    const fetchMock = stubFetch({
      runs: { c1: [{ ts: at(7), status: 'ok' }, { ts: at(8), status: 'error', error: 'AccessDenied' }] },
      day: { status: 'ready', text: 'Forge fixed the retry test and the morning brief failed once.' },
    });
    setSessions([FORGE_MAIN]);
    setSources({
      tasks: [task(), task({ id: 't2', title: 'Ship notes', feedback: [{ at: at(14, 20), by: 'agent:forge', note: 'Merged #458 as 5edad4f.' }], updatedAt: at(14, 20) })],
      crons: [cron()],
    });
    renderView();

    const facts = await screen.findByTestId('today-facts');
    await waitFor(() => expect(facts).toHaveTextContent('1 session· 2 done· 1 merged· 1 cron run ok· 1 failed'));
    expect(await screen.findByTestId('today-paragraph')).toHaveTextContent('Forge fixed the retry test');

    const dayCall = fetchMock.mock.calls.find(([url]) => url === '/api/attention/day-summary');
    const body = JSON.parse(String((dayCall as unknown as [string, RequestInit])[1].body)) as { facts: { day: string; counts: unknown; done: string[] } };
    expect(body.facts.day).toBe('2026-11-28');
    expect(body.facts.counts).toEqual({ sessions: 1, done: 2, merged: 1, cronFailed: 1 });
    expect(body.facts.done).toContain('14:20 PR #458 merged (Ship notes)');
  });

  it('shows the facts alone when the paragraph cannot be written', async () => {
    stubFetch({ day: { status: 'error' } });
    setSources({ tasks: [task()] });
    renderView();
    await waitFor(() => expect(screen.getByTestId('today-facts')).toHaveTextContent('1 done'));
    expect(screen.queryByTestId('today-paragraph')).toBeNull();
    expect(screen.queryByText('Summarizing the day...')).toBeNull();
  });

  it('does not ask for the paragraph while a source is still loading', async () => {
    const fetchMock = stubFetch({ day: { status: 'ready', text: 'Never asked.' } });
    setSources({ sources: { tasks: { state: 'loading' }, proposals: live(), crons: live() } });
    renderView();
    expect(within(section('Done today')).getByText('Loading tasks.')).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/attention/day-summary')).toBe(false);
  });

  it('desktop shows both sections open; phones start them collapsed with counts', () => {
    setSessions([FORGE_MAIN]);
    setSources({ tasks: [task()] });
    const desktop = renderView();
    expect(within(section('Done today')).getAllByTestId('today-row')).toHaveLength(1);
    // Chats today leads; Done today follows it.
    expect(section('Chats today').compareDocumentPosition(section('Done today')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    desktop.unmount();

    renderView({ compact: true });
    const done = section('Done today');
    const header = within(done).getByRole('button', { expanded: false });
    expect(header.className).toContain('min-h-11');
    expect(within(done).getByTestId('today-done-count')).toHaveTextContent('1');
    expect(within(section('Chats today')).getByTestId('today-chats-count')).toHaveTextContent('1');
    expect(screen.queryAllByTestId('today-row')).toHaveLength(0);

    fireEvent.click(header);
    const rows = within(done).getAllByTestId('today-row');
    expect(rows).toHaveLength(1);
    const height = rows[0].className.match(/min-h-\[(\d+)px\]/);
    expect(Number(height![1])).toBeGreaterThanOrEqual(44);
  });

  it('opens a row in place with its result, its thread summary and a Nudge, asking summaries only then', () => {
    summariesMock.mockImplementation(({ sessionKeys }) => (
      sessionKeys.includes('agent:forge:main') ? { 'agent:forge:main': { status: 'ready', text: 'Forge patched the backoff.' } } : {}
    ));
    setSessions([FORGE_MAIN]);
    setSources({ tasks: [task()] });
    const { onOpen } = renderView();
    expect(summariesMock.mock.calls.at(-1)![0].sessionKeys).toEqual([]);

    const row = rowFor('Fix the flaky retry test');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(summariesMock.mock.calls.at(-1)![0].sessionKeys).toEqual(['agent:forge:main']);

    const detail = within(row.parentElement as HTMLElement).getByTestId('today-row-detail');
    expect(within(detail).getByText('Patched the retry backoff and reran the suite.')).toBeInTheDocument();
    expect(within(detail).getByText('Forge patched the backoff.')).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole('button', { name: 'Open task' }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'task', id: 't1' });

    fireEvent.click(within(detail).getByRole('button', { name: 'Nudge' }));
    expect(within(detail).getByRole('textbox', { name: 'Nudge Forge' })).toBeInTheDocument();
  });

  it('a card worked through notes alone nudges the agent who wrote them', async () => {
    setSessions([{ key: 'agent:linus:main', identityName: 'Linus', updatedAt: at(14) }]);
    setSources({
      tasks: [task({
        assignee: undefined,
        run: undefined,
        result: undefined,
        feedback: [{ at: at(14, 12), by: 'agent:linus', note: 'Merged #456 as 8a0b787. Closing card.' }],
      })],
    });
    renderView();
    expect(rowFor('PR #456 merged')).toHaveTextContent('Fix the flaky retry test · Linus');
    const row = rowFor('Task done');
    expect(row).toHaveTextContent('Task done · Linus');
    fireEvent.click(row);
    const detail = within(row.parentElement as HTMLElement).getByTestId('today-row-detail');
    expect(within(detail).getByText('Merged #456 as 8a0b787. Closing card.')).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole('button', { name: 'Nudge' }));
    const field = within(detail).getByRole('textbox', { name: 'Nudge Linus' });
    fireEvent.change(field, { target: { value: 'Is the device test done?' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(rpc.mock.calls.some(([method]) => method === 'chat.send')).toBe(true));
    const send = rpc.mock.calls.find(([method]) => method === 'chat.send')![1];
    expect(send.sessionKey).toBe('agent:linus:main');
    expect(String(send.message)).toBe('About the task "Fix the flaky retry test", done at 14:12.\n\nIs the device test done?');
  });

  it('a finished subagent asks its parent, with a line about the subagent', async () => {
    setSessions([FORGE_MAIN, SUBAGENT]);
    setSources();
    renderView();

    const row = rowFor('fix-retry');
    expect(row).toHaveTextContent('Subagent finished');
    fireEvent.click(row);
    const detail = within(row.parentElement as HTMLElement).getByTestId('today-row-detail');
    fireEvent.click(within(detail).getByRole('button', { name: 'Ask Forge' }));
    const field = within(detail).getByRole('textbox', { name: 'Ask Forge' });
    fireEvent.change(field, { target: { value: 'Did it pass on CI?' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(rpc.mock.calls.some(([method]) => method === 'chat.send')).toBe(true));
    const send = rpc.mock.calls.find(([method]) => method === 'chat.send')![1];
    expect(send.sessionKey).toBe('agent:forge:main');
    expect(String(send.message)).toMatch(/^About the subagent "fix-retry" \(agent:forge:subagent:fix\), which finished at 13:40\.\n\nDid it pass on CI\?$/);
    // The reply shows under the row it was sent from, and only there.
    expect(within(row.parentElement as HTMLElement).getByTestId('inline-reply')).toBeInTheDocument();
    expect(screen.getAllByTestId('inline-reply')).toHaveLength(1);
  });

  it('lists chats with subagents under their parent and marks the ones that need the operator', () => {
    setSessions([FORGE_MAIN, SUBAGENT]);
    setSources({ tasks: [task({ status: 'review', run: { sessionKey: 'agent:forge:main', startedAt: at(13), endedAt: at(14), status: 'done' } })] });
    renderView();
    const chats = within(section('Chats today')).getAllByTestId('today-chat');
    expect(chats.map((row) => row.textContent?.split('·')[0])).toEqual([
      expect.stringContaining('Forge'),
      expect.stringContaining('fix-retry'),
    ]);
    expect(chats[0]).toHaveTextContent('Needs you');
    expect(chats[0]).toHaveTextContent('Review');
    fireEvent.click(chats[0]);
    const detail = within(chats[0].parentElement as HTMLElement).getByTestId('today-row-detail');
    expect(within(detail).getByRole('button', { name: 'Reply' })).toBeInTheDocument();
  });

  it('names each source that could not be read and never reads as an empty day', async () => {
    stubFetch({ runs: { c1: 'fail' } });
    setSources({
      crons: [cron()],
      sources: { tasks: { state: 'error', error: 'HTTP 500' }, proposals: live(), crons: live() },
    });
    const { onOpen } = renderView();
    const done = section('Done today');
    expect(within(done).getByText('Tasks could not be read (HTTP 500).')).toBeInTheDocument();
    expect(await within(done).findByText('Cron runs could not be read (Morning brief).')).toBeInTheDocument();
    expect(within(done).queryByText('Nothing has finished yet today.')).toBeNull();
    expect(screen.getByText(/Tasks and Cron runs could not be read, so this day may be incomplete\./)).toBeInTheDocument();
    fireEvent.click(within(done).getByRole('button', { name: 'Open Tasks' }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'source', source: 'tasks' });
  });

  it('says a quiet day is quiet once every source has answered', () => {
    setSources();
    renderView();
    expect(within(section('Done today')).getByText('Nothing has finished yet today.')).toBeInTheDocument();
    expect(within(section('Chats today')).getByText('No chats yet today.')).toBeInTheDocument();
  });

  it('keeps an open row in place when a newer row arrives, and re-sorts once it closes', () => {
    setSources({ tasks: [task({ id: 'a', title: 'Older task', updatedAt: at(10) })] });
    const { rerender } = renderView();
    fireEvent.click(rowFor('Older task'));

    setSources({ tasks: [task({ id: 'a', title: 'Older task', updatedAt: at(10) }), task({ id: 'b', title: 'Newer task', updatedAt: at(14) })] });
    rerender(<AttentionView active compact={false} kanbanEnabled onOpen={vi.fn()} />);
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
