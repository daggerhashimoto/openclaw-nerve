import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SessionProvider, useSessionContext } from './SessionContext';
import { getSessionKey, type GatewayEvent } from '@/types';

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
});
