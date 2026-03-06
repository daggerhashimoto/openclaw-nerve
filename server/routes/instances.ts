/**
 * Local Docker instance discovery for Multi-Claw.
 *
 * GET  /api/instances              — list local OpenClaw-like Docker containers
 * GET  /api/instances/credentials  — list copyable master credential metadata
 * POST   /api/instances            — create a new docker-backed instance
 * POST   /api/instances/:id/stop   — stop a running instance
 * DELETE /api/instances/:id        — remove an instance container (+ managed state dir)
 * GET    /api/instances/:id/token  — retrieve gateway token from allowlisted env keys
 */

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import {
  listAllowedMasterCredentialSelectionKeys,
  createDockerInstance,
  DockerCommandError,
  getInstanceToken,
  listCopyableMasterCredentials,
  listLocalOpenClawInstances,
  removeLocalOpenClawInstance,
  stopLocalOpenClawInstance,
} from '../lib/docker-instances.js';
import { proxyToInstance, toProxyErrorResponse } from '../lib/instance-proxy.js';
import { isValidInstanceId } from '../lib/instance-routing.js';

const app = new Hono();
const CONTAINER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;

const createInstanceBodySchema = z.object({
  name: z.string().trim().min(1).max(63).regex(CONTAINER_NAME_RE, {
    message: 'Name must start with alphanumeric and contain only letters, numbers, dot, underscore, and dash.',
  }),
  type: z.literal('docker'),
  configurationKeys: z.array(z.string().trim().min(1).max(256)).max(256).optional(),
  credentialKeys: z.array(z.string().trim().min(1).max(256)).max(256).optional(),
});

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

app.get('/api/instances/credentials', rateLimitGeneral, async (c) => {
  const configurations = listCopyableMasterCredentials();
  return c.json({
    types: ['docker'],
    configurations,
    credentials: configurations,
  });
});

function mapCreateDockerError(err: DockerCommandError): { status: number; code: string; message: string } {
  const message = err.message;
  if (/is already in use by container/i.test(message)) {
    return {
      status: 409,
      code: 'instance_name_in_use',
      message: 'A container with that name already exists.',
    };
  }
  if (/pull access denied|repository does not exist|not found: manifest unknown|No such image/i.test(message)) {
    return {
      status: 422,
      code: 'image_not_available',
      message: 'The selected image is not available locally and could not be pulled.',
    };
  }
  if (/invalid reference format/i.test(message)) {
    return {
      status: 400,
      code: 'invalid_image_reference',
      message: 'Resolved Docker image reference is invalid.',
    };
  }
  if (err.code === 'docker_command_failed') {
    return {
      status: 502,
      code: err.code,
      message,
    };
  }
  return {
    status: 503,
    code: err.code,
    message,
  };
}

function mapInstanceMutationError(err: DockerCommandError): { status: number; code: string; message: string } {
  const message = err.message;
  if (/No such (?:container|object)/i.test(message)) {
    return {
      status: 404,
      code: 'instance_not_found',
      message: 'Instance not found.',
    };
  }
  if (err.code === 'docker_command_failed') {
    return {
      status: 502,
      code: err.code,
      message,
    };
  }
  return {
    status: 503,
    code: err.code,
    message,
  };
}

app.post('/api/instances', rateLimitGeneral, async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          code: 'invalid_json',
          message: 'Request body must be valid JSON.',
        },
      },
      400,
    );
  }

  const parsed = createInstanceBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'invalid_request',
          message: parsed.error.issues[0]?.message || 'Invalid create-instance request.',
        },
      },
      400,
    );
  }

  const allowlisted = new Set<string>(listAllowedMasterCredentialSelectionKeys());
  const selectedConfigurationKeys = [...new Set(parsed.data.configurationKeys || parsed.data.credentialKeys || [])];
  const invalidConfigurationKey = selectedConfigurationKeys.find((key) => {
    if (allowlisted.has(key)) return false;
    if (key.startsWith('AUTH_PROFILE:') && key.slice('AUTH_PROFILE:'.length).trim().length > 0) return false;
    return true;
  });
  if (invalidConfigurationKey) {
    return c.json(
      {
        error: {
          code: 'invalid_configuration_key',
          message: `Configuration key "${invalidConfigurationKey}" is not copyable.`,
        },
      },
      400,
    );
  }

  try {
    const created = await createDockerInstance({
      name: parsed.data.name,
      credentialKeys: selectedConfigurationKeys,
    });
    return c.json(created, 201);
  } catch (err) {
    if (err instanceof DockerCommandError) {
      const mapped = mapCreateDockerError(err);
      return c.json(
        {
          error: {
            code: mapped.code,
            message: mapped.message,
          },
        },
        mapped.status as 400 | 409 | 422 | 502 | 503,
      );
    }
    return c.json(
      {
        error: {
          code: 'unknown_error',
          message: 'Unexpected error while creating instance.',
        },
      },
      500,
    );
  }
});

app.post('/api/instances/:id/stop', rateLimitGeneral, async (c) => {
  const id = c.req.param('id');
  if (!isValidInstanceId(id)) {
    return c.json({ error: 'Invalid instance id.' }, 400);
  }

  try {
    const stopped = await stopLocalOpenClawInstance(id);
    if (!stopped) {
      return c.json({ error: 'Instance not found.' }, 404);
    }
    return c.json({ ok: true, instance: stopped });
  } catch (err) {
    if (err instanceof DockerCommandError) {
      const mapped = mapInstanceMutationError(err);
      return c.json(
        {
          error: {
            code: mapped.code,
            message: mapped.message,
          },
        },
        mapped.status as 404 | 502 | 503,
      );
    }
    return c.json(
      {
        error: {
          code: 'unknown_error',
          message: 'Unexpected error while stopping instance.',
        },
      },
      500,
    );
  }
});

app.delete('/api/instances/:id', rateLimitGeneral, async (c) => {
  const id = c.req.param('id');
  if (!isValidInstanceId(id)) {
    return c.json({ error: 'Invalid instance id.' }, 400);
  }

  try {
    const removed = await removeLocalOpenClawInstance(id);
    if (!removed) {
      return c.json({ error: 'Instance not found.' }, 404);
    }
    return c.json({ ok: true, ...removed });
  } catch (err) {
    if (err instanceof DockerCommandError) {
      const mapped = mapInstanceMutationError(err);
      return c.json(
        {
          error: {
            code: mapped.code,
            message: mapped.message,
          },
        },
        mapped.status as 404 | 502 | 503,
      );
    }
    return c.json(
      {
        error: {
          code: 'unknown_error',
          message: 'Unexpected error while removing instance.',
        },
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
