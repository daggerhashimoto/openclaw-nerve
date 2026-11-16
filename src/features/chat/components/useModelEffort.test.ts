import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const { mockUseGateway, mockUseSessionContext } = vi.hoisted(() => ({
  mockUseGateway: vi.fn(),
  mockUseSessionContext: vi.fn(),
}));

vi.mock('@/contexts/GatewayContext', () => ({
  useGateway: () => mockUseGateway(),
}));

vi.mock('@/contexts/SessionContext', () => ({
  useSessionContext: () => mockUseSessionContext(),
}));

import { buildModelCatalogUiError, buildSelectableModelList, type GatewayModelInfo, useModelEffort } from './useModelEffort';

const CONFIGURED_MODELS: GatewayModelInfo[] = [
  { id: 'zai/glm-4.7', label: 'glm-4.7', provider: 'zai', role: 'primary' },
  { id: 'ollama/qwen2.5:7b-instruct-q5_K_M', label: 'qwen-local', provider: 'ollama', role: 'fallback' },
];

function jsonResponse(data: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => data,
  };
}

describe('buildSelectableModelList', () => {
  it('returns configured models unchanged when available', () => {
    expect(buildSelectableModelList(CONFIGURED_MODELS, null)).toEqual(CONFIGURED_MODELS);
  });

  it('returns no fake fallback models when configured catalog is empty', () => {
    expect(buildSelectableModelList([], null)).toEqual([]);
  });

  it('appends the current active model when it is missing from the configured catalog', () => {
    expect(buildSelectableModelList(CONFIGURED_MODELS, 'openrouter/xiaomi/mimo-v2-pro')).toEqual([
      ...CONFIGURED_MODELS,
      { id: 'openrouter/xiaomi/mimo-v2-pro', label: 'xiaomi/mimo-v2-pro', provider: 'openrouter' },
    ]);
  });

  it('does not append a phantom model when a configured option already has the same base name', () => {
    const models: GatewayModelInfo[] = [
      { id: 'openai/gpt-5.4', label: 'gpt-5.4', provider: 'openai' },
    ];

    expect(buildSelectableModelList(models, 'openai-codex/gpt-5.4')).toEqual(models);
  });
});

