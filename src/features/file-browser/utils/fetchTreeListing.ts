/**
 * Fetch a workspace tree listing and follow `nextCursor` until the directory
 * is complete.
 *
 * `/api/files/tree` pages large directories (1,000 entries per page by
 * default). Callers that render a whole directory must collect every page,
 * otherwise entries past the first page silently disappear. A listing is all or
 * nothing: a failed later page, or reaching the page cap, fails the whole
 * listing so callers never show a partial directory as complete. A rejected
 * request propagates exactly like a rejected first request.
 */

export const MAX_TREE_LISTING_PAGES = 50;

interface TreeListingPayload {
  ok?: boolean;
  entries?: unknown[];
  nextCursor?: string;
  error?: string;
}

export async function fetchTreeListing<T extends TreeListingPayload>(
  url: string,
): Promise<{ response: Response; payload: T | null }> {
  const response = await fetch(url);
  const payload = await readPayload<T>(response);
  if (!response.ok || !payload?.ok || !Array.isArray(payload.entries)) {
    return { response, payload };
  }

  let entries = payload.entries;
  let cursor = payload.nextCursor;
  for (let page = 1; cursor && page < MAX_TREE_LISTING_PAGES; page += 1) {
    const nextResponse = await fetch(withCursor(url, cursor));
    const next = await readPayload<T>(nextResponse);
    if (!nextResponse.ok || !next?.ok || !Array.isArray(next.entries)) {
      return { response: nextResponse, payload: next };
    }
    entries = entries.concat(next.entries);
    cursor = next.nextCursor;
  }

  if (cursor) {
    return {
      response,
      payload: { ...payload, ok: false, entries: [], error: 'Directory has too many entries to list.' },
    };
  }

  return { response, payload: { ...payload, entries, nextCursor: undefined } };
}

async function readPayload<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

function withCursor(url: string, cursor: string): string {
  const [path, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  params.set('cursor', cursor);
  return `${path}?${params.toString()}`;
}
