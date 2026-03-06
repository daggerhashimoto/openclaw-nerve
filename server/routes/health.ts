/**
 * Health endpoints.
 * - GET /health      — basic health + gateway probe
 * - GET /healthcheck — explicit readiness/availability shape for orchestration
 */

import { Hono } from 'hono';
import { config } from '../lib/config.js';

const app = new Hono();

async function probeGateway(): Promise<'ok' | 'unreachable'> {
  try {
    const res = await fetch(`${config.gatewayUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return 'ok';
  } catch {
    // unreachable
  }
  return 'unreachable';
}

app.get('/health', async (c) => {
  const gateway = await probeGateway();
  return c.json({ status: 'ok', uptime: process.uptime(), gateway });
});

app.get('/healthcheck', async (c) => {
  const gateway = await probeGateway();
  const ready = gateway === 'ok';
  return c.json({
    service: 'nerve',
    status: ready ? 'ready' : 'initializing',
    ready,
    uptime: process.uptime(),
    gateway,
  });
});

export default app;
