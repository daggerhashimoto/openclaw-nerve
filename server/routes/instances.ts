/**
 * Local Docker instance discovery for Multi-Claw.
 *
 * GET /api/instances            — list local OpenClaw-like Docker containers
 * GET /api/instances/:id/token  — retrieve gateway token from allowlisted env keys
 */

import { Hono, type Context } from 'hono';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import {
  DockerCommandError,
  getLocalOpenClawInstance,
  getInstanceToken,
  listLocalOpenClawInstances,
  resolvePublishedGatewayPort,
} from '../lib/docker-instances.js';

const app = new Hono();

const INSTANCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const PROXY_RESPONSE_HEADERS = new Set(['content-type', 'cache-control', 'etag', 'last-modified', 'content-encoding']);
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
const MASTER_PINNED_PREFIXES = ['/api/instances'];

function getProxyTargetPath(c: Context, id: string): {
  path: string;
  search: string;
} {
  const reqUrl = new URL(c.req.url);
  const prefix = `/api/instances/${id}/proxy`;
  if (reqUrl.pathname === prefix) {
    return { path: '/', search: reqUrl.search };
  }
  if (reqUrl.pathname.startsWith(`${prefix}/`)) {
    return { path: reqUrl.pathname.slice(prefix.length), search: reqUrl.search };
  }
  return { path: '/', search: reqUrl.search };
}

function hasTraversal(path: string): boolean {
  return /(^|\/)\.\.(\/|$)/.test(path);
}

function isMasterPinnedPath(path: string): boolean {
  const lower = path.toLowerCase();
  return MASTER_PINNED_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`));
}

function validateProxyPath(path: string): { ok: true } | { ok: false; code: string; error: string } {
  if (!path.startsWith('/')) {
    return { ok: false, code: 'invalid_proxy_path', error: 'Proxy path must be absolute.' };
  }
  if (path.startsWith('//')) {
    return { ok: false, code: 'invalid_proxy_path', error: 'Protocol-relative paths are not allowed.' };
  }
  if (path.includes('\\')) {
    return { ok: false, code: 'invalid_proxy_path', error: 'Backslashes are not allowed in proxy paths.' };
  }

  if (isMasterPinnedPath(path)) {
    return {
      ok: false,
      code: 'master_pinned_path',
      error: 'This endpoint is managed by the master and cannot be proxied.',
    };
  }

  const schemeInPath = /^\/[a-z][a-z0-9+.-]*:/i.test(path);
  if (schemeInPath) {
    return { ok: false, code: 'invalid_proxy_path', error: 'Absolute URLs are not allowed in proxy paths.' };
  }

  if (hasTraversal(path)) {
    return { ok: false, code: 'invalid_proxy_path', error: 'Path traversal segments are not allowed.' };
  }

  let decoded = path;
  for (let i = 0; i < 2; i += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return { ok: false, code: 'invalid_proxy_path', error: 'Malformed percent-encoding in proxy path.' };
    }
    if (isMasterPinnedPath(decoded)) {
      return {
        ok: false,
        code: 'master_pinned_path',
        error: 'This endpoint is managed by the master and cannot be proxied.',
      };
    }
    if (decoded.startsWith('//') || /^\/[a-z][a-z0-9+.-]*:/i.test(decoded) || hasTraversal(decoded)) {
      return { ok: false, code: 'invalid_proxy_path', error: 'Unsafe proxy path.' };
    }
  }

  return { ok: true };
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

app.get('/api/instances', rateLimitGeneral, async (c) => {
  const now = Date.now();
  try {
    const instances = await listLocalOpenClawInstances();
    return c.json({
      source: 'local-docker',
      updatedAt: now,
      instances,
    });
  } catch (err) {
    if (err instanceof DockerCommandError) {
      return c.json(
        {
          source: 'local-docker',
          updatedAt: now,
          instances: [],
          error: { code: err.code, message: err.message },
        },
        err.code === 'docker_command_failed' ? 502 : 503,
      );
    }
    return c.json(
      {
        source: 'local-docker',
        updatedAt: now,
        instances: [],
        error: { code: 'unknown_error', message: 'Unexpected error while listing instances.' },
      },
      500,
    );
  }
});

async function handleProxy(c: Context) {
  const id = c.req.param('id');
  if (!INSTANCE_ID_RE.test(id)) {
    return c.json({ error: 'Invalid instance id.' }, 400);
  }

  const { path, search } = getProxyTargetPath(c, id);
  const pathValidation = validateProxyPath(path);
  if (!pathValidation.ok) {
    return c.json({ error: pathValidation.error, code: pathValidation.code }, 400);
  }

  try {
    const instance = await getLocalOpenClawInstance(id);
    if (!instance) {
      return c.json({ error: 'Instance unavailable.', code: 'instance_unavailable' }, 404);
    }

    const targetPort = resolvePublishedGatewayPort(instance.ports);
    if (!targetPort) {
      return c.json(
        {
          error: 'Instance has no published gateway port.',
          code: 'target_port_unavailable',
        },
        409,
      );
    }

    const target = new URL(`http://127.0.0.1:${targetPort}${path}`);
    target.search = search;

    const method = c.req.method.toUpperCase();
    let body: ArrayBuffer | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const payload = await c.req.raw.arrayBuffer();
      if (payload.byteLength > 0) body = payload;
    }

    const upstream = await fetch(target.toString(), {
      method,
      headers: buildForwardHeaders(c.req.raw.headers),
      body,
      redirect: 'manual',
    });

    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: buildResponseHeaders(upstream.headers),
    });
  } catch (err) {
    if (err instanceof DockerCommandError) {
      return c.json(
        { error: err.message, code: err.code },
        err.code === 'docker_command_failed' ? 502 : 503,
      );
    }
    return c.json({ error: 'Proxy request failed.', code: 'proxy_request_failed' }, 502);
  }
}

app.all('/api/instances/:id/proxy', rateLimitGeneral, handleProxy);
app.all('/api/instances/:id/proxy/*', rateLimitGeneral, handleProxy);

app.get('/api/instances/:id/token', rateLimitGeneral, async (c) => {
  const id = c.req.param('id');
  if (!INSTANCE_ID_RE.test(id)) {
    return c.json({ error: 'Invalid instance id.' }, 400);
  }

  try {
    const result = await getInstanceToken(id);
    if (!result) {
      return c.json({ error: 'Instance not found.' }, 404);
    }
    return c.json(result);
  } catch (err) {
    if (err instanceof DockerCommandError) {
      return c.json(
        { error: err.message, code: err.code },
        err.code === 'docker_command_failed' ? 502 : 503,
      );
    }
    return c.json({ error: 'Unexpected error while retrieving token.' }, 500);
  }
});

export default app;
