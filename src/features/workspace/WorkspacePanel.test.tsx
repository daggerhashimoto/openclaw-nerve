import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePanel } from './WorkspacePanel';

const configTabRenderLog: string[] = [];
const skillsTabRenderLog: string[] = [];

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
  ConfigTab: ({ agentId }: { agentId: string }) => {
    configTabRenderLog.push(agentId);
    return <div data-testid="config-tab">config:{agentId}</div>;
  },
  SkillsTab: ({ agentId }: { agentId: string }) => {
    skillsTabRenderLog.push(agentId);
    return <div data-testid="skills-tab">skills:{agentId}</div>;
  },
}));

vi.mock('./hooks/useCrons', () => ({
  useCrons: () => ({ activeCount: 0 }),
}));

vi.mock('@/features/kanban', () => ({
  KanbanQuickView: () => <div data-testid="kanban-tab" />,
}));

describe('WorkspacePanel', () => {
  beforeEach(() => {
    localStorage.clear();
    configTabRenderLog.length = 0;
    skillsTabRenderLog.length = 0;
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
    expect(configTabRenderLog).toEqual(['bravo']);
    expect(skillsTabRenderLog).toEqual(['alpha']);
  });
});
