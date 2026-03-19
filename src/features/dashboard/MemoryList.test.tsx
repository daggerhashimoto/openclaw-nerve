import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryList } from './MemoryList';
import type { Memory } from '@/types';

type FetchResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

function jsonResponse(data: unknown): FetchResponse {
  return {
    ok: true,
    json: async () => data,
  };
}

describe('MemoryList', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('preserves an unsaved memory draft when switching away and back to the same agent', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const alphaMemories: Memory[] = [{ type: 'section', text: 'Project' }];
    const bravoMemories: Memory[] = [{ type: 'section', text: 'Other' }];

    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/memories/section?title=Project&agentId=alpha') {
        return Promise.resolve(jsonResponse({ ok: true, content: 'alpha memory' }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof globalThis.fetch;

    const { rerender } = render(
      <MemoryList
        agentId="alpha"
        memories={alphaMemories}
        onRefresh={onRefresh}
      />,
    );

    await user.click(screen.getByTitle('Edit section'));

    const editor = await screen.findByLabelText('Edit Project');
    expect(editor).toHaveValue('alpha memory');

    await user.type(editor, ' draft');
    expect(editor).toHaveValue('alpha memory draft');

    rerender(
      <MemoryList
        agentId="bravo"
        memories={bravoMemories}
        onRefresh={onRefresh}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByLabelText('Edit Project')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Other')).toBeInTheDocument();

    rerender(
      <MemoryList
        agentId="alpha"
        memories={alphaMemories}
        onRefresh={onRefresh}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Edit Project')).toHaveValue('alpha memory draft');
    });
  });
});
