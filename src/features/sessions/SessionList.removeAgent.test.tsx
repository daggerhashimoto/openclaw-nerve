import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { Session } from '@/types';
import type { AgentRemovalInfo, RemoveAgentOpts } from '@/contexts/SessionContext';
import { SessionList } from './SessionList';

// One agent row on screen; whether it is the only configured agent is the gateway's to say.
const ONE_AGENT_ROW: Session[] = [
  { sessionKey: 'agent:main:main', label: 'Main' },
  { sessionKey: 'agent:main:subagent:x', label: 'X' },
];

const OPS_TREE: Session[] = [
  { sessionKey: 'agent:main:main', label: 'Main' },
  { sessionKey: 'agent:ops:main', label: 'Ops' },
  { sessionKey: 'agent:ops:subagent:worker', label: 'Worker' },
  { sessionKey: 'agent:ops:cron:nightly', label: 'Nightly' },
];

function renderSessionList(
  sessions: Session[],
  onRemoveAgent: (agentId: string, opts: RemoveAgentOpts) => Promise<void>,
  getAgentRemovalInfo?: (agentId: string) => Promise<AgentRemovalInfo | null>,
) {
  return render(
    <SessionList
      sessions={sessions}
      currentSession=""
      busyState={{}}
      onSelect={() => {}}
      onRefresh={() => {}}
      onDelete={async () => {}}
      onRemoveAgent={onRemoveAgent}
      getAgentRemovalInfo={getAgentRemovalInfo}
      onRename={async () => {}}
    />,
  );
}

/** The row that shows `label`: its select button's parent holds the row's actions. */
function rowOf(label: string): HTMLElement {
  return screen.getByText(label).closest('button')!.parentElement!;
}

function openRemoveFor(label: string) {
  act(() => {
    within(rowOf(label)).getByTitle('Remove agent').click();
  });
}

describe('SessionList remove agent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers Remove agent on top-level agent rows and Delete on the rest', () => {
    renderSessionList(OPS_TREE, vi.fn(async () => {}));

    expect(screen.getAllByTitle('Remove agent')).toHaveLength(2);
    expect(screen.getAllByTitle('Delete session')).toHaveLength(2);
  });

  it('removes the agent keeping its files by default', async () => {
    const onRemoveAgent = vi.fn(async () => {});
    renderSessionList(OPS_TREE, onRemoveAgent);

    openRemoveFor('Ops');
    expect(screen.getByRole('radio', { name: /Keep files on disk/ })).toBeChecked();
    await act(async () => {
      screen.getByRole('button', { name: 'Remove agent' }).click();
    });

    expect(onRemoveAgent).toHaveBeenCalledWith('ops', { deleteFiles: false });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('moves the files to the Trash when that mode is picked', async () => {
    const onRemoveAgent = vi.fn(async () => {});
    renderSessionList(OPS_TREE, onRemoveAgent);

    openRemoveFor('Ops');
    act(() => {
      screen.getByRole('radio', { name: /Move files to Trash/ }).click();
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Remove agent' }).click();
    });

    expect(onRemoveAgent).toHaveBeenCalledWith('ops', { deleteFiles: true });
  });

  it('keeps the dialog open with the gateway reason when removal is refused', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const refusal = 'Agent "ops" owns the shared auth store and cannot be deleted.';
    const onRemoveAgent = vi.fn(async () => { throw new Error(refusal); });
    renderSessionList(OPS_TREE, onRemoveAgent);

    openRemoveFor('Ops');
    await act(async () => {
      screen.getByRole('button', { name: 'Remove agent' }).click();
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(refusal);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove agent' })).toBeEnabled();
  });

  it('sends one removal for a double click on confirm', async () => {
    const onRemoveAgent = vi.fn(() => new Promise<void>(() => {}));
    renderSessionList(OPS_TREE, onRemoveAgent);

    openRemoveFor('Ops');
    await act(async () => {
      screen.getByRole('button', { name: 'Remove agent' }).click();
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Removing...' }).click();
    });

    expect(onRemoveAgent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Removing...' })).toBeDisabled();
  });

  it('shows the workspace and says it stays when it sits inside another agent workspace', async () => {
    const getAgentRemovalInfo = vi.fn(async (): Promise<AgentRemovalInfo> => ({
      path: '/home/me/.openclaw/workspace/ops',
      overlap: { agentId: 'main', relation: 'inside' },
      isOnlyAgent: false,
    }));
    renderSessionList(OPS_TREE, vi.fn(async () => {}), getAgentRemovalInfo);

    openRemoveFor('Ops');

    expect(await screen.findByText('/home/me/.openclaw/workspace/ops')).toBeInTheDocument();
    expect(getAgentRemovalInfo).toHaveBeenCalledWith('ops');
    expect(screen.getByRole('radio', { name: /Move files to Trash/ })).toHaveAccessibleName(
      expect.stringContaining("Its workspace stays: it sits inside main's workspace."),
    );
  });

  it.each([
    ['contains', "Its workspace stays: worker's workspace sits inside it."],
    ['same', 'Its workspace stays: worker uses the same folder.'],
  ] as const)('says the workspace stays when it overlaps another agent workspace (%s)', async (relation, hint) => {
    const getAgentRemovalInfo = vi.fn(async (): Promise<AgentRemovalInfo> => ({
      path: '/home/me/ops',
      overlap: { agentId: 'worker', relation },
      isOnlyAgent: false,
    }));
    renderSessionList(OPS_TREE, vi.fn(async () => {}), getAgentRemovalInfo);

    openRemoveFor('Ops');

    expect(await screen.findByText('/home/me/ops')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Move files to Trash/ })).toHaveAccessibleName(expect.stringContaining(hint));
  });

  it('says the workspace goes to the Trash when it sits beside the others', async () => {
    const getAgentRemovalInfo = vi.fn(async () => ({ path: '/home/me/.openclaw/workspace-ops', isOnlyAgent: false }));
    renderSessionList(OPS_TREE, vi.fn(async () => {}), getAgentRemovalInfo);

    openRemoveFor('Ops');

    expect(await screen.findByText('/home/me/.openclaw/workspace-ops')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Move files to Trash/ })).toHaveAccessibleName(
      expect.stringContaining('Its workspace, sessions and state go to the system Trash.'),
    );
  });

  it('says the only agent cannot be removed when the gateway lists just one', async () => {
    const onRemoveAgent = vi.fn(async () => {});
    renderSessionList(ONE_AGENT_ROW, onRemoveAgent, vi.fn(async () => ({ path: '/home/me/.openclaw/workspace', isOnlyAgent: true })));

    openRemoveFor('Agent (main)');

    expect(await screen.findByText(/The only agent cannot be removed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove agent' })).toBeDisabled();
  });

  it('offers removal when the gateway lists other agents, even with one agent row on screen', async () => {
    const onRemoveAgent = vi.fn(async () => {});
    const getAgentRemovalInfo = vi.fn(async () => ({ path: '/home/me/.openclaw/workspace', isOnlyAgent: false }));
    renderSessionList(ONE_AGENT_ROW, onRemoveAgent, getAgentRemovalInfo);

    openRemoveFor('Agent (main)');
    await waitFor(() => expect(getAgentRemovalInfo).toHaveBeenCalledWith('main'));
    expect(await screen.findByText('/home/me/.openclaw/workspace')).toBeInTheDocument();
    expect(screen.queryByText(/The only agent cannot be removed/)).not.toBeInTheDocument();
    await act(async () => {
      screen.getByRole('button', { name: 'Remove agent' }).click();
    });

    expect(onRemoveAgent).toHaveBeenCalledWith('main', { deleteFiles: false });
  });
});
