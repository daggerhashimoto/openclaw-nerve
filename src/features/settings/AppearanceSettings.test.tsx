import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceSettings } from './AppearanceSettings';

const mockTogglePerformanceMode = vi.fn();
let performanceMode = false;

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    eventsVisible: false,
    toggleEvents: vi.fn(),
    logVisible: false,
    toggleLog: vi.fn(),
    showHiddenWorkspaceEntries: false,
    toggleShowHiddenWorkspaceEntries: vi.fn(),
    commandPaletteButtonVisible: true,
    toggleCommandPaletteButtonVisible: vi.fn(),
    kanbanVisible: true,
    toggleKanbanVisible: vi.fn(),
    performanceMode,
    togglePerformanceMode: mockTogglePerformanceMode,
    theme: 'ayu-dark',
    setTheme: vi.fn(),
    font: 'instrument-sans',
    setFont: vi.fn(),
    fontSize: 15,
    setFontSize: vi.fn(),
    editorFontSize: 13,
    setEditorFontSize: vi.fn(),
  }),
}));

describe('AppearanceSettings', () => {
  beforeEach(() => {
    performanceMode = false;
    mockTogglePerformanceMode.mockClear();
  });

  it('renders the performance mode toggle', () => {
    render(<AppearanceSettings />);

    const toggle = screen.getByRole('switch', { name: /performance mode/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);

    expect(mockTogglePerformanceMode).toHaveBeenCalledTimes(1);
  });

  it('reflects enabled performance mode', () => {
    performanceMode = true;

    render(<AppearanceSettings />);

    expect(screen.getByRole('switch', { name: /performance mode/i })).toHaveAttribute('aria-checked', 'true');
  });
});
