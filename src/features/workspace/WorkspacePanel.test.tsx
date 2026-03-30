import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePanel } from './WorkspacePanel';

const configTabRenderLog: Array<{ agentId: string; cronWarning?: string | null }> = [];
const skillsTabRenderLog: string[] = [];
const mockUseCrons = vi.fn(() => ({ activeCount: 0, cronWarning: null }));

vi.mock('./WorkspaceTabs', () => ({
  WorkspaceTabs: ({ activeTab, onTabChange }: { activeTab: string; onTabChange: (tab: 'config') => void }) => (
    <div>
      <button type="button" onClick={() => onTabChange('config')}>Config</button>
      <div data-testid="active-tab">{activeTab}</div>
    </div>
  ),
}));

vi.mock('./tabs', () => ({
  CronsTab: () => <div data-testid="crons-tab" />,
  ConfigTab: ({ agentId, cronWarning }: { agentId: string; cronWarning?: string | null }) => {
    configTabRenderLog.push({ agentId, cronWarning });
    return <div data-testid="config-tab">config:{agentId}:{cronWarning ?? 'none'}</div>;
  },
  SkillsTab: ({ agentId }: { agentId: string }) => {
    skillsTabRenderLog.push(agentId);
    return <div data-testid="skills-tab">skills:{agentId}</div>;
  },
}));

vi.mock('./hooks/useCrons', () => ({
  useCrons: () => mockUseCrons(),
}));

vi.mock('@/features/kanban', () => ({
  KanbanQuickView: () => <div data-testid="kanban-tab" />,
}));

describe('WorkspacePanel', () => {
  beforeEach(() => {
    localStorage.clear();
    configTabRenderLog.length = 0;
    skillsTabRenderLog.length = 0;
    mockUseCrons.mockReset();
    mockUseCrons.mockReturnValue({ activeCount: 0, cronWarning: null });
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

    expect(await screen.findByTestId('config-tab')).toHaveTextContent('config:bravo:none');
    expect(configTabRenderLog).toEqual([{ agentId: 'bravo', cronWarning: null }]);
    expect(skillsTabRenderLog).toEqual(['alpha']);
  });

  it('passes the cron warning into the config tab', async () => {
    localStorage.setItem('nerve-workspace-tab', 'config');
    mockUseCrons.mockReturnValue({
      activeCount: 0,
      cronWarning: 'This gateway does not expose cron management, so Nerve can’t load or edit crons right now.',
    });

    render(
      <WorkspacePanel workspaceAgentId="alpha" memories={[]} onRefreshMemories={vi.fn()} />,
    );

    expect(await screen.findByTestId('config-tab')).toHaveTextContent('Nerve can’t load or edit crons right now');
  });
});
