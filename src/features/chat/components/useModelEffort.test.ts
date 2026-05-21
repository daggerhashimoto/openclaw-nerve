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
      { value: 'primary', label: 'primary' },
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
});

describe('buildModelCatalogUiError', () => {
  it('returns the backend error when the configured catalog is empty', () => {
    expect(buildModelCatalogUiError([], 'Could not load configured models')).toBe('Could not load configured models');
  });

  it('suppresses the backend error when configured models exist', () => {
    expect(buildModelCatalogUiError(CONFIGURED_MODELS, 'Could not load configured models')).toBeNull();
  });
});
