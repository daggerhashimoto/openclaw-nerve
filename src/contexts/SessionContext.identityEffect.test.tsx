import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

const hoisted = vi.hoisted(() => ({
  gatewayNames: {} as Record<string, string>,
  workspaceName: 'Workspace Ops',
  workspaceStatus: 200,
}));

const rpcMock = vi.hoisted(() => vi.fn(async (method: string) => {
  if (method === 'sessions.list') {
    return { sessions: [{ key: 'agent:ops:main' }] };
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
