import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SessionProvider, useSessionContext } from './SessionContext';
import { getSessionKey } from '@/types';

const mockUseGateway = vi.fn();
let rpcMock: ReturnType<typeof vi.fn>;

vi.mock('./GatewayContext', () => ({
  useGateway: () => mockUseGateway(),
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

describe('SessionContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();

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

    mockUseGateway.mockReturnValue({
      connectionState: 'connected',
      rpc: rpcMock,
      subscribe: vi.fn(() => () => {}),
    });

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
});
