import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const hoisted = vi.hoisted(() => ({
  gatewayNames: {} as Record<string, string>,
  workspaceName: 'Workspace Ops',
  workspaceStatus: 200,
  sessions: [{ key: 'agent:ops:main' }] as Array<{ key: string }>,
}));

const rpcMock = vi.hoisted(() => vi.fn(async (method: string) => {
  if (method === 'sessions.list') {
    return { sessions: [...hoisted.sessions] };
  }
  if (method === 'agents.list') {
    return {
      agents: Object.entries(hoisted.gatewayNames).map(([id, name]) => ({ id, identity: { name } })),
    };
  }
  return {};
}));

vi.mock('./GatewayContext', () => ({
  useGateway: () => ({
    connectionState: 'connected',
    rpc: rpcMock,
    subscribe: () => () => {},
  }),
}));

vi.mock('./SettingsContext', () => ({
  useSettings: () => ({ soundEnabled: false }),
}));

import { SessionProvider, useSessionContext } from './SessionContext';
import { getSessionDisplayLabel } from '@/features/sessions/sessionKeys';

function Labels() {
  const { sessions, agentName } = useSessionContext();
  return (
    <div>
      {sessions.map((session) => (
        <span key={session.key}>{getSessionDisplayLabel(session, agentName)}</span>
      ))}
    </div>
  );
}

function Refresh() {
  const { refreshSessions } = useSessionContext();
  return <button type="button" onClick={() => void refreshSessions()}>Refresh</button>;
}

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('SessionContext identity source', () => {
  beforeEach(() => {
    hoisted.gatewayNames = {};
    hoisted.workspaceName = 'Workspace Ops';
    hoisted.workspaceStatus = 200;
    hoisted.sessions = [{ key: 'agent:ops:main' }];
    vi.clearAllMocks();

    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/agentlog') return json({ ok: true });
      if (url === '/api/server-info') {
        return json({ agentName: 'Kim', defaultAgentWorkspaceRoot: '/tmp' });
      }
      if (url.startsWith('/api/sessions/hidden')) return json({ ok: true, sessions: [] });
      if (url.startsWith('/api/workspace/identity')) {
        if (hoisted.workspaceStatus === 404) return json({ ok: false, error: 'not found' }, 404);
        if (hoisted.workspaceStatus === 500) return json({ ok: false, error: 'down' }, 500);
        return json({ ok: true, content: `- **Name:** ${hoisted.workspaceName}` });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof globalThis.fetch;
  });

  it('prefers the gateway agents.list identity over a workspace file', async () => {
    hoisted.gatewayNames = { ops: 'Gateway Ops' };

    render(<SessionProvider><Labels /></SessionProvider>);

    await waitFor(() => expect(screen.getByText('Gateway Ops (ops)')).toBeInTheDocument());
  });

  it('clears a stale workspace name when the identity file becomes a 404', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      render(<SessionProvider><Labels /></SessionProvider>);
      await waitFor(() => expect(screen.getByText('Workspace Ops (ops)')).toBeInTheDocument());

      hoisted.workspaceStatus = 404;
      await act(async () => {
        vi.advanceTimersByTime(5 * 60_000 + 1_000);
      });

      await waitFor(() => expect(screen.getByText('ops')).toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries an aborted identity read immediately after a sessions change', async () => {
    const baseFetch = globalThis.fetch;
    let identityCalls = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/workspace/identity')) {
        identityCalls += 1;
        if (identityCalls === 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            });
          });
        }
        return json({ ok: true, content: '- **Name:** Retried' });
      }
      return baseFetch(input as RequestInfo, init);
    }) as typeof globalThis.fetch;

    render(<SessionProvider><Labels /><Refresh /></SessionProvider>);
    await waitFor(() => expect(identityCalls).toBe(1));

    // Force a changed session list so the identity effect re-runs and aborts the
    // pending read. An aborted read must not stamp the retry window; the new
    // effect run should fetch immediately.
    hoisted.sessions = [{ key: 'agent:ops:main' }, { key: 'agent:ops2:main' }];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(screen.getByText('Retried (ops)')).toBeInTheDocument());
    expect(identityCalls).toBeGreaterThan(1);
  });

  it('retries a failed workspace read after the retry window', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      hoisted.workspaceStatus = 500;
      render(<SessionProvider><Labels /></SessionProvider>);
      await waitFor(() => expect(screen.getByText('ops')).toBeInTheDocument());

      hoisted.workspaceStatus = 200;
      hoisted.workspaceName = 'New Ops';
      await act(async () => {
        vi.advanceTimersByTime(60_000 + 1_000);
      });

      await waitFor(() => expect(screen.getByText('New Ops (ops)')).toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });
});
