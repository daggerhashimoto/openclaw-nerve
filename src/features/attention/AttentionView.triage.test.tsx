/**
 * The Now board's interaction layer: deferred sends with Undo and receipts, focus and the live
 * region, keyboard triage, the new-items pill, one composer at a time, and Today staying mounted.
 * Today is a stateful stub here, so these tests do not depend on its contents.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanTask } from '@/features/kanban/types';
import type { KanbanProposal } from '@/features/kanban/hooks/useProposals';
import type { Session } from '@/types';
import { setAttentionSegment } from './attentionSegment';
import { UNDO_WINDOW_MS } from './deferredActions';
import type { OpenTarget, SourceStatus } from './types';
import { AttentionView } from './AttentionView';

const NOW = Date.UTC(2026, 10, 27, 8, 22);
const MINUTE = 60_000;
const HOUR = 3_600_000;

type Polled = 'tasks' | 'proposals' | 'crons';

const sourcesMock = vi.fn();
const sessionMock = vi.fn();
const gatewayMock = vi.fn();
const todayMounts = vi.fn();
const todayActive = vi.fn();

vi.mock('./useAttentionSummaries', () => ({ useAttentionSummaries: () => ({}) }));
vi.mock('./useAttentionSources', () => ({ useAttentionSources: () => sourcesMock() }));
vi.mock('@/contexts/SessionContext', () => ({ useSessionContext: () => sessionMock() }));
vi.mock('@/contexts/GatewayContext', () => ({ useGateway: () => gatewayMock() }));
vi.mock('./today/TodayView', () => ({
  TodayView: ({ active }: { active: boolean }) => {
    const [draft, setDraft] = useState('');
    useEffect(() => { todayMounts(); }, []);
    todayActive(active);
    return (
      <section aria-label="Today stub">
        <input aria-label="Today draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
      </section>
    );
  },
}));

const handlers = new Set<(event: { type: 'event'; event: string; payload: unknown }) => void>();
const rpc = vi.fn(async (method: string, params?: Record<string, unknown>) => (
  method === 'chat.send' ? { runId: params?.idempotencyKey, status: 'started' } : method === 'exec.approval.list' ? [] : {}
));
const subscribe = (handler: (event: { type: 'event'; event: string; payload: unknown }) => void) => {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
};
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

function task(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: 't1',
    title: 'Rotate the API keys',
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
    result: 'Rotated them.',
    resultAt: NOW - 90 * MINUTE,
    run: { sessionKey: 'agent:forge:subagent:keys', startedAt: NOW - 3 * HOUR, endedAt: NOW - 90 * MINUTE, status: 'done' },
    ...overrides,
  };
}

function failedTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return task({
    id: 'f1',
    title: 'Rebuild the index',
    status: 'todo',
    result: undefined,
    run: { sessionKey: 'agent:forge:subagent:index', startedAt: NOW - 3 * HOUR, endedAt: NOW - 2 * HOUR, status: 'error', error: 'Tests failed' },
    ...overrides,
  });
}

function proposal(overrides: Partial<KanbanProposal> = {}): KanbanProposal {
  return {
    id: 'p1',
    type: 'create',
    payload: { title: 'Write release notes' },
    proposedBy: 'agent:kim',
    proposedAt: NOW - 30 * MINUTE,
    status: 'pending',
    version: 1,
    ...overrides,
  };
}

function live(): Record<Polled, SourceStatus> {
  return { tasks: { state: 'live', checkedAt: NOW }, proposals: { state: 'live', checkedAt: NOW }, crons: { state: 'live', checkedAt: NOW } };
}

function setSources(overrides: { tasks?: KanbanTask[]; proposals?: KanbanProposal[]; refresh?: () => void } = {}) {
  const value = { tasks: [], proposals: [], crons: [], sources: live(), refresh: vi.fn(), ...overrides };
  sourcesMock.mockReturnValue(value);
  return value;
}

function renderView(props: Partial<Parameters<typeof AttentionView>[0]> = {}) {
  const onOpen = vi.fn<(target: OpenTarget) => void>();
  const all = { active: true, compact: false, kanbanEnabled: true, onOpen, ...props };
  const utils = render(<AttentionView {...all} />);
  return { ...utils, onOpen, rerenderWith: (next: Partial<typeof all> = {}) => utils.rerender(<AttentionView {...all} {...next} />) };
}

async function pass(ms = UNDO_WINDOW_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function itemOf(title: string): HTMLElement {
  const el = screen.getAllByTestId('attention-row-title').find((node) => node.textContent === title);
  if (!el) throw new Error(`No row titled ${title}`);
  return el.closest('[data-testid="attention-item"]') as HTMLElement;
}

const toggleOf = (title: string) => within(itemOf(title)).getByTestId('attention-row');
const plate = () => screen.getByRole('region', { name: 'Start here' });
const announcer = () => screen.getByTestId('attention-announcer');
/** A key on whatever has focus, as the keyboard sends it. */
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });

function urls() {
  return fetchMock.mock.calls.map(([url]) => url).filter((url) => !url.endsWith('/runs') && url !== '/api/attention/summaries');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  setAttentionSegment('now');
  handlers.clear();
  rpc.mockClear();
  todayMounts.mockClear();
  todayActive.mockClear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  gatewayMock.mockReturnValue({ connectionState: 'connected', rpc, subscribe });
  sessionMock.mockReturnValue({
    sessions: [{ key: 'agent:forge:main', identityName: 'Forge', updatedAt: NOW - HOUR }] as Session[],
    sessionsLoading: false,
    agentStatus: {},
    busyState: {},
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('deferred sends with undo', () => {
  it('Undo puts the item back where it was, with focus on it, and nothing is sent', async () => {
    setSources({ tasks: [task(), task({ id: 't2', title: 'Second review', resultAt: NOW - 20 * MINUTE }), task({ id: 't3', title: 'Third review', resultAt: NOW - 10 * MINUTE })] });
    renderView();

    fireEvent.click(within(itemOf('Second review')).getByRole('button', { name: 'Approve' }));
    const receipt = screen.getByTestId('attention-receipt');
    expect(receipt).toHaveTextContent('Approved ‘Second review’');
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('2 to decide');

    fireEvent.click(within(receipt).getByRole('button', { name: 'Undo' }));
    const rows = screen.getAllByTestId('attention-row-title').map((node) => node.textContent);
    expect(rows).toEqual(['Second review', 'Third review']);
    expect(document.activeElement).toBe(toggleOf('Second review'));
    expect(announcer()).toHaveTextContent('Undone. ‘Second review’ is back.');
    await pass();
    expect(urls()).toEqual([]);
  });

  it('Undo on the plate gives the plate back to the item', () => {
    setSources({ tasks: [task(), task({ id: 't2', title: 'Second review', resultAt: NOW - 20 * MINUTE })] });
    renderView();

    fireEvent.click(within(plate()).getByRole('button', { name: 'Approve' }));
    expect(within(plate()).getByRole('heading', { level: 3 })).toHaveTextContent('Second review');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(plate()).getByRole('heading', { level: 3 })).toHaveTextContent('Rotate the API keys');
    expect(document.activeElement).toBe(plate());
  });

  it('a hidden or closing page sends what is waiting at once, with keepalive', () => {
    setSources({ tasks: [failedTask()] });
    renderView();

    fireEvent.click(within(itemOf('Rebuild the index')).getByRole('button', { name: 'Retry' }));
    expect(urls()).toEqual([]);
    window.dispatchEvent(new Event('pagehide'));
    expect(urls()).toEqual(['/api/kanban/tasks/f1/execute']);
    const init = fetchMock.mock.calls.find(([url]) => url === '/api/kanban/tasks/f1/execute')?.[1];
    expect(init).toEqual(expect.objectContaining({ keepalive: true }));
  });

  it('lists what was handled this visit, collapsed, with the time and how it went', async () => {
    fetchMock.mockImplementation(async (url: string) => (
      url.includes('/proposals/') ? new Response(JSON.stringify({ error: 'gone' }), { status: 409 }) : new Response('{}', { status: 200 })
    ));
    setSources({ tasks: [task()], proposals: [proposal()] });
    renderView();

    expect(screen.queryByRole('button', { name: /Handled this visit/ })).toBeNull();
    fireEvent.click(within(plate()).getByRole('button', { name: 'Approve' }));
    await pass();
    fireEvent.click(within(plate()).getByRole('button', { name: 'Approve' }));
    await pass();

    const toggle = screen.getByRole('button', { name: /Handled this visit/ });
    expect(toggle).toHaveTextContent('Handled this visit (2)');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByTestId('handled-receipt')).toHaveLength(0);
    fireEvent.click(toggle);
    const lines = screen.getAllByTestId('handled-receipt').map((node) => node.textContent);
    expect(lines[0]).toMatch(/^\d\d:\d\d.*Could not approve ‘Write release notes’/);
    expect(lines[1]).toMatch(/^\d\d:\d\d.*Approved ‘Rotate the API keys’/);
  });
});

describe('focus and announcements', () => {
  it('after an action focus goes to the next item and the region says what is next', () => {
    setSources({ tasks: [failedTask(), task(), task({ id: 't2', title: 'Second review', resultAt: NOW - 20 * MINUTE })] });
    renderView();

    toggleOf('Rebuild the index').focus();
    fireEvent.click(within(itemOf('Rebuild the index')).getByRole('button', { name: 'Retry' }));
    expect(document.activeElement).toBe(plate());
    expect(announcer()).toHaveTextContent('Retried ‘Rebuild the index’. 2 left, next: Review, Rotate the API keys.');
  });

  it('when the last item leaves, focus goes to its section heading', () => {
    setSources({ tasks: [task()] });
    renderView();
    fireEvent.click(within(plate()).getByRole('button', { name: 'Approve' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Waiting on you' }));
    expect(announcer()).toHaveTextContent('Nothing else waiting.');
  });

  it('Mark seen moves focus on to the next failure', () => {
    setSources({ tasks: [failedTask(), failedTask({ id: 'f2', title: 'Rotate the logs' })] });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Rebuild the index seen' }));
    expect(document.activeElement).toBe(toggleOf('Rotate the logs'));
  });

  it('closing the note gives focus back to what opened it, by Cancel or Escape', () => {
    setSources({ tasks: [task()] });
    renderView();
    const opener = within(plate()).getByRole('button', { name: 'Request changes' });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(within(plate()).getByRole('textbox', { name: 'What needs to change' }));
    fireEvent.click(within(plate()).getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    fireEvent.keyDown(within(plate()).getByRole('textbox'), { key: 'Escape' });
    expect(within(plate()).queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closing the reply field gives focus back to Reply, after Send too, and a finished reply is announced', async () => {
    setSources({ tasks: [task()] });
    renderView();
    const reply = within(plate()).getByRole('button', { name: 'Reply' });
    reply.focus();
    fireEvent.click(reply);
    fireEvent.keyDown(within(plate()).getByRole('textbox'), { key: 'Escape' });
    expect(document.activeElement).toBe(reply);

    fireEvent.click(reply);
    const field = within(plate()).getByRole('textbox', { name: 'Reply to Forge' });
    fireEvent.change(field, { target: { value: 'Ship it' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(document.activeElement).toBe(within(plate()).getByRole('button', { name: 'Reply' }));

    await pass(0);
    const send = rpc.mock.calls.find(([method]) => method === 'chat.send');
    const runId = send?.[1]?.idempotencyKey as string;
    // The reply's own region mounts empty, then says the run.
    const status = within(screen.getByTestId('inline-reply')).getByRole('status');
    expect(status).toHaveTextContent('');
    await pass(100);
    expect(status).toHaveTextContent('Forge is working');

    act(() => {
      for (const handler of [...handlers]) handler({ type: 'event', event: 'chat', payload: { sessionKey: 'agent:forge:subagent:keys', runId, state: 'final', seq: 1, message: 'Shipped.' } });
    });
    expect(announcer()).toHaveTextContent('Forge replied');
  });
});

describe('keyboard triage', () => {
  function board() {
    sessionMock.mockReturnValue({
      sessions: [{ key: 'agent:forge:main', identityName: 'Forge', updatedAt: NOW - HOUR }] as Session[],
      sessionsLoading: false,
      agentStatus: {},
      busyState: {},
    });
    return setSources({ tasks: [failedTask(), task()], proposals: [proposal()] });
  }

  it('j and k move over Failing, Waiting on you and the Agents strip in board order', () => {
    board();
    renderView();
    press('j');
    expect(document.activeElement).toBe(toggleOf('Rebuild the index'));
    press('j');
    expect(document.activeElement).toBe(plate());
    press('ArrowDown');
    expect(document.activeElement).toBe(toggleOf('Write release notes'));
    press('j');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: "Open Forge's chat" }));
    press('k');
    press('ArrowUp');
    expect(document.activeElement).toBe(plate());
  });

  it('Enter opens and closes a row; o opens its source', () => {
    board();
    const { onOpen } = renderView();
    toggleOf('Write release notes').focus();
    press('Enter');
    expect(toggleOf('Write release notes')).toHaveAttribute('aria-expanded', 'true');
    press('Enter');
    expect(toggleOf('Write release notes')).toHaveAttribute('aria-expanded', 'false');
    press('o');
    expect(onOpen).toHaveBeenCalledWith({ type: 'proposal', id: 'p1' });
  });

  it('a approves, x rejects, u undoes the last one', async () => {
    board();
    renderView();
    plate().focus();
    press('a');
    expect(screen.getByTestId('attention-receipt')).toHaveTextContent('Approved ‘Rotate the API keys’');
    press('u');
    expect(screen.queryByTestId('attention-receipt')).toBeNull();
    expect(document.activeElement).toBe(plate());

    toggleOf('Write release notes').focus();
    press('x');
    expect(screen.getByTestId('attention-receipt')).toHaveTextContent('Rejected ‘Write release notes’');
    await pass();
    expect(urls()).toEqual(['/api/kanban/proposals/p1/reject']);
  });

  it('a retries a failure, e marks one seen', () => {
    setSources({ tasks: [failedTask(), failedTask({ id: 'f2', title: 'Rotate the logs' })] });
    renderView();
    toggleOf('Rebuild the index').focus();
    press('e');
    expect(screen.getByRole('button', { name: 'Seen (1)' })).toBeInTheDocument();
    expect(document.activeElement).toBe(toggleOf('Rotate the logs'));
    press('a');
    expect(screen.getByTestId('attention-receipt')).toHaveTextContent('Retried ‘Rotate the logs’');
  });

  it('c opens the note and r the reply on a collapsed row, opening it first; one field at a time', () => {
    setSources({ tasks: [task(), task({ id: 't2', title: 'Second review', resultAt: NOW - 20 * MINUTE })] });
    renderView();
    toggleOf('Second review').focus();
    press('c');
    expect(toggleOf('Second review')).toHaveAttribute('aria-expanded', 'true');
    const note = within(itemOf('Second review')).getByRole('textbox', { name: 'What needs to change' });
    expect(document.activeElement).toBe(note);
    // Keys are text in a field.
    fireEvent.keyDown(note, { key: 'a' });
    expect(screen.queryByTestId('attention-receipt')).toBeNull();
    fireEvent.change(note, { target: { value: 'Add a test' } });

    // The plate's Reply closes the note, which keeps its draft.
    fireEvent.click(within(plate()).getByRole('button', { name: 'Reply' }));
    expect(within(itemOf('Second review')).queryByRole('textbox')).toBeNull();
    expect(within(plate()).getByRole('textbox', { name: 'Reply to Forge' })).toBeInTheDocument();
    // The row's actions stayed in sight while it was open.
    expect(within(itemOf('Second review')).getByRole('button', { name: 'Approve' })).toBeInTheDocument();

    fireEvent.click(within(itemOf('Second review')).getByRole('button', { name: 'Request changes' }));
    expect(within(plate()).queryByRole('textbox')).toBeNull();
    expect(within(itemOf('Second review')).getByRole('textbox', { name: 'What needs to change' })).toHaveValue('Add a test');

    toggleOf('Second review').focus();
    press('r');
    expect(within(itemOf('Second review')).getByRole('textbox', { name: 'Reply to Forge' })).toBeInTheDocument();
  });

  it('s stops an agent run, s again confirms', async () => {
    setSources({ tasks: [task({ id: 'r1', title: 'Index the archive', status: 'in-progress', result: undefined, updatedAt: NOW - 5 * HOUR, run: { sessionKey: 'agent:forge:subagent:index', startedAt: NOW - 5 * HOUR, status: 'running' } })] });
    renderView();
    const line = screen.getAllByTestId('agent-line')[0];
    within(line).getByRole('button', { name: "Open Forge's chat" }).focus();
    press('s');
    expect(within(line).getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    press('s');
    expect(within(line).getByTestId('attention-receipt')).toHaveTextContent('Stopped ‘Index the archive’');
    expect(document.activeElement).toBe(within(line).getByRole('button', { name: "Open Forge's chat" }));
    await pass();
    expect(urls()).toEqual(['/api/kanban/tasks/r1/abort']);
  });

  it('g then n or t switches halves, / goes to the Ask box, ? shows the keys', () => {
    board();
    renderView();
    press('?');
    expect(screen.getByTestId('attention-shortcuts')).toBeInTheDocument();
    press('?');
    expect(screen.queryByTestId('attention-shortcuts')).toBeNull();

    press('g');
    press('t');
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
    press('g');
    press('n');
    expect(screen.getByRole('button', { name: 'Now' })).toHaveAttribute('aria-pressed', 'true');

    press('/');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Ask Forge' }));
    // Inert while typing.
    press('j');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Ask Forge' }));
  });

  it('modified keys are left to the app', () => {
    board();
    renderView();
    plate().focus();
    press('a', { ctrlKey: true });
    press('a', { metaKey: true });
    press('A', { shiftKey: true });
    expect(screen.queryByTestId('attention-receipt')).toBeNull();
  });

  it('the focused item shows keycap hints at the desk, never on a phone', () => {
    board();
    const { unmount } = renderView();
    plate().focus();
    press('j');
    press('k');
    expect(within(plate()).getAllByTestId('key-hint').map((node) => node.textContent)).toEqual(expect.arrayContaining(['a', 'c', 'r', 'o']));
    unmount();

    renderView({ compact: true });
    press('j');
    expect(screen.queryAllByTestId('key-hint')).toHaveLength(0);
  });
});

describe('new items', () => {
  it('n shows held arrivals in their ranked place', () => {
    setSources({ tasks: [task({ resultAt: NOW - HOUR }), task({ id: 't2', title: 'Second review', resultAt: NOW - 20 * MINUTE })] });
    const { rerenderWith } = renderView();
    setSources({ tasks: [task({ resultAt: NOW - HOUR }), task({ id: 't2', title: 'Second review', resultAt: NOW - 20 * MINUTE }), task({ id: 't3', title: 'Older review', resultAt: NOW - 2 * HOUR })] });
    rerenderWith();
    expect(screen.getByTestId('attention-new-pill')).toHaveTextContent('1 new · Show');
    expect(screen.getAllByTestId('attention-row-title').map((node) => node.textContent)).toEqual(['Second review']);

    press('n');
    expect(screen.queryByTestId('attention-new-pill')).toBeNull();
    // Ranked before Second review, which keeps its place after it.
    expect(screen.getAllByTestId('attention-row-title').map((node) => node.textContent)).toEqual(['Older review', 'Second review']);
  });

  it('with nothing in Waiting on you, an arrival shows at once', () => {
    setSources({ tasks: [failedTask()] });
    const { rerenderWith } = renderView();
    setSources({ tasks: [failedTask(), task()] });
    rerenderWith();
    expect(screen.queryByTestId('attention-new-pill')).toBeNull();
    expect(within(plate()).getByRole('heading', { level: 3 })).toHaveTextContent('Rotate the API keys');
  });
});

describe('Today stays mounted', () => {
  it('switching halves keeps Today and its state, and only the shown half is active', () => {
    setSources({ tasks: [task()] });
    renderView();
    expect(todayMounts).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(todayMounts).toHaveBeenCalledTimes(1);
    expect(todayActive).toHaveBeenLastCalledWith(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Today draft' }), { target: { value: 'half written' } });

    fireEvent.click(screen.getByRole('button', { name: 'Now' }));
    expect(todayActive).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId('attention-today-pane')).toHaveClass('hidden');
    // Now kept its own state too: the plate is still there.
    expect(plate()).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(todayMounts).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: 'Today draft' })).toHaveValue('half written');
    expect(screen.getByTestId('attention-now-pane')).toHaveClass('hidden');
  });
});

describe('phone replies', () => {
  it('a long reply grows with the page and offers Show all instead of a scroll box', async () => {
    setSources({ tasks: [task()] });
    renderView({ compact: true });
    fireEvent.click(within(plate()).getByRole('button', { name: 'Reply' }));
    const field = within(plate()).getByRole('textbox', { name: 'Reply to Forge' });
    fireEvent.change(field, { target: { value: 'Summarize' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await pass(0);
    const runId = rpc.mock.calls.find(([method]) => method === 'chat.send')?.[1]?.idempotencyKey as string;
    act(() => {
      for (const handler of [...handlers]) handler({ type: 'event', event: 'chat', payload: { sessionKey: 'agent:forge:subagent:keys', runId, state: 'final', seq: 1, message: 'Line.\n\n'.repeat(40) } });
    });
    const body = screen.getByTestId('inline-reply-body');
    expect(body.className).not.toContain('overflow-y-auto');
    expect(body.className).toContain('overflow-hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByTestId('inline-reply-body').className).not.toContain('overflow-hidden');
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
  });
});