describe('useModelEffort', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    localStorage.clear();
    vi.clearAllMocks();

    mockUseGateway.mockReturnValue({
      rpc: vi.fn(),
      connectionState: 'connected',
      model: 'zai/glm-4.7',
      thinking: 'medium',
    });

    mockUseSessionContext.mockReturnValue({
      currentSession: 'agent:main:subagent:preview-run',
      sessions: [
        { key: 'agent:main:main', model: 'zai/glm-4.7' },
        { key: 'agent:main:subagent:preview-run', model: 'openrouter/xiaomi/mimo-v2-pro' },
      ],
      updateSession: vi.fn(),
    });

    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/gateway/models') {
        return Promise.resolve(jsonResponse({ models: CONFIGURED_MODELS, error: null }));
      }
      if (url.startsWith('/api/gateway/session-info?sessionKey=')) {
        return Promise.resolve(jsonResponse({}));
      }
      if (url.startsWith('/api/sessions/runtime?sessionKey=')) {
        return Promise.resolve(jsonResponse({ ok: true, model: null, thinking: null, missing: true }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('keeps the current session model visible when the gateway context model belongs to a different session', async () => {
    const { result } = renderHook(() => useModelEffort());

    await waitFor(() => {
      expect(result.current.selectedModel).toBe('openrouter/xiaomi/mimo-v2-pro');
    });

    await waitFor(() => {
      expect(result.current.modelOptions.map((option) => option.value)).toContain('openrouter/xiaomi/mimo-v2-pro');
    });

    expect(result.current.modelOptions).toEqual([
      { value: 'primary', label: 'glm-4.7 (primary)' },
      { value: 'zai/glm-4.7', label: 'glm-4.7' },
      { value: 'ollama/qwen2.5:7b-instruct-q5_K_M', label: 'qwen-local' },
      { value: 'openrouter/xiaomi/mimo-v2-pro', label: 'xiaomi/mimo-v2-pro' },
    ]);
  });

  it('keeps inherited effort selected while displaying the effective default value', async () => {
    mockUseGateway.mockReturnValue({
      rpc: vi.fn(),
      connectionState: 'connected',
      model: 'zai/glm-4.7',
      thinking: 'medium',
    });

    mockUseSessionContext.mockReturnValue({
      currentSession: 'agent:main:main',
      sessions: [
        { key: 'agent:main:main', model: 'openai-codex/gpt-5.4', thinking: 'medium' },
      ],
      updateSession: vi.fn(),
    });

    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/gateway/models') {
        return Promise.resolve(jsonResponse({
          models: [
            { id: 'openai/gpt-5.4', label: 'gpt-5.4', provider: 'openai', role: 'primary' },
            { id: 'zai/glm-4.7', label: 'glm-4.7', provider: 'zai', role: 'fallback' },
          ],
          error: null,
        }));
      }
      if (url.startsWith('/api/gateway/session-info?sessionKey=')) {
        return Promise.resolve(jsonResponse({}));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof globalThis.fetch;

    const { result } = renderHook(() => useModelEffort());

    await waitFor(() => {
      expect(result.current.selectedModel).toBe('primary');
      expect(result.current.selectedEffort).toBe('thinkingDefault');
      expect(result.current.selectedEffortLabel).toBe('medium');
      expect(result.current.effortOptions[0]).toEqual({ value: 'thinkingDefault', label: 'medium (default)' });
    });
  });

  it('keeps inherited adaptive effort selected while displaying the effective default value', async () => {
    mockUseGateway.mockReturnValue({
      rpc: vi.fn(),
      connectionState: 'connected',
      model: 'zai/glm-4.7',
      thinking: 'adaptive',
    });

    mockUseSessionContext.mockReturnValue({
      currentSession: 'agent:main:main',
      sessions: [
        { key: 'agent:main:main', model: 'openai-codex/gpt-5.4', thinking: 'adaptive' },
      ],
      updateSession: vi.fn(),
    });

    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/gateway/models') {
        return Promise.resolve(jsonResponse({
          models: [
            { id: 'openai/gpt-5.4', label: 'gpt-5.4', provider: 'openai', role: 'primary' },
            { id: 'zai/glm-4.7', label: 'glm-4.7', provider: 'zai', role: 'fallback' },
          ],
          error: null,
        }));
      }
      if (url.startsWith('/api/gateway/session-info?sessionKey=')) {
        return Promise.resolve(jsonResponse({}));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof globalThis.fetch;

    const { result } = renderHook(() => useModelEffort());

    await waitFor(() => {
      expect(result.current.selectedModel).toBe('primary');
      expect(result.current.selectedEffort).toBe('thinkingDefault');
      expect(result.current.selectedEffortLabel).toBe('adaptive');
      expect(result.current.effortOptions[0]).toEqual({ value: 'thinkingDefault', label: 'adaptive (default)' });
      expect(result.current.effortOptions).toContainEqual({ value: 'adaptive', label: 'adaptive' });
    });
  });

  it('uses transcript runtime defaults to label inherited effort when session summaries omit thinking', async () => {
    mockUseGateway.mockReturnValue({
      rpc: vi.fn(),
      connectionState: 'connected',
      model: 'zai/glm-4.7',
      thinking: '--',
    });

    mockUseSessionContext.mockReturnValue({
      currentSession: 'agent:smoke257:main',
      sessions: [
        { key: 'agent:smoke257:main', id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', model: 'zai/glm-4.7' },
      ],
      updateSession: vi.fn(),
    });

    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/gateway/models') {
        return Promise.resolve(jsonResponse({ models: CONFIGURED_MODELS, error: null }));
      }
      if (url === '/api/gateway/session-info?sessionKey=agent%3Asmoke257%3Amain') {
        return Promise.resolve(jsonResponse({}));
      }
      if (url === '/api/sessions/runtime?sessionKey=agent%3Asmoke257%3Amain') {
        return Promise.resolve(jsonResponse({ ok: true, model: 'openai-codex/gpt-5.4', thinking: 'medium', missing: false }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof globalThis.fetch;

    const { result } = renderHook(() => useModelEffort());

    await waitFor(() => {
      expect(result.current.selectedEffort).toBe('thinkingDefault');
      expect(result.current.selectedEffortLabel).toBe('medium');
      expect(result.current.effortOptions[0]).toEqual({ value: 'thinkingDefault', label: 'medium (default)' });
    });
  });

  it('preserves explicit effort overrides when present', async () => {
    mockUseSessionContext.mockReturnValue({
      currentSession: 'agent:main:subagent:explicit',
      sessions: [
        { key: 'agent:main:main', model: 'zai/glm-4.7' },
        { key: 'agent:main:subagent:explicit', model: 'zai/glm-4.7', thinking: 'medium', thinkingLevel: 'high' },
      ],
      updateSession: vi.fn(),
    });

    const { result } = renderHook(() => useModelEffort());

    await waitFor(() => {
      expect(result.current.selectedModel).toBe('primary');
      expect(result.current.selectedEffort).toBe('high');
      expect(result.current.selectedEffortLabel).toBe('high');
    });
  });

  it('preserves explicit adaptive effort overrides when present', async () => {
    mockUseSessionContext.mockReturnValue({
      currentSession: 'agent:main:subagent:explicit-adaptive',
      sessions: [
        { key: 'agent:main:main', model: 'zai/glm-4.7' },
        { key: 'agent:main:subagent:explicit-adaptive', model: 'zai/glm-4.7', thinking: 'medium', thinkingLevel: 'adaptive' },
      ],
      updateSession: vi.fn(),
    });

    const { result } = renderHook(() => useModelEffort());

    await waitFor(() => {
      expect(result.current.selectedModel).toBe('primary');
      expect(result.current.selectedEffort).toBe('adaptive');
      expect(result.current.selectedEffortLabel).toBe('adaptive');
    });
  });

  it('sends explicit off as a real thinking override instead of collapsing it to inherited default', async () => {
    const rpc = vi.fn().mockResolvedValue({ ok: true });
    const updateSession = vi.fn();

    mockUseGateway.mockReturnValue({
      rpc,
      connectionState: 'connected',
      model: 'zai/glm-4.7',
      thinking: 'medium',
    });

    mockUseSessionContext.mockReturnValue({
      currentSession: 'agent:main:main',
      sessions: [
        { key: 'agent:main:main', model: 'zai/glm-4.7', thinking: 'medium' },
      ],
      updateSession,
    });

    const { result } = renderHook(() => useModelEffort());

    await waitFor(() => {
      expect(result.current.selectedEffort).toBe('thinkingDefault');
    });

    await act(async () => {
      await result.current.handleEffortChange('off');
    });

    expect(rpc).toHaveBeenCalledWith('sessions.patch', { key: 'agent:main:main', thinkingLevel: 'off' });
    expect(updateSession).toHaveBeenCalledWith('agent:main:main', { thinkingLevel: 'off' });
  });

  it('omits thinking overrides when the inherited default option is selected', async () => {
    const rpc = vi.fn().mockResolvedValue({ ok: true });
    const updateSession = vi.fn();

    mockUseGateway.mockReturnValue({
      rpc,
      connectionState: 'connected',
      model: 'zai/glm-4.7',
      thinking: 'adaptive',
    });

    mockUseSessionContext.mockReturnValue({
      currentSession: 'agent:main:main',
      sessions: [
        { key: 'agent:main:main', model: 'zai/glm-4.7', thinking: 'adaptive', thinkingLevel: 'off' },
      ],
      updateSession,
    });

    const { result } = renderHook(() => useModelEffort());

    await waitFor(() => {
      expect(result.current.selectedEffort).toBe('off');
    });

    await act(async () => {
      await result.current.handleEffortChange('thinkingDefault');
    });

    expect(rpc).toHaveBeenCalledWith('sessions.patch', { key: 'agent:main:main', thinkingLevel: null });
    expect(updateSession).toHaveBeenCalledWith('agent:main:main', { thinkingLevel: undefined });
  });

  describe('readable inherited effort label', () => {
    const TELEGRAM_SESSION = 'agent:main:telegram:direct:424242';

    function useTelegramSession(row: Record<string, unknown>, gatewayThinking = '--', updateSession = vi.fn()) {
      mockUseGateway.mockReturnValue({
        rpc: vi.fn().mockResolvedValue({ ok: true }),
        connectionState: 'connected',
        model: 'zai/glm-4.7',
        thinking: gatewayThinking,
      });
      mockUseSessionContext.mockReturnValue({
        currentSession: TELEGRAM_SESSION,
        sessions: [{ key: TELEGRAM_SESSION, model: 'zai/glm-4.7', ...row }],
        updateSession,
      });
    }

    it('shows "Default" on the button and in the list when nothing says what the default resolves to', async () => {
      // A direct session with no override, a gateway status without a thinking level, no
      // thinking on the row and no transcript to read one from.
      useTelegramSession({});

      const { result } = renderHook(() => useModelEffort());

      await waitFor(() => {
        expect(result.current.selectedModel).toBe('primary');
      });

      expect(result.current.selectedEffort).toBe('thinkingDefault');
      expect(result.current.selectedEffortLabel).toBe('Default');
      expect(result.current.effortOptions[0]).toEqual({ value: 'thinkingDefault', label: 'Default' });
      expect(result.current.selectedEffortLabel).toBe(result.current.effortOptions[0].label);
      for (const option of result.current.effortOptions) {
        expect(option.label).not.toContain('thinkingDefault');
      }
    });

    it('names the level the gateway reports as the session default on the row', async () => {
      useTelegramSession({ thinkingDefault: 'xhigh' });

      const { result } = renderHook(() => useModelEffort());

      await waitFor(() => {
        expect(result.current.selectedEffortLabel).toBe('xhigh');
      });

      expect(result.current.selectedEffort).toBe('thinkingDefault');
      expect(result.current.effortOptions[0]).toEqual({ value: 'thinkingDefault', label: 'xhigh (default)' });
    });

    it('does not read a row level equal to its own default as an override of the gateway default', async () => {
      useTelegramSession({ thinking: 'xhigh', thinkingDefault: 'xhigh' }, 'medium');

      const { result } = renderHook(() => useModelEffort());

      await waitFor(() => {
        expect(result.current.selectedEffortLabel).toBe('xhigh');
      });

      expect(result.current.selectedEffort).toBe('thinkingDefault');
      expect(result.current.effortOptions[0]).toEqual({ value: 'thinkingDefault', label: 'xhigh (default)' });
    });

    it('shows an explicit level as that level, whatever the default is', async () => {
      useTelegramSession({ thinkingLevel: 'low', thinkingDefault: 'xhigh' });

      const { result } = renderHook(() => useModelEffort());

      await waitFor(() => {
        expect(result.current.selectedEffort).toBe('low');
      });

      expect(result.current.selectedEffortLabel).toBe('low');
      expect(result.current.effortOptions[0]).toEqual({ value: 'thinkingDefault', label: 'xhigh (default)' });
    });

    it('goes back to the readable label when an explicit level is switched back to inherited', async () => {
      const updateSession = vi.fn();
      useTelegramSession({ thinkingLevel: 'high' }, '--', updateSession);

      const { result } = renderHook(() => useModelEffort());

      await waitFor(() => {
        expect(result.current.selectedEffort).toBe('high');
      });
      expect(result.current.selectedEffortLabel).toBe('high');

      await act(async () => {
        await result.current.handleEffortChange('thinkingDefault');
      });

      expect(result.current.selectedEffort).toBe('thinkingDefault');
      expect(result.current.selectedEffortLabel).toBe('Default');
      expect(result.current.selectedEffortLabel).toBe(result.current.effortOptions[0].label);
      expect(result.current.selectedEffortLabel).not.toContain('thinkingDefault');
    });
  });

  describe('readable inherited model label', () => {
    const TELEGRAM_SESSION = 'agent:main:telegram:direct:424242';
    const LUNA = { id: 'openai-codex/gpt-6-luna', label: 'gpt-6-luna', provider: 'openai-codex', role: 'primary' } as const;
    const QWEN = { id: 'ollama/qwen2.5:7b-instruct-q5_K_M', label: 'qwen-local', provider: 'ollama', role: 'fallback' } as const;

    function useModelSession(opts: {
      catalog: unknown[] | 'fails';
      sessionModel: string;
      rpc?: ReturnType<typeof vi.fn>;
    }) {
      mockUseGateway.mockReturnValue({
        rpc: opts.rpc ?? vi.fn().mockResolvedValue({ ok: true }),
        connectionState: 'connected',
        model: opts.sessionModel,
        thinking: '--',
      });
      mockUseSessionContext.mockReturnValue({
        currentSession: TELEGRAM_SESSION,
        sessions: [{ key: TELEGRAM_SESSION, model: opts.sessionModel }],
        updateSession: vi.fn(),
      });
      globalThis.fetch = vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url === '/api/gateway/models') {
          return opts.catalog === 'fails'
            ? Promise.resolve(jsonResponse({}, { ok: false, status: 500 }))
            : Promise.resolve(jsonResponse({ models: opts.catalog, error: null }));
        }
        if (url.startsWith('/api/gateway/session-info?sessionKey=')) {
          return Promise.resolve(jsonResponse({}));
        }
        if (url.startsWith('/api/sessions/runtime?sessionKey=')) {
          return Promise.resolve(jsonResponse({ ok: true, model: null, thinking: null, missing: true }));
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }) as typeof globalThis.fetch;
    }

    function expectNoBarePrimary(result: { current: ReturnType<typeof useModelEffort> }) {
      expect(result.current.selectedModelLabel).not.toBe('primary');
      expect(result.current.modelOptions.map((option) => option.label)).not.toContain('primary');
    }

    it('names the primary model on the button and in the list when the catalog says which it is', async () => {
      useModelSession({ catalog: [LUNA, QWEN], sessionModel: LUNA.id });

      const { result } = renderHook(() => useModelEffort());

      await waitFor(() => {
        expect(result.current.selectedModel).toBe('primary');
      });

      expect(result.current.selectedModelLabel).toBe('gpt-6-luna');
      expect(result.current.modelOptions[0]).toEqual({ value: 'primary', label: 'gpt-6-luna (primary)' });
      // The configured entry for the same model stays beside it, under its own name.
      expect(result.current.modelOptions).toContainEqual({ value: LUNA.id, label: 'gpt-6-luna' });
      expectNoBarePrimary(result);
    });

    it('reads "Primary" on the button and in the list while the catalog does not say which model is primary', async () => {
      useModelSession({ catalog: [QWEN], sessionModel: QWEN.id });

      const { result } = renderHook(() => useModelEffort());

      await waitFor(() => {
        expect(result.current.modelOptions).toContainEqual({ value: QWEN.id, label: 'qwen-local' });
      });

      expect(result.current.modelOptions[0]).toEqual({ value: 'primary', label: 'Primary' });

      await act(async () => {
        await result.current.handleModelChange('primary');
      });

      expect(result.current.selectedModel).toBe('primary');
      expect(result.current.selectedModelLabel).toBe('Primary');
      expect(result.current.selectedModelLabel).toBe(result.current.modelOptions[0].label);
      expectNoBarePrimary(result);
    });

    it('reads "Primary" when the catalog could not be loaded at all', async () => {
      useModelSession({ catalog: 'fails', sessionModel: LUNA.id });

      const { result } = renderHook(() => useModelEffort());

      await waitFor(() => {
        expect(result.current.uiError).toBe('Could not load configured models');
      });

      expect(result.current.modelOptions[0]).toEqual({ value: 'primary', label: 'Primary' });
      expectNoBarePrimary(result);
    });

    it('reads like the inherited option while the session model is not known yet, as the select always has', async () => {
      useModelSession({ catalog: [LUNA, QWEN], sessionModel: '--' });

      const { result } = renderHook(() => useModelEffort());

      await waitFor(() => {
        expect(result.current.modelOptions[0].label).toBe('gpt-6-luna (primary)');
      });

      expect(result.current.selectedModel).toBe('--');
      expect(result.current.selectedModelLabel).toBe('gpt-6-luna');
      expectNoBarePrimary(result);
    });

    it('follows the selection between an explicit model and the primary, still patching the primary the same way', async () => {
      const rpc = vi.fn().mockResolvedValue({ ok: true });
      useModelSession({ catalog: [LUNA, QWEN], sessionModel: QWEN.id, rpc });

      const { result } = renderHook(() => useModelEffort());

      await waitFor(() => {
        expect(result.current.selectedModel).toBe(QWEN.id);
        expect(result.current.modelOptions[0].label).toBe('gpt-6-luna (primary)');
      });
      expect(result.current.selectedModelLabel).toBe('qwen-local');
      expectNoBarePrimary(result);

      await act(async () => {
        await result.current.handleModelChange('primary');
      });

      expect(rpc).toHaveBeenLastCalledWith('sessions.patch', { key: TELEGRAM_SESSION, model: null });
      expect(result.current.selectedModel).toBe('primary');
      expect(result.current.selectedModelLabel).toBe('gpt-6-luna');
      expectNoBarePrimary(result);

      await act(async () => {
        await result.current.handleModelChange(QWEN.id);
      });

      expect(rpc).toHaveBeenLastCalledWith('sessions.patch', { key: TELEGRAM_SESSION, model: QWEN.id });
      expect(result.current.selectedModel).toBe(QWEN.id);
      expect(result.current.selectedModelLabel).toBe('qwen-local');
      expectNoBarePrimary(result);
    });
  });
});

describe('buildModelCatalogUiError', () => {
  it('returns the backend error when the configured catalog is empty', () => {
    expect(buildModelCatalogUiError([], 'Could not load configured models')).toBe('Could not load configured models');
  });

  it('suppresses the backend error when configured models exist', () => {
    expect(buildModelCatalogUiError(CONFIGURED_MODELS, 'Could not load configured models')).toBeNull();
  });
});
