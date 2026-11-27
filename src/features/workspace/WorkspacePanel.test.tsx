import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePanel } from './WorkspacePanel';

const configTabRenderLog: Array<{ agentId: string }> = [];
const skillsTabRenderLog: string[] = [];
const mockUseCrons = vi.fn<() => { activeCount: number }>(() => ({
  activeCount: 0,
}));
let kanbanVisible = true;
const mockUseSettings = vi.fn(() => ({ kanbanVisible }));

vi.mock('./WorkspaceTabs', () => ({
  WorkspaceTabs: ({ activeTab, onTabChange }: { activeTab: string; onTabChange: (tab: 'config') => void }) => (
    <div>
      <button type="button" onClick={() => onTabChange('config')}>Config</button>
      <div data-testid="active-tab">{activeTab}</div>
    </div>
  ),
}));

vi.mock('./tabs', () => ({
  CronsTab: ({ focusCronId, focusNonce }: { focusCronId?: string | null; focusNonce?: number }) => (
    <div data-testid="crons-tab" data-focus-cron={focusCronId ?? ''} data-focus-nonce={focusNonce ?? ''} />
  ),
  ConfigTab: ({ agentId }: { agentId: string }) => {
    configTabRenderLog.push({ agentId });
    return <div data-testid="config-tab">config:{agentId}</div>;
  },
  SkillsTab: ({ agentId }: { agentId: string }) => {
    skillsTabRenderLog.push(agentId);
    return <div data-testid="skills-tab">skills:{agentId}</div>;
  },
}));

vi.mock('./hooks/useCrons', () => ({
  useCrons: () => mockUseCrons(),
}));

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => mockUseSettings(),
}));

vi.mock('@/features/kanban/KanbanQuickView', () => ({
  KanbanQuickView: () => <div data-testid="kanban-tab" />,
}));

