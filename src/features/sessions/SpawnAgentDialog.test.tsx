import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SpawnAgentDialog } from './SpawnAgentDialog';
import { FALLBACK_MODELS } from './fallbackModels';

const mockUseSessionContext = vi.fn();

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));

vi.mock('@/contexts/SessionContext', () => ({
  useSessionContext: () => mockUseSessionContext(),
}));

function renderDialog(onSpawn = vi.fn(async () => {})) {
  return render(
    <SpawnAgentDialog
      open
      onOpenChange={vi.fn()}
      onSpawn={onSpawn}
    />,
  );
}

describe('SpawnAgentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    mockUseSessionContext.mockReturnValue({
      sessions: [{ key: 'agent:main:main', label: 'Kim (main)' }],
      currentSession: 'agent:main:main',
      agentName: 'Kim',
    });
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: false,
      json: () => Promise.resolve({}),
    } as Response)) as typeof fetch;
  });

  it('shows After run only for subagents and defaults it to Keep', async () => {
    renderDialog();

    fireEvent.click(screen.getByText('New subagent'));

    const afterRun = await screen.findByRole('button', { name: 'After run' });
    expect(afterRun).toHaveTextContent('Keep');
  });

  it('does not show After run for top-level agents', () => {
    renderDialog();

    fireEvent.click(screen.getByText('New agent'));

    expect(screen.queryByRole('button', { name: 'After run' })).toBeNull();
  });

  it('passes cleanup=delete when Delete is selected', async () => {
    const onSpawn = vi.fn(async () => {});
    renderDialog(onSpawn);

    fireEvent.click(screen.getByText('New subagent'));
    fireEvent.change(screen.getByPlaceholderText('What should this subagent do?'), { target: { value: 'test task' } });

    fireEvent.click(await screen.findByRole('button', { name: 'After run' }));
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Delete' }));
    fireEvent.click(screen.getByText('Launch subagent'));

    await waitFor(() => {
      expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({ cleanup: 'delete' }));
    });
  });

  it('includes gpt-5.4 in the fallback model list when the catalog fetch fails', () => {
    expect(FALLBACK_MODELS.some((option) => option.value === 'openai-codex/gpt-5.4')).toBe(true);
  });
});
