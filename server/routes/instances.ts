/**
 * Local Docker instance discovery for Multi-Claw.
 *
 * GET /api/instances            — list local OpenClaw-like Docker containers
 * GET /api/instances/:id/token  — retrieve gateway token from allowlisted env keys
 */

import { Hono } from 'hono';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import {
  DockerCommandError,
  getInstanceToken,
  listLocalOpenClawInstances,
} from '../lib/docker-instances.js';

const app = new Hono();

const INSTANCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

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
