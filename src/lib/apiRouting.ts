const MASTER_ONLY_API_PREFIXES = [
  '/api/instances',
  '/api/auth',
] as const;

const PROXYABLE_API_PREFIXES = [
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

  const proxyPrefix = `/api/instances/${encodeURIComponent(instanceId)}/proxy`;
  if (pathname === proxyPrefix || pathname.startsWith(`${proxyPrefix}/`)) {
    return pathWithQuery;
  }

  if (!PROXYABLE_API_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return pathWithQuery;
  }

  return `${proxyPrefix}${pathname}${suffix}`;
}

export function routeFetchInput(
  input: RequestInfo | URL,
  instanceId: string | null,
  currentOrigin: string,
): RequestInfo | URL {
  if (!instanceId) return input;

  if (typeof input === 'string' || input instanceof URL) {
    const raw = input.toString();
    const parsed = new URL(raw, currentOrigin);
    if (parsed.origin !== currentOrigin) return input;
    const routed = routeApiPath(`${parsed.pathname}${parsed.search}`, instanceId);
    if (routed === `${parsed.pathname}${parsed.search}`) return input;

    if (raw.startsWith('/')) return routed;
    return new URL(routed, currentOrigin).toString();
  }

  const parsed = new URL(input.url, currentOrigin);
  if (parsed.origin !== currentOrigin) return input;
  const routed = routeApiPath(`${parsed.pathname}${parsed.search}`, instanceId);
  if (routed === `${parsed.pathname}${parsed.search}`) return input;
  return new Request(new URL(routed, currentOrigin).toString(), input);
}

export { MASTER_ONLY_API_PREFIXES, PROXYABLE_API_PREFIXES };
