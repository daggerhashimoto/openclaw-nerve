import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SpawnAgentDialog } from './SpawnAgentDialog';

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

function renderDialog(
  onSpawn = vi.fn(async () => {}),
  onOpenChange = vi.fn(),
) {
  return render(
    <SpawnAgentDialog
      open
      onOpenChange={onOpenChange}
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
      ok: true,
      json: () => Promise.resolve({
        models: [
          { id: 'anthropic/claude-sonnet-4-5', alias: 'claude-sonnet-4-5' },
        ],
        error: null,
        source: 'config',
      }),
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

  it('shows inherited primary plus configured models from the gateway catalog', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        models: [
          { id: 'zai/glm-4.7', alias: 'glm-4.7' },
          { id: 'ollama/qwen2.5:7b-instruct-q5_K_M', alias: 'qwen-local' },
        ],
        error: null,
        source: 'config',
      }),
    } as Response)) as typeof fetch;

    renderDialog();
    fireEvent.click(screen.getByText('New agent'));

    const modelSelect = await screen.findByRole('button', { name: 'Select model' });
    expect(modelSelect).toHaveTextContent('Primary');

    fireEvent.click(modelSelect);
    expect(await screen.findByRole('option', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'qwen-local' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'claude-sonnet-4-5' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'gpt-5.4' })).toBeNull();
  });

  it('offers gateway-only models and scopes thinking levels to the selected model', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        models: [
          {
            id: 'openai/gpt-6-luna',
            label: 'gpt-6-luna',
            role: 'primary',
            thinkingLevels: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }],
            thinkingDefault: 'medium',
          },
          {
            // Present in the gateway catalog, absent from the old config-only reader.
            id: 'opencode-go/jev-1.14',
            label: 'jev-1.14',
            role: 'allowed',
            thinkingLevels: [{ id: 'off', label: 'off' }, { id: 'ultra', label: 'ultra' }],
            thinkingDefault: 'off',
          },
        ],
        error: null,
        source: 'gateway',
      }),
    } as Response)) as typeof fetch;

    renderDialog();
    fireEvent.click(screen.getByText('New agent'));

    const modelSelect = await screen.findByRole('button', { name: 'Select model' });
    fireEvent.click(modelSelect);
    expect(await screen.findByRole('option', { name: 'jev-1.14' })).toBeInTheDocument();
    fireEvent.click(modelSelect); // close the model menu before opening Thinking

    // While the choice is inherited, the primary model's levels drive the picker.
    fireEvent.click(screen.getByRole('button', { name: 'Select thinking level' }));
    expect(await screen.findByRole('option', { name: 'medium' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'ultra' })).toBeNull();
    fireEvent.pointerDown(screen.getByRole('option', { name: 'high' }));
    expect(screen.getByRole('button', { name: 'Select thinking level' })).toHaveTextContent('high');

    // Switch to the gateway-only model.
    fireEvent.click(screen.getByRole('button', { name: 'Select model' }));
    fireEvent.pointerDown(await screen.findByRole('option', { name: 'jev-1.14' }));
    expect(screen.getByRole('button', { name: 'Select model' })).toHaveTextContent('jev-1.14');

    // 'high' is not offered by jev-1.14, so the stale override resets to the inherited default.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Select thinking level' })).toHaveTextContent('Default');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Select thinking level' }));
    expect(await screen.findByRole('option', { name: 'off' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'ultra' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'medium' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'high' })).toBeNull();
  });

  it('names the primary model on the button and in the list when the catalog says which it is', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        models: [
          { id: 'openai-codex/gpt-6-luna', label: 'gpt-6-luna', role: 'primary' },
          { id: 'ollama/qwen2.5:7b-instruct-q5_K_M', alias: 'qwen-local', label: 'qwen-local', role: 'fallback' },
        ],
        error: null,
        source: 'config',
      }),
    } as Response)) as typeof fetch;

    const onSpawn = vi.fn(async () => {});
    renderDialog(onSpawn);
    fireEvent.click(screen.getByText('New agent'));

    const modelSelect = await screen.findByRole('button', { name: 'Select model' });
    await waitFor(() => {
      expect(modelSelect).toHaveTextContent('gpt-6-luna');
    });
    expect(modelSelect).not.toHaveTextContent('primary');
    expect(modelSelect).not.toHaveTextContent('Primary');

    fireEvent.click(modelSelect);
    expect(await screen.findByRole('option', { name: 'gpt-6-luna (primary)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'gpt-6-luna' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'primary' })).toBeNull();

    // Choosing the explicit entry names it; choosing the inherited one still omits the model.
    fireEvent.pointerDown(screen.getByRole('option', { name: 'qwen-local' }));
    expect(screen.getByRole('button', { name: 'Select model' })).toHaveTextContent('qwen-local');
    fireEvent.click(screen.getByRole('button', { name: 'Select model' }));
    fireEvent.pointerDown(await screen.findByRole('option', { name: 'gpt-6-luna (primary)' }));
    expect(screen.getByRole('button', { name: 'Select model' })).toHaveTextContent('gpt-6-luna');

    fireEvent.change(screen.getByPlaceholderText('e.g. reviewer'), { target: { value: 'research' } });
    fireEvent.change(screen.getByPlaceholderText('What should this new agent start working on?'), { target: { value: 'test task' } });
    fireEvent.click(screen.getByText('Create agent'));

    await waitFor(() => {
      expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({ model: undefined }));
    });
  });

  it('disables launch and shows an error when no configured models are available', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        models: [],
        error: 'Could not load configured models',
        source: 'config',
      }),
    } as Response)) as typeof fetch;

    const onSpawn = vi.fn(async () => {});
    renderDialog(onSpawn);

    fireEvent.click(screen.getByText('New agent'));
    fireEvent.change(screen.getByPlaceholderText('e.g. reviewer'), { target: { value: 'research' } });
    fireEvent.change(screen.getByPlaceholderText('What should this new agent start working on?'), { target: { value: 'test task' } });

    expect(await screen.findByText('Could not load configured models')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select model' })).toBeDisabled();
    expect(screen.getByText('Create agent')).toBeDisabled();
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it('omits model and thinking in the spawn payload when inherited defaults are selected', async () => {
    const onSpawn = vi.fn(async () => {});
    renderDialog(onSpawn);

    fireEvent.click(screen.getByText('New agent'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Select model' })).toHaveTextContent('Primary');
      expect(screen.getByRole('button', { name: 'Select thinking level' })).toHaveTextContent('Default');
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. reviewer'), { target: { value: 'research' } });
    fireEvent.change(screen.getByPlaceholderText('What should this new agent start working on?'), { target: { value: 'test task' } });
    fireEvent.click(screen.getByText('Create agent'));

    await waitFor(() => {
      expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'root',
        agentName: 'research',
        task: 'test task',
        model: undefined,
        thinking: undefined,
      }));
    });
  });

  it('offers adaptive thinking and forwards it as an explicit spawn override', async () => {
    const onSpawn = vi.fn(async () => {});
    renderDialog(onSpawn);

    fireEvent.click(screen.getByText('New agent'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Select model' })).toHaveTextContent('Primary');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Select thinking level' }));
    expect(await screen.findByRole('option', { name: 'Default' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'adaptive' })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('option', { name: 'adaptive' }));

    fireEvent.change(screen.getByPlaceholderText('e.g. reviewer'), { target: { value: 'research' } });
    fireEvent.change(screen.getByPlaceholderText('What should this new agent start working on?'), { target: { value: 'test task' } });
    fireEvent.click(screen.getByText('Create agent'));

    await waitFor(() => {
      expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'root',
        agentName: 'research',
        task: 'test task',
        model: undefined,
        thinking: 'adaptive',
      }));
    });
  });

  it('keeps the dialog open when spawning is deferred by a guard', async () => {
    const onSpawn = vi.fn(async () => false);
    const onOpenChange = vi.fn();
    renderDialog(onSpawn, onOpenChange);

    fireEvent.click(screen.getByText('New agent'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Select model' })).toHaveTextContent('Primary');
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. reviewer'), { target: { value: 'research' } });
    fireEvent.change(screen.getByPlaceholderText('What should this new agent start working on?'), { target: { value: 'test task' } });
    fireEvent.click(screen.getByText('Create agent'));

    await waitFor(() => {
      expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'root',
        agentName: 'research',
        task: 'test task',
      }));
    });

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText('Configure new agent')).toBeInTheDocument();
  });
});
