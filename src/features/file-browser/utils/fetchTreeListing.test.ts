/** Tests for fetchTreeListing - collecting every page of a paged tree listing. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchTreeListing, MAX_TREE_LISTING_PAGES } from './fetchTreeListing';

global.fetch = vi.fn();

interface Page {
  ok: boolean;
  entries?: Array<{ path: string }>;
  nextCursor?: string;
  error?: string;
}

function respond(page: Page, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => page } as Response;
}

function requestedUrls(): URL[] {
  return vi.mocked(fetch).mock.calls.map(([input]) => new URL(String(input), 'http://localhost'));
}

describe('fetchTreeListing', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
  });

  it('follows nextCursor until the directory is complete', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const cursor = new URL(String(input), 'http://localhost').searchParams.get('cursor');
      if (cursor === '2') return respond({ ok: true, entries: [{ path: 'c' }], nextCursor: '3' });
      if (cursor === '3') return respond({ ok: true, entries: [{ path: 'd' }] });
      return respond({ ok: true, entries: [{ path: 'a' }, { path: 'b' }], nextCursor: '2' });
    });

    const { response, payload } = await fetchTreeListing<Page>('/api/files/tree?depth=1&agentId=main&path=src');

    expect(response.ok).toBe(true);
    expect(payload?.entries?.map((entry) => entry.path)).toEqual(['a', 'b', 'c', 'd']);
    expect(payload?.nextCursor).toBeUndefined();
    const urls = requestedUrls();
    expect(urls.map((url) => url.searchParams.get('cursor'))).toEqual([null, '2', '3']);
    for (const url of urls) {
      expect(url.searchParams.get('agentId')).toBe('main');
      expect(url.searchParams.get('path')).toBe('src');
      expect(url.searchParams.get('depth')).toBe('1');
    }
  });

  it('makes a single request when the listing fits in one page', async () => {
    vi.mocked(fetch).mockResolvedValue(respond({ ok: true, entries: [{ path: 'a' }] }));

    const { payload } = await fetchTreeListing<Page>('/api/files/tree?depth=1');

    expect(payload?.entries).toEqual([{ path: 'a' }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns a failed first response untouched for the caller to handle', async () => {
    vi.mocked(fetch).mockResolvedValue(respond({ ok: false, error: 'Directory not found' }, 404));

    const { response, payload } = await fetchTreeListing<Page>('/api/files/tree?depth=1&path=gone');

    expect(response.status).toBe(404);
    expect(payload).toEqual({ ok: false, error: 'Directory not found' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the pages already collected when a later page fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(respond({ ok: true, entries: [{ path: 'a' }], nextCursor: '1' }))
      .mockResolvedValueOnce(respond({ ok: false, error: 'boom' }, 500));

    const { payload } = await fetchTreeListing<Page>('/api/files/tree?depth=1');

    expect(payload?.entries).toEqual([{ path: 'a' }]);
    expect(payload?.nextCursor).toBe('1');
  });

  it('stops after the page cap even if the server keeps returning a cursor', async () => {
    vi.mocked(fetch).mockImplementation(async () => respond({ ok: true, entries: [{ path: 'x' }], nextCursor: 'more' }));

    const { payload } = await fetchTreeListing<Page>('/api/files/tree?depth=1');

    expect(fetch).toHaveBeenCalledTimes(MAX_TREE_LISTING_PAGES);
    expect(payload?.entries).toHaveLength(MAX_TREE_LISTING_PAGES);
  });
});
