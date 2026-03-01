import {
  DockerCommandError,
  getLocalOpenClawInstance,
  resolvePublishedNervePort,
} from './docker-instances.js';
import { isMasterOnlyApiPath } from './instance-routing.js';

const PROXY_RESPONSE_HEADERS = new Set([
  'content-type',
  'cache-control',
  'etag',
  'last-modified',
  // Intentionally omit content-encoding: upstream fetch may already decode body.
  // Forwarding stale encoding headers can cause client-side "Decoding failed" errors.
]);

const PROXY_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'if-none-match',
  'if-modified-since',
  'x-request-id',
  'x-openclaw-gateway-token',
]);

export class InstanceProxyError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function hasTraversal(path: string): boolean {
  return /(^|\/)\.\.(\/|$)/.test(path);
}

export function validateProxyPath(path: string): void {
  if (!path.startsWith('/')) {
    throw new InstanceProxyError(400, 'invalid_proxy_path', 'Proxy path must be absolute.');
  }
  if (path.startsWith('//')) {
    throw new InstanceProxyError(400, 'invalid_proxy_path', 'Protocol-relative paths are not allowed.');
  }
  if (path.includes('\\')) {
    throw new InstanceProxyError(400, 'invalid_proxy_path', 'Backslashes are not allowed in proxy paths.');
  }
  if (isMasterOnlyApiPath(path)) {
    throw new InstanceProxyError(
      400,
      'master_pinned_path',
      'This endpoint is managed by the master and cannot be proxied.',
    );
  }

  const schemeInPath = /^\/[a-z][a-z0-9+.-]*:/i.test(path);
  if (schemeInPath) {
    throw new InstanceProxyError(400, 'invalid_proxy_path', 'Absolute URLs are not allowed in proxy paths.');
  }

  if (hasTraversal(path)) {
    throw new InstanceProxyError(400, 'invalid_proxy_path', 'Path traversal segments are not allowed.');
  }

  let decoded = path;
  for (let i = 0; i < 2; i += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      throw new InstanceProxyError(400, 'invalid_proxy_path', 'Malformed percent-encoding in proxy path.');
    }

    if (isMasterOnlyApiPath(decoded)) {
      throw new InstanceProxyError(
        400,
        'master_pinned_path',
        'This endpoint is managed by the master and cannot be proxied.',
      );
    }
    if (decoded.startsWith('//') || /^\/[a-z][a-z0-9+.-]*:/i.test(decoded) || hasTraversal(decoded)) {
      throw new InstanceProxyError(400, 'invalid_proxy_path', 'Unsafe proxy path.');
    }
  }
}

function buildForwardHeaders(reqHeaders: Headers): Headers {
  const out = new Headers();
  for (const [key, value] of reqHeaders.entries()) {
    const lower = key.toLowerCase();
    if (PROXY_REQUEST_HEADERS.has(lower)) {
      out.set(key, value);
    }
  }
  return out;
}

function buildResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  for (const [key, value] of upstream.entries()) {
    if (PROXY_RESPONSE_HEADERS.has(key.toLowerCase())) {
      out.set(key, value);
    }
  }
  return out;
}

interface ProxyToInstanceOptions {
  instanceId: string;
  path: string;
  search: string;
  method: string;
  headers: Headers;
  body?: ArrayBuffer;
}

export async function proxyToInstance(options: ProxyToInstanceOptions): Promise<Response> {
  const { instanceId, path, search, method, headers, body } = options;
  validateProxyPath(path);

  const instance = await getLocalOpenClawInstance(instanceId);
  if (!instance) {
    throw new InstanceProxyError(404, 'instance_unavailable', 'Instance unavailable.');
  }

  const targetPort = resolvePublishedNervePort(instance.ports);
  if (!targetPort) {
    throw new InstanceProxyError(
      409,
      'target_port_unavailable',
      'Instance has no published Nerve port.',
    );
  }

  const target = new URL(`http://127.0.0.1:${targetPort}${path}`);
  target.search = search;

  const upstream = await fetch(target.toString(), {
    method,
    headers: buildForwardHeaders(headers),
    body,
    redirect: 'manual',
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: buildResponseHeaders(upstream.headers),
  });
}

export function toProxyErrorResponse(err: unknown): Response {
  if (err instanceof InstanceProxyError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }

  if (err instanceof DockerCommandError) {
    return Response.json(
      { error: err.message, code: err.code },
      { status: err.code === 'docker_command_failed' ? 502 : 503 },
    );
  }

  return Response.json(
    { error: 'Proxy request failed.', code: 'proxy_request_failed' },
    { status: 502 },
  );
}
