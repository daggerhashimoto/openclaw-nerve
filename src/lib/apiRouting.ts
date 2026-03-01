const MASTER_ONLY_API_PREFIXES = [
  '/api/instances',
  '/api/auth',
] as const;

const INSTANCE_ROUTED_API_PREFIXES = [
  '/api/agentlog',
  '/api/channels',
  '/api/claude-code-limits',
  '/api/codex-limits',
  '/api/connect-defaults',
  '/api/crons',
  '/api/events',
  '/api/files',
  '/api/gateway',
  '/api/keys',
  '/api/language',
  '/api/memories',
  '/api/server-info',
  '/api/sessions',
  '/api/skills',
  '/api/tokens',
  '/api/transcribe',
  '/api/tts',
  '/api/version',
  '/api/version/check',
  '/api/voice-phrases',
  '/api/workspace',
] as const;

export const INSTANCE_ID_HEADER = 'X-Instance-Id';
export const INSTANCE_ID_QUERY_PARAM = 'instanceId';

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function splitPathAndQuery(input: string): { pathname: string; suffix: string } {
  const idx = input.search(/[?#]/);
  if (idx === -1) return { pathname: input, suffix: '' };
  return { pathname: input.slice(0, idx), suffix: input.slice(idx) };
}

export function routeApiPath(pathWithQuery: string, instanceId: string | null): string {
  if (!instanceId) return pathWithQuery;

  const { pathname, suffix } = splitPathAndQuery(pathWithQuery);
  if (!(pathname === '/api' || pathname.startsWith('/api/'))) {
    return pathWithQuery;
  }

  if (MASTER_ONLY_API_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return pathWithQuery;
  }

  if (!INSTANCE_ROUTED_API_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return pathWithQuery;
  }

  const query = suffix.startsWith('?') ? suffix.slice(1) : suffix;
  const params = new URLSearchParams(query);
  params.set(INSTANCE_ID_QUERY_PARAM, instanceId);
  const nextQuery = params.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}

function shouldAttachInstanceMetadata(
  input: RequestInfo | URL,
  currentOrigin: string,
): boolean {
  if (typeof input === 'string' || input instanceof URL) {
    const parsed = new URL(input.toString(), currentOrigin);
    if (parsed.origin !== currentOrigin) return false;
    return parsed.pathname.startsWith('/api/') || parsed.pathname === '/api';
  }

  const parsed = new URL(input.url, currentOrigin);
  if (parsed.origin !== currentOrigin) return false;
  return parsed.pathname.startsWith('/api/') || parsed.pathname === '/api';
}

export function addInstanceHeaderToFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  instanceId: string | null,
  currentOrigin: string,
): { input: RequestInfo | URL; init: RequestInit | undefined } {
  if (!instanceId) return { input, init };
  if (!shouldAttachInstanceMetadata(input, currentOrigin)) return { input, init };

  const pathname = (() => {
    if (typeof input === 'string' || input instanceof URL) {
      return new URL(input.toString(), currentOrigin).pathname;
    }
    return new URL(input.url, currentOrigin).pathname;
  })();

  if (!INSTANCE_ROUTED_API_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return { input, init };
  }
  if (MASTER_ONLY_API_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return { input, init };
  }

  const headers = new Headers(
    init?.headers
      ?? (input instanceof Request ? input.headers : undefined),
  );
  headers.set(INSTANCE_ID_HEADER, instanceId);

  if (input instanceof Request) {
    const requestInit: RequestInit = {
      ...input,
      ...init,
      headers,
    };
    return { input: new Request(input, requestInit), init: undefined };
  }

  return { input, init: { ...init, headers } };
}

export { MASTER_ONLY_API_PREFIXES, INSTANCE_ROUTED_API_PREFIXES };
