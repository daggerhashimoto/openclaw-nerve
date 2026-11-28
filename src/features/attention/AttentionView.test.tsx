import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanTask } from '@/features/kanban/types';
import type { KanbanProposal } from '@/features/kanban/hooks/useProposals';
import type { CronJob } from '@/features/workspace/hooks/useCrons';
import type { Session } from '@/types';
import { formatClock } from './briefCopy';
import type { OpenTarget, SourceStatus } from './types';
import type { ThreadSummary } from './useAttentionSummaries';
import { AttentionView } from './AttentionView';

const NOW = Date.UTC(2026, 10, 27, 8, 22);
const MINUTE = 60_000;
const HOUR = 3_600_000;

type Polled = 'tasks' | 'proposals' | 'crons';

interface SourcesMock {
  tasks: KanbanTask[];
  proposals: KanbanProposal[];
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
const gatewayMock = vi.fn(() => ({ connectionState: 'connected' as string }));

interface SummariesArgs {
  active: boolean;
  sessionKeys: string[];
  signal: string;
}
const summariesMock = vi.fn<(args: SummariesArgs) => Record<string, ThreadSummary>>(() => ({}));

vi.mock('./useAttentionSummaries', () => ({
  useAttentionSummaries: (args: SummariesArgs) => summariesMock(args),
}));
vi.mock('./useAttentionSources', () => ({
  useAttentionSources: () => sourcesMock(),
}));
vi.mock('@/contexts/SessionContext', () => ({
  useSessionContext: () => sessionMock(),
}));
vi.mock('@/contexts/GatewayContext', () => ({
  useGateway: () => gatewayMock(),
}));

function task(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: 't1',
    title: 'Fix the flaky retry test',
    status: 'review',
    priority: 'normal',
    assignee: 'agent:forge',
    createdBy: 'operator',
    createdAt: NOW - 20 * HOUR,
    updatedAt: NOW - 90 * MINUTE,
    version: 1,
    labels: [],
    columnOrder: 0,
    feedback: [],
    result: 'Patched the retry backoff and reran the suite.',
    resultAt: NOW - 90 * MINUTE,
    run: {
      sessionKey: 'agent:forge:subagent:fix',
      startedAt: NOW - 3 * HOUR,
      endedAt: NOW - 90 * MINUTE,
      status: 'done',
    },
    ...overrides,
  };
}

function cron(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 'c1',
    name: 'Morning brief',
    enabled: true,
    scheduleKind: 'cron',
    schedule: '0 7 * * *',
    payloadKind: 'agentTurn',
    lastStatus: 'ok',
    lastRun: new Date(NOW - HOUR).toISOString(),
    ...overrides,
  };
}

function live(): SourceStatus {
  return { state: 'live', checkedAt: NOW };
}

function allLive(): Record<Polled, SourceStatus> {
  return { tasks: live(), proposals: live(), crons: live() };
}

function setSources(overrides: Partial<SourcesMock> = {}) {
  const value: SourcesMock = {
    tasks: [],
    proposals: [],
    crons: [],
    sources: allLive(),
    refresh: vi.fn(),
    ...overrides,
  };
  sourcesMock.mockReturnValue(value);
  return value;
}

function renderView(props: Partial<Parameters<typeof AttentionView>[0]> = {}) {
  const onOpen = vi.fn<(target: OpenTarget) => void>();
  const all = { active: true, compact: false, kanbanEnabled: true, onOpen, ...props };
  const utils = render(<AttentionView {...all} />);
  return {
    ...utils,
    onOpen,
    rerenderWith: (next: Partial<typeof all>) => utils.rerender(<AttentionView {...all} {...next} />),
  };
}

/** Matches the innermost element whose whole text is `text`, across monospace clock spans. */
function hasText(text: string | RegExp) {
  const matches = (node: Element) => (
    typeof text === 'string' ? node.textContent === text : text.test(node.textContent ?? '')
  );
  return (_content: string, element: Element | null) => (
    Boolean(element) && matches(element!) && Array.from(element!.children).every((child) => !matches(child))
  );
}

/** The decisions in board order: the Start here plate, then the rows under it. */
function decideTitles(): string[] {
  const section = screen.getByRole('region', { name: 'Waiting on you' });
  const plate = within(section).queryByRole('heading', { level: 3 });
  const rows = within(section).queryAllByTestId('attention-row-title').map((title) => title.textContent ?? '');
  return [...(plate ? [plate.textContent ?? ''] : []), ...rows];
}

/** The whole row (toggle, actions, open detail) whose title is `title`. */
function itemOf(title: string): HTMLElement {
  const titleEl = screen.getAllByTestId('attention-row-title').find((el) => el.textContent === title);
  if (!titleEl) throw new Error(`No row titled ${title}`);
  return titleEl.closest('[data-testid="attention-item"]') as HTMLElement;
}

function toggleOf(title: string): HTMLElement {
  return within(itemOf(title)).getByTestId('attention-row');
}

function failedTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return task({
    id: 'f1',
    title: 'Rebuild the index',
    status: 'todo',
    result: undefined,
    run: {
      sessionKey: 'agent:forge:subagent:fix',
      startedAt: NOW - 3 * HOUR,
      endedAt: NOW - 2 * HOUR,
      status: 'error',
      error: 'Tests failed',
    },
    ...overrides,
  });
}

function runningTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return task({
    id: 'r1',
    title: 'Index the archive',
    status: 'in-progress',
    result: undefined,
    updatedAt: NOW - 10 * MINUTE,
    run: { sessionKey: 'agent:forge:subagent:index', startedAt: NOW - 10 * MINUTE, status: 'running' },
    ...overrides,
  });
}

function proposal(overrides: Partial<KanbanProposal> = {}): KanbanProposal {
  return {
    id: 'p1',
    type: 'create',
    payload: { title: 'Write release notes' },
    proposedBy: 'agent:kim',
    proposedAt: NOW - 3 * HOUR,
    status: 'pending',
    version: 1,
    ...overrides,
  };
}

function finishedTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return task({
    id: 'd1',
    title: 'Write the changelog',
    status: 'in-progress',
    result: 'Wrote it.',
    run: { sessionKey: 'agent:forge:subagent:log', startedAt: NOW - 2 * HOUR, endedAt: NOW - HOUR, status: 'done' },
    ...overrides,
  });
}

