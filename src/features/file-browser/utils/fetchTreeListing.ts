/**
 * Fetch a workspace tree listing and follow `nextCursor` until the directory
 * is complete.
 *
 * `/api/files/tree` pages large directories (1,000 entries per page by
 * default). Callers that render a whole directory must collect every page,
 * otherwise entries past the first page silently disappear. A page cap guards
 * against a server that never stops returning a cursor.
 */

export const MAX_TREE_LISTING_PAGES = 50;

interface TreeListingPayload {
  ok?: boolean;
  entries?: unknown[];
  nextCursor?: string;
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
    // Keep the pages already collected; the remaining cursor stays on the payload.
    if (!nextResponse.ok || !next?.ok || !Array.isArray(next.entries)) break;
    entries = entries.concat(next.entries);
    cursor = next.nextCursor;
  }

  return { response, payload: { ...payload, entries, nextCursor: cursor } };
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
