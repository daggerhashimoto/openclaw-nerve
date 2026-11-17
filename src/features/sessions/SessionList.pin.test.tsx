import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Session } from '@/types';
import { SessionList } from './SessionList';
import { PINNED_SESSIONS_STORAGE_KEY, resetPinnedSessionsCache } from './pinnedSessions';
import { SessionProvider, useSessionContext } from '@/contexts/SessionContext';

const mockUseGateway = vi.fn();

vi.mock('@/contexts/GatewayContext', () => ({
  useGateway: () => mockUseGateway(),
}));

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({ soundEnabled: false }),
}));

const MAIN: Session = { sessionKey: 'agent:main:main', label: 'Fleet lead' };
const ALPHA: Session = { sessionKey: 'agent:alpha:main', label: 'Alpha' };
const OPS: Session = { sessionKey: 'agent:ops:main', label: 'Ops' };
const ANVIL: Session = { sessionKey: 'agent:ops:subagent:anvil', label: 'Anvil' };
const BELLOWS: Session = { sessionKey: 'agent:ops:subagent:bellows', label: 'Bellows' };
const CHISEL: Session = { sessionKey: 'agent:ops:subagent:chisel', label: 'Chisel' };
const SESSIONS = [MAIN, ALPHA, OPS, ANVIL, BELLOWS, CHISEL];
const LABELS = ['Fleet lead', 'Alpha', 'Ops', 'Anvil', 'Bellows', 'Chisel'];

function renderSessionList(
  sessions: Session[] = SESSIONS,
  props: Partial<React.ComponentProps<typeof SessionList>> = {},
) {
  return render(
    <SessionList
      sessions={sessions}
      currentSession=""
      busyState={{}}
      onSelect={() => {}}
      onRefresh={() => {}}
      onDelete={vi.fn(async () => {})}
      onRename={vi.fn(async () => {})}
      {...props}
    />,
  );
}

/** The row that shows this label, so its actions and marker can be read without matching other rows. */
function rowFor(label: string): HTMLElement {
  const row = screen.getByText(label, { exact: true }).closest<HTMLElement>('.group');
  if (!row) throw new Error(`No session row for ${label}`);
  return row;
}

/** Session names in the order the column shows them. */
function rowOrder(labels: string[] = LABELS): string[] {
  return screen.getAllByText(new RegExp(`^(${labels.join('|')})$`)).map((element) => element.textContent ?? '');
}

function isMarkedPinned(label: string): boolean {
  return within(rowFor(label)).queryByRole('img', { name: 'Pinned' }) !== null;
}

function storedPins(): unknown {
  return JSON.parse(localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY) ?? 'null');
}

const ORIGINAL_ORDER = ['Fleet lead', 'Alpha', 'Ops', 'Anvil', 'Bellows', 'Chisel'];

beforeEach(() => {
  localStorage.clear();
  resetPinnedSessionsCache();
});

