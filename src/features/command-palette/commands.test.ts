import { describe, expect, it, vi } from 'vitest';
import { createCommands } from './commands';
import type { CommandActions } from './commands';

function makeActions(): CommandActions {
  return {
    onNewSession: vi.fn(),
    onResetSession: vi.fn(),
    onToggleSound: vi.fn(),
    onSettings: vi.fn(),
    onSearch: vi.fn(),
    onAbort: vi.fn(),
    onSetTheme: vi.fn(),
    onSetFont: vi.fn(),
    onTtsProviderChange: vi.fn(),
    onToggleWakeWord: vi.fn(),
    onToggleEvents: vi.fn(),
    onToggleLog: vi.fn(),
    onToggleTelemetry: vi.fn(),
    onOpenSettings: vi.fn(),
    onRefreshSessions: vi.fn(),
    onRefreshMemory: vi.fn(),
  };
}

describe('createCommands', () => {
  it('includes a command for disabling TTS', () => {
    const actions = makeActions();
    const command = createCommands(actions).find((candidate) => candidate.id === 'tts-off');

    expect(command).toMatchObject({ label: 'TTS: Off', category: 'voice' });
    command?.action();
    expect(actions.onTtsProviderChange).toHaveBeenCalledWith('off');
  });
});
