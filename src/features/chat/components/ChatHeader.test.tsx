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
  handleModelChange: vi.fn(),
  handleEffortChange: vi.fn(),
  controlsDisabled: false,
  uiError: null,
};

describe('ChatHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders COMMS header with model selectors', () => {
    const mockUseModelEffort = vi.mocked(useModelEffort);
    mockUseModelEffort.mockReturnValue(defaultMockHook);

    render(
      <ChatHeader
        onReset={mockOnReset}
        onAbort={mockOnAbort}
        isGenerating={false}
      />
    );

    expect(screen.getByText('Comms')).toBeInTheDocument();
    expect(screen.getByText('GPT-4')).toBeInTheDocument();
    expect(screen.getByText('Balanced')).toBeInTheDocument();
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