describe('SessionList pins', () => {
  it('moves a pinned child to the top of its siblings and marks it, leaving the other rows where they were', () => {
    renderSessionList();
    expect(rowOrder()).toEqual(ORIGINAL_ORDER);
    expect(screen.queryByRole('img', { name: 'Pinned' })).toBeNull();

    fireEvent.click(within(rowFor('Chisel')).getByRole('button', { name: 'Pin' }));

    expect(rowOrder()).toEqual(['Fleet lead', 'Alpha', 'Ops', 'Chisel', 'Anvil', 'Bellows']);
    expect(isMarkedPinned('Chisel')).toBe(true);
    expect(within(rowFor('Chisel')).getByTitle('Pinned')).toBeInTheDocument();
    expect(isMarkedPinned('Anvil')).toBe(false);
    expect(within(rowFor('Chisel')).getByRole('button', { name: 'Unpin' })).toBeInTheDocument();
    expect(storedPins()).toEqual(['agent:ops:subagent:chisel']);
  });

  it('moves a pinned root above the other roots, main included, with its children still under it', () => {
    renderSessionList();

    fireEvent.click(within(rowFor('Ops')).getByRole('button', { name: 'Pin' }));

    expect(rowOrder()).toEqual(['Ops', 'Anvil', 'Bellows', 'Chisel', 'Fleet lead', 'Alpha']);
    expect(isMarkedPinned('Ops')).toBe(true);
  });

  it('restores the original order when the pin is taken off', () => {
    renderSessionList();
    fireEvent.click(within(rowFor('Chisel')).getByRole('button', { name: 'Pin' }));
    fireEvent.click(within(rowFor('Alpha')).getByRole('button', { name: 'Pin' }));
    expect(rowOrder()).toEqual(['Alpha', 'Fleet lead', 'Ops', 'Chisel', 'Anvil', 'Bellows']);

    fireEvent.click(within(rowFor('Chisel')).getByRole('button', { name: 'Unpin' }));
    fireEvent.click(within(rowFor('Alpha')).getByRole('button', { name: 'Unpin' }));

    expect(rowOrder()).toEqual(ORIGINAL_ORDER);
    expect(screen.queryByRole('img', { name: 'Pinned' })).toBeNull();
    expect(storedPins()).toEqual([]);
  });

  it('keeps pins across a remount, read back from localStorage', () => {
    const { unmount } = renderSessionList();
    fireEvent.click(within(rowFor('Bellows')).getByRole('button', { name: 'Pin' }));
    unmount();

    // Forget the page's copy, as a reload would, so the next mount has only storage to go on
    resetPinnedSessionsCache();
    expect(localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY)).toBe('["agent:ops:subagent:bellows"]');

    renderSessionList();
    expect(rowOrder()).toEqual(['Fleet lead', 'Alpha', 'Ops', 'Bellows', 'Anvil', 'Chisel']);
    expect(isMarkedPinned('Bellows')).toBe(true);
  });

  it('shows the column in its usual order when the stored pins are malformed', () => {
    localStorage.setItem(PINNED_SESSIONS_STORAGE_KEY, '{not json');

    renderSessionList();

    expect(rowOrder()).toEqual(ORIGINAL_ORDER);
    expect(screen.queryByRole('img', { name: 'Pinned' })).toBeNull();
  });

  it('keeps a pinned session pinned through a rename, since the rename keeps its key', () => {
    const { rerender } = renderSessionList();
    fireEvent.click(within(rowFor('Chisel')).getByRole('button', { name: 'Pin' }));

    const renamed = SESSIONS.map((session) => (session === CHISEL ? { ...session, label: 'Zebra' } : session));
    rerender(
      <SessionList
        sessions={renamed}
        currentSession=""
        busyState={{}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onDelete={vi.fn(async () => {})}
        onRename={vi.fn(async () => {})}
      />,
    );

    expect(rowOrder([...LABELS, 'Zebra'])).toEqual(['Fleet lead', 'Alpha', 'Ops', 'Zebra', 'Anvil', 'Bellows']);
    expect(isMarkedPinned('Zebra')).toBe(true);
  });

  it('offers Pin and Unpin from the compact actions menu and closes the menu', () => {
    renderSessionList(SESSIONS, { compact: true });

    fireEvent.click(within(rowFor('Chisel')).getByRole('button', { name: 'Session actions' }));
    fireEvent.click(within(rowFor('Chisel')).getByRole('button', { name: 'Pin' }));

    expect(rowOrder()).toEqual(['Fleet lead', 'Alpha', 'Ops', 'Chisel', 'Anvil', 'Bellows']);
    expect(isMarkedPinned('Chisel')).toBe(true);
    expect(within(rowFor('Chisel')).queryByRole('button', { name: 'Unpin' })).toBeNull();

    fireEvent.click(within(rowFor('Chisel')).getByRole('button', { name: 'Session actions' }));
    fireEvent.click(within(rowFor('Chisel')).getByRole('button', { name: 'Unpin' }));

    expect(rowOrder()).toEqual(ORIGINAL_ORDER);
  });
});

describe('SessionList pins and Nerve delete', () => {
  function jsonResponse(data: unknown): Response {
    return { ok: true, json: async () => data } as Response;
  }

  /** The sidebar wired to the real session context, the way App.tsx renders it. */
  function ConnectedSessionList() {
    const { sessions, currentSession, busyState, deleteSession, renameSession } = useSessionContext();
    return (
      <SessionList
        sessions={sessions}
        currentSession={currentSession}
        busyState={busyState}
        onSelect={() => {}}
        onRefresh={() => {}}
        onDelete={deleteSession}
        onRename={renameSession}
      />
    );
  }

  beforeEach(() => {
    let stored: Session[] = [MAIN, OPS, ANVIL, CHISEL];
    const rpc = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'sessions.list') return { sessions: stored };
      if (method === 'sessions.delete') {
        stored = stored.filter((session) => session.sessionKey !== params?.key);
        return { ok: true, key: params?.key, deleted: true, archived: [] };
      }
      return {};
    });
    mockUseGateway.mockImplementation(() => ({ connectionState: 'connected', rpc, subscribe: () => () => {} }));

    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/server-info')) return Promise.resolve(jsonResponse({ agentName: 'Jen' }));
      if (url.includes('/api/agentlog')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/api/sessions/hidden')) return Promise.resolve(jsonResponse({ ok: true, sessions: [] }));
      return Promise.resolve(jsonResponse({}));
    }) as typeof fetch;
  });

  it('drops the pin of a session deleted from its row and keeps the other pins', async () => {
    render(<SessionProvider><ConnectedSessionList /></SessionProvider>);
    await screen.findByText('Chisel');

    fireEvent.click(within(rowFor('Ops')).getByRole('button', { name: 'Pin' }));
    fireEvent.click(within(rowFor('Chisel')).getByRole('button', { name: 'Pin' }));
    expect(storedPins()).toEqual(['agent:ops:main', 'agent:ops:subagent:chisel']);

    fireEvent.click(within(rowFor('Chisel')).getByTitle('Delete session'));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    });

    await waitFor(() => expect(screen.queryByText('Chisel')).toBeNull());
    expect(storedPins()).toEqual(['agent:ops:main']);
    expect(isMarkedPinned('Ops')).toBe(true);
  });
});
