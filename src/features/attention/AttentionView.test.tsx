import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanTask } from '@/features/kanban/types';
import type { KanbanProposal } from '@/features/kanban/hooks/useProposals';
import type { CronJob } from '@/features/workspace/hooks/useCrons';
import type { Session } from '@/types';
import { formatClock } from './briefCopy';
import type { OpenTarget, SourceStatus } from './types';
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

function cardTitles(): string[] {
  return screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent ?? '');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  sessionMock.mockReturnValue({ sessions: [], sessionsLoading: false, agentStatus: {}, busyState: {} });
  gatewayMock.mockReturnValue({ connectionState: 'connected' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AttentionView', () => {
  it('shows Start here with No evidence attached and opens the task', () => {
    setSources({ tasks: [task()] });
    const { onOpen } = renderView();

    const start = screen.getByRole('region', { name: 'Start here' });
    expect(within(start).getByText('Fix the flaky retry test')).toBeInTheDocument();
    expect(within(start).getByText('No evidence attached')).toBeInTheDocument();
    expect(within(start).getByText(/Patched the retry backoff/)).toBeInTheDocument();

    fireEvent.click(within(start).getByRole('button', { name: 'Open review' }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'task', id: 't1' });

    fireEvent.click(within(start).getByRole('button', { name: 'Open session' }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'session', key: 'agent:forge:subagent:fix' });
  });

  it('empty state only when every source is live', () => {
    setSources();
    const { unmount } = renderView();
    expect(
      screen.getByText(hasText(`Nothing needs you. Checked tasks, proposals and crons at ${formatClock(NOW)}.`)),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/session failures show from when this page opened/i).length).toBeGreaterThan(0);
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

  it('shows the footer only once a live source has reported, with that time', () => {
    const loading: Record<Polled, SourceStatus> = {
      tasks: { state: 'loading' },
      proposals: { state: 'loading' },
      crons: { state: 'loading' },
    };
    setSources({ sources: loading });
    const { rerenderWith } = renderView();
    expect(screen.queryByText(hasText(/That is everything the live sources reported/))).not.toBeInTheDocument();

    const checkedAt = NOW - 4 * MINUTE;
    setSources({ sources: { ...loading, tasks: { state: 'live', checkedAt } } });
    rerenderWith({});
    expect(
      screen.getByText(hasText(`That is everything the live sources reported at ${formatClock(checkedAt)}.`)),
    ).toBeInTheDocument();
  });

  it('errored crons source shows its message and an Open Crons link', () => {
    setSources({ sources: { ...allLive(), crons: { state: 'error', error: 'HTTP 502' } } });
    const { onOpen } = renderView();

    expect(screen.getAllByText('Crons could not be read (HTTP 502).').length).toBeGreaterThan(0);
    const links = screen.getAllByRole('button', { name: 'Open Crons' });
    fireEvent.click(links[0]);
    expect(onOpen).toHaveBeenCalledWith({ type: 'source', source: 'crons' });
  });

  it('Mark seen collapses finished items into the Seen line', () => {
    setSources({ crons: [cron()] });
    renderView();

    expect(screen.getByText('Morning brief')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark seen' }));

    expect(screen.queryByText('Morning brief')).not.toBeInTheDocument();
    const seenLine = screen.getByRole('button', { name: 'Seen (1)' });
    expect(seenLine).toHaveAttribute('aria-expanded', 'false');
    expect(JSON.parse(localStorage.getItem('nerve:attention:seen') ?? '[]')).toHaveLength(1);

    fireEvent.click(seenLine);
    expect(screen.getByText('Morning brief')).toBeInTheDocument();
  });

  it('compact renders rows with 44px or taller targets', () => {
    setSources({
      tasks: [task(), task({ id: 't2', title: 'Write the ship notes', resultAt: NOW - 30 * MINUTE })],
      crons: [cron({ id: 'c2', name: 'Nightly backup', lastStatus: 'error', lastError: 'AccessDenied' })],
    });
    const { onOpen } = renderView({ compact: true });

    // On phones Start here has one filled button, the decision; the rest are text buttons.
    const start = screen.getByRole('region', { name: 'Start here' });
    const startButtons = within(start).getAllByRole('button');
    const filled = startButtons.filter((button) => button.className.includes('bg-primary'));
    expect(filled).toHaveLength(1);
    expect(filled[0]).toHaveTextContent('Approve');
    expect(startButtons.map((button) => button.textContent)).toEqual(['Approve', 'Request changes', 'Open review', 'Reply']);
    for (const button of startButtons) expect(button.className).toContain('min-h-11');
    const rows = screen.getAllByTestId('attention-row');
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.tagName).toBe('BUTTON');
      const match = row.className.match(/min-h-\[(\d+)px\]/);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBeGreaterThanOrEqual(44);
    }

    const backupRow = rows.find((row) => row.textContent?.includes('Nightly backup'));
    fireEvent.click(backupRow!);
    expect(onOpen).toHaveBeenCalledWith({ type: 'cron', id: 'c2' });
  });

  it('disconnected shows last brief with the not connected line', () => {
    setSources({ tasks: [task()] });
    const { rerenderWith } = renderView();
    expect(screen.queryByText(hasText(/Not connected since/))).not.toBeInTheDocument();

    vi.setSystemTime(NOW + 7 * MINUTE);
    gatewayMock.mockReturnValue({ connectionState: 'reconnecting' });
    rerenderWith({});

    expect(
      screen.getByText(hasText(new RegExp(`Not connected since ${formatClock(NOW + 7 * MINUTE)}`))),
    ).toBeInTheDocument();
    expect(screen.getByText('Fix the flaky retry test')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing needs you/)).not.toBeInTheDocument();
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
    expect(screen.getAllByText(/Sessions could not be read \(not connected\)/).length).toBeGreaterThan(0);
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
      sessions: [{ key: 'agent:kim:subagent:abc', label: 'Research worker', updatedAt: NOW - 10 * MINUTE }],
      sessionsLoading: false,
      agentStatus: {},
      busyState: { 'agent:kim:subagent:abc': true },
    });
    rerenderWith({});

    expect(screen.getByText('Research worker')).toBeInTheDocument();
    expect(screen.queryByText('New')).not.toBeInTheDocument();
    expect(screen.queryByText(hasText(/Not connected since/))).not.toBeInTheDocument();

    // The baseline now holds the session, so a later arrival is the only New item.
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

  it('keeps Since you left across leaving the view and coming back in one page session', () => {
    localStorage.setItem('nerve:attention:lastLook', String(NOW - 5 * HOUR));
    setSources();
    const { rerenderWith } = renderView();

    const heading = () => screen.getByRole('heading', { level: 1 }).textContent;
    const before = heading();
    expect(before).toMatch(/^Since you left /);
    expect(before).toContain(formatClock(NOW - 5 * HOUR));

    vi.setSystemTime(NOW + 5 * MINUTE);
    rerenderWith({ active: false });
    // The next page load gets the new time, but this session keeps the one it started with.
    expect(localStorage.getItem('nerve:attention:lastLook')).toBe(String(NOW + 5 * MINUTE));
    rerenderWith({ active: true });

    expect(heading()).toBe(before);
  });

  it('marking every failure seen keeps a Seen count in the all-clear block', () => {
    setSources({
      tasks: [task({
        status: 'todo',
        result: undefined,
        run: {
          sessionKey: 'agent:forge:subagent:fix',
          startedAt: NOW - 3 * HOUR,
          endedAt: NOW - 2 * HOUR,
          status: 'error',
          error: 'Tests failed',
        },
      })],
    });
    renderView();

    expect(screen.getByRole('heading', { name: 'Blocked or failed' })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing needs you/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark seen' }));

    expect(screen.getByText(hasText(/Nothing needs you\. Checked/))).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Blocked or failed' })).not.toBeInTheDocument();
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

    // Tasks answer first with only the newer review.
    setSources({ tasks: [newer], sources: { ...loading, tasks: live() } });
    rerenderWith({});
    expect(screen.queryByText(/Nothing needs you/)).not.toBeInTheDocument();
    expect(screen.queryByText('New')).not.toBeInTheDocument();

    // The rest answer, and the older review ranks first.
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
    expect(cardTitles()).toEqual(['First review', 'Second review']);

    rerenderWith({ active: false });

    // Reopened with the previous answers still in place; a new older item arrives but nothing re-ranks.
    const earlier = task({ id: 't3', title: 'Earlier review', resultAt: NOW - 3 * HOUR });
    setSources({ tasks: [first, second, earlier], sources: status });
    rerenderWith({ active: true });
    expect(cardTitles()).toEqual(['First review', 'Second review', 'Earlier review']);
    expect(screen.queryByText('New')).not.toBeInTheDocument();

    // Fresh answers land: the brief re-ranks as a new baseline.
    setSources({ tasks: [first, second, earlier], sources: allLive() });
    rerenderWith({});
    expect(cardTitles()).toEqual(['Earlier review', 'First review', 'Second review']);
    expect(screen.queryByText('New')).not.toBeInTheDocument();
  });

  it('tags items that arrive while the brief is open as New, at the end', () => {
    const first = task({ id: 't1', title: 'First review', resultAt: NOW - HOUR });
    setSources({ tasks: [first] });
    const { rerenderWith } = renderView();

    const earlier = task({ id: 't3', title: 'Earlier review', resultAt: NOW - 3 * HOUR });
    setSources({ tasks: [first, earlier] });
    rerenderWith({});
    expect(cardTitles()).toEqual(['First review', 'Earlier review']);
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
    expect(cardTitles()).toEqual(['Earlier review', 'First review']);
    expect(screen.queryByText('New')).not.toBeInTheDocument();
  });

  describe('per-item Mark seen', () => {
    function failedTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
      return task({
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

    it('per-item Mark seen hides only that failure', () => {
      setSources({
        tasks: [
          failedTask({ id: 'f1', title: 'Rebuild the index' }),
          failedTask({ id: 'f2', title: 'Rotate the logs' }),
        ],
      });
      renderView();

      expect(screen.getByRole('button', { name: 'Rebuild the index' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Rotate the logs' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Mark Rebuild the index seen' }));

      expect(screen.queryByRole('button', { name: 'Rebuild the index' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Rotate the logs' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mark Rotate the logs seen' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Seen (1)' })).toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem('nerve:attention:seen') ?? '[]')).toHaveLength(1);
    });

    it('per-item Mark seen does not open the item', () => {
      setSources({
        tasks: [failedTask({ id: 'f1', title: 'Rebuild the index' })],
        crons: [cron()],
      });
      const { onOpen } = renderView();

      fireEvent.click(screen.getByRole('button', { name: 'Mark Rebuild the index seen' }));
      fireEvent.click(screen.getByRole('button', { name: 'Mark Morning brief seen' }));

      expect(onOpen).not.toHaveBeenCalled();
      // One Seen line in Blocked or failed, one in Recently finished.
      expect(screen.getAllByRole('button', { name: 'Seen (1)' })).toHaveLength(2);
      expect(screen.queryByText('Morning brief')).not.toBeInTheDocument();
    });

    it('is a 44px target on phone rows and absent from Decide now and In progress items', () => {
      sessionMock.mockReturnValue({
        sessions: [{ key: 'agent:kim:subagent:abc', label: 'Research worker', updatedAt: NOW - 10 * MINUTE }],
        sessionsLoading: false,
        agentStatus: {},
        busyState: { 'agent:kim:subagent:abc': true },
      });
      setSources({
        tasks: [
          task(),
          task({ id: 't2', title: 'Write the ship notes', resultAt: NOW - 30 * MINUTE }),
          failedTask({ id: 'f1', title: 'Rebuild the index' }),
        ],
        crons: [cron()],
      });
      renderView({ compact: true });

      expect(screen.getByText('Research worker')).toBeInTheDocument();
      const marks = screen.getAllByRole('button', { name: /^Mark .+ seen$/ });
      expect(marks.map((button) => button.getAttribute('aria-label')).sort()).toEqual([
        'Mark Morning brief seen',
        'Mark Rebuild the index seen',
      ]);
      for (const button of marks) {
        expect(button.tagName).toBe('BUTTON');
        expect(button).toHaveAttribute('type', 'button');
        expect(button.className).toContain('min-h-[44px]');
        expect(button.closest('[data-testid="attention-row"]')).toBeNull();
      }
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
      return fetchMock.mock.calls.map(([url, init]) => ({
        url,
        method: init?.method,
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      }));
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

    function cardOf(title: string): HTMLElement {
      return screen.getByRole('button', { name: title }).closest('article')!;
    }

    function rowOf(title: string): HTMLElement {
      const row = screen.getAllByTestId('attention-row').find((button) => button.textContent?.includes(title));
      // The row's own line, then the line under it for Stop's confirm and errors.
      return row!.parentElement!.parentElement!;
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
      expect(fetchMock).not.toHaveBeenCalled();

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
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a failed action shows the server error on the card and re-enables the buttons', async () => {
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

    it('a pending proposal can be approved or rejected from its card', async () => {
      const value = setSources({
        tasks: [task({ resultAt: NOW - 5 * HOUR })],
        proposals: [proposal(), proposal({ id: 'p2', payload: { title: 'Prune old branches' }, proposedAt: NOW - 2 * HOUR })],
      });
      const { onOpen } = renderView();

      fireEvent.click(within(cardOf('Write release notes')).getByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(1));

      fireEvent.click(within(cardOf('Prune old branches')).getByRole('button', { name: 'Reject' }));
      await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(2));

      expect(calls()).toEqual([
        { url: '/api/kanban/proposals/p1/approve', method: 'POST', body: undefined },
        { url: '/api/kanban/proposals/p2/reject', method: 'POST', body: {} },
      ]);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('a failed run can be retried from its card', async () => {
      const value = setSources({ tasks: [failedTask()] });
      const { onOpen } = renderView();

      fireEvent.click(within(cardOf('Rebuild the index')).getByRole('button', { name: 'Retry' }));

      await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(1));
      expect(calls()).toEqual([{ url: '/api/kanban/tasks/f1/execute', method: 'POST', body: {} }]);
      expect(within(cardOf('Rebuild the index')).getByRole('button', { name: 'Started' })).toBeDisabled();
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('Stop on a running row needs the confirm step', async () => {
      const value = setSources({ tasks: [runningTask()] });
      const { onOpen } = renderView();

      fireEvent.click(within(rowOf('Index the archive')).getByRole('button', { name: 'Stop' }));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(within(rowOf('Index the archive')).getByText('Stop run?')).toBeInTheDocument();

      fireEvent.click(within(rowOf('Index the archive')).getByRole('button', { name: 'Cancel' }));
      expect(within(rowOf('Index the archive')).queryByText('Stop run?')).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();

      fireEvent.click(within(rowOf('Index the archive')).getByRole('button', { name: 'Stop' }));
      fireEvent.click(within(rowOf('Index the archive')).getByRole('button', { name: 'Confirm' }));

      await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(1));
      expect(calls()).toEqual([{ url: '/api/kanban/tasks/r1/abort', method: 'POST', body: {} }]);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('Stop on a gone-quiet card needs the confirm step', async () => {
      const value = setSources({
        tasks: [runningTask({ updatedAt: NOW - 5 * HOUR, run: { startedAt: NOW - 5 * HOUR, status: 'running' } })],
      });
      const { onOpen } = renderView();
      const card = cardOf('Index the archive');

      fireEvent.click(within(card).getByRole('button', { name: 'Stop' }));
      expect(fetchMock).not.toHaveBeenCalled();
      fireEvent.click(within(card).getByRole('button', { name: 'Confirm' }));

      await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(1));
      expect(calls()).toEqual([{ url: '/api/kanban/tasks/r1/abort', method: 'POST', body: {} }]);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('a failed cron can be run now or paused from its card', async () => {
      const crons = [
        cron({ id: 'c2', name: 'Nightly backup', lastStatus: 'error', lastError: 'AccessDenied' }),
        cron({ id: 'c3', name: 'Weekly digest', lastStatus: 'error', lastError: 'Timeout' }),
      ];
      const value = setSources({ crons });
      const { onOpen } = renderView();

      fireEvent.click(within(cardOf('Nightly backup')).getByRole('button', { name: 'Run now' }));
      await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(1));

      fireEvent.click(within(cardOf('Weekly digest')).getByRole('button', { name: 'Pause' }));
      await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(2));

      expect(calls()).toEqual([
        { url: '/api/crons/c2/run', method: 'POST', body: undefined },
        { url: '/api/crons/c3/toggle', method: 'POST', body: { enabled: false } },
      ]);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('after Run now the cron card stays and Pause still works', async () => {
      const value = setSources({ crons: [cron({ id: 'c2', name: 'Nightly backup', lastStatus: 'error' })] });
      renderView();
      const card = cardOf('Nightly backup');

      fireEvent.click(within(card).getByRole('button', { name: 'Run now' }));
      expect(await within(card).findByRole('button', { name: 'Started' })).toBeDisabled();
      expect(within(card).getByRole('button', { name: 'Pause' })).toBeEnabled();

      fireEvent.click(within(card).getByRole('button', { name: 'Pause' }));
      await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(2));
      expect(within(card).getByRole('button', { name: 'Paused' })).toBeDisabled();
      expect(calls().map((call) => call.url)).toEqual(['/api/crons/c2/run', '/api/crons/c2/toggle']);
    });

    it('a failed cron run shows the gateway error on the card', async () => {
      fetchMock.mockImplementationOnce(async () => respond(502, { ok: false, error: 'gateway down' }));
      const value = setSources({ crons: [cron({ id: 'c2', name: 'Nightly backup', lastStatus: 'error' })] });
      renderView();
      const card = cardOf('Nightly backup');

      fireEvent.click(within(card).getByRole('button', { name: 'Run now' }));

      expect(await within(card).findByRole('alert')).toHaveTextContent('Could not run: gateway down');
      expect(within(card).getByRole('button', { name: 'Run now' })).toBeEnabled();
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
      expect(within(start).getAllByRole('button').map((button) => button.textContent)).toEqual(['Open review', 'Open session', 'Reply']);
      for (const name of ['Approve', 'Reject', 'Request changes', 'Retry', 'Stop']) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
      }
      expect(screen.getByRole('button', { name: 'Run now' })).toBeInTheDocument();
    });

    it('session items have no actions', () => {
      sessionMock.mockReturnValue({
        sessions: [{ key: 'agent:kim:subagent:abc', label: 'Research worker', updatedAt: NOW - 10 * MINUTE }],
        sessionsLoading: false,
        agentStatus: {},
        busyState: { 'agent:kim:subagent:abc': true },
      });
      setSources();
      renderView();

      expect(within(rowOf('Research worker')).getAllByRole('button')).toHaveLength(1);
    });

    it('phone rows carry the main action as a 44px chip beside the row', async () => {
      const value = setSources({ tasks: [task({ resultAt: NOW - 5 * HOUR }), failedTask(), runningTask()] });
      const { onOpen } = renderView({ compact: true });

      const retry = within(rowOf('Rebuild the index')).getByRole('button', { name: 'Retry' });
      expect(retry.className).toContain('min-h-[44px]');
      expect(retry.closest('[data-testid="attention-row"]')).toBeNull();
      expect(within(rowOf('Index the archive')).getByRole('button', { name: 'Stop' }).className).toContain('min-h-[44px]');

      fireEvent.click(retry);
      await waitFor(() => expect(value.refresh).toHaveBeenCalledTimes(1));
      expect(calls()).toEqual([{ url: '/api/kanban/tasks/f1/execute', method: 'POST', body: {} }]);
      expect(onOpen).not.toHaveBeenCalled();
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

  it('a card Reply sends into its own session and keeps the ranking', async () => {
    const failed = task({
      id: 'f1',
      title: 'Rebuild the index',
      status: 'todo',
      result: undefined,
      run: { sessionKey: 'agent:forge:subagent:rebuild', startedAt: NOW - 3 * HOUR, endedAt: NOW - 2 * HOUR, status: 'error', error: 'Tests failed' },
    });
    const value = setSources({ tasks: [task(), failed] });
    const { onOpen } = renderView();
    const before = cardTitles();

    const card = screen.getByRole('button', { name: 'Rebuild the index' }).closest('article')!;
    fireEvent.click(within(card).getByRole('button', { name: 'Reply' }));
    const field = within(card).getByRole('textbox', { name: 'Reply to forge' });
    expect(within(card).getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.change(field, { target: { value: 'Why did the tests fail?' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0]).toMatchObject({ sessionKey: 'agent:forge:subagent:rebuild', message: 'Why did the tests fail?' });
    expect(onOpen).not.toHaveBeenCalled();

    const runId = sends()[0].idempotencyKey as string;
    emit({ sessionKey: 'agent:forge:subagent:rebuild', runId, state: 'final', seq: 1, message: 'A fixture was missing.' });
    const reply = within(card).getByTestId('inline-reply');
    expect(within(reply).getByText('A fixture was missing.')).toBeInTheDocument();
    // The box shows nothing for a reply asked from a card.
    expect(within(screen.getByRole('region', { name: 'Ask the agent' })).queryByTestId('inline-reply')).toBeNull();

    fireEvent.click(within(reply).getByRole('button', { name: 'Open in chat' }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'session', key: 'agent:forge:subagent:rebuild' });
    expect(cardTitles()).toEqual(before);
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

  it('phones keep the box with a 44px Send', () => {
    setSources({ tasks: [task()] });
    renderView({ compact: true });

    const ask = screen.getByRole('region', { name: 'Ask the agent' });
    expect(within(ask).getByRole('button', { name: 'Send' }).className).toContain('min-h-[44px]');
  });
});
