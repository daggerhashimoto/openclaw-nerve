import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadViewerTab } from './BeadViewerTab';

const beadDetailState = {
  bead: {
    id: 'nerve-4gpd',
    title: 'Second CodeRabbit fixes',
    notes: 'Open /workspace/src/plain.tsx and `/workspace/src/code.tsx` plus [related](bead:nerve-related)',
    status: 'open',
    priority: 1,
    issueType: 'task',
    owner: 'chip',
    createdAt: null,
    updatedAt: null,
    closedAt: null,
    closeReason: null,
    dependencies: [{ id: 'nerve-dep', title: 'Dependency', status: 'open', dependencyType: 'blocks' }],
    dependents: [],
    linkedPlan: {
      path: '.plans/demo.md',
      workspacePath: 'projects/demo/.plans/demo.md',
      title: 'Demo plan',
      planId: 'plan-demo',
      archived: false,
      status: 'In Progress',
      updatedAt: 123,
    },
  },
  loading: false,
  error: null as string | null,
};

vi.mock('./useBeadDetail', () => ({
  useBeadDetail: () => beadDetailState,
}));

describe('BeadViewerTab', () => {
  beforeEach(() => {
    beadDetailState.loading = false;
    beadDetailState.error = null;
  });

  it('preserves the current bead context when opening related beads and markdown bead links', async () => {
    const onOpenBeadId = vi.fn();

    render(
      <BeadViewerTab
        beadTarget={{
          beadId: 'nerve-4gpd',
          explicitTargetPath: '../projects/demo/.beads',
          currentDocumentPath: 'notes/beads.md',
          workspaceAgentId: 'research',
        }}
        onOpenBeadId={onOpenBeadId}
        onOpenWorkspacePath={vi.fn()}
        pathLinkPrefixes={['/workspace/']}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Dependency/ }));
    fireEvent.click(screen.getByRole('link', { name: 'related' }));

    await waitFor(() => {
      expect(onOpenBeadId).toHaveBeenNthCalledWith(1, {
        beadId: 'nerve-dep',
        explicitTargetPath: '../projects/demo/.beads',
        currentDocumentPath: 'notes/beads.md',
        workspaceAgentId: 'research',
      });
      expect(onOpenBeadId).toHaveBeenNthCalledWith(2, {
        beadId: 'nerve-related',
        explicitTargetPath: '../projects/demo/.beads',
        currentDocumentPath: 'notes/beads.md',
        workspaceAgentId: 'research',
      });
    });
  });

  it('linkifies bead note workspace paths, including inline code spans, with the same chat path prefixes', async () => {
    const onOpenWorkspacePath = vi.fn();

    render(
      <BeadViewerTab
        beadTarget={{ beadId: 'nerve-4gpd', currentDocumentPath: 'notes/beads.md', workspaceAgentId: 'research' }}
        onOpenWorkspacePath={onOpenWorkspacePath}
        pathLinkPrefixes={['/workspace/']}
      />,
    );

    const plainLink = screen.getByRole('link', { name: '/workspace/src/plain.tsx' });
    const codeLink = screen.getByRole('link', { name: '/workspace/src/code.tsx' });

    expect(codeLink.closest('code')).not.toBeNull();

    fireEvent.click(plainLink);
    fireEvent.click(codeLink);

    await waitFor(() => {
      expect(onOpenWorkspacePath).toHaveBeenNthCalledWith(1, '/workspace/src/plain.tsx', 'notes/beads.md');
      expect(onOpenWorkspacePath).toHaveBeenNthCalledWith(2, '/workspace/src/code.tsx', 'notes/beads.md');
    });
  });

  it('opens linked plans via their resolved workspace path and logs async failures', async () => {
    const error = new Error('nope');
    const onOpenWorkspacePath = vi.fn().mockRejectedValueOnce(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <BeadViewerTab
        beadTarget={{ beadId: 'nerve-4gpd', workspaceAgentId: 'research' }}
        onOpenWorkspacePath={onOpenWorkspacePath}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Demo plan/i }));

    await waitFor(() => {
      expect(onOpenWorkspacePath).toHaveBeenCalledWith('projects/demo/.plans/demo.md');
      expect(consoleError).toHaveBeenCalledWith('Failed to open linked plan:', error);
    });

    consoleError.mockRestore();
  });
});
