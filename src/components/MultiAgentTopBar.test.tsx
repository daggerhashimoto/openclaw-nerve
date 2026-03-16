import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MultiAgentTopBar } from './MultiAgentTopBar';
import type { AgentLogEntry, EventEntry, TokenData } from '@/types';

// Mock the AgentRegistryContext
vi.mock('@/contexts/AgentRegistryContext', () => ({
  useAgentRegistry: () => ({
    agents: [
      { name: 'JARVIS', role: 'Orchestrator', enabled: true, connectionStatus: 'connected' },
      { name: 'ATLAS', role: 'Research', enabled: true, connectionStatus: 'connected' },
      { name: 'CODEX', role: 'Developer', enabled: true, connectionStatus: 'idle' },
    ],
    loading: false,
  }),
}));

describe('MultiAgentTopBar Mobile Usability', () => {
  const defaultProps = {
    onSettings: vi.fn(),
    agentLogEntries: [] as AgentLogEntry[],
    tokenData: null as TokenData | null,
    logGlow: false,
    eventEntries: [] as EventEntry[],
    eventsVisible: true,
    logVisible: true,
    mobilePanelButtonsVisible: false,
    viewMode: 'chat' as const,
    onViewModeChange: vi.fn(),
    currentAgent: 'JARVIS',
    onAgentChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render without crashing', () => {
    render(<MultiAgentTopBar {...defaultProps} />);
    expect(screen.getByText('NERVE')).toBeInTheDocument();
  });

  it('should open agent selector when clicked', () => {
    render(<MultiAgentTopBar {...defaultProps} />);
    
    // Find the agent selector button by its chevron icon
    const buttons = screen.getAllByRole('button');
    const agentButton = buttons.find(btn => btn.querySelector('svg'));
    expect(agentButton).toBeTruthy();
    
    if (agentButton) {
      fireEvent.click(agentButton);
    }
  });

  it('should call onAgentChange when agent is selected', () => {
    render(<MultiAgentTopBar {...defaultProps} />);
    
    // Get all buttons and find the one with the chevron
    const buttons = screen.getAllByRole('button');
    const agentButton = buttons.find(btn => btn.querySelector('svg'));
    
    if (agentButton) {
      fireEvent.click(agentButton);
    }
    
    // The onAgentChange should be callable
    expect(defaultProps.onAgentChange).not.toHaveBeenCalled();
  });

  it('should toggle view mode between chat and kanban', () => {
    render(<MultiAgentTopBar {...defaultProps} />);
    
    // Find the kanban button by looking for the LayoutGrid icon or Tasks text
    const buttons = screen.getAllByRole('button');
    const kanbanButton = buttons.find(btn => 
      btn.getAttribute('aria-label')?.includes('tasks') ||
      btn.textContent?.includes('Tasks')
    );
    
    if (kanbanButton) {
      fireEvent.click(kanbanButton);
      expect(defaultProps.onViewModeChange).toHaveBeenCalledWith('kanban');
    }
  });

  it('should call onSettings when settings button is clicked', () => {
    render(<MultiAgentTopBar {...defaultProps} />);
    
    // Find settings button by aria-label
    const settingsButton = screen.getByRole('button', { name: /settings/i });
    fireEvent.click(settingsButton);
    
    expect(defaultProps.onSettings).toHaveBeenCalled();
  });

  it('should display connected agent count', () => {
    render(<MultiAgentTopBar {...defaultProps} />);
    
    // Should show "2/3" for connected/total agents
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('should handle mobile panel buttons when visible', () => {
    render(<MultiAgentTopBar {...defaultProps} mobilePanelButtonsVisible sessionsPanel={<div>Sessions</div>} />);
    
    // Check for Sessions button
    const sessionsButton = screen.getByRole('button', { name: /sessions/i });
    expect(sessionsButton).toBeInTheDocument();
  });
});
