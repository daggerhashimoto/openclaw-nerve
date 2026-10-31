import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceSettings } from './AppearanceSettings';

const mockTogglePerformanceMode = vi.fn();
const mockSetTheme = vi.fn();
const mockSetThemeStyle = vi.fn();
let performanceMode = false;
let theme = 'nerve-dark';

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
    theme,
    setTheme: mockSetTheme,
    setThemeStyle: mockSetThemeStyle,
    font: 'atkinson-hyperlegible',
    setFont: vi.fn(),
    fontSize: 15,
    setFontSize: vi.fn(),
    editorFontSize: 13,
    setEditorFontSize: vi.fn(),
  }),
}));

describe('AppearanceSettings', () => {
  // jsdom has no scrollIntoView; InlineSelect calls it to keep the highlighted option visible.
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'scrollIntoView');
  beforeAll(() => {
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });
  afterAll(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
    } else {
      delete (window.HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    }
  });

  beforeEach(() => {
    performanceMode = false;
    theme = 'nerve-dark';
    mockTogglePerformanceMode.mockClear();
    mockSetTheme.mockClear();
    mockSetThemeStyle.mockClear();
  });

  function openOptions(name: string): string[] {
    fireEvent.click(screen.getByRole('button', { name }));
    const listbox = screen.getByRole('listbox', { name });
    return within(listbox).getAllByRole('option').map((option) => option.textContent ?? '');
  }

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

  it('lists only the Nerve themes while the Nerve style is active', () => {
    render(<AppearanceSettings />);

    expect(screen.getByRole('button', { name: 'Select style' })).toHaveTextContent('Nerve');
    expect(openOptions('Select theme')).toEqual(['Night', 'Daylight']);
  });

  it('lists the 14 Classic themes while a Classic theme is active', () => {
    theme = 'classic-nord';

    render(<AppearanceSettings />);

    expect(screen.getByRole('button', { name: 'Select style' })).toHaveTextContent('Classic');
    const options = openOptions('Select theme');
    expect(options).toHaveLength(14);
    expect(options).toEqual(expect.arrayContaining(['Ayu Dark', 'Nord', 'Light', 'Monochrome']));
    expect(options).not.toContain('Night');
  });

  it('switches theme family through the Style control', () => {
    render(<AppearanceSettings />);

    expect(openOptions('Select style')).toEqual(['Nerve', 'Classic']);
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Classic' }));

    expect(mockSetThemeStyle).toHaveBeenCalledExactlyOnceWith('classic');
    expect(mockSetTheme).not.toHaveBeenCalled();
  });

  it('offers the style default as the first UI font', () => {
    render(<AppearanceSettings />);

    expect(screen.getByRole('button', { name: 'Select font' })).toHaveTextContent('Style default');
  });
});
