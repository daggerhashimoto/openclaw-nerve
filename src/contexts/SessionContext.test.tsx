import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SessionProvider, useSessionContext } from './SessionContext';
import { getSessionKey, type GatewayEvent } from '@/types';
import { getSessionDisplayLabel } from '@/features/sessions/sessionKeys';
import { EventLog } from '@/features/activity/EventLog';
import { sessionPaneState } from '@/lib/paneState';
import { PINNED_SESSIONS_STORAGE_KEY, resetPinnedSessionsCache } from '@/features/sessions/pinnedSessions';

const mockUseGateway = vi.fn();
const mockUseSettings = vi.fn();
const playPingMock = vi.fn();
let rpcMock: ReturnType<typeof vi.fn>;
let subscribeMock: ReturnType<typeof vi.fn>;
let connectionStateValue: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' = 'connected';
let subscribedHandler: ((msg: GatewayEvent) => void) | null = null;
let soundEnabledValue = true;

vi.mock('./GatewayContext', () => ({
  useGateway: () => mockUseGateway(),
}));

vi.mock('./SettingsContext', () => ({
  useSettings: () => mockUseSettings(),
}));

vi.mock('@/features/voice/audio-feedback', () => ({
  playPing: (...args: unknown[]) => playPingMock(...args),
}));

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

function SessionLabels() {
  const { sessions, currentSession } = useSessionContext();

  return (
    <div>
      <div data-testid="current-session">{currentSession}</div>
      {sessions.map((session) => (
        <div key={getSessionKey(session)}>{session.label || session.displayName || getSessionKey(session)}</div>
      ))}
    </div>
  );
}

function SessionDisplayLabels() {
  const { sessions, agentName } = useSessionContext();

  return (
    <div>
      {sessions.map((session) => (
        <div key={getSessionKey(session)}>{getSessionDisplayLabel(session, agentName)}</div>
      ))}
    </div>
  );
}

function SessionRefreshProbe() {
  const { refreshSessions } = useSessionContext();

  return (
    <button data-testid="refresh-sessions" onClick={() => void refreshSessions()}>
      Refresh sessions
    </button>
  );
}

function SessionUnreadProbe() {
  const { currentSession, unreadSessions, setCurrentSession } = useSessionContext();

  return (
    <div>
      <div data-testid="current-session">{currentSession}</div>
      <div data-testid="reviewer-unread">{String(Boolean(unreadSessions['agent:reviewer:main']))}</div>
      <button data-testid="select-reviewer" onClick={() => setCurrentSession('agent:reviewer:main')}>
        Select reviewer
      </button>
    </div>
  );
}

function SessionEventLog() {
  const { eventEntries } = useSessionContext();
  return <EventLog entries={eventEntries} />;
}

function SessionStatusProbe() {
  const { agentStatus } = useSessionContext();
  return <div data-testid="reviewer-status">{agentStatus['agent:reviewer:main']?.status ?? 'NONE'}</div>;
}