describe('WorkspacePanel', () => {
  beforeEach(() => {
    localStorage.clear();
    configTabRenderLog.length = 0;
    skillsTabRenderLog.length = 0;
    mockUseCrons.mockReset();
    mockUseCrons.mockReturnValue({ activeCount: 0 });
    kanbanVisible = true;
    mockUseSettings.mockClear();
  });

  it('recomputes the config subview from storage on agent switch before mounting the child tab', async () => {
    localStorage.setItem('nerve-workspace-tab', 'config');
    localStorage.setItem('nerve-config-view', 'skills');

    const props = {
      workspaceAgentId: 'alpha',
      memories: [],
      onRefreshMemories: vi.fn(),
    };

    const { rerender } = render(<WorkspacePanel {...props} />);

    expect(screen.getByTestId('skills-tab')).toHaveTextContent('skills:alpha');
    expect(skillsTabRenderLog).toEqual(['alpha']);
    expect(configTabRenderLog).toEqual([]);

    localStorage.removeItem('nerve-config-view');
    localStorage.setItem('nerve:workspace:bravo:config-view', 'files');

    rerender(<WorkspacePanel {...props} workspaceAgentId="bravo" />);

    expect(await screen.findByTestId('config-tab')).toHaveTextContent('config:bravo');
    expect(configTabRenderLog).toEqual([{ agentId: 'bravo' }]);
    expect(skillsTabRenderLog).toEqual(['alpha']);
  });

  it('falls back to memory when kanban is hidden but persisted as active', () => {
    localStorage.setItem('nerve-workspace-tab', 'kanban');
    kanbanVisible = false;

    render(
      <WorkspacePanel workspaceAgentId="alpha" memories={[]} onRefreshMemories={vi.fn()} />,
    );

    expect(screen.getByTestId('active-tab')).toHaveTextContent('memory');
    expect(localStorage.getItem('nerve-workspace-tab')).toBe('memory');
  });

  it('keeps kanban active when visibility is enabled', () => {
    localStorage.setItem('nerve-workspace-tab', 'kanban');

    render(
      <WorkspacePanel workspaceAgentId="alpha" memories={[]} onRefreshMemories={vi.fn()} />,
    );

    expect(screen.getByTestId('active-tab')).toHaveTextContent('kanban');
  });

  it('focusRequest for crons selects the Crons tab', () => {
    const props = { workspaceAgentId: 'alpha', memories: [], onRefreshMemories: vi.fn() };
    const { rerender } = render(<WorkspacePanel {...props} />);
    expect(screen.getByTestId('active-tab')).toHaveTextContent('memory');

    rerender(<WorkspacePanel {...props} focusRequest={{ tab: 'crons', cronId: 'cron-7', nonce: 101 }} />);

    expect(screen.getByTestId('active-tab')).toHaveTextContent('crons');
    expect(screen.getByTestId('crons-tab')).toHaveAttribute('data-focus-cron', 'cron-7');
  });

  it('applies a focusRequest that is already set when the panel mounts', () => {
    render(
      <WorkspacePanel
        workspaceAgentId="alpha"
        memories={[]}
        onRefreshMemories={vi.fn()}
        focusRequest={{ tab: 'crons', cronId: 'cron-7', nonce: 102 }}
      />,
    );

    expect(screen.getByTestId('active-tab')).toHaveTextContent('crons');
    expect(screen.getByTestId('crons-tab')).toHaveAttribute('data-focus-cron', 'cron-7');
  });

  it('does not replay a focusRequest it already applied when the panel mounts afresh', () => {
    const props = {
      workspaceAgentId: 'alpha',
      memories: [],
      onRefreshMemories: vi.fn(),
      focusRequest: { tab: 'crons' as const, cronId: 'cron-7', nonce: 105 },
    };
    const first = render(<WorkspacePanel {...props} />);
    expect(screen.getByTestId('active-tab')).toHaveTextContent('crons');
    first.unmount();

    // The compact panel mounts again on the next open, with the same request still set.
    localStorage.setItem('nerve-workspace-tab', 'memory');
    render(<WorkspacePanel {...props} />);

    expect(screen.getByTestId('active-tab')).toHaveTextContent('memory');
    expect(screen.queryByTestId('crons-tab')).not.toBeInTheDocument();
  });

  it('applies a focusRequest once per nonce, so the operator can move on', () => {
    const props = { workspaceAgentId: 'alpha', memories: [], onRefreshMemories: vi.fn() };
    const { rerender } = render(
      <WorkspacePanel {...props} focusRequest={{ tab: 'crons', cronId: 'cron-7', nonce: 103 }} />,
    );
    expect(screen.getByTestId('active-tab')).toHaveTextContent('crons');

    fireEvent.click(screen.getByRole('button', { name: 'Config' }));
    expect(screen.getByTestId('active-tab')).toHaveTextContent('config');

    rerender(<WorkspacePanel {...props} focusRequest={{ tab: 'crons', cronId: 'cron-7', nonce: 103 }} />);
    expect(screen.getByTestId('active-tab')).toHaveTextContent('config');

    rerender(<WorkspacePanel {...props} focusRequest={{ tab: 'crons', cronId: 'cron-7', nonce: 104 }} />);
    expect(screen.getByTestId('active-tab')).toHaveTextContent('crons');
  });

  it('forwards each request nonce to the Crons tab, even for the same cron', () => {
    const props = { workspaceAgentId: 'alpha', memories: [], onRefreshMemories: vi.fn() };
    const { rerender } = render(
      <WorkspacePanel {...props} focusRequest={{ tab: 'crons', cronId: 'cron-7', nonce: 106 }} />,
    );
    expect(screen.getByTestId('crons-tab')).toHaveAttribute('data-focus-nonce', '106');

    rerender(<WorkspacePanel {...props} focusRequest={{ tab: 'crons', cronId: 'cron-7', nonce: 107 }} />);
    expect(screen.getByTestId('crons-tab')).toHaveAttribute('data-focus-cron', 'cron-7');
    expect(screen.getByTestId('crons-tab')).toHaveAttribute('data-focus-nonce', '107');
  });
});
