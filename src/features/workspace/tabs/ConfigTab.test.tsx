import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigTab } from './ConfigTab';

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

describe('ConfigTab', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('preserves an unsaved config draft per agent across top-level agent switches', async () => {
    const user = userEvent.setup();

    globalThis.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (!init?.method && url === '/api/workspace/soul?agentId=alpha') {
        return Promise.resolve(jsonResponse({ ok: true, content: 'alpha soul' }));
      }
      if (!init?.method && url === '/api/workspace/soul?agentId=bravo') {
        return Promise.resolve(jsonResponse({ ok: true, content: 'bravo soul' }));
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof globalThis.fetch;

    const { rerender } = render(<ConfigTab agentId="alpha" />);

    await waitFor(() => {
      expect(screen.getByText('alpha soul')).toBeInTheDocument();
    });

    await user.click(screen.getByTitle('Edit'));

    const editor = await screen.findByRole('textbox');
    expect(editor).toHaveValue('alpha soul');

    await user.type(editor, ' draft');
    expect(editor).toHaveValue('alpha soul draft');

    rerender(<ConfigTab agentId="bravo" />);

    await waitFor(() => {
      expect(screen.getByText('bravo soul')).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue('alpha soul draft')).not.toBeInTheDocument();

    rerender(<ConfigTab agentId="alpha" />);

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue('alpha soul draft');
    });
  });
});
