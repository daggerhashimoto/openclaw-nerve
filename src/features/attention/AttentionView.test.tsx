import { fireEvent, render, screen, within } from '@testing-library/react';
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

    expect(screen.getByRole('region', { name: 'Start here' })).toBeInTheDocument();
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
});