const FLEET = [
  { key: 'agent:forge:main', identityName: 'Forge', updatedAt: NOW - HOUR },
  { key: 'agent:kim:main', identityName: 'Kim', updatedAt: NOW - HOUR },
  { key: 'agent:tuna:main', identityName: 'Tuna', updatedAt: NOW - HOUR },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  sessionMock.mockReturnValue({ sessions: [], sessionsLoading: false, agentStatus: {}, busyState: {} });
  gatewayMock.mockReturnValue({ connectionState: 'connected' });
  summariesMock.mockReset();
  summariesMock.mockImplementation(() => ({}));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AttentionView', () => {
  it('heads the board with counts, then Failing, Waiting on you, Agents and Since you looked in that order', () => {
    sessionMock.mockReturnValue({
      sessions: FLEET,
      sessionsLoading: false,
      agentStatus: {},
      busyState: {},
    } as never);
    setSources({
      tasks: [task(), task({ id: 't2', title: 'Second review', resultAt: NOW - 20 * MINUTE }), failedTask(), runningTask(), finishedTask()],
      crons: [cron({ id: 'c2', name: 'Nightly backup', lastStatus: 'error', lastError: 'AccessDenied' })],
    });
    renderView();

    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('2 failing · 2 to decide · 1 working');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(['Failing', 'Waiting on you', 'Agents', 'Since you looked']);
    // Now | Today sits on the heading row, with the checked time and Refresh.
    expect(screen.getByRole('group', { name: 'Attention view' })).toBeInTheDocument();
    expect(screen.getByTitle(`Checked ${formatClock(NOW)}`)).toBeInTheDocument();
    // The Ask box docks after the board.
    const ask = screen.getByRole('region', { name: 'Ask the agent' });
    const since = screen.getByRole('region', { name: 'Since you looked' });
    expect(since.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No "In the last 24 hours", no always-on caveat, no kickers.
    expect(screen.queryByText(/In the last 24 hours/)).toBeNull();
    expect(screen.queryByText(/session failures show from when this page opened/i)).toBeNull();
    expect(screen.queryByText('Then')).toBeNull();
    expect(screen.queryByText(/^Ranked/)).toBeNull();
    expect(screen.getByTestId('attention-decide-count')).toHaveAttribute('title', expect.stringMatching(/^Ranked: /));
  });

  it('says where things come from only when a source is not live', () => {
    setSources({ tasks: [task()], crons: [cron({ lastStatus: 'error', lastRun: new Date(NOW - HOUR).toISOString() })] });
    const { unmount } = renderView();
    expect(screen.queryByText(/tasks · live|crons · live|proposals · live/)).toBeNull();
    expect(screen.queryByText(/stale/)).toBeNull();
    unmount();

    setSources({ tasks: [task()], sources: { ...allLive(), tasks: { state: 'error', error: 'HTTP 503' } } });
    renderView();
    expect(screen.getByText('Tasks could not be read, so this may be incomplete.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Start here' })).getByText(/stale/)).toBeInTheDocument();
  });

  it('names a running subagent in words, under its agent in the Agents strip', () => {
    sessionMock.mockReturnValue({
      sessions: [
        { key: 'agent:linus:main', identityName: 'Linus', updatedAt: NOW - HOUR },
        { key: 'agent:linus:subagent:abc', label: 'Research worker', updatedAt: NOW - 10 * MINUTE },
      ],
      sessionsLoading: false,
      agentStatus: {},
      busyState: { 'agent:linus:subagent:abc': true },
    } as never);
    setSources();
    renderView();

    const [line] = screen.getAllByTestId('agent-line');
    expect(line).toHaveTextContent('Linus');
    expect(line).toHaveTextContent('Research worker');
    expect(screen.queryByText(/pick something you like/)).not.toBeInTheDocument();
    expect(screen.queryByText(/agent:linus/)).toBeNull();
  });

  it('falls back to the agent id when a root session carries placeholder identity text', () => {
    sessionMock.mockReturnValue({
      sessions: [
        { key: 'agent:linus:main', identityName: '_ (pick something you like) _', updatedAt: NOW - HOUR },
        { key: 'agent:linus:subagent:abc', label: 'Research worker', updatedAt: NOW - 10 * MINUTE },
      ],
      sessionsLoading: false,
      agentStatus: {},
      busyState: { 'agent:linus:subagent:abc': true },
    } as never);
    setSources();
    renderView();

    expect(screen.getAllByTestId('agent-line')[0]).toHaveTextContent('linus');
    expect(screen.queryByText(/pick something you like/)).not.toBeInTheDocument();
  });

  it('lists every agent with what it is doing, working first, and opens its main chat', () => {
    sessionMock.mockReturnValue({
      sessions: [
        ...FLEET,
        { key: 'agent:kim:telegram:direct:9', channel: 'telegram', updatedAt: NOW - MINUTE },
        { key: 'agent:forge:subagent:x1', label: 'kb-r1-1795864537794', updatedAt: NOW - MINUTE },
      ],
      sessionsLoading: false,
      agentStatus: {},
      busyState: { 'agent:kim:telegram:direct:9': true },
    } as never);
    setSources({ tasks: [runningTask({ run: { sessionKey: 'agent:forge:subagent:x1', startedAt: NOW - 32 * MINUTE, status: 'running' } })] });
    const { onOpen } = renderView();

    const lines = screen.getAllByTestId('agent-line');
    expect(lines.map((line) => line.getAttribute('data-state'))).toEqual(['working', 'working', 'idle']);
    expect(lines[0]).toHaveTextContent('Forge');
    expect(lines[0]).toHaveTextContent('Index the archive');
    expect(lines[0]).toHaveTextContent('32m');
    expect(lines[1]).toHaveTextContent('Kim');
    expect(lines[1]).toHaveTextContent('replying on Telegram');
    expect(lines[2]).toHaveTextContent('Tuna');
    expect(lines[2]).toHaveTextContent('idle');
    for (const line of lines) expect(line.textContent).not.toMatch(/agent:|kb-/);
    // Names are set in the names face, in the agent's hue.
    expect(within(lines[0]).getByText('Forge').className).toContain('font-display');
    expect(within(lines[0]).getByText('Forge').className).toContain('name-hued');

    fireEvent.click(within(lines[1]).getByRole('button', { name: "Open Kim's chat" }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'session', key: 'agent:kim:main' });
  });

  it('counts an agent working from the session list run fields, as the top bar does', () => {
    sessionMock.mockReturnValue({
      sessions: [
        { key: 'agent:kim:main', identityName: 'Kim', label: 'Shaun (@shaunfi) id:42', lastChannel: 'telegram', status: 'running', hasActiveRun: true, startedAt: NOW - MINUTE },
        { key: 'agent:linus:main', identityName: 'Linus', hasActiveRun: true },
        { key: 'agent:tuna:main', identityName: 'Tuna', status: 'done' },
      ],
      sessionsLoading: false,
      agentStatus: {},
      busyState: {},
    } as never);
    setSources();
    renderView();

    const lines = screen.getAllByTestId('agent-line');
    expect(lines.map((line) => line.getAttribute('data-state'))).toEqual(['working', 'working', 'idle']);
    const kim = lines.find((line) => line.textContent?.startsWith('Kim'))!;
    expect(kim).toHaveAttribute('data-state', 'working');
    expect(kim).toHaveTextContent('replying on Telegram');
    expect(kim).toHaveTextContent('1m');
    expect(kim.textContent).not.toContain('Shaun');
    expect(lines.find((line) => line.textContent?.startsWith('Linus'))).toHaveTextContent('in main chat');
    expect(lines[2]).toHaveTextContent('Tuna');
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('2 working');
  });

  it('a running channel chat counts from its list status too', () => {
    sessionMock.mockReturnValue({
      sessions: [
        { key: 'agent:kim:main', identityName: 'Kim' },
        { key: 'agent:kim:telegram:direct:9', channel: 'telegram', status: 'running' },
      ],
      sessionsLoading: false,
      agentStatus: {},
      busyState: {},
    } as never);
    setSources();
    renderView();
    expect(screen.getAllByTestId('agent-line')[0]).toHaveTextContent('replying on Telegram');
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('1 working');
  });

  it('a review with no assignee is named after the agent whose session ran it', () => {
    sessionMock.mockReturnValue({ sessions: [{ key: 'agent:linus:main', identityName: 'Linus' }], sessionsLoading: false, agentStatus: {}, busyState: {} } as never);
    setSources({
      tasks: [
        task(),
        task({
          id: 't2',
          title: 'Check the backup log',
          assignee: undefined,
          resultAt: NOW - HOUR,
          run: { sessionKey: 'agent:linus:main', childSessionKey: 'agent:linus:subagent:bk', startedAt: NOW - 2 * HOUR, endedAt: NOW - HOUR, status: 'done' },
        }),
      ],
    });
    renderView();
    expect(itemOf('Check the backup log')).toHaveTextContent('Linus · 1h · Review');
  });

  it('on phones the controls take one row and the counts their own line, with titles over two lines', () => {
    setSources({ tasks: [task(), task({ id: 't2', title: 'A long review title that needs more than one line on a phone', resultAt: NOW - 20 * MINUTE })] });
    const { unmount } = renderView({ compact: true });
    const heading = screen.getByRole('heading', { level: 1 });
    const tabs = screen.getByRole('group', { name: 'Attention view' });
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(tabs.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(refresh.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.parentElement).not.toBe(tabs.parentElement);
    const title = within(itemOf('A long review title that needs more than one line on a phone')).getByTestId('attention-row-title');
    expect(title.className).toContain('line-clamp-2');
    expect(title.className).not.toContain('truncate');
    expect(itemOf('A long review title that needs more than one line on a phone').querySelector('svg.lucide-chevron-right')).toBeNull();
    unmount();

    // The desk keeps the counts first on one row.
    renderView();
    const deskHeading = screen.getByRole('heading', { level: 1 });
    expect(deskHeading.compareDocumentPosition(screen.getByRole('group', { name: 'Attention view' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a quiet task run is marked on its agent and can be stopped with a confirm', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    sessionMock.mockReturnValue({ sessions: FLEET, sessionsLoading: false, agentStatus: {}, busyState: {} } as never);
    const value = setSources({
      tasks: [runningTask({ updatedAt: NOW - 5 * HOUR, run: { sessionKey: 'agent:forge:subagent:index', startedAt: NOW - 5 * HOUR, status: 'running' } })],
    });
    const { onOpen } = renderView();

    const line = screen.getAllByTestId('agent-line')[0];
    expect(line).toHaveAttribute('data-state', 'quiet');
    expect(line).toHaveTextContent('quiet 5h');
    // Gone quiet is not a failure.
    expect(screen.queryByRole('region', { name: 'Failing' })).toBeNull();

    fireEvent.click(within(line).getByRole('button', { name: 'Stop' }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(line).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain('/api/kanban/tasks/r1/abort');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('Start here is a warm plate with the full summary, real evidence and the agent name', () => {
    sessionMock.mockReturnValue({ sessions: FLEET, sessionsLoading: false, agentStatus: {}, busyState: {} } as never);
    summariesMock.mockImplementation(() => ({ 'agent:forge:subagent:fix': { status: 'ready', text: 'You asked for a retry fix. Forge patched it and waits for review.' } }));
    setSources({ tasks: [task({ result: 'Patched the retry backoff. https://github.com/acme/app/pull/460' })] });
    const { onOpen } = renderView();

    const start = screen.getByRole('region', { name: 'Start here' });
    expect(start.className).toContain('plate-operator');
    expect(within(start).getByRole('heading', { level: 3 })).toHaveTextContent('Fix the flaky retry test');
    expect(within(start).getByText('Forge')).toHaveClass('font-display');
    const summary = within(start).getByText('You asked for a retry fix. Forge patched it and waits for review.');
    expect(summary.className).toContain('text-foreground');
    expect(summary.className).toContain('max-w-[72ch]');
    expect(within(start).queryByText(/What happened/)).toBeNull();
    expect(within(start).queryByText('No evidence attached')).toBeNull();
    expect(within(start).getByText(/Patched the retry backoff/)).toBeInTheDocument();
    expect(within(start).getByRole('link', { name: 'PR #460' })).toHaveAttribute('href', 'https://github.com/acme/app/pull/460');

    fireEvent.click(within(start).getByRole('button', { name: 'Open review' }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'task', id: 't1' });
    fireEvent.click(within(start).getByRole('button', { name: 'Run session' }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'session', key: 'agent:forge:subagent:fix' });
  });

  it('shows no evidence line when an item carries none', () => {
    setSources({ proposals: [proposal()] });
    renderView();
    const start = screen.getByRole('region', { name: 'Start here' });
    expect(within(start).queryByTestId('attention-evidence')).toBeNull();
    expect(within(start).queryByText('No evidence attached')).toBeNull();
  });

  it('action tiers: one warm button on the plate, outline main actions on rows, muted text for the rest', () => {
    setSources({
      tasks: [task(), task({ id: 't2', title: 'Second review', resultAt: NOW - 20 * MINUTE }), failedTask()],
    });
    renderView();

    const start = screen.getByRole('region', { name: 'Start here' });
    const approve = within(start).getByRole('button', { name: 'Approve' });
    expect(approve.className).toContain('bg-primary');
    const reject = within(start).getByRole('button', { name: 'Request changes' });
    expect(reject.className).toContain('text-muted-foreground');
    expect(reject.className).toContain('underline');
    expect(reject.className).not.toContain('bg-primary');

    const filled = screen.getAllByRole('button').filter((button) => button.className.includes('bg-primary'));
    expect(filled).toEqual([approve]);

    for (const title of ['Second review', 'Rebuild the index']) {
      const main = within(itemOf(title)).getByRole('button', { name: title === 'Second review' ? 'Approve' : 'Retry' });
      expect(main.className).toContain('border-input');
      expect(main.className).toContain('text-foreground');
      expect(main.className).not.toContain('shell-chip');
      expect(main.className).not.toContain('bg-primary');
    }
    // A failure keeps Open beside its main action.
    expect(within(itemOf('Rebuild the index')).getByRole('button', { name: 'Open task' }).className).toContain('underline');
  });

  it('rows open in place with the summary, evidence, every action, Reply and an explicit Open', () => {
    summariesMock.mockImplementation(() => ({ 'agent:forge:subagent:second': { status: 'ready', text: 'Forge tidied the changelog.' } }));
    setSources({
      tasks: [
        task(),
        task({
          id: 't2',
          title: 'Second review',
          resultAt: NOW - 20 * MINUTE,
          result: 'Tidied the changelog.',
          run: { sessionKey: 'agent:forge:subagent:second', startedAt: NOW - HOUR, endedAt: NOW - 20 * MINUTE, status: 'done' },
        }),
      ],
    });
    const { onOpen } = renderView();

    const toggle = toggleOf('Second review');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(itemOf('Second review')).queryByTestId('attention-row-detail')).toBeNull();
    // Collapsed: title, then agent, age and kind; the main action stays in reach.
    expect(itemOf('Second review')).toHaveTextContent('forge · 20m · Review');

    fireEvent.click(toggle);
    expect(onOpen).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const detail = within(itemOf('Second review')).getByTestId('attention-row-detail');
    expect(within(detail).getByText('Forge tidied the changelog.')).toBeInTheDocument();
    expect(within(detail).getByText('Tidied the changelog.')).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Request changes' })).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Reply' })).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole('button', { name: 'Open review' }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'task', id: 't2' });

    fireEvent.click(toggle);
    expect(within(itemOf('Second review')).queryByTestId('attention-row-detail')).toBeNull();
  });

  it('rows open in place on phones too, with 44px targets', () => {
    setSources({ tasks: [task(), task({ id: 't2', title: 'Second review', resultAt: NOW - 20 * MINUTE }), failedTask()] });
    const { onOpen } = renderView({ compact: true });

    for (const row of screen.getAllByTestId('attention-row')) {
      expect(row.tagName).toBe('BUTTON');
      expect(row.className).toContain('min-h-[60px]');
    }
    expect(within(itemOf('Second review')).getByRole('button', { name: 'Approve' }).className).toContain('min-h-[44px]');
    fireEvent.click(toggleOf('Rebuild the index'));
    expect(onOpen).not.toHaveBeenCalled();
    const detail = within(itemOf('Rebuild the index')).getByTestId('attention-row-detail');
    expect(within(detail).getByRole('button', { name: 'Mark Rebuild the index seen' })).toBeInTheDocument();

    // On phones Start here has one filled button, the decision; the rest are text buttons.
    const start = screen.getByRole('region', { name: 'Start here' });
    const startButtons = within(start).getAllByRole('button');
    expect(startButtons.filter((button) => button.className.includes('bg-primary')).map((b) => b.textContent)).toEqual(['Approve']);
    expect(startButtons.map((button) => button.textContent)).toEqual(['Run session', 'Approve', 'Request changes', 'Reply', 'Open review']);
    for (const button of startButtons) expect(button.className).toContain('min-h-11');
  });

  it('empty state only when every source is live', () => {
    setSources();
    const { unmount } = renderView();
    expect(
      screen.getByText(hasText(`Nothing needs you. Checked tasks, proposals and crons at ${formatClock(NOW)}.`)),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('Nothing needs you');
    unmount();

    setSources({ sources: { ...allLive(), crons: { state: 'loading' } } });
    const loading = renderView();
    expect(screen.queryByText(/Nothing needs you/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Loading crons/i).length).toBeGreaterThan(0);
    loading.unmount();

    setSources({ sources: { ...allLive(), crons: { state: 'error', error: 'HTTP 502' } } });
    renderView();
    expect(screen.queryByText(/Nothing needs you/)).not.toBeInTheDocument();
  });

  it('errored crons source shows its message and an Open Crons link', () => {
    setSources({ sources: { ...allLive(), crons: { state: 'error', error: 'HTTP 502' } } });
    const { onOpen } = renderView();

    expect(screen.getAllByText('Crons could not be read (HTTP 502).').length).toBeGreaterThan(0);
    const links = screen.getAllByRole('button', { name: 'Open Crons' });
    fireEvent.click(links[0]);
    expect(onOpen).toHaveBeenCalledWith({ type: 'source', source: 'crons' });
  });

  it('a failing cron is listed; one whose later run went fine is not, and reads as recovered since you looked', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/crons/c2/runs') {
        return new Response(JSON.stringify({
          ok: true,
          result: { entries: [{ ts: NOW - 5 * HOUR, status: 'error', error: 'AccessDenied' }, { ts: NOW - 2 * HOUR, status: 'ok' }] },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: { entries: [] } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    setSources({
      crons: [
        cron({ id: 'c1', name: 'Morning brief', lastStatus: 'ok', lastRun: new Date(NOW - HOUR).toISOString() }),
        cron({ id: 'c2', name: 'Nightly backup', lastStatus: 'error', lastError: 'AccessDenied', lastRun: new Date(NOW - 5 * HOUR).toISOString() }),
      ],
    });
    renderView();

    // Before the history answers, the job's own last status says failing.
    expect(within(screen.getByRole('region', { name: 'Failing' })).getByText('Nightly backup')).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Failing' })).toBeNull());
    const since = screen.getByRole('region', { name: 'Since you looked' });
    fireEvent.click(within(since).getByRole('button', { name: /1 finished/ }));
    expect(within(since).getByText('Nightly backup')).toBeInTheDocument();
    expect(within(since).getByText(hasText(`Failed ${formatClock(NOW - 5 * HOUR)}, recovered ${formatClock(NOW - 2 * HOUR)}`))).toBeInTheDocument();
    // A successful cron run is not news on Now.
    expect(screen.queryByText('Morning brief')).toBeNull();
  });

  it('Since you looked is one collapsed line with a count, Mark all seen, and per-row Mark seen', () => {
    setSources({ tasks: [finishedTask(), finishedTask({ id: 'd2', title: 'Prune the cache', run: { sessionKey: 'agent:forge:subagent:p', startedAt: NOW - 3 * HOUR, endedAt: NOW - 2 * HOUR, status: 'done' } })] });
    renderView();

    const since = screen.getByRole('region', { name: 'Since you looked' });
    const count = within(since).getByRole('button', { name: /2 finished/ });
    expect(count).toHaveAttribute('aria-expanded', 'false');
    expect(within(since).queryByText('Write the changelog')).toBeNull();

    fireEvent.click(count);
    expect(within(since).getByText('Write the changelog')).toBeInTheDocument();
    // Finished history is dark: no family hue in the pane.
    expect(within(itemOf('Write the changelog')).getByRole('img', { name: 'Finished' })).not.toHaveClass('pane-hued');
    const mark = within(itemOf('Write the changelog')).getByRole('button', { name: 'Mark Write the changelog seen' });
    expect(mark.className).toContain('group-hover:opacity-100');
    fireEvent.click(mark);
    expect(within(since).queryByText('Write the changelog')).toBeNull();
    expect(within(since).getByRole('button', { name: 'Seen (1)' })).toBeInTheDocument();

    fireEvent.click(within(since).getByRole('button', { name: 'Mark all seen' }));
    expect(within(since).queryByText('Prune the cache')).toBeNull();
    expect(within(since).getByRole('button', { name: 'Seen (2)' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('nerve:attention:seen') ?? '[]')).toHaveLength(2);
  });

  it('disconnected keeps the board readable, says since when, and never shows the all clear', () => {
    setSources({ tasks: [task()] });
    const { rerenderWith, container } = renderView();
    expect(screen.queryByText(hasText(/Not connected since/))).not.toBeInTheDocument();

    vi.setSystemTime(NOW + 7 * MINUTE);
    gatewayMock.mockReturnValue({ connectionState: 'reconnecting' });
    rerenderWith({});

    expect(
      screen.getByText(hasText(new RegExp(`Not connected since ${formatClock(NOW + 7 * MINUTE)}`))),
    ).toBeInTheDocument();
    expect(screen.getByText('Fix the flaky retry test')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing needs you/)).not.toBeInTheDocument();
    expect(container.querySelector('.opacity-60')).toBeNull();
    // Kanban actions go over HTTP and stay available.
    expect(within(screen.getByRole('region', { name: 'Start here' })).getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('disconnected never shows the all clear', () => {
    setSources();
    const { rerenderWith } = renderView();
    expect(screen.getByText(hasText(/Nothing needs you\. Checked/))).toBeInTheDocument();

    gatewayMock.mockReturnValue({ connectionState: 'reconnecting' });
    rerenderWith({});

    expect(screen.getByText(hasText(/Not connected since/))).toBeInTheDocument();
    expect(screen.queryByText(/Nothing needs you/)).not.toBeInTheDocument();
  });

  it('a first connect that fails reads as not connected', () => {
    gatewayMock.mockReturnValue({ connectionState: 'connecting' });
    sessionMock.mockReturnValue({ sessions: [], sessionsLoading: true, agentStatus: {}, busyState: {} });
    setSources({ tasks: [task()] });
    const { rerenderWith } = renderView();

    gatewayMock.mockReturnValue({ connectionState: 'disconnected' });
    rerenderWith({});
    expect(screen.getByText(hasText(/Not connected since/))).toBeInTheDocument();
    expect(screen.getByText('Fix the flaky retry test')).toBeInTheDocument();
  });

  it('after an outage, sessions are not treated as live and the brief cannot read as clear', () => {
    setSources();
    const { rerenderWith } = renderView();
    expect(screen.getByText(hasText(/^Nothing needs you\./))).toBeInTheDocument();

    gatewayMock.mockReturnValue({ connectionState: 'disconnected' });
    rerenderWith({});
    expect(screen.getByText(hasText(/Not connected since/))).toBeInTheDocument();
    expect(screen.queryByText(/Nothing needs you/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('Nothing to show');
  });

  it('a page load before the socket connects is not an outage and takes sessions into the baseline', () => {
    gatewayMock.mockReturnValue({ connectionState: 'disconnected' });
    sessionMock.mockReturnValue({ sessions: [], sessionsLoading: true, agentStatus: {}, busyState: {} });
    setSources({ tasks: [task()] });
    const { rerenderWith } = renderView();
    expect(screen.queryByText(hasText(/Not connected since/))).not.toBeInTheDocument();

    gatewayMock.mockReturnValue({ connectionState: 'connecting' });
    rerenderWith({});
    expect(screen.queryByText(hasText(/Not connected since/))).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Start here' })).toBeInTheDocument();

    gatewayMock.mockReturnValue({ connectionState: 'connected' });
    sessionMock.mockReturnValue({
      sessions: [{ key: 'agent:kim:main', identityName: 'Kim' }, { key: 'agent:kim:subagent:abc', label: 'Research worker', updatedAt: NOW - 10 * MINUTE }],
      sessionsLoading: false,
      agentStatus: {},
      busyState: { 'agent:kim:subagent:abc': true },
    });
    rerenderWith({});

    expect(screen.getByText('Research worker')).toBeInTheDocument();
    expect(screen.queryByText('New')).not.toBeInTheDocument();
    expect(screen.queryByText(hasText(/Not connected since/))).not.toBeInTheDocument();

    // The baseline now holds the board, so a later arrival is the only New item.
    setSources({ tasks: [task(), task({ id: 't9', title: 'Later review', resultAt: NOW - MINUTE })] });
    rerenderWith({});
    expect(screen.getAllByText('New')).toHaveLength(1);
  });

  it('writes last look when deactivated', () => {
    setSources();
    const { rerenderWith } = renderView();
    expect(localStorage.getItem('nerve:attention:lastLook')).toBeNull();

    vi.setSystemTime(NOW + 5 * MINUTE);
    rerenderWith({ active: false });
    expect(localStorage.getItem('nerve:attention:lastLook')).toBe(String(NOW + 5 * MINUTE));
  });

  it('keeps the last look across leaving the view and coming back in one page session', () => {
    localStorage.setItem('nerve:attention:lastLook', String(NOW - 5 * HOUR));
    setSources();
    const { rerenderWith } = renderView();

    const since = () => screen.getByRole('heading', { level: 2, name: 'Since you looked' }).getAttribute('title');
    const before = since();
    expect(before).toBe(`Since ${formatClock(NOW - 5 * HOUR)}`);

    vi.setSystemTime(NOW + 5 * MINUTE);
    rerenderWith({ active: false });
    // The next page load gets the new time, but this session keeps the one it started with.
    expect(localStorage.getItem('nerve:attention:lastLook')).toBe(String(NOW + 5 * MINUTE));
    rerenderWith({ active: true });

    expect(since()).toBe(before);
  });

  it('marking every failure seen keeps a Seen count in the all-clear block', () => {
    setSources({ tasks: [failedTask({ title: 'Fix the flaky retry test' })] });
    renderView({ compact: false });

    expect(screen.getByRole('heading', { name: 'Failing' })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing needs you/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Fix the flaky retry test seen' }));

    expect(screen.getByText(hasText(/Nothing needs you\. Checked/))).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Failing' })).not.toBeInTheDocument();
    const seenLine = screen.getByRole('button', { name: 'Seen (1)' });
    expect(seenLine).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Fix the flaky retry test')).not.toBeInTheDocument();

    fireEvent.click(seenLine);
    expect(screen.getByText('Fix the flaky retry test')).toBeInTheDocument();
  });

  it('cold load waits for every source, then Start here is the top-ranked item without New tags', () => {
    const loading: Record<Polled, SourceStatus> = {
      tasks: { state: 'loading' },
      proposals: { state: 'loading' },
      crons: { state: 'loading' },
    };
    const newer = task({ id: 't2', title: 'Newer review', resultAt: NOW - 10 * MINUTE });
    const older = task({ id: 't1', title: 'Older review', resultAt: NOW - 2 * HOUR });

    setSources({ sources: loading });
    const { rerenderWith } = renderView();
    expect(screen.queryByText(/Nothing needs you/)).not.toBeInTheDocument();
    expect(screen.queryByText('New')).not.toBeInTheDocument();

    setSources({ tasks: [newer], sources: { ...loading, tasks: live() } });
    rerenderWith({});
    expect(screen.queryByText(/Nothing needs you/)).not.toBeInTheDocument();
    expect(screen.queryByText('New')).not.toBeInTheDocument();

    setSources({ tasks: [newer, older], sources: allLive() });
    rerenderWith({});
    const start = screen.getByRole('region', { name: 'Start here' });
    expect(within(start).getByText('Older review')).toBeInTheDocument();
    expect(screen.queryByText('New')).not.toBeInTheDocument();
  });

  it('reactivation keeps the old order until the sources answer again, then re-ranks without New', () => {
    const first = task({ id: 't1', title: 'First review', resultAt: NOW - HOUR });
    const second = task({ id: 't2', title: 'Second review', resultAt: NOW - 30 * MINUTE });
    const status = allLive();
    setSources({ tasks: [first, second], sources: status });
    const { rerenderWith } = renderView();
    expect(decideTitles()).toEqual(['First review', 'Second review']);

    rerenderWith({ active: false });

    const earlier = task({ id: 't3', title: 'Earlier review', resultAt: NOW - 3 * HOUR });
    setSources({ tasks: [first, second, earlier], sources: status });
    rerenderWith({ active: true });
    expect(decideTitles()).toEqual(['First review', 'Second review', 'Earlier review']);
    expect(screen.queryByText('New')).not.toBeInTheDocument();

    setSources({ tasks: [first, second, earlier], sources: allLive() });
    rerenderWith({});
    expect(decideTitles()).toEqual(['Earlier review', 'First review', 'Second review']);
    expect(screen.queryByText('New')).not.toBeInTheDocument();
  });

  it('tags items that arrive while the board is open as New, at the end, and keeps the plate', () => {
    const first = task({ id: 't1', title: 'First review', resultAt: NOW - HOUR });
    setSources({ tasks: [first] });
    const { rerenderWith } = renderView();

    const earlier = task({ id: 't3', title: 'Earlier review', resultAt: NOW - 3 * HOUR });
    setSources({ tasks: [first, earlier] });
    rerenderWith({});
    expect(decideTitles()).toEqual(['First review', 'Earlier review']);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('Refresh re-ranks once the sources answer', () => {
    const first = task({ id: 't1', title: 'First review', resultAt: NOW - HOUR });
    const status = allLive();
    const value = setSources({ tasks: [first], sources: status });
    const { rerenderWith } = renderView();

    const earlier = task({ id: 't3', title: 'Earlier review', resultAt: NOW - 3 * HOUR });
    setSources({ tasks: [first, earlier], sources: status, refresh: value.refresh });
    rerenderWith({});
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(value.refresh).toHaveBeenCalled();

    setSources({ tasks: [first, earlier], sources: allLive(), refresh: value.refresh });
    rerenderWith({});
    expect(decideTitles()).toEqual(['Earlier review', 'First review']);
    expect(screen.queryByText('New')).not.toBeInTheDocument();
  });

  describe('per-item Mark seen', () => {
    it('per-item Mark seen hides only that failure', () => {
      setSources({
        tasks: [
          failedTask({ id: 'f1', title: 'Rebuild the index' }),
          failedTask({ id: 'f2', title: 'Rotate the logs' }),
        ],
      });
      renderView();

      expect(itemOf('Rebuild the index')).toBeInTheDocument();
      expect(itemOf('Rotate the logs')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Mark Rebuild the index seen' }));

      expect(screen.queryAllByTestId('attention-row-title').map((el) => el.textContent)).toEqual(['Rotate the logs']);
      expect(screen.getByRole('button', { name: 'Mark Rotate the logs seen' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Seen (1)' })).toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem('nerve:attention:seen') ?? '[]')).toHaveLength(1);
    });

    it('per-item Mark seen does not open the item', () => {
      setSources({ tasks: [failedTask({ id: 'f1', title: 'Rebuild the index' }), finishedTask()] });
      const { onOpen } = renderView();

      fireEvent.click(screen.getByRole('button', { name: 'Mark Rebuild the index seen' }));
      fireEvent.click(screen.getByRole('button', { name: /1 finished/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Mark Write the changelog seen' }));

      expect(onOpen).not.toHaveBeenCalled();
      // One Seen line under Failing (now in the all-clear block), one under Since you looked.
      expect(screen.getAllByRole('button', { name: 'Seen (1)' })).toHaveLength(2);
    });

    it('is absent from decisions', () => {
      setSources({ tasks: [task(), task({ id: 't2', title: 'Write the ship notes', resultAt: NOW - 30 * MINUTE })] });
      renderView();
      fireEvent.click(toggleOf('Write the ship notes'));
      expect(screen.queryByRole('button', { name: /^Mark .+ seen$/ })).toBeNull();
    });
  });

  describe('item actions', () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

    function respond(status: number, body: unknown) {
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }

    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockImplementation(async () => respond(200, { ok: true }));
      vi.stubGlobal('fetch', fetchMock);
    });

    function calls() {
      return fetchMock.mock.calls
        .filter(([url]) => !/\/api\/crons\/[^/]+\/runs$/.test(url) && url !== '/api/attention/summaries')
        .map(([url, init]) => ({
          url,
          method: init?.method,
          body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
        }));
    }

    it('Approve on Start here posts the approval, shows progress and refreshes without opening', async () => {
      let release: (value: Response) => void = () => {};
      fetchMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
      const value = setSources({ tasks: [task()] });
      const { onOpen } = renderView();

      const start = screen.getByRole('region', { name: 'Start here' });
      fireEvent.click(within(start).getByRole('button', { name: 'Approve' }));

      const pending = within(start).getByRole('button', { name: 'Approving...' });
      expect(pending).toBeDisabled();
      expect(within(start).getByRole('button', { name: 'Request changes' })).toBeDisabled();
      expect(value.refresh).not.toHaveBeenCalled();

      release(respond(200, { id: 't1' }));
      expect(await within(start).findByRole('button', { name: 'Approved' })).toBeDisabled();
      expect(value.refresh).toHaveBeenCalledTimes(1);
      expect(calls()).toEqual([{ url: '/api/kanban/tasks/t1/approve', method: 'POST', body: {} }]);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('Request changes opens a note, needs text, and sends it as the rejection note', async () => {
      const value = setSources({ tasks: [task()] });
      const { onOpen } = renderView();
      const start = screen.getByRole('region', { name: 'Start here' });

      fireEvent.click(within(start).getByRole('button', { name: 'Request changes' }));
      const field = within(start).getByRole('textbox', { name: 'What needs to change' });
      const send = within(start).getByRole('button', { name: 'Request changes' });
      expect(send).toBeDisabled();
      expect(calls()).toEqual([]);

      fireEvent.change(field, { target: { value: 'Cover the timeout path' } });
      fireEvent.click(send);

      await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(1));
      expect(calls()).toEqual([
        { url: '/api/kanban/tasks/t1/reject', method: 'POST', body: { note: 'Cover the timeout path' } },
      ]);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('Cancel closes the note without a request', () => {
      setSources({ tasks: [task()] });
      renderView();
      const start = screen.getByRole('region', { name: 'Start here' });

      fireEvent.click(within(start).getByRole('button', { name: 'Request changes' }));
      fireEvent.click(within(start).getByRole('button', { name: 'Cancel' }));

      expect(within(start).queryByRole('textbox')).not.toBeInTheDocument();
      expect(within(start).getByRole('button', { name: 'Approve' })).toBeEnabled();
      expect(calls()).toEqual([]);
    });

    it('a failed action shows the server error on the plate and re-enables the buttons', async () => {
      fetchMock.mockImplementationOnce(async () => respond(400, { error: 'invalid_transition', details: 'Task is not in review' }));
      const value = setSources({ tasks: [task()] });
      renderView();
      const start = screen.getByRole('region', { name: 'Start here' });

      fireEvent.click(within(start).getByRole('button', { name: 'Approve' }));

      expect(await within(start).findByRole('alert')).toHaveTextContent('Could not approve: Task is not in review');
      expect(within(start).getByRole('button', { name: 'Approve' })).toBeEnabled();
      expect(within(start).getByRole('button', { name: 'Request changes' })).toBeEnabled();
      expect(value.refresh).not.toHaveBeenCalled();
    });

    it('a pending proposal can be approved from its row, or rejected once opened', async () => {
      const value = setSources({
        tasks: [task({ resultAt: NOW - 5 * HOUR })],
        proposals: [proposal(), proposal({ id: 'p2', payload: { title: 'Prune old branches' }, proposedAt: NOW - 2 * HOUR })],
      });
      const { onOpen } = renderView();

      fireEvent.click(within(itemOf('Write release notes')).getByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(1));

      fireEvent.click(toggleOf('Prune old branches'));
      fireEvent.click(within(itemOf('Prune old branches')).getByRole('button', { name: 'Reject' }));
      await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(2));

      expect(calls()).toEqual([
        { url: '/api/kanban/proposals/p1/approve', method: 'POST', body: undefined },
        { url: '/api/kanban/proposals/p2/reject', method: 'POST', body: {} },
      ]);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('a failed run can be retried from its row', async () => {
      const value = setSources({ tasks: [failedTask()] });
      const { onOpen } = renderView();

      fireEvent.click(within(itemOf('Rebuild the index')).getByRole('button', { name: 'Retry' }));

      await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(1));
      expect(calls()).toEqual([{ url: '/api/kanban/tasks/f1/execute', method: 'POST', body: {} }]);
      expect(within(itemOf('Rebuild the index')).getByRole('button', { name: 'Started' })).toBeDisabled();
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('a failed cron can be run now from its row or paused once opened', async () => {
      const crons = [
        cron({ id: 'c2', name: 'Nightly backup', lastStatus: 'error', lastError: 'AccessDenied' }),
        cron({ id: 'c3', name: 'Weekly digest', lastStatus: 'error', lastError: 'Timeout' }),
      ];
      const value = setSources({ crons });
      const { onOpen } = renderView();
      expect(itemOf('Nightly backup')).toHaveTextContent('AccessDenied');

      fireEvent.click(within(itemOf('Nightly backup')).getByRole('button', { name: 'Run now' }));
      await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(1));

      fireEvent.click(toggleOf('Weekly digest'));
      fireEvent.click(within(itemOf('Weekly digest')).getByRole('button', { name: 'Pause' }));
      await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(2));

      expect(calls()).toEqual([
        { url: '/api/crons/c2/run', method: 'POST', body: undefined },
        { url: '/api/crons/c3/toggle', method: 'POST', body: { enabled: false } },
      ]);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('after Run now the cron row stays and Pause still works', async () => {
      const value = setSources({ crons: [cron({ id: 'c2', name: 'Nightly backup', lastStatus: 'error' })] });
      renderView();

      fireEvent.click(within(itemOf('Nightly backup')).getByRole('button', { name: 'Run now' }));
      expect(await within(itemOf('Nightly backup')).findByRole('button', { name: 'Started' })).toBeDisabled();
      fireEvent.click(toggleOf('Nightly backup'));
      expect(within(itemOf('Nightly backup')).getByRole('button', { name: 'Pause' })).toBeEnabled();

      fireEvent.click(within(itemOf('Nightly backup')).getByRole('button', { name: 'Pause' }));
      await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(2));
      expect(within(itemOf('Nightly backup')).getByRole('button', { name: 'Paused' })).toBeDisabled();
      expect(calls().map((call) => call.url)).toEqual(['/api/crons/c2/run', '/api/crons/c2/toggle']);
    });

    it('a failed cron run shows the gateway error on the row', async () => {
      fetchMock.mockImplementation(async (url: string) => (
        url === '/api/crons/c2/run' ? respond(502, { ok: false, error: 'gateway down' }) : respond(200, { ok: true })
      ));
      const value = setSources({ crons: [cron({ id: 'c2', name: 'Nightly backup', lastStatus: 'error' })] });
      renderView();

      fireEvent.click(within(itemOf('Nightly backup')).getByRole('button', { name: 'Run now' }));

      expect(await within(itemOf('Nightly backup')).findByRole('alert')).toHaveTextContent('Could not run: gateway down');
      expect(within(itemOf('Nightly backup')).getByRole('button', { name: 'Run now' })).toBeEnabled();
      expect(value.refresh).not.toHaveBeenCalled();
    });

    it('offers no task or proposal actions with kanban off', () => {
      setSources({
        tasks: [task(), failedTask(), runningTask()],
        proposals: [proposal({ proposedAt: NOW - 30 * MINUTE })],
        crons: [cron({ id: 'c2', name: 'Nightly backup', lastStatus: 'error' })],
      });
      renderView({ kanbanEnabled: false });

      const start = screen.getByRole('region', { name: 'Start here' });
      expect(within(start).getAllByRole('button').map((button) => button.textContent)).toEqual(['Run session', 'Open review', 'Reply']);
      for (const name of ['Approve', 'Reject', 'Request changes', 'Retry', 'Stop']) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
      }
      expect(screen.getByRole('button', { name: 'Run now' })).toBeInTheDocument();
    });

    it('session failures have no actions, only Open', () => {
      sessionMock.mockReturnValue({
        sessions: [{ key: 'agent:kim:subagent:abc', label: 'Research worker', updatedAt: NOW - 10 * MINUTE }],
        sessionsLoading: false,
        agentStatus: { 'agent:kim:subagent:abc': { status: 'ERROR', since: NOW - MINUTE } },
        busyState: {},
      } as never);
      setSources();
      renderView();

      const buttons = within(itemOf('Research worker')).getAllByRole('button').map((button) => button.textContent);
      expect(buttons).toEqual([expect.stringContaining('Research worker'), 'Open in chat', 'Mark seen']);
    });
  });

  describe('exec approvals', () => {
    const MAIN = 'agent:kim:main';
    const APPROVAL = {
      id: 'ap_1',
      approvalKind: 'exec',
      createdAtMs: NOW - 2 * MINUTE,
      expiresAtMs: NOW + 28 * MINUTE,
      request: {
        command: 'rm -rf build',
        cwd: '/srv/app',
        agentId: 'kim',
        sessionKey: MAIN,
        allowedDecisions: ['allow-once', 'allow-always', 'deny'],
      },
    };
    const handlers = new Set<(event: { type: 'event'; event: string; payload: unknown }) => void>();
    const subscribe = (handler: (event: { type: 'event'; event: string; payload: unknown }) => void) => {
      handlers.add(handler);
      return () => { handlers.delete(handler); };
    };

    function gatewayWith(rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>) {
      gatewayMock.mockReturnValue({ connectionState: 'connected', rpc, subscribe } as never);
    }

    beforeEach(() => {
      handlers.clear();
      sessionMock.mockReturnValue({ sessions: [{ key: MAIN, identityName: 'Kim' }], sessionsLoading: false, agentStatus: {}, busyState: {} } as never);
    });

    it('lists pending approvals first, with the command, the agent and Allow, Deny and Allow always', async () => {
      const rpc = vi.fn(async (method: string) => (method === 'exec.approval.list' ? [APPROVAL] : {}));
      gatewayWith(rpc);
      setSources({ tasks: [task({ priority: 'critical' })] });
      renderView();

      const plate = () => screen.getByRole('region', { name: 'Start here' });
      await waitFor(() => expect(within(plate()).getByRole('heading', { level: 3 })).toHaveTextContent('rm -rf build'));
      const start = plate();
      expect(within(start).getByText('Kim')).toBeInTheDocument();
      expect(within(start).getByText('in /srv/app from Kim')).toBeInTheDocument();
      expect(within(start).getByRole('button', { name: 'Allow' }).className).toContain('bg-primary');
      expect(within(start).getByRole('button', { name: 'Deny' })).toBeInTheDocument();
      expect(within(start).getByRole('button', { name: 'Allow always' })).toBeInTheDocument();
      expect(decideTitles()).toEqual(['rm -rf build', 'Fix the flaky retry test']);
      expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('2 to decide');
    });

    it('Allow and Deny resolve with the right decision over the socket', async () => {
      const rpc = vi.fn(async (method: string) => (method === 'exec.approval.list' ? [APPROVAL, { ...APPROVAL, id: 'ap_2', createdAtMs: NOW - MINUTE, request: { ...APPROVAL.request, command: 'git push --force' } }] : {}));
      gatewayWith(rpc);
      setSources();
      renderView();

      await waitFor(() => expect(within(screen.getByRole('region', { name: 'Start here' })).getByRole('heading', { level: 3 })).toHaveTextContent('rm -rf build'));
      const start = screen.getByRole('region', { name: 'Start here' });
      fireEvent.click(within(start).getByRole('button', { name: 'Allow' }));
      await waitFor(() => expect(rpc).toHaveBeenCalledWith('exec.approval.resolve', { id: 'ap_1', decision: 'allow-once' }));

      fireEvent.click(toggleOf('git push --force'));
      fireEvent.click(within(itemOf('git push --force')).getByRole('button', { name: 'Deny' }));
      await waitFor(() => expect(rpc).toHaveBeenCalledWith('exec.approval.resolve', { id: 'ap_2', decision: 'deny' }));
    });

    it('a request event adds an approval and a resolved event reads the list again', async () => {
      let pending: unknown[] = [];
      const rpc = vi.fn(async (method: string) => (method === 'exec.approval.list' ? pending : {}));
      gatewayWith(rpc);
      setSources();
      renderView();
      await waitFor(() => expect(rpc).toHaveBeenCalledWith('exec.approval.list', {}));
      expect(screen.queryByRole('region', { name: 'Start here' })).toBeNull();

      act(() => {
        for (const handler of [...handlers]) handler({ type: 'event', event: 'exec.approval.requested', payload: APPROVAL });
      });
      expect(within(screen.getByRole('region', { name: 'Start here' })).getByRole('heading', { level: 3 })).toHaveTextContent('rm -rf build');

      pending = [];
      act(() => {
        for (const handler of [...handlers]) handler({ type: 'event', event: 'exec.approval.resolved', payload: { id: 'ap_1', decision: 'deny' } });
      });
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Start here' })).toBeNull());
    });

    it('an approval that arrives mid-look leads the rows under the plate, tagged New, without taking the plate', async () => {
      const rpc = vi.fn(async (method: string) => (method === 'exec.approval.list' ? [] : {}));
      gatewayWith(rpc);
      setSources({ tasks: [task(), task({ id: 't2', title: 'Second review', resultAt: NOW - 20 * MINUTE })] });
      renderView();
      await waitFor(() => expect(rpc).toHaveBeenCalledWith('exec.approval.list', {}));
      await waitFor(() => expect(decideTitles()).toEqual(['Fix the flaky retry test', 'Second review']));

      act(() => {
        for (const handler of [...handlers]) handler({ type: 'event', event: 'exec.approval.requested', payload: APPROVAL });
      });
      expect(decideTitles()).toEqual(['Fix the flaky retry test', 'rm -rf build', 'Second review']);
      expect(within(itemOf('rm -rf build')).getByText('New')).toBeInTheDocument();
      expect(within(itemOf('rm -rf build')).getByRole('button', { name: 'Allow' }).className).toContain('border-input');
    });

    it('a row whose title is only the preview keeps Allow until the full command shows', async () => {
      const long = { ...APPROVAL, request: { ...APPROVAL.request, command: 'rm -rf /srv/app/build /srv/app/cache', commandPreview: 'rm -rf build' } };
      const rpc = vi.fn(async (method: string) => (method === 'exec.approval.list' ? [] : {}));
      gatewayWith(rpc);
      setSources({ tasks: [task()] });
      renderView();
      await waitFor(() => expect(rpc).toHaveBeenCalledWith('exec.approval.list', {}));
      await waitFor(() => expect(decideTitles()).toEqual(['Fix the flaky retry test']));
      act(() => {
        for (const handler of [...handlers]) handler({ type: 'event', event: 'exec.approval.requested', payload: long });
      });
      expect(within(itemOf('rm -rf build')).queryByRole('button', { name: 'Allow' })).toBeNull();
      fireEvent.click(toggleOf('rm -rf build'));
      expect(within(itemOf('rm -rf build')).getByText('rm -rf /srv/app/build /srv/app/cache')).toBeInTheDocument();
      expect(within(itemOf('rm -rf build')).getByRole('button', { name: 'Allow' })).toBeInTheDocument();
    });

    it('a gateway without approvals leaves the board as it was, all clear included', async () => {
      const rpc = vi.fn(async (method: string) => {
        if (method === 'exec.approval.list') throw new Error('unknown method: exec.approval.list');
        return {};
      });
      gatewayWith(rpc);
      setSources();
      renderView();
      await waitFor(() => expect(screen.getByText(hasText(/Nothing needs you\. Checked/))).toBeInTheDocument());
      expect(screen.queryByText(/Approvals/)).toBeNull();
    });

    it('an approvals read that fails for another reason is said, and holds the all clear', async () => {
      const rpc = vi.fn(async (method: string) => {
        if (method === 'exec.approval.list') throw new Error('Timeout');
        return {};
      });
      gatewayWith(rpc);
      setSources();
      renderView();
      expect(await screen.findByText('Approvals could not be read (Timeout).')).toBeInTheDocument();
      expect(screen.queryByText(/Nothing needs you/)).toBeNull();
    });
  });
});

describe('prompting from the brief', () => {
  const MAIN = 'agent:main:main';
  const handlers = new Set<(event: { type: 'event'; event: string; payload: unknown }) => void>();
  const rpc = vi.fn(async (method: string, params: Record<string, unknown>) => (
    method === 'chat.send' ? { runId: params.idempotencyKey, status: 'started' } : {}
  ));
  const subscribe = vi.fn((handler: (event: { type: 'event'; event: string; payload: unknown }) => void) => {
    handlers.add(handler);
    return () => { handlers.delete(handler); };
  });
  const setCurrentSession = vi.fn();

  function emit(payload: Record<string, unknown>) {
    act(() => {
      for (const handler of [...handlers]) handler({ type: 'event', event: 'chat', payload });
    });
  }

  function sends() {
    return rpc.mock.calls.filter(([method]) => method === 'chat.send').map(([, params]) => params);
  }

  beforeEach(() => {
    handlers.clear();
    rpc.mockClear();
    subscribe.mockClear();
    setCurrentSession.mockClear();
    gatewayMock.mockReturnValue({ connectionState: 'connected', rpc, subscribe } as never);
    sessionMock.mockReturnValue({
      sessions: [{ key: MAIN, identityName: 'Kim', updatedAt: NOW - HOUR }],
      sessionsLoading: false,
      agentStatus: {},
      busyState: {},
      currentSession: 'agent:forge:main',
      setCurrentSession,
    } as never);
  });

  it('the box sends to the main session and shows the reply under it', async () => {
    const value = setSources({ tasks: [task()] });
    const { onOpen } = renderView();

    const box = screen.getByRole('textbox', { name: 'Ask Kim' });
    expect(box).toHaveAttribute('placeholder', 'Ask Kim...');
    fireEvent.change(box, { target: { value: 'What needs me first?' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(sends()).toHaveLength(0);
    fireEvent.keyDown(box, { key: 'Enter' });

    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0]).toMatchObject({ sessionKey: MAIN, message: 'What needs me first?' });
    expect(box).toHaveValue('');
    const runId = sends()[0].idempotencyKey as string;

    const ask = screen.getByRole('region', { name: 'Ask the agent' });
    expect(within(ask).getByText('Working')).toBeInTheDocument();
    expect(within(ask).getByRole('button', { name: 'Send' })).toBeDisabled();

    emit({ sessionKey: MAIN, runId, state: 'delta', seq: 1, deltaText: 'Start with the **review**.' });
    const reply = within(ask).getByTestId('inline-reply');
    expect(within(reply).getByText('review').tagName).toBe('STRONG');
    expect(within(reply).getByText('Writing')).toBeInTheDocument();

    emit({ sessionKey: MAIN, runId, state: 'final', seq: 2, message: 'Start with the review.' });
    expect(within(reply).getByText(/Replied at/)).toBeInTheDocument();
    expect(within(reply).getByText('You: What needs me first?')).toBeInTheDocument();

    fireEvent.click(within(reply).getByRole('button', { name: 'Open in chat' }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'session', key: MAIN });

    // Sending is not an action on the brief: no refresh, no session switch.
    expect(value.refresh).not.toHaveBeenCalled();
    expect(setCurrentSession).not.toHaveBeenCalled();

    fireEvent.click(within(reply).getByRole('button', { name: 'Dismiss' }));
    expect(within(ask).queryByTestId('inline-reply')).toBeNull();
  });

  it('a Reply on a task with no owner is named after its session agent', () => {
    const failed = task({
      id: 'f2',
      title: 'Renew the certificate',
      status: 'todo',
      assignee: undefined,
      result: undefined,
      run: { sessionKey: `${MAIN.replace(/:main$/, '')}:subagent:renew`, startedAt: NOW - 3 * HOUR, endedAt: NOW - 2 * HOUR, status: 'error', error: 'DNS failed' },
    });
    setSources({ tasks: [failed] });
    renderView();

    fireEvent.click(toggleOf('Renew the certificate'));
    const row = itemOf('Renew the certificate');
    fireEvent.click(within(row).getByRole('button', { name: 'Reply' }));
    expect(within(row).getByRole('textbox', { name: 'Reply to Kim' })).toBeInTheDocument();
  });

  it('a row Reply sends into its own session and keeps the ranking', async () => {
    const failed = task({
      id: 'f1',
      title: 'Rebuild the index',
      status: 'todo',
      result: undefined,
      run: { sessionKey: 'agent:forge:subagent:rebuild', startedAt: NOW - 3 * HOUR, endedAt: NOW - 2 * HOUR, status: 'error', error: 'Tests failed' },
    });
    const value = setSources({ tasks: [task(), task({ id: 't2', title: 'Second review', resultAt: NOW - 20 * MINUTE }), failed] });
    const { onOpen } = renderView();
    const before = decideTitles();

    fireEvent.click(toggleOf('Rebuild the index'));
    const row = itemOf('Rebuild the index');
    fireEvent.click(within(row).getByRole('button', { name: 'Reply' }));
    const field = within(row).getByRole('textbox', { name: 'Reply to forge' });
    expect(within(row).getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.change(field, { target: { value: 'Why did the tests fail?' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0]).toMatchObject({ sessionKey: 'agent:forge:subagent:rebuild', message: 'Why did the tests fail?' });
    expect(onOpen).not.toHaveBeenCalled();

    const runId = sends()[0].idempotencyKey as string;
    emit({ sessionKey: 'agent:forge:subagent:rebuild', runId, state: 'final', seq: 1, message: 'A fixture was missing.' });
    const reply = within(itemOf('Rebuild the index')).getByTestId('inline-reply');
    expect(within(reply).getByText('A fixture was missing.')).toBeInTheDocument();
    // The box shows nothing for a reply asked from a row.
    expect(within(screen.getByRole('region', { name: 'Ask the agent' })).queryByTestId('inline-reply')).toBeNull();

    fireEvent.click(within(reply).getByRole('button', { name: 'Open in chat' }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'session', key: 'agent:forge:subagent:rebuild' });
    expect(decideTitles()).toEqual(before);
    expect(value.refresh).not.toHaveBeenCalled();
    expect(setCurrentSession).not.toHaveBeenCalled();
  });

  it('Start here Reply sends into the review run session', async () => {
    setSources({ tasks: [task()] });
    renderView();

    const start = screen.getByRole('region', { name: 'Start here' });
    fireEvent.click(within(start).getByRole('button', { name: 'Reply' }));
    const field = within(start).getByRole('textbox', { name: 'Reply to forge' });
    fireEvent.change(field, { target: { value: 'Did you rerun the full suite?' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0]).toMatchObject({ sessionKey: 'agent:forge:subagent:fix' });
    expect(within(start).queryByRole('textbox')).toBeNull();
    expect(within(start).getByTestId('inline-reply')).toBeInTheDocument();
  });

  it('a run error shows on the box with its reason', async () => {
    setSources();
    renderView();

    const box = screen.getByRole('textbox', { name: 'Ask Kim' });
    fireEvent.change(box, { target: { value: 'Hello' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(sends()).toHaveLength(1));

    emit({ sessionKey: MAIN, runId: sends()[0].idempotencyKey, state: 'error', seq: 1, errorMessage: 'model overloaded' });
    expect(screen.getByRole('alert')).toHaveTextContent('model overloaded');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.change(box, { target: { value: 'Try again' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('disconnected keeps sending off and says why', () => {
    gatewayMock.mockReturnValue({ connectionState: 'disconnected', rpc, subscribe } as never);
    setSources({ tasks: [task()] });
    renderView();

    const box = screen.getByRole('textbox', { name: 'Ask Kim' });
    fireEvent.change(box, { target: { value: 'Anyone there?' } });
    const ask = screen.getByRole('region', { name: 'Ask the agent' });
    expect(within(ask).getByText('Not connected')).toBeInTheDocument();
    expect(within(ask).getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(sends()).toHaveLength(0);
  });

  it('while the socket is still coming up the box says Connecting', () => {
    gatewayMock.mockReturnValue({ connectionState: 'connecting', rpc, subscribe } as never);
    setSources();
    renderView();

    const ask = screen.getByRole('region', { name: 'Ask the agent' });
    expect(within(ask).getByText('Connecting')).toBeInTheDocument();
    expect(within(ask).getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('falls back to the agent in the placeholder when the main agent has no name', () => {
    sessionMock.mockReturnValue({
      sessions: [{ key: MAIN, identityName: 'Agent', updatedAt: NOW - HOUR }],
      sessionsLoading: false,
      agentStatus: {},
      busyState: {},
    } as never);
    setSources();
    renderView();

    expect(screen.getByRole('textbox', { name: 'Ask the agent' })).toHaveAttribute('placeholder', 'Ask the agent...');
  });

  it('the box docks at the bottom, one line at rest', () => {
    setSources({ tasks: [task()] });
    renderView();
    const ask = screen.getByRole('region', { name: 'Ask the agent' });
    expect(ask.closest('.sticky')).not.toBeNull();
    expect(within(ask).getByRole('textbox', { name: 'Ask Kim' })).toHaveAttribute('rows', '1');
  });

  it('phones keep the box with a 44px Send', () => {
    setSources({ tasks: [task()] });
    renderView({ compact: true });

    const ask = screen.getByRole('region', { name: 'Ask the agent' });
    expect(within(ask).getByRole('button', { name: 'Send' }).className).toContain('min-h-[44px]');
  });
});

describe('What happened summaries', () => {
  const REVIEW = 'agent:forge:subagent:review';
  const THEN = 'agent:forge:subagent:then';
  const FAILED = 'agent:forge:subagent:failed';
  const RUNNING = 'agent:forge:subagent:running';

  function board() {
    return [
      task({ id: 't1', title: 'Fix the flaky retry test', priority: 'high', run: { sessionKey: REVIEW, startedAt: NOW - 3 * HOUR, endedAt: NOW - 90 * MINUTE, status: 'done' } }),
      task({ id: 't2', title: 'Tidy the changelog', run: { sessionKey: THEN, startedAt: NOW - 3 * HOUR, endedAt: NOW - 80 * MINUTE, status: 'done' } }),
      task({
        id: 'f1',
        title: 'Rebuild the index',
        status: 'todo',
        result: undefined,
        run: { sessionKey: FAILED, startedAt: NOW - 3 * HOUR, endedAt: NOW - 2 * HOUR, status: 'error', error: 'Tests failed' },
      }),
      task({
        id: 'r1',
        title: 'Index the archive',
        status: 'in-progress',
        result: undefined,
        updatedAt: NOW - 10 * MINUTE,
        run: { sessionKey: RUNNING, startedAt: NOW - 10 * MINUTE, status: 'running' },
      }),
    ];
  }

  function lastKeys(): string[] {
    const calls = summariesMock.mock.calls;
    return [...calls[calls.length - 1][0].sessionKeys].sort();
  }

  it('asks only for Start here until a row is opened, then for that row too', () => {
    setSources({ tasks: board() });
    renderView();
    expect(lastKeys()).toEqual([REVIEW]);
    expect(summariesMock.mock.calls.at(-1)![0].active).toBe(true);

    fireEvent.click(toggleOf('Rebuild the index'));
    expect(lastKeys()).toEqual([FAILED, REVIEW].sort());
    fireEvent.click(toggleOf('Tidy the changelog'));
    expect(lastKeys()).toEqual([FAILED, REVIEW, THEN].sort());
    // A running task lives on its agent's line, not as a row.
    expect(lastKeys()).not.toContain(RUNNING);
  });

  it('on phones asks the same way', () => {
    setSources({ tasks: board() });
    renderView({ compact: true });
    expect(lastKeys()).toEqual([REVIEW]);
  });

  it('shows ready text in full on Start here and an open row, and Summarizing while pending', () => {
    summariesMock.mockImplementation(() => ({
      [REVIEW]: { status: 'ready', text: 'You asked for a retry fix. Forge patched it and waits for review.' },
      [THEN]: { status: 'pending' },
      [FAILED]: { status: 'error' },
    }));
    setSources({ tasks: board() });
    renderView();

    const start = screen.getByRole('region', { name: 'Start here' });
    expect(within(start).getByText(/Forge patched it and waits for review/)).toBeInTheDocument();
    expect(screen.queryByText(/Summarizing\.\.\./)).toBeNull();
    fireEvent.click(toggleOf('Tidy the changelog'));
    expect(within(itemOf('Tidy the changelog')).getByText(/Summarizing\.\.\./)).toBeInTheDocument();
    fireEvent.click(toggleOf('Rebuild the index'));
    expect(within(itemOf('Rebuild the index')).queryByText(/Summarizing/)).toBeNull();
  });

  it('keeps the old text while a summary is refreshed and says nothing for an empty thread', () => {
    summariesMock.mockImplementation(() => ({
      [REVIEW]: { status: 'pending', text: 'Earlier summary.' },
      [THEN]: { status: 'empty' },
    }));
    setSources({ tasks: board() });
    renderView();
    fireEvent.click(toggleOf('Tidy the changelog'));
    expect(screen.getByText(/Earlier summary\./)).toBeInTheDocument();
    expect(screen.queryByText(/Summarizing/)).not.toBeInTheDocument();
  });

  it('asks for nothing when the brief is all clear', () => {
    setSources();
    renderView();
    expect(lastKeys()).toEqual([]);
  });
});
