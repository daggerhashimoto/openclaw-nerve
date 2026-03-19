import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSkills } from './useSkills';

type FetchResponse = {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
};

function jsonResponse(data: unknown, init: { ok?: boolean; status?: number } = {}): FetchResponse {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => data,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const sampleSkill = (name: string) => ({
  name,
  description: `${name} description`,
  emoji: '🧪',
  eligible: true,
  disabled: false,
  blockedByAllowlist: false,
  source: 'workspace',
  bundled: false,
});

const useSkillsWithAgent = useSkills as unknown as (agentId: string) => ReturnType<typeof useSkills>;

describe('useSkills', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('requests the scoped skills endpoint for the active agent', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(jsonResponse({
      ok: true,
      skills: [sampleSkill('research-skill')],
    }))) as typeof globalThis.fetch;

    const { result } = renderHook(() => useSkillsWithAgent('research'));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/skills?agentId=research', expect.any(Object));
    });

    await waitFor(() => {
      expect(result.current.skills.map((skill) => skill.name)).toEqual(['research-skill']);
    });
  });

  it('refreshes on agent changes and ignores stale responses from the previous agent', async () => {
    const alphaLoad = deferred<FetchResponse>();
    const bravoLoad = deferred<FetchResponse>();

    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/skills?agentId=alpha') return alphaLoad.promise;
      if (url === '/api/skills?agentId=bravo') return bravoLoad.promise;
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ agentId }) => useSkillsWithAgent(agentId),
      { initialProps: { agentId: 'alpha' } },
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/skills?agentId=alpha', expect.any(Object));
    });

    rerender({ agentId: 'bravo' });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/skills?agentId=bravo', expect.any(Object));
    });

    await act(async () => {
      bravoLoad.resolve(jsonResponse({ ok: true, skills: [sampleSkill('bravo-skill')] }));
    });

    await waitFor(() => {
      expect(result.current.skills.map((skill) => skill.name)).toEqual(['bravo-skill']);
      expect(result.current.error).toBeNull();
    });

    await act(async () => {
      alphaLoad.resolve(jsonResponse({ ok: true, skills: [sampleSkill('alpha-skill')] }));
    });

    await waitFor(() => {
      expect(result.current.skills.map((skill) => skill.name)).toEqual(['bravo-skill']);
    });
  });
});
