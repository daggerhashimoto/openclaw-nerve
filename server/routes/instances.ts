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
  getInstanceToken,
  listLocalOpenClawInstances,
} from '../lib/docker-instances.js';
import { proxyToInstance, toProxyErrorResponse } from '../lib/instance-proxy.js';
import { isValidInstanceId } from '../lib/instance-routing.js';

const app = new Hono();

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
  if (!isValidInstanceId(id)) {
    return c.json({ error: 'Invalid instance id.' }, 400);
  }

  const { path, search } = getProxyTargetPath(c, id);
  try {
    const method = c.req.method.toUpperCase();
    let body: ArrayBuffer | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const payload = await c.req.raw.arrayBuffer();
      if (payload.byteLength > 0) body = payload;
    }

    return await proxyToInstance({
      instanceId: id,
      path,
      search,
      method,
      headers: c.req.raw.headers,
      body,
    });
  } catch (err) {
    return toProxyErrorResponse(err);
  }
}

app.all('/api/instances/:id/proxy', rateLimitGeneral, handleProxy);
app.all('/api/instances/:id/proxy/*', rateLimitGeneral, handleProxy);

app.get('/api/instances/:id/token', rateLimitGeneral, async (c) => {
  const id = c.req.param('id');
  if (!isValidInstanceId(id)) {
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
