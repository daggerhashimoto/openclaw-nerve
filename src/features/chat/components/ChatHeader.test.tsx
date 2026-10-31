/** Tests for ChatHeader component and collapsed explorer reopen control. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatHeader } from './ChatHeader';
import { useModelEffort } from './useModelEffort';

// Mock the useModelEffort hook
vi.mock('./useModelEffort', () => ({
  useModelEffort: vi.fn(),
}));

const mockOnReset = vi.fn();
const mockOnAbort = vi.fn();
const mockOnToggleFileBrowser = vi.fn();
const mockOnToggleMobileTopBar = vi.fn();

const defaultMockHook = {
  modelOptions: [
    { value: 'gpt-4', label: 'GPT-4' },
    { value: 'gpt-3.5', label: 'GPT-3.5' },
  ],
  effortOptions: [
    { value: 'fast', label: 'Fast' },
    { value: 'balanced', label: 'Balanced' },
  ],
  selectedModel: 'gpt-4',
  selectedEffort: 'balanced',
  selectedEffortLabel: 'Balanced',
  handleModelChange: vi.fn(),
  handleEffortChange: vi.fn(),
  controlsDisabled: false,
  uiError: null,
};

describe('ChatHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the session header with the agent name and model selectors', () => {
    const mockUseModelEffort = vi.mocked(useModelEffort);
    mockUseModelEffort.mockReturnValue(defaultMockHook);

    render(
      <ChatHeader
        onReset={mockOnReset}
        onAbort={mockOnAbort}
        isGenerating={false}
        agentName="Jen (main)"
      />
    );

    expect(screen.getByText('Jen (main)')).toBeInTheDocument();
    expect(screen.getByText('GPT-4')).toBeInTheDocument();
    expect(screen.getByText('Balanced')).toBeInTheDocument();
  });

  it('reads idle with a dark pane when the agent is not generating', () => {
    const mockUseModelEffort = vi.mocked(useModelEffort);
    mockUseModelEffort.mockReturnValue(defaultMockHook);

    render(
      <ChatHeader
        onReset={mockOnReset}
        onAbort={mockOnAbort}
        isGenerating={false}
      />
    );

    const runState = screen.getByTestId('chat-run-state');
    expect(runState).toHaveTextContent('Idle');
    expect(runState.querySelector('.pane')).toHaveAttribute('data-state', 'off');
  });

  it('reads the running tool and elapsed clock with a live pane while generating', () => {
    const mockUseModelEffort = vi.mocked(useModelEffort);
    mockUseModelEffort.mockReturnValue(defaultMockHook);

    render(
      <ChatHeader
        onReset={mockOnReset}
        onAbort={mockOnAbort}
        isGenerating={true}
        processingStage="tool_use"
        currentToolDescription="exec: openclaw cron run nightly-backup"
        elapsedMs={14_000}
      />
    );

    const runState = screen.getByTestId('chat-run-state');
    expect(runState).toHaveTextContent('Running:');
    expect(runState).toHaveTextContent('exec: openclaw cron run nightly-backup');
    expect(runState).toHaveTextContent('00:14');
    expect(runState.querySelector('.pane')).toHaveAttribute('data-state', 'live');
  });

  it('reads thinking while the agent reasons', () => {
    const mockUseModelEffort = vi.mocked(useModelEffort);
    mockUseModelEffort.mockReturnValue(defaultMockHook);

    render(
      <ChatHeader
        onReset={mockOnReset}
        onAbort={mockOnAbort}
        isGenerating={true}
        processingStage="thinking"
        elapsedMs={3_000}
      />
    );

    const runState = screen.getByTestId('chat-run-state');
    expect(runState).toHaveTextContent('Thinking');
    expect(runState).not.toHaveTextContent('Running:');
  });

  it('shows the file browser expand button when provided', () => {
    const mockUseModelEffort = vi.mocked(useModelEffort);
    mockUseModelEffort.mockReturnValue(defaultMockHook);

    render(
      <ChatHeader
        onReset={mockOnReset}
        onAbort={mockOnAbort}
        isGenerating={false}
        onToggleFileBrowser={mockOnToggleFileBrowser}
      />
    );

    const expandButton = screen.getByRole('button', { name: /open file explorer/i });
    expect(expandButton).toBeInTheDocument();
    expect(expandButton).toHaveAttribute('aria-label', 'Open file explorer');
    expect(expandButton).toHaveAttribute('title', 'Open file explorer (Ctrl+B)');
  });

  it('shows the stacked mobile chrome control when top bar toggle is provided', () => {
    const mockUseModelEffort = vi.mocked(useModelEffort);
    mockUseModelEffort.mockReturnValue(defaultMockHook);

    render(
      <ChatHeader
        onReset={mockOnReset}
        onAbort={mockOnAbort}
        isGenerating={false}
        onToggleFileBrowser={mockOnToggleFileBrowser}
        isFileBrowserCollapsed={true}
        onToggleMobileTopBar={mockOnToggleMobileTopBar}
        isMobileTopBarHidden={false}
      />
    );

    expect(screen.getByRole('button', { name: /hide header controls/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open file explorer/i })).toBeInTheDocument();
  });

  it('does not show the expand button when not provided', () => {
    const mockUseModelEffort = vi.mocked(useModelEffort);
    mockUseModelEffort.mockReturnValue(defaultMockHook);

    render(
      <ChatHeader
        onReset={mockOnReset}
        onAbort={mockOnAbort}
        isGenerating={false}
      />
    );

    expect(screen.queryByRole('button', { name: /open file explorer/i })).not.toBeInTheDocument();
  });

  it('calls onToggleFileBrowser when expand button is clicked', () => {
    const mockUseModelEffort = vi.mocked(useModelEffort);
    mockUseModelEffort.mockReturnValue(defaultMockHook);

    render(
      <ChatHeader
        onReset={mockOnReset}
        onAbort={mockOnAbort}
        isGenerating={false}
        onToggleFileBrowser={mockOnToggleFileBrowser}
      />
    );

    const expandButton = screen.getByRole('button', { name: /open file explorer/i });
    fireEvent.click(expandButton);

    expect(mockOnToggleFileBrowser).toHaveBeenCalledTimes(1);
  });

  it('calls both mobile chrome actions when the stacked control is used', () => {
    const mockUseModelEffort = vi.mocked(useModelEffort);
    mockUseModelEffort.mockReturnValue(defaultMockHook);

    render(
      <ChatHeader
        onReset={mockOnReset}
        onAbort={mockOnAbort}
        isGenerating={false}
        onToggleFileBrowser={mockOnToggleFileBrowser}
        isFileBrowserCollapsed={true}
        onToggleMobileTopBar={mockOnToggleMobileTopBar}
        isMobileTopBarHidden={true}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /show header controls/i }));
    fireEvent.click(screen.getByRole('button', { name: /open file explorer/i }));

    expect(mockOnToggleMobileTopBar).toHaveBeenCalledTimes(1);
    expect(mockOnToggleFileBrowser).toHaveBeenCalledTimes(1);
  });

  it('shows a truthful error and disables the model selector when no configured models are available', () => {
    const mockUseModelEffort = vi.mocked(useModelEffort);
    mockUseModelEffort.mockReturnValue({
      ...defaultMockHook,
      modelOptions: [],
      selectedModel: '',
      uiError: 'Could not load configured models',
    });

    render(
      <ChatHeader
        onReset={mockOnReset}
        onAbort={mockOnAbort}
        isGenerating={false}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Could not load configured models');
    expect(screen.getByRole('button', { name: 'Model' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('No configured models');
  });

  it('uses the effort display label when provided by the hook', () => {
    const mockUseModelEffort = vi.mocked(useModelEffort);
    mockUseModelEffort.mockReturnValue({
      ...defaultMockHook,
      selectedEffort: 'thinkingDefault',
      selectedEffortLabel: 'medium',
      effortOptions: [
        { value: 'thinkingDefault', label: 'medium (default)' },
        { value: 'medium', label: 'medium' },
      ],
    });

    render(
      <ChatHeader
        onReset={mockOnReset}
        onAbort={mockOnAbort}
        isGenerating={false}
      />
    );

    expect(screen.getByRole('button', { name: 'Effort' })).toHaveTextContent('medium');
    expect(screen.getByRole('button', { name: 'Effort' })).not.toHaveTextContent('medium (default)');
  });

  it('shows abort button when generating', () => {
    const mockUseModelEffort = vi.mocked(useModelEffort);
    mockUseModelEffort.mockReturnValue(defaultMockHook);

    render(
      <ChatHeader
        onReset={mockOnReset}
        onAbort={mockOnAbort}
        isGenerating={true}
      />
    );

    expect(screen.getByRole('button', { name: /stop generating/i })).toBeInTheDocument();
  });

  it('shows reset button when not generating', () => {
    const mockUseModelEffort = vi.mocked(useModelEffort);
    mockUseModelEffort.mockReturnValue(defaultMockHook);

    render(
      <ChatHeader
        onReset={mockOnReset}
        onAbort={mockOnAbort}
        isGenerating={false}
      />
    );

    expect(screen.getByRole('button', { name: /reset session/i })).toBeInTheDocument();
  });
});