describe('SessionContext', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    subscribedHandler = null;
    soundEnabledValue = true;
    connectionStateValue = 'connected';

    rpcMock = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'sessions.list') {
        const filtered = params && Object.prototype.hasOwnProperty.call(params, 'activeMinutes');
        return {
          sessions: filtered
            ? [
                { sessionKey: 'agent:main:main', label: 'Main' },
                { sessionKey: 'agent:main:cron:daily-digest', label: 'Cron: Daily Digest' },
              ]
            : [
                { sessionKey: 'agent:main:main', label: 'Main' },
                { sessionKey: 'agent:designer:main', label: 'Designer', updatedAt: 1774099479671 },
                { sessionKey: 'agent:main:cron:daily-digest', label: 'Cron: Daily Digest' },
              ],
        };
      }
      return {};
    });

    subscribeMock = vi.fn((handler: (msg: GatewayEvent) => void) => {
      subscribedHandler = handler;
      return () => {};
    });

    mockUseGateway.mockImplementation(() => ({
      connectionState: connectionStateValue,
      rpc: rpcMock,
      subscribe: subscribeMock,
    }));

    mockUseSettings.mockImplementation(() => ({
      soundEnabled: soundEnabledValue,
    }));

    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes('/api/server-info')) return Promise.resolve(jsonResponse({ agentName: 'Jen' }));
      if (url.includes('/api/agentlog')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/api/sessions/hidden')) return Promise.resolve(jsonResponse({ ok: true, sessions: [] }));
      return Promise.resolve(jsonResponse({}));
    }) as typeof fetch;
  });

  it('calls agents.create when spawning a root agent', async () => {
    function Spawn() {
      const { spawnSession } = useSessionContext();
      return <button data-testid="spawn" onClick={() => spawnSession({
        kind: 'root', agentName: 'Test', task: 'hi', model: 'anthropic/claude-sonnet-4-5',
      })} />;
    }

    render(<SessionProvider><Spawn /></SessionProvider>);
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    screen.getByTestId('spawn').click();
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('agents.create', expect.objectContaining({ name: 'Test' }));
    });
  });

  it('subagent spawn calls /api/sessions/spawn-subagent, refreshes sessions, and switches to the returned child', async () => {
    let sessionsListCalls = 0;
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        sessionsListCalls += 1;
        return sessionsListCalls >= 2
          ? {
              sessions: [
                { sessionKey: 'agent:reviewer:main', label: 'Reviewer' },
                { sessionKey: 'agent:reviewer:subagent:new-child-uuid', label: 'Reviewer child' },
              ],
            }
          : {
              sessions: [
                { sessionKey: 'agent:reviewer:main', label: 'Reviewer' },
              ],
            };
      }
      return {};
    });

    const spawnedChildKey = 'agent:reviewer:subagent:new-child-uuid';
    const fetchSpy = vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes('/api/sessions/spawn-subagent')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, sessionKey: spawnedChildKey, mode: 'direct' }),
        } as Response);
      }
      if (url.includes('/api/server-info')) return Promise.resolve(jsonResponse({ agentName: 'Jen' }));
      if (url.includes('/api/agentlog')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/api/sessions/hidden')) return Promise.resolve(jsonResponse({ ok: true, sessions: [] }));
      return Promise.resolve(jsonResponse({}));
    }) as typeof fetch;
    globalThis.fetch = fetchSpy;

    function SpawnSubagent() {
      const { spawnSession, currentSession } = useSessionContext();
      return (
        <div>
          <div data-testid="current-session">{currentSession}</div>
          <button
            data-testid="spawn-subagent"
            onClick={() => spawnSession({
              kind: 'subagent',
              task: 'do something',
              label: 'my-task',
              cleanup: 'keep',
              parentSessionKey: 'agent:reviewer:main',
            })}
          />
        </div>
      );
    }

    render(<SessionProvider><SpawnSubagent /></SessionProvider>);

    await waitFor(() => {
      expect(screen.getByTestId('current-session').textContent).toBe('agent:reviewer:main');
    });

    await act(async () => {
      screen.getByTestId('spawn-subagent').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('current-session').textContent).toBe(spawnedChildKey);
    });

    const spawnCall = fetchSpy.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return url.includes('/api/sessions/spawn-subagent');
    });
    expect(spawnCall).toBeDefined();
    expect(spawnCall?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String((spawnCall?.[1] as RequestInit).body))).toEqual({
      parentSessionKey: 'agent:reviewer:main',
      task: 'do something',
      label: 'my-task',
      cleanup: 'keep',
    });
    expect(sessionsListCalls).toBeGreaterThanOrEqual(2);
  });

  it('surfaces route error when subagent spawn fails', async () => {
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [{ sessionKey: 'agent:reviewer:main', label: 'Reviewer' }] };
      }
      return {};
    });

    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes('/api/sessions/spawn-subagent')) {
        return Promise.resolve({
          ok: false,
          json: async () => ({ ok: false, error: 'Gateway connection failed' }),
        } as Response);
      }
      if (url.includes('/api/server-info')) return Promise.resolve(jsonResponse({ agentName: 'Jen' }));
      if (url.includes('/api/agentlog')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/api/sessions/hidden')) return Promise.resolve(jsonResponse({ ok: true, sessions: [] }));
      return Promise.resolve(jsonResponse({}));
    }) as typeof fetch;

    let caughtError: Error | null = null;

    function SpawnSubagentError() {
      const { spawnSession } = useSessionContext();
      return (
        <button
          data-testid="spawn-error"
          onClick={async () => {
            try {
              await spawnSession({
                kind: 'subagent',
                task: 'do something',
                parentSessionKey: 'agent:reviewer:main',
              });
            } catch (err) {
              caughtError = err as Error;
            }
          }}
        />
      );
    }

    render(<SessionProvider><SpawnSubagentError /></SessionProvider>);
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());

    await act(async () => {
      screen.getByTestId('spawn-error').click();
    });

    await waitFor(() => {
      expect(caughtError).not.toBeNull();
    });

    expect(caughtError!.message).toContain('Gateway connection failed');
  });

  it('root spawn still uses agents.create + chat.send and does not call spawn-subagent route', async () => {
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [{ sessionKey: 'agent:main:main', label: 'Main' }] };
      }
      return {};
    });

    const fetchSpy = vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url.includes('/api/server-info')) return Promise.resolve(jsonResponse({ agentName: 'Jen' }));
      if (url.includes('/api/agentlog')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/api/sessions/hidden')) return Promise.resolve(jsonResponse({ ok: true, sessions: [] }));
      return Promise.resolve(jsonResponse({}));
    }) as typeof fetch;
    globalThis.fetch = fetchSpy;

    function SpawnRoot() {
      const { spawnSession } = useSessionContext();
      return (
        <button
          data-testid="spawn-root"
          onClick={() => spawnSession({ kind: 'root', agentName: 'NewAgent', task: 'hi' })}
        />
      );
    }

    render(<SessionProvider><SpawnRoot /></SessionProvider>);
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());

    await act(async () => {
      screen.getByTestId('spawn-root').click();
    });

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('agents.create', expect.objectContaining({ name: 'NewAgent' }));
      expect(rpcMock).toHaveBeenCalledWith('chat.send', expect.objectContaining({ message: 'hi' }));
    });

    const spawnRouteCalled = fetchSpy.mock.calls.some(([input]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return url.includes('/api/sessions/spawn-subagent');
    });
    expect(spawnRouteCalled).toBe(false);
  });

  it('clears the root thinking override when spawnSession is called without an explicit thinking level', async () => {
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [{ sessionKey: 'agent:main:main', label: 'Main' }] };
      }
      return {};
    });

    function SpawnRootDefaultThinking() {
      const { spawnSession } = useSessionContext();
      return (
        <button
          data-testid="spawn-root-default-thinking"
          onClick={() => spawnSession({ kind: 'root', agentName: 'DefaultThink', task: 'hi' })}
        />
      );
    }

    render(<SessionProvider><SpawnRootDefaultThinking /></SessionProvider>);
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());

    await act(async () => {
      screen.getByTestId('spawn-root-default-thinking').click();
    });

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('sessions.patch', expect.objectContaining({
        key: 'agent:defaultthink:main',
        label: 'DefaultThink',
        thinkingLevel: null,
      }));
    });
  });

  it.each(['off', 'adaptive'])('preserves explicit %s thinking when spawning a root agent', async (thinking) => {
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [{ sessionKey: 'agent:main:main', label: 'Main' }] };
      }
      return {};
    });

    function SpawnRootExplicitThinking() {
      const { spawnSession } = useSessionContext();
      return (
        <button
          data-testid={`spawn-root-${thinking}`}
          onClick={() => spawnSession({ kind: 'root', agentName: `Think ${thinking}`, task: 'hi', thinking })}
        />
      );
    }

    render(<SessionProvider><SpawnRootExplicitThinking /></SessionProvider>);
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());

    await act(async () => {
      screen.getByTestId(`spawn-root-${thinking}`).click();
    });

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('sessions.patch', expect.objectContaining({
        label: `Think ${thinking}`,
        thinkingLevel: thinking,
      }));
    });
  });

  it('uses a unique config name when spawning a duplicate root agent', async () => {
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:main:main', label: 'Main' },
            { sessionKey: 'agent:test:main', label: 'Test' },
          ],
        };
      }
      return {};
    });

    function Spawn() {
      const { spawnSession } = useSessionContext();
      return <button data-testid="spawn-duplicate" onClick={() => spawnSession({
        kind: 'root', agentName: 'Test', task: 'hi', model: 'anthropic/claude-sonnet-4-5',
      })} />;
    }

    render(<SessionProvider><Spawn /></SessionProvider>);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('sessions.list', { limit: 1000 }));
    screen.getByTestId('spawn-duplicate').click();
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('agents.create', expect.objectContaining({
        name: 'Test 2',
        workspace: '~/.openclaw/workspace-test-2',
      }));
      expect(rpcMock).toHaveBeenCalledWith('sessions.patch', expect.objectContaining({
        key: 'agent:test-2:main',
        label: 'Test',
      }));
    });
  });

  it('uses the server-provided default workspace root when spawning a root agent', async () => {
    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes('/api/server-info')) {
        return Promise.resolve(jsonResponse({
          agentName: 'Jen',
          defaultAgentWorkspaceRoot: '/managed/workspaces',
        }));
      }
      if (url.includes('/api/agentlog')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/api/sessions/hidden')) return Promise.resolve(jsonResponse({ ok: true, sessions: [] }));
      return Promise.resolve(jsonResponse({}));
    }) as typeof fetch;

    function Spawn() {
      const { spawnSession } = useSessionContext();
      return <button data-testid="spawn-managed" onClick={() => spawnSession({
        kind: 'root', agentName: 'Managed', task: 'hi', model: 'anthropic/claude-sonnet-4-5',
      })} />;
    }

    render(<SessionProvider><Spawn /></SessionProvider>);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('sessions.list', { limit: 1000 }));
    screen.getByTestId('spawn-managed').click();
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('agents.create', expect.objectContaining({
        name: 'Managed',
        workspace: '/managed/workspaces/managed',
      }));
    });
  });

  describe('deleteSession', () => {
    // Gateway stand-in: lists what is still stored and refuses keys the way sessions.delete does.
    function installDeleteGateway(initial: Array<Record<string, unknown>>, refuse: (key: string) => string | null) {
      let stored = [...initial];
      rpcMock.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
        if (method === 'sessions.list') return { sessions: stored };
        if (method === 'sessions.delete') {
          const key = String(params?.key);
          const refusal = refuse(key);
          if (refusal) throw new Error(refusal);
          stored = stored.filter((session) => session.sessionKey !== key);
          return { ok: true, key, deleted: true, archived: [] };
        }
        return {};
      });
    }

    function deleteCalls() {
      return rpcMock.mock.calls.filter(([method]) => method === 'sessions.delete').map(([, params]) => params.key);
    }

    function listedKeys() {
      return screen.getAllByRole('listitem').map((item) => item.textContent);
    }

    function DeleteProbe({ target, select, onError }: { target: string; select?: string; onError: (err: Error) => void }) {
      const { sessions, currentSession, deleteSession, setCurrentSession } = useSessionContext();
      return (
        <div>
          <div data-testid="current-session">{currentSession}</div>
          <ul>
            {sessions.map((session) => <li key={getSessionKey(session)}>{getSessionKey(session)}</li>)}
          </ul>
          {select && <button data-testid="select" onClick={() => setCurrentSession(select)} />}
          <button data-testid="delete" onClick={() => { deleteSession(target).catch(onError); }} />
        </div>
      );
    }

    it('refuses an agent main session up front instead of deleting its children first', async () => {
      installDeleteGateway([
        { sessionKey: 'agent:main:main', label: 'Main' },
        { sessionKey: 'agent:ops:main', label: 'Ops' },
        { sessionKey: 'agent:ops:subagent:worker', label: 'Worker' },
        { sessionKey: 'agent:ops:cron:nightly', label: 'Nightly' },
      ], (key) => (key === 'agent:ops:main' ? 'Cannot delete the main session (agent:ops:main).' : null));
      const onError = vi.fn();

      render(<SessionProvider><DeleteProbe target="agent:ops:main" onError={onError} /></SessionProvider>);
      await screen.findByText('agent:ops:subagent:worker');

      await act(async () => {
        screen.getByTestId('delete').click();
      });

      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(deleteCalls()).toEqual([]);
      expect(onError.mock.calls[0][0].message).toContain('Nothing was deleted');
      expect(listedKeys()).toEqual(['agent:main:main', 'agent:ops:main', 'agent:ops:subagent:worker', 'agent:ops:cron:nightly']);
    });

    it('drops exactly the sessions that were deleted when a later delete in the tree fails', async () => {
      installDeleteGateway([
        { sessionKey: 'agent:main:main', label: 'Main' },
        { sessionKey: 'agent:ops:main', label: 'Ops' },
        { sessionKey: 'agent:ops:subagent:lead', label: 'Lead' },
        { sessionKey: 'agent:ops:subagent:helper-a', label: 'Helper A', parentSessionKey: 'agent:ops:subagent:lead' },
        { sessionKey: 'agent:ops:subagent:helper-b', label: 'Helper B', parentSessionKey: 'agent:ops:subagent:lead' },
      ], (key) => (key === 'agent:ops:subagent:helper-b' ? `Session ${key} is still active; try again.` : null));
      const onError = vi.fn();

      render(
        <SessionProvider>
          <DeleteProbe target="agent:ops:subagent:lead" select="agent:ops:subagent:helper-a" onError={onError} />
        </SessionProvider>,
      );
      await screen.findByText('agent:ops:subagent:helper-a');
      act(() => {
        screen.getByTestId('select').click();
      });
      expect(screen.getByTestId('current-session')).toHaveTextContent('agent:ops:subagent:helper-a');

      await act(async () => {
        screen.getByTestId('delete').click();
      });

      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(onError.mock.calls[0][0].message).toContain('still active');
      expect(deleteCalls()).toEqual(['agent:ops:subagent:helper-a', 'agent:ops:subagent:helper-b']);
      expect(listedKeys()).toEqual(['agent:main:main', 'agent:ops:main', 'agent:ops:subagent:lead', 'agent:ops:subagent:helper-b']);
      expect(screen.getByTestId('current-session')).toHaveTextContent('agent:main:main');
    });

    it('drops the pins of exactly the sessions it deleted, also when a later delete in the tree fails', async () => {
      installDeleteGateway([
        { sessionKey: 'agent:main:main', label: 'Main' },
        { sessionKey: 'agent:ops:main', label: 'Ops' },
        { sessionKey: 'agent:ops:subagent:lead', label: 'Lead' },
        { sessionKey: 'agent:ops:subagent:helper-a', label: 'Helper A', parentSessionKey: 'agent:ops:subagent:lead' },
        { sessionKey: 'agent:ops:subagent:helper-b', label: 'Helper B', parentSessionKey: 'agent:ops:subagent:lead' },
      ], (key) => (key === 'agent:ops:subagent:helper-b' ? `Session ${key} is still active; try again.` : null));
      // Pinned: the target, both children, a session outside the tree, and one the list does not show right now
      localStorage.setItem(PINNED_SESSIONS_STORAGE_KEY, JSON.stringify([
        'agent:ops:subagent:lead',
        'agent:ops:subagent:helper-a',
        'agent:ops:subagent:helper-b',
        'agent:ops:main',
        'agent:ops:subagent:away',
      ]));
      resetPinnedSessionsCache();
      onTestFinished(() => {
        localStorage.removeItem(PINNED_SESSIONS_STORAGE_KEY);
        resetPinnedSessionsCache();
      });
      const onError = vi.fn();

      render(<SessionProvider><DeleteProbe target="agent:ops:subagent:lead" onError={onError} /></SessionProvider>);
      await screen.findByText('agent:ops:subagent:helper-a');

      await act(async () => {
        screen.getByTestId('delete').click();
      });

      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(deleteCalls()).toEqual(['agent:ops:subagent:helper-a', 'agent:ops:subagent:helper-b']);
      // Only helper A was deleted; the refused child and the target it protected keep their pins
      expect(JSON.parse(localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY) ?? '[]')).toEqual([
        'agent:ops:subagent:lead',
        'agent:ops:subagent:helper-b',
        'agent:ops:main',
        'agent:ops:subagent:away',
      ]);
    });

    it('deletes children before the target and removes the whole tree when every delete succeeds', async () => {
      installDeleteGateway([
        { sessionKey: 'agent:main:main', label: 'Main' },
        { sessionKey: 'agent:ops:main', label: 'Ops' },
        { sessionKey: 'agent:ops:cron:nightly', label: 'Nightly' },
        { sessionKey: 'agent:ops:cron:nightly:run:r1', label: 'Run 1' },
      ], () => null);
      const onError = vi.fn();

      render(<SessionProvider><DeleteProbe target="agent:ops:cron:nightly" onError={onError} /></SessionProvider>);
      await screen.findByText('agent:ops:cron:nightly:run:r1');

      await act(async () => {
        screen.getByTestId('delete').click();
      });

      await waitFor(() => expect(listedKeys()).toEqual(['agent:main:main', 'agent:ops:main']));
      expect(onError).not.toHaveBeenCalled();
      expect(deleteCalls()).toEqual(['agent:ops:cron:nightly:run:r1', 'agent:ops:cron:nightly']);
    });

    it('keeps a deleted session gone when a refresh that started before the delete lands after it', async () => {
      installDeleteGateway([
        { sessionKey: 'agent:main:main', label: 'Main' },
        { sessionKey: 'agent:ops:main', label: 'Ops' },
        { sessionKey: 'agent:ops:subagent:worker', label: 'Worker' },
      ], () => null);
      // Hold one full sessions.list answer, taken before the delete, until after the delete has landed.
      const gateway = rpcMock.getMockImplementation()!;
      let holdNextFullList = false;
      let releaseHeldList = () => {};
      rpcMock.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
        const answer = await gateway(method, params);
        if (method === 'sessions.list' && !params?.spawnedBy && holdNextFullList) {
          holdNextFullList = false;
          await new Promise<void>((resolve) => { releaseHeldList = resolve; });
        }
        return answer;
      });
      const onError = vi.fn();

      render(
        <SessionProvider>
          <SessionRefreshProbe />
          <DeleteProbe target="agent:ops:subagent:worker" onError={onError} />
        </SessionProvider>,
      );
      await screen.findByText('agent:ops:subagent:worker');

      holdNextFullList = true;
      await act(async () => {
        screen.getByTestId('refresh-sessions').click();
      });
      await act(async () => {
        screen.getByTestId('delete').click();
      });
      await waitFor(() => expect(listedKeys()).toEqual(['agent:main:main', 'agent:ops:main']));

      const spawnedByCallsBefore = rpcMock.mock.calls.filter(([method, params]) => method === 'sessions.list' && params?.spawnedBy).length;
      await act(async () => {
        releaseHeldList();
      });
      // The held refresh has finished once it has asked for both roots' children.
      await waitFor(() => {
        expect(rpcMock.mock.calls.filter(([method, params]) => method === 'sessions.list' && params?.spawnedBy)).toHaveLength(spawnedByCallsBefore + 2);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(onError).not.toHaveBeenCalled();
      expect(listedKeys()).toEqual(['agent:main:main', 'agent:ops:main']);
    });

    it('keeps a subagent spawned while a delete lands in the list it switches to', async () => {
      installDeleteGateway([
        { sessionKey: 'agent:main:main', label: 'Main' },
        { sessionKey: 'agent:ops:main', label: 'Ops' },
        { sessionKey: 'agent:ops:subagent:worker', label: 'Worker' },
      ], () => null);
      const freshKey = 'agent:ops:subagent:fresh';
      // Once the spawn route answers, the gateway lists the new child; the refresh spawnSession
      // starts next is held, its answer taken before the delete, until after the delete has landed.
      const gateway = rpcMock.getMockImplementation()!;
      let spawned = false;
      let holdNextFullList = false;
      let releaseHeldList = () => {};
      rpcMock.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
        const answer = await gateway(method, params) as { sessions?: Array<Record<string, unknown>> };
        if (method !== 'sessions.list' || params?.spawnedBy) return answer;
        const listedNow = { sessions: spawned ? [...(answer.sessions ?? []), { sessionKey: freshKey, label: 'Fresh' }] : answer.sessions };
        if (holdNextFullList) {
          holdNextFullList = false;
          await new Promise<void>((resolve) => { releaseHeldList = resolve; });
        }
        return listedNow;
      });
      const baseFetch = globalThis.fetch;
      globalThis.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (!url.includes('/api/sessions/spawn-subagent')) return baseFetch(input, init);
        spawned = true;
        holdNextFullList = true;
        return Promise.resolve(jsonResponse({ ok: true, sessionKey: freshKey, mode: 'direct' }));
      }) as typeof fetch;
      function SpawnProbe() {
        const { spawnSession } = useSessionContext();
        return (
          <button
            data-testid="spawn"
            onClick={() => { void spawnSession({ kind: 'subagent', task: 'go', parentSessionKey: 'agent:ops:main' }); }}
          />
        );
      }
      const onError = vi.fn();

      render(
        <SessionProvider>
          <SpawnProbe />
          <DeleteProbe target="agent:ops:subagent:worker" onError={onError} />
        </SessionProvider>,
      );
      await screen.findByText('agent:ops:subagent:worker');

      await act(async () => {
        screen.getByTestId('spawn').click();
      });
      await act(async () => {
        screen.getByTestId('delete').click();
      });
      await waitFor(() => expect(listedKeys()).not.toContain('agent:ops:subagent:worker'));
      await act(async () => {
        releaseHeldList();
      });

      await waitFor(() => expect(screen.getByTestId('current-session')).toHaveTextContent(freshKey));
      await waitFor(() => expect(listedKeys()).toEqual(['agent:main:main', 'agent:ops:main', freshKey]));
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe('getAgentWorkspace', () => {
    function WorkspaceProbe({ agentId, onResult }: { agentId: string; onResult: (result: unknown) => void }) {
      const { getAgentWorkspace } = useSessionContext();
      return <button data-testid="workspace" onClick={() => { void getAgentWorkspace(agentId).then(onResult); }} />;
    }

    function installAgentsList(answer: () => unknown) {
      const gateway = rpcMock.getMockImplementation()!;
      rpcMock.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
        if (method === 'agents.list') return answer();
        return gateway(method, params);
      });
    }

    async function lookUp(agentId: string) {
      const onResult = vi.fn();
      render(<SessionProvider><WorkspaceProbe agentId={agentId} onResult={onResult} /></SessionProvider>);
      await act(async () => {
        screen.getByTestId('workspace').click();
      });
      await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
      return onResult.mock.calls[0][0];
    }

    const AGENTS = {
      agents: [
        { id: 'main', workspace: '/home/me/.openclaw/workspace' },
        { id: 'ops', workspace: '/home/me/.openclaw/workspace/ops' },
        { id: 'side', workspace: '/home/me/.openclaw/workspace-side' },
      ],
    };

    it('finds an agent workspace and the agent whose workspace holds it', async () => {
      installAgentsList(() => AGENTS);
      expect(await lookUp('ops')).toEqual({
        path: '/home/me/.openclaw/workspace/ops',
        overlap: { agentId: 'main', relation: 'inside' },
      });
    });

    it('names an agent whose workspace sits inside this one', async () => {
      installAgentsList(() => AGENTS);
      expect(await lookUp('main')).toEqual({
        path: '/home/me/.openclaw/workspace',
        overlap: { agentId: 'ops', relation: 'contains' },
      });
    });

    it('names an agent that uses the same folder', async () => {
      installAgentsList(() => ({
        agents: [...AGENTS.agents, { id: 'twin', workspace: '/home/me/.openclaw/workspace-side/' }],
      }));
      expect(await lookUp('side')).toEqual({
        path: '/home/me/.openclaw/workspace-side',
        overlap: { agentId: 'twin', relation: 'same' },
      });
    });

    it('names no holder for a workspace beside the others', async () => {
      installAgentsList(() => AGENTS);
      expect(await lookUp('side')).toEqual({ path: '/home/me/.openclaw/workspace-side' });
    });

    it('answers null for an agent agents.list does not have', async () => {
      installAgentsList(() => AGENTS);
      expect(await lookUp('ghost')).toBeNull();
    });

    it('answers null when agents.list fails', async () => {
      vi.spyOn(console, 'debug').mockImplementation(() => {});
      installAgentsList(() => { throw new Error('gateway unreachable'); });
      expect(await lookUp('ops')).toBeNull();
    });
  });

  describe('removeAgent', () => {
    const OPS_TREE = [
      { sessionKey: 'agent:main:main', label: 'Main' },
      { sessionKey: 'agent:ops:main', label: 'Ops' },
      { sessionKey: 'agent:ops:subagent:worker', label: 'Worker' },
      { sessionKey: 'agent:ops:cron:nightly', label: 'Nightly' },
    ];

    // Gateway stand-in: agents.delete refuses with the given message, or drops every stored session of the agent.
    function installRemoveGateway(initial: Array<Record<string, unknown>>, refusal: string | null = null) {
      let stored = [...initial];
      const gateway = { add: (session: Record<string, unknown>) => { stored = [...stored, session]; } };
      rpcMock.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
        if (method === 'sessions.list') return { sessions: stored };
        if (method === 'agents.delete') {
          if (refusal) throw new Error(refusal);
          const prefix = `agent:${String(params?.agentId)}:`;
          stored = stored.filter((session) => !String(session.sessionKey).startsWith(prefix));
          return { ok: true, agentId: params?.agentId };
        }
        return {};
      });
      return gateway;
    }

    function listedKeys() {
      return screen.getAllByRole('listitem').map((item) => item.textContent);
    }

    function RemoveProbe({ agentId, deleteFiles = false, select, onError }: {
      agentId: string;
      deleteFiles?: boolean;
      select?: string;
      onError: (err: Error) => void;
    }) {
      const { sessions, currentSession, removeAgent, setCurrentSession } = useSessionContext();
      return (
        <div>
          <div data-testid="current-session">{currentSession}</div>
          <ul>
            {sessions.map((session) => <li key={getSessionKey(session)}>{getSessionKey(session)}</li>)}
          </ul>
          {select && <button data-testid="select" onClick={() => setCurrentSession(select)} />}
          <button data-testid="remove" onClick={() => { removeAgent(agentId, { deleteFiles }).catch(onError); }} />
        </div>
      );
    }

    it.each([false, true])('calls agents.delete for the agent with deleteFiles %s and drops all of its sessions', async (deleteFiles) => {
      installRemoveGateway(OPS_TREE);
      const onError = vi.fn();

      render(<SessionProvider><RemoveProbe agentId="ops" deleteFiles={deleteFiles} onError={onError} /></SessionProvider>);
      await screen.findByText('agent:ops:cron:nightly');

      await act(async () => {
        screen.getByTestId('remove').click();
      });

      await waitFor(() => expect(listedKeys()).toEqual(['agent:main:main']));
      expect(onError).not.toHaveBeenCalled();
      expect(rpcMock.mock.calls.filter(([method]) => method === 'agents.delete'))
        .toEqual([['agents.delete', { agentId: 'ops', deleteFiles }]]);
      expect(rpcMock.mock.calls.some(([method]) => method === 'sessions.delete')).toBe(false);
    });

    it('leaves every session in place and rejects with the gateway refusal', async () => {
      const refusal = 'Agent "ops" owns the shared auth store and cannot be deleted.';
      installRemoveGateway(OPS_TREE, refusal);
      const onError = vi.fn();

      render(<SessionProvider><RemoveProbe agentId="ops" onError={onError} /></SessionProvider>);
      await screen.findByText('agent:ops:cron:nightly');

      await act(async () => {
        screen.getByTestId('remove').click();
      });

      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(onError.mock.calls[0][0].message).toBe(refusal);
      expect(listedKeys()).toEqual(OPS_TREE.map((session) => session.sessionKey));
    });

    it('switches away from a removed agent session and drops its pins', async () => {
      installRemoveGateway(OPS_TREE);
      localStorage.setItem(PINNED_SESSIONS_STORAGE_KEY, JSON.stringify([
        'agent:ops:main',
        'agent:ops:subagent:worker',
        'agent:main:main',
      ]));
      resetPinnedSessionsCache();
      onTestFinished(() => {
        localStorage.removeItem(PINNED_SESSIONS_STORAGE_KEY);
        resetPinnedSessionsCache();
      });
      const onError = vi.fn();

      render(<SessionProvider><RemoveProbe agentId="ops" select="agent:ops:subagent:worker" onError={onError} /></SessionProvider>);
      await screen.findByText('agent:ops:subagent:worker');
      act(() => {
        screen.getByTestId('select').click();
      });
      expect(screen.getByTestId('current-session')).toHaveTextContent('agent:ops:subagent:worker');

      await act(async () => {
        screen.getByTestId('remove').click();
      });

      await waitFor(() => expect(screen.getByTestId('current-session')).toHaveTextContent('agent:main:main'));
      expect(onError).not.toHaveBeenCalled();
      expect(JSON.parse(localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY) ?? '[]')).toEqual(['agent:main:main']);
    });

    it('drops every pin of the removed agent, also of sessions the list does not show', async () => {
      installRemoveGateway(OPS_TREE);
      localStorage.setItem(PINNED_SESSIONS_STORAGE_KEY, JSON.stringify([
        'agent:ops:subagent:away',
        'agent:ops:main',
        'agent:main:main',
        'agent:opsx:main',
      ]));
      resetPinnedSessionsCache();
      onTestFinished(() => {
        localStorage.removeItem(PINNED_SESSIONS_STORAGE_KEY);
        resetPinnedSessionsCache();
      });
      const onError = vi.fn();

      render(<SessionProvider><RemoveProbe agentId="ops" onError={onError} /></SessionProvider>);
      await screen.findByText('agent:ops:cron:nightly');

      await act(async () => {
        screen.getByTestId('remove').click();
      });

      await waitFor(() => expect(listedKeys()).toEqual(['agent:main:main']));
      expect(onError).not.toHaveBeenCalled();
      expect(JSON.parse(localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY) ?? '[]')).toEqual(['agent:main:main', 'agent:opsx:main']);
    });

    it('clears the statuses of the removed agent sessions', async () => {
      installRemoveGateway(OPS_TREE);
      function OpsStatus() {
        const { agentStatus } = useSessionContext();
        return <div data-testid="ops-status">{agentStatus['agent:ops:main']?.status ?? 'NONE'}</div>;
      }
      const onError = vi.fn();

      render(<SessionProvider><OpsStatus /><RemoveProbe agentId="ops" onError={onError} /></SessionProvider>);
      await screen.findByText('agent:ops:cron:nightly');
      await waitFor(() => expect(subscribedHandler).not.toBeNull());
      await act(async () => {
        subscribedHandler?.({ type: 'event', event: 'chat', payload: { sessionKey: 'agent:ops:main', state: 'final' } });
        await Promise.resolve();
      });
      expect(screen.getByTestId('ops-status').textContent).toBe('DONE');

      await act(async () => {
        screen.getByTestId('remove').click();
      });

      await waitFor(() => expect(listedKeys()).toEqual(['agent:main:main']));
      expect(onError).not.toHaveBeenCalled();
      expect(screen.getByTestId('ops-status').textContent).toBe('NONE');
    });

    it('reads the identity of an agent re-created with the same id afresh', async () => {
      // No labels on the agent rows, so they show their identity names.
      const gateway = installRemoveGateway([
        { sessionKey: 'agent:main:main', label: 'Main' },
        { sessionKey: 'agent:ops:main' },
      ]);
      let identityName = 'Old Ops';
      const baseFetch = globalThis.fetch;
      globalThis.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/api/workspace/identity?agentId=ops')) {
          return Promise.resolve(jsonResponse({ ok: true, content: `# IDENTITY.md\n- Name: ${identityName}\n` }));
        }
        return baseFetch(input, init);
      }) as typeof fetch;
      const onError = vi.fn();

      render(
        <SessionProvider>
          <SessionDisplayLabels />
          <SessionRefreshProbe />
          <RemoveProbe agentId="ops" onError={onError} />
        </SessionProvider>,
      );
      expect(await screen.findByText('Old Ops (ops)')).toBeInTheDocument();

      await act(async () => {
        screen.getByTestId('remove').click();
      });
      await waitFor(() => expect(listedKeys()).toEqual(['agent:main:main']));

      identityName = 'New Ops';
      gateway.add({ sessionKey: 'agent:ops:main' });
      await act(async () => {
        screen.getByTestId('refresh-sessions').click();
      });

      expect(await screen.findByText('New Ops (ops)')).toBeInTheDocument();
      expect(onError).not.toHaveBeenCalled();
    });

    it('keeps a removed agent gone when a refresh that started before the removal lands after it', async () => {
      installRemoveGateway(OPS_TREE);
      // Hold one full sessions.list answer, taken before the removal, until after the removal has landed.
      // The removal's own refresh fails, so only the held, older answer could bring the agent's rows back.
      const gateway = rpcMock.getMockImplementation()!;
      let holdNextFullList = false;
      let failNextFullList = false;
      let releaseHeldList = () => {};
      rpcMock.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
        if (method === 'sessions.list' && !params?.spawnedBy && failNextFullList) {
          failNextFullList = false;
          throw new Error('gateway unreachable');
        }
        const answer = await gateway(method, params);
        if (method === 'agents.delete') failNextFullList = true;
        if (method === 'sessions.list' && !params?.spawnedBy && holdNextFullList) {
          holdNextFullList = false;
          await new Promise<void>((resolve) => { releaseHeldList = resolve; });
        }
        return answer;
      });
      vi.spyOn(console, 'debug').mockImplementation(() => {});
      const onError = vi.fn();

      render(
        <SessionProvider>
          <SessionRefreshProbe />
          <RemoveProbe agentId="ops" onError={onError} />
        </SessionProvider>,
      );
      await screen.findByText('agent:ops:cron:nightly');

      holdNextFullList = true;
      await act(async () => {
        screen.getByTestId('refresh-sessions').click();
      });
      await act(async () => {
        screen.getByTestId('remove').click();
      });
      await waitFor(() => expect(listedKeys()).toEqual(['agent:main:main']));

      const spawnedByCallsBefore = rpcMock.mock.calls.filter(([method, params]) => method === 'sessions.list' && params?.spawnedBy).length;
      await act(async () => {
        releaseHeldList();
      });
      // The held refresh has finished once it has asked for both roots' children.
      await waitFor(() => {
        expect(rpcMock.mock.calls.filter(([method, params]) => method === 'sessions.list' && params?.spawnedBy)).toHaveLength(spawnedByCallsBefore + 2);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(onError).not.toHaveBeenCalled();
      expect(listedKeys()).toEqual(['agent:main:main']);
    });
  });

  it('lets an older refresh land when a newer one failed to reach the gateway', async () => {
    let listed = [
      { sessionKey: 'agent:main:main', label: 'Main' },
      { sessionKey: 'agent:main:subagent:worker', label: 'Worker' },
    ];
    let nextFullList: 'answer' | 'hold' | 'fail' = 'answer';
    let releaseHeldList = () => {};
    rpcMock.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method !== 'sessions.list') return {};
      if (params?.spawnedBy) return { sessions: [] };
      const mode = nextFullList;
      nextFullList = 'answer';
      if (mode === 'fail') throw new Error('gateway timeout');
      const answer = { sessions: listed };
      if (mode === 'hold') await new Promise<void>((resolve) => { releaseHeldList = resolve; });
      return answer;
    });

    render(
      <SessionProvider>
        <SessionRefreshProbe />
        <SessionLabels />
      </SessionProvider>,
    );
    await screen.findByText('Worker');

    listed = [{ sessionKey: 'agent:main:main', label: 'Main' }];
    nextFullList = 'hold';
    await act(async () => {
      screen.getByTestId('refresh-sessions').click();
    });
    nextFullList = 'fail';
    await act(async () => {
      screen.getByTestId('refresh-sessions').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      releaseHeldList();
    });

    // The only answer the gateway gave since the worker went away must reach the list.
    await waitFor(() => expect(screen.queryByText('Worker')).not.toBeInTheDocument());
  });

  it('applies only the newest of two overlapping refreshes when the older one answers last', async () => {
    let listed = [
      { sessionKey: 'agent:main:main', label: 'Main' },
      { sessionKey: 'agent:main:subagent:worker', label: 'Worker' },
    ];
    let holdNextFullList = false;
    let releaseHeldList = () => {};
    rpcMock.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method !== 'sessions.list') return {};
      if (params?.spawnedBy) return { sessions: [] };
      const answer = { sessions: listed };
      if (holdNextFullList) {
        holdNextFullList = false;
        await new Promise<void>((resolve) => { releaseHeldList = resolve; });
      }
      return answer;
    });

    render(
      <SessionProvider>
        <SessionRefreshProbe />
        <SessionLabels />
      </SessionProvider>,
    );
    await screen.findByText('Worker');

    holdNextFullList = true;
    await act(async () => {
      screen.getByTestId('refresh-sessions').click();
    });
    listed = [{ sessionKey: 'agent:main:main', label: 'Main' }];
    await act(async () => {
      screen.getByTestId('refresh-sessions').click();
    });
    await waitFor(() => expect(screen.queryByText('Worker')).not.toBeInTheDocument());

    await act(async () => {
      releaseHeldList();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByText('Worker')).not.toBeInTheDocument();
  });

  it('carries a status or updatedAt change into a listed row even when nothing else changed', async () => {
    let worker = { status: 'running', updatedAt: 1_000 };
    rpcMock.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method !== 'sessions.list') return {};
      if (params?.spawnedBy) return { sessions: [] };
      return {
        sessions: [
          { sessionKey: 'agent:main:main', label: 'Main' },
          { sessionKey: 'agent:main:subagent:worker', label: 'Worker', totalTokens: 1_200, ...worker },
        ],
      };
    });

    function WorkerRow() {
      const { sessions } = useSessionContext();
      const row = sessions.find((session) => getSessionKey(session) === 'agent:main:subagent:worker');
      return <div data-testid="worker-row">{row ? `${row.status}@${row.updatedAt}` : 'none'}</div>;
    }

    render(
      <SessionProvider>
        <SessionRefreshProbe />
        <WorkerRow />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('worker-row')).toHaveTextContent('running@1000'));

    // The run failed before it spent a token: only the status moved.
    worker = { status: 'failed', updatedAt: 1_000 };
    await act(async () => {
      screen.getByTestId('refresh-sessions').click();
    });
    await waitFor(() => expect(screen.getByTestId('worker-row')).toHaveTextContent('failed@1000'));

    worker = { status: 'failed', updatedAt: 2_000 };
    await act(async () => {
      screen.getByTestId('refresh-sessions').click();
    });
    await waitFor(() => expect(screen.getByTestId('worker-row')).toHaveTextContent('failed@2000'));
  });

  it('uses the full gateway session list for sidebar refreshes so older agent chats stay visible', async () => {
    render(
      <SessionProvider>
        <SessionLabels />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Designer')).toBeInTheDocument();
    });

    expect(rpcMock).toHaveBeenCalledWith('sessions.list', { limit: 1000 });
    expect(rpcMock).not.toHaveBeenCalledWith('sessions.list', expect.objectContaining({ activeMinutes: expect.any(Number) }));
  });

  it('hydrates root session labels from IDENTITY.md names', async () => {
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:main:main', label: 'Main' },
            { sessionKey: 'agent:reviewer:main', displayName: 'stale reviewer label' },
          ],
        };
      }
      return {};
    });

    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes('/api/server-info')) return Promise.resolve(jsonResponse({ agentName: 'Jen' }));
      if (url.includes('/api/workspace/identity?agentId=reviewer')) {
        return Promise.resolve(jsonResponse({ ok: true, content: '# IDENTITY.md\n- Name: Reviewer Prime\n- Role: Review agent\n' }));
      }
      if (url.includes('/api/agentlog')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/api/sessions/hidden')) return Promise.resolve(jsonResponse({ ok: true, sessions: [] }));
      return Promise.resolve(jsonResponse({}));
    }) as typeof fetch;

    render(
      <SessionProvider>
        <SessionDisplayLabels />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Jen (main)')).toBeInTheDocument();
      expect(screen.getByText('Reviewer Prime (reviewer)')).toBeInTheDocument();
    });
  });


  it('clears stale identity labels when a non-main root has no parseable identity name', async () => {
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:main:main', label: 'Main' },
            { sessionKey: 'agent:reviewer:main', identityName: 'Reviewer Prime' },
          ],
        };
      }
      return {};
    });

    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes('/api/server-info')) return Promise.resolve(jsonResponse({ agentName: 'Jen' }));
      if (url.includes('/api/workspace/identity?agentId=reviewer')) {
        return Promise.resolve(jsonResponse({ ok: true, content: '# IDENTITY.md\n- Role: Review agent\n' }));
      }
      if (url.includes('/api/agentlog')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/api/sessions/hidden')) return Promise.resolve(jsonResponse({ ok: true, sessions: [] }));
      return Promise.resolve(jsonResponse({}));
    }) as typeof fetch;

    render(
      <SessionProvider>
        <SessionDisplayLabels />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Jen (main)')).toBeInTheDocument();
      expect(screen.getByText('reviewer')).toBeInTheDocument();
    });

    expect(screen.queryByText('Reviewer Prime (reviewer)')).not.toBeInTheDocument();
  });

  it('does not refetch identity content for roots whose identity files have no parseable name', async () => {
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:main:main', label: 'Main' },
            { sessionKey: 'agent:reviewer:main', displayName: 'stale reviewer label' },
          ],
        };
      }
      return {};
    });

    const fetchSpy = vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes('/api/server-info')) return Promise.resolve(jsonResponse({ agentName: 'Jen' }));
      if (url.includes('/api/workspace/identity?agentId=reviewer')) {
        return Promise.resolve(jsonResponse({ ok: true, content: '# IDENTITY.md\n- Role: Review agent\n' }));
      }
      if (url.includes('/api/agentlog')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/api/sessions/hidden')) return Promise.resolve(jsonResponse({ ok: true, sessions: [] }));
      return Promise.resolve(jsonResponse({}));
    }) as typeof fetch;
    globalThis.fetch = fetchSpy;

    const { getByTestId } = render(
      <SessionProvider>
        <SessionRefreshProbe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/workspace/identity?agentId=reviewer',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    const identityCallsBeforeRefresh = fetchSpy.mock.calls.filter(([input]) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      return url.includes('/api/workspace/identity?agentId=reviewer');
    }).length;
    expect(identityCallsBeforeRefresh).toBe(1);

    await act(async () => {
      getByTestId('refresh-sessions').click();
    });

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('sessions.list', { limit: 1000 });
    });

    const identityCallsAfterRefresh = fetchSpy.mock.calls.filter(([input]) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      return url.includes('/api/workspace/identity?agentId=reviewer');
    }).length;
    expect(identityCallsAfterRefresh).toBe(1);
  });

  it('marks background top-level roots unread on start and pings when chat reaches a terminal event', async () => {
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:main:main', label: 'Main' },
            { sessionKey: 'agent:reviewer:main', label: 'Reviewer' },
          ],
        };
      }
      return {};
    });

    render(
      <SessionProvider>
        <SessionUnreadProbe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('current-session').textContent).toBe('agent:main:main');
    });

    act(() => {
      subscribedHandler?.({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: 'agent:reviewer:main',
          state: 'started',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('reviewer-unread').textContent).toBe('true');
    });
    expect(playPingMock).not.toHaveBeenCalled();

    await act(async () => {
      subscribedHandler?.({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: 'agent:reviewer:main',
          state: 'final',
        },
      });
      await Promise.resolve();
    });

    expect(playPingMock).toHaveBeenCalledTimes(1);
  });

  it('marks a background root unread but does not ping its completion while sound is off', async () => {
    soundEnabledValue = false;
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:main:main', label: 'Main' },
            { sessionKey: 'agent:reviewer:main', label: 'Reviewer' },
          ],
        };
      }
      return {};
    });

    render(
      <SessionProvider>
        <SessionUnreadProbe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('current-session').textContent).toBe('agent:main:main');
    });

    act(() => {
      subscribedHandler?.({
        type: 'event',
        event: 'chat',
        payload: { sessionKey: 'agent:reviewer:main', state: 'started' },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('reviewer-unread').textContent).toBe('true');
    });

    await act(async () => {
      subscribedHandler?.({
        type: 'event',
        event: 'chat',
        payload: { sessionKey: 'agent:reviewer:main', state: 'final' },
      });
      await Promise.resolve();
    });

    expect(playPingMock).not.toHaveBeenCalled();
  });

  it('dedupes background completion pings when lifecycle and chat terminal events arrive for the same root', async () => {
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:main:main', label: 'Main' },
            { sessionKey: 'agent:reviewer:main', label: 'Reviewer' },
          ],
        };
      }
      return {};
    });

    render(
      <SessionProvider>
        <SessionUnreadProbe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('current-session').textContent).toBe('agent:main:main');
    });

    await act(async () => {
      subscribedHandler?.({
        type: 'event',
        event: 'agent',
        payload: {
          sessionKey: 'agent:reviewer:main',
          stream: 'lifecycle',
          data: { phase: 'end' },
        },
      });
      subscribedHandler?.({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: 'agent:reviewer:main',
          state: 'final',
        },
      });
      await Promise.resolve();
    });

    expect(playPingMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes background completion pings by run id when lifecycle and chat terminal events agree', async () => {
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:main:main', label: 'Main' },
            { sessionKey: 'agent:reviewer:main', label: 'Reviewer' },
          ],
        };
      }
      return {};
    });

    render(
      <SessionProvider>
        <SessionUnreadProbe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('current-session').textContent).toBe('agent:main:main');
    });

    await act(async () => {
      subscribedHandler?.({
        type: 'event',
        event: 'agent',
        payload: {
          sessionKey: 'agent:reviewer:main',
          stream: 'lifecycle',
          data: { phase: 'end', runId: 'run-1' },
        },
      });
      subscribedHandler?.({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: 'agent:reviewer:main',
          state: 'final',
          runId: 'run-1',
        },
      });
      await Promise.resolve();
    });

    expect(playPingMock).toHaveBeenCalledTimes(1);
  });

  it('allows separate completion pings for distinct background run ids', async () => {
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:main:main', label: 'Main' },
            { sessionKey: 'agent:reviewer:main', label: 'Reviewer' },
          ],
        };
      }
      return {};
    });

    render(
      <SessionProvider>
        <SessionUnreadProbe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('current-session').textContent).toBe('agent:main:main');
    });

    await act(async () => {
      subscribedHandler?.({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: 'agent:reviewer:main',
          state: 'final',
          runId: 'run-1',
        },
      });
      subscribedHandler?.({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: 'agent:reviewer:main',
          state: 'final',
          runId: 'run-2',
        },
      });
      await Promise.resolve();
    });

    expect(playPingMock).toHaveBeenCalledTimes(2);
  });

  it('allows another session-level completion ping after the dedupe window expires', async () => {
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:main:main', label: 'Main' },
            { sessionKey: 'agent:reviewer:main', label: 'Reviewer' },
          ],
        };
      }
      return {};
    });

    render(
      <SessionProvider>
        <SessionUnreadProbe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('current-session').textContent).toBe('agent:main:main');
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T16:00:00.000Z'));

    await act(async () => {
      subscribedHandler?.({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: 'agent:reviewer:main',
          state: 'final',
        },
      });
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_001);
      subscribedHandler?.({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: 'agent:reviewer:main',
          state: 'final',
        },
      });
      await Promise.resolve();
    });

    expect(playPingMock).toHaveBeenCalledTimes(2);
  });

  it('does not mark the currently viewed root unread or ping for its own chat events', async () => {
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:main:main', label: 'Main' },
            { sessionKey: 'agent:reviewer:main', label: 'Reviewer' },
          ],
        };
      }
      return {};
    });

    render(
      <SessionProvider>
        <SessionUnreadProbe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('current-session').textContent).toBe('agent:main:main');
    });

    act(() => {
      screen.getByTestId('select-reviewer').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('current-session').textContent).toBe('agent:reviewer:main');
    });

    act(() => {
      subscribedHandler?.({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: 'agent:reviewer:main',
          state: 'started',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('reviewer-unread').textContent).toBe('false');
    });
    expect(playPingMock).not.toHaveBeenCalled();
  });

  it('does not mark unread or ping when a root becomes current in the same act as its chat event', async () => {
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:main:main', label: 'Main' },
            { sessionKey: 'agent:reviewer:main', label: 'Reviewer' },
          ],
        };
      }
      return {};
    });

    render(
      <SessionProvider>
        <SessionUnreadProbe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('current-session').textContent).toBe('agent:main:main');
    });

    act(() => {
      screen.getByTestId('select-reviewer').click();
      subscribedHandler?.({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: 'agent:reviewer:main',
          state: 'started',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('current-session').textContent).toBe('agent:reviewer:main');
    });
    expect(screen.getByTestId('reviewer-unread').textContent).toBe('false');
    expect(playPingMock).not.toHaveBeenCalled();
  });

  it('keeps the DONE-to-IDLE timer alive when sound is toggled mid-response', async () => {
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:main:main', label: 'Main' },
            { sessionKey: 'agent:reviewer:main', label: 'Reviewer' },
          ],
        };
      }
      return {};
    });

    const view = render(
      <SessionProvider>
        <SessionStatusProbe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(subscribedHandler).not.toBeNull();
    });

    vi.useFakeTimers();

    await act(async () => {
      subscribedHandler?.({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: 'agent:reviewer:main',
          state: 'final',
        },
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId('reviewer-status').textContent).toBe('DONE');

    await act(async () => {
      soundEnabledValue = false;
      view.rerender(
        <SessionProvider>
          <SessionStatusProbe />
        </SessionProvider>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });

    expect(screen.getByTestId('reviewer-status').textContent).toBe('IDLE');
  });

  it('uses the latest refresh callback for delayed refreshes after gateway changes', async () => {
    const rpcBeforeReconnect = vi.fn(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:main:main', label: 'Main' },
            { sessionKey: 'agent:reviewer:main', label: 'Reviewer' },
          ],
        };
      }
      return {};
    });
    const rpcAfterReconnect = vi.fn(async () => ({}));
    rpcMock = rpcBeforeReconnect;

    const view = render(
      <SessionProvider>
        <SessionStatusProbe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(rpcBeforeReconnect).toHaveBeenCalledWith('sessions.list', { limit: 1000 });
    });

    vi.useFakeTimers();

    await act(async () => {
      subscribedHandler?.({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: 'agent:reviewer:main',
          state: 'final',
        },
      });
      await Promise.resolve();
    });

    const preReconnectSessionsListCalls = rpcBeforeReconnect.mock.calls.filter(([method]) => method === 'sessions.list').length;

    await act(async () => {
      connectionStateValue = 'reconnecting';
      rpcMock = rpcAfterReconnect;
      view.rerender(
        <SessionProvider>
          <SessionStatusProbe />
        </SessionProvider>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_600);
    });

    expect(rpcBeforeReconnect.mock.calls.filter(([method]) => method === 'sessions.list')).toHaveLength(preReconnectSessionsListCalls);
    expect(rpcAfterReconnect).not.toHaveBeenCalledWith('sessions.list', expect.anything());
  });

  it('uses the latest refresh callback for missing-session fallback refreshes after gateway changes', async () => {
    const rpcBeforeReconnect = vi.fn(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:main:main', label: 'Main' },
            { sessionKey: 'agent:reviewer:main', label: 'Reviewer' },
          ],
        };
      }
      return {};
    });
    const rpcAfterReconnect = vi.fn(async () => ({}));
    rpcMock = rpcBeforeReconnect;

    const view = render(
      <SessionProvider>
        <SessionStatusProbe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(rpcBeforeReconnect).toHaveBeenCalledWith('sessions.list', { limit: 1000 });
    });

    vi.useFakeTimers();

    await act(async () => {
      subscribedHandler?.({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: 'agent:fresh:main',
          state: 'started',
        },
      });
      await Promise.resolve();
    });

    const preReconnectSessionsListCalls = rpcBeforeReconnect.mock.calls.filter(([method]) => method === 'sessions.list').length;

    await act(async () => {
      connectionStateValue = 'reconnecting';
      rpcMock = rpcAfterReconnect;
      view.rerender(
        <SessionProvider>
          <SessionStatusProbe />
        </SessionProvider>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(rpcBeforeReconnect.mock.calls.filter(([method]) => method === 'sessions.list')).toHaveLength(preReconnectSessionsListCalls);
    expect(rpcAfterReconnect).not.toHaveBeenCalledWith('sessions.list', expect.anything());
  });

  it('records a chat error as a failure in the event log', async () => {
    render(
      <SessionProvider>
        <SessionEventLog />
      </SessionProvider>,
    );
    await waitFor(() => expect(subscribedHandler).not.toBeNull());

    act(() => {
      subscribedHandler?.({ type: 'event', event: 'chat', payload: { sessionKey: 'agent:main:main', state: 'final' } });
    });
    expect(screen.getByText('Response complete')).toHaveClass('text-foreground');
    expect(screen.queryByLabelText('Failed')).toBeNull();

    act(() => {
      subscribedHandler?.({ type: 'event', event: 'chat', payload: { sessionKey: 'agent:main:main', state: 'error' } });
    });
    expect(screen.getByText('Chat error')).toHaveClass('text-destructive');
    expect(screen.getByLabelText('Failed')).toHaveAttribute('data-state', 'error');
  });

  it('keeps the main session dark while a heartbeat runs on it', async () => {
    const MAIN = 'agent:main:main';
    function MainPaneProbe() {
      const { agentStatus, busyState } = useSessionContext();
      const pane = sessionPaneState({ sessionKey: MAIN }, { busyState, agentStatus });
      return <div data-testid="main-pane">{`${agentStatus[MAIN]?.status ?? 'NONE'} ${String(Boolean(busyState[MAIN]))} ${pane}`}</div>;
    }
    render(
      <SessionProvider>
        <MainPaneProbe />
      </SessionProvider>,
    );
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('sessions.list', { limit: 1000 });
    });
    const emit = (event: string, payload: Record<string, unknown>) => {
      act(() => {
        subscribedHandler?.({ type: 'event', event, payload });
      });
    };

    // Agent frames of a heartbeat carry isHeartbeat; its chat frames only share the run id.
    const heartbeat = { sessionKey: MAIN, agentId: 'main', runId: 'run-hb', isHeartbeat: true };
    emit('agent', { ...heartbeat, stream: 'lifecycle', data: { phase: 'start' } });
    expect(screen.getByTestId('main-pane')).toHaveTextContent('NONE false off');
    emit('agent', { ...heartbeat, stream: 'item', data: { kind: 'tool', phase: 'start', name: 'read' } });
    emit('chat', { sessionKey: MAIN, runId: 'run-hb', state: 'delta', deltaText: 'Disk' });
    expect(screen.getByTestId('main-pane')).toHaveTextContent('NONE false off');
    emit('agent', { ...heartbeat, stream: 'lifecycle', data: { phase: 'end' } });
    emit('chat', { sessionKey: MAIN, runId: 'run-hb', state: 'final' });
    expect(screen.getByTestId('main-pane')).toHaveTextContent('NONE false off');
    expect(playPingMock).not.toHaveBeenCalled();

    // Any other run on the session lights it as before.
    emit('agent', { sessionKey: MAIN, agentId: 'main', runId: 'run-tg', isHeartbeat: false, stream: 'lifecycle', data: { phase: 'start' } });
    expect(screen.getByTestId('main-pane')).toHaveTextContent('THINKING true live');
  });

  it('drops the granular statuses held across a reconnect so the refreshed snapshot decides', async () => {
    const view = render(
      <SessionProvider>
        <SessionStatusProbe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('sessions.list', { limit: 1000 });
    });

    act(() => {
      subscribedHandler?.({ type: 'event', event: 'chat', payload: { sessionKey: 'agent:reviewer:main', state: 'started' } });
    });
    expect(screen.getByTestId('reviewer-status')).toHaveTextContent('THINKING');

    // The gateway drops; the status is kept while we are away
    act(() => {
      connectionStateValue = 'reconnecting';
      view.rerender(
        <SessionProvider>
          <SessionStatusProbe />
        </SessionProvider>,
      );
    });
    expect(screen.getByTestId('reviewer-status')).toHaveTextContent('THINKING');

    // Back online: whatever happened in the gap is unknown, so the retained status goes
    act(() => {
      connectionStateValue = 'connected';
      view.rerender(
        <SessionProvider>
          <SessionStatusProbe />
        </SessionProvider>,
      );
    });
    expect(screen.getByTestId('reviewer-status')).toHaveTextContent('NONE');
  });

  describe('cron sessions from sessions.json', () => {
    function installHiddenAnswer(answer: unknown) {
      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/api/server-info')) return Promise.resolve(jsonResponse({ agentName: 'Jen' }));
        if (url.includes('/api/agentlog')) return Promise.resolve(jsonResponse([]));
        if (url.includes('/api/sessions/hidden')) return Promise.resolve(jsonResponse(answer));
        return Promise.resolve(jsonResponse({}));
      });
      globalThis.fetch = fetchMock as typeof fetch;
      return () => fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/sessions/hidden')).length;
    }

    const fullListCalls = () => rpcMock.mock.calls.filter(([method, params]) => method === 'sessions.list' && !params?.spawnedBy).length;

    it('pauses asking after the server reports no sessions.json, as on current OpenClaw, and checks again later', async () => {
      const hiddenCalls = installHiddenAnswer({ ok: true, sessions: [], storeMissing: true, remoteWorkspace: true });
      const realNow = performance.now.bind(performance);
      let offsetMs = 0;
      const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => realNow() + offsetMs);
      onTestFinished(() => nowSpy.mockRestore());
      const refresh = async () => {
        const before = fullListCalls();
        await act(async () => {
          screen.getByTestId('refresh-sessions').click();
        });
        await waitFor(() => expect(fullListCalls()).toBeGreaterThan(before));
      };

      render(<SessionProvider><SessionLabels /><SessionRefreshProbe /></SessionProvider>);
      await screen.findByText('Cron: Daily Digest');
      expect(hiddenCalls()).toBe(1);

      await refresh();
      expect(hiddenCalls()).toBe(1);
      // The gateway's own list still carries the cron session
      expect(screen.getByText('Cron: Daily Digest')).toBeInTheDocument();

      // An older gateway may create the file later, so the pause runs out
      offsetMs = 5 * 60_000 + 1;
      await refresh();
      expect(hiddenCalls()).toBe(2);
    });

    it('lets only the newest answer start the pause, so a late missing answer cannot hide cron rows', async () => {
      const nightly = { ok: true, sessions: [{ sessionKey: 'agent:main:cron:nightly', label: 'Cron: Nightly' }] };
      let releaseLateMissing = () => {};
      let hiddenCount = 0;
      globalThis.fetch = vi.fn((input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/api/server-info')) return Promise.resolve(jsonResponse({ agentName: 'Jen' }));
        if (url.includes('/api/agentlog')) return Promise.resolve(jsonResponse([]));
        if (url.includes('/api/sessions/hidden')) {
          hiddenCount += 1;
          // The second request (refresh A) answers "missing" only after refresh B found the file
          if (hiddenCount === 2) {
            return new Promise<Response>((resolve) => {
              releaseLateMissing = () => resolve(jsonResponse({ ok: true, sessions: [], storeMissing: true }));
            });
          }
          return Promise.resolve(jsonResponse(nightly));
        }
        return Promise.resolve(jsonResponse({}));
      }) as typeof fetch;

      render(<SessionProvider><SessionLabels /><SessionRefreshProbe /></SessionProvider>);
      await screen.findByText('Cron: Nightly');

      await act(async () => {
        screen.getByTestId('refresh-sessions').click(); // A: held
      });
      await act(async () => {
        screen.getByTestId('refresh-sessions').click(); // B: finds the file
      });
      await waitFor(() => expect(hiddenCount).toBe(3));
      await act(async () => {
        releaseLateMissing();
      });

      await act(async () => {
        screen.getByTestId('refresh-sessions').click(); // C: must still ask
      });
      await waitFor(() => expect(hiddenCount).toBe(4));
      expect(screen.getByText('Cron: Nightly')).toBeInTheDocument();
    });

    it('keeps asking on every refresh when a file it has read before goes missing', async () => {
      const nightly = { ok: true, sessions: [{ sessionKey: 'agent:main:cron:nightly', label: 'Cron: Nightly' }] };
      const answers = [nightly, { ok: true, sessions: [], storeMissing: true, remoteWorkspace: true }, nightly];
      let hiddenCount = 0;
      globalThis.fetch = vi.fn((input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/api/server-info')) return Promise.resolve(jsonResponse({ agentName: 'Jen' }));
        if (url.includes('/api/agentlog')) return Promise.resolve(jsonResponse([]));
        if (url.includes('/api/sessions/hidden')) {
          const answer = answers[Math.min(hiddenCount, answers.length - 1)];
          hiddenCount += 1;
          return Promise.resolve(jsonResponse(answer));
        }
        return Promise.resolve(jsonResponse({}));
      }) as typeof fetch;

      render(<SessionProvider><SessionLabels /><SessionRefreshProbe /></SessionProvider>);
      await screen.findByText('Cron: Nightly');

      // The gateway is rewriting the file: this refresh finds it missing
      await act(async () => {
        screen.getByTestId('refresh-sessions').click();
      });
      await waitFor(() => expect(hiddenCount).toBe(2));

      // No pause: the next refresh asks again and the cron row is back
      await act(async () => {
        screen.getByTestId('refresh-sessions').click();
      });
      await waitFor(() => expect(hiddenCount).toBe(3));
      expect(await screen.findByText('Cron: Nightly')).toBeInTheDocument();
    });

    it('lifts the pause when an older answer that found the file lands after a newer missing one', async () => {
      const nightly = { ok: true, sessions: [{ sessionKey: 'agent:main:cron:nightly', label: 'Cron: Nightly' }] };
      let releaseLateFound = () => {};
      let hiddenCount = 0;
      globalThis.fetch = vi.fn((input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/api/server-info')) return Promise.resolve(jsonResponse({ agentName: 'Jen' }));
        if (url.includes('/api/agentlog')) return Promise.resolve(jsonResponse([]));
        if (url.includes('/api/sessions/hidden')) {
          hiddenCount += 1;
          // The first request (mount) finds the file only after the second one reported it missing
          if (hiddenCount === 1) {
            return new Promise<Response>((resolve) => {
              releaseLateFound = () => resolve(jsonResponse(nightly));
            });
          }
          if (hiddenCount === 2) return Promise.resolve(jsonResponse({ ok: true, sessions: [], storeMissing: true }));
          return Promise.resolve(jsonResponse(nightly));
        }
        return Promise.resolve(jsonResponse({}));
      }) as typeof fetch;

      render(<SessionProvider><SessionLabels /><SessionRefreshProbe /></SessionProvider>);
      await waitFor(() => expect(hiddenCount).toBe(1));
      await act(async () => {
        screen.getByTestId('refresh-sessions').click(); // reports missing and starts the pause
      });
      await waitFor(() => expect(hiddenCount).toBe(2));
      await act(async () => {
        releaseLateFound();
      });

      await act(async () => {
        screen.getByTestId('refresh-sessions').click(); // must ask despite the pause
      });
      await waitFor(() => expect(hiddenCount).toBe(3));
      expect(await screen.findByText('Cron: Nightly')).toBeInTheDocument();
    });

    it('keeps asking and merges its cron sessions when the file exists, as on older gateways', async () => {
      const hiddenCalls = installHiddenAnswer({
        ok: true,
        sessions: [{ sessionKey: 'agent:main:cron:nightly', label: 'Cron: Nightly' }],
      });

      render(<SessionProvider><SessionLabels /><SessionRefreshProbe /></SessionProvider>);
      await screen.findByText('Cron: Nightly');

      const before = hiddenCalls();
      await act(async () => {
        screen.getByTestId('refresh-sessions').click();
      });

      await waitFor(() => expect(hiddenCalls()).toBe(before + 1));
      expect(screen.getByText('Cron: Nightly')).toBeInTheDocument();
    });
  });
});
