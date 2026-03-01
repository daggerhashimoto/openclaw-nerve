const INSTANCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export const INSTANCE_ID_HEADER = 'x-instance-id';
export const INSTANCE_ID_QUERY_PARAM = 'instanceId';

export const MASTER_ONLY_API_PREFIXES = [
  '/api/instances',
  '/api/auth',
] as const;

export const INSTANCE_PROXYABLE_API_PREFIXES = [
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

export function isValidInstanceId(id: string): boolean {
  return INSTANCE_ID_RE.test(id);
}

export function parseInstanceId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return isValidInstanceId(trimmed) ? trimmed : null;
}

export function isMasterOnlyApiPath(pathname: string): boolean {
  return MASTER_ONLY_API_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function isInstanceProxyPath(pathname: string): boolean {
  const match = pathname.match(/^\/api\/instances\/([^/]+)\/proxy(?:\/|$)/);
  if (!match) return false;
  try {
    return isValidInstanceId(decodeURIComponent(match[1]));
  } catch {
    return false;
  }
}

export function isProxyEligibleApiPath(pathname: string): boolean {
  if (!(pathname === '/api' || pathname.startsWith('/api/'))) return false;
  if (isMasterOnlyApiPath(pathname)) return false;
  if (isInstanceProxyPath(pathname)) return false;
  return INSTANCE_PROXYABLE_API_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function resolveRequestedInstanceId(url: URL, headers: Headers): string | null {
  const headerValue = parseInstanceId(headers.get(INSTANCE_ID_HEADER));
  if (headerValue) return headerValue;
  return parseInstanceId(url.searchParams.get(INSTANCE_ID_QUERY_PARAM));
}

export function buildInstanceProxyPath(pathname: string, search: string, instanceId: string): string {
  return `/api/instances/${encodeURIComponent(instanceId)}/proxy${pathname}${search}`;
}
