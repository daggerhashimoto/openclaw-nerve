/**
 * GET /api/connect-defaults — Provides gateway connection defaults for the browser.
 *
 * The ConnectDialog in the frontend needs the WebSocket URL and auth token.
 * Instead of requiring users to enter these manually in the browser,
 * this endpoint exposes the server's configured gateway URL and token
 * so the frontend can pre-fill (or auto-connect).
 *
 * Security: The gateway token is only returned to loopback clients.
 * Remote clients receive the wsUrl and agentName but token is null.
 */

import { Hono } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { config } from '../lib/config.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const LOOPBACK_RE = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;

const app = new Hono();

app.get('/api/connect-defaults', rateLimitGeneral, (c) => {
  // Determine if the request originates from loopback
  let remoteIp = '';
  try {
    const info = getConnInfo(c);
    remoteIp = info.remote?.address ?? '';
  } catch {
    // fallback: not available in some test environments
  }
  const isLoopback = LOOPBACK_RE.test(remoteIp);

  // Derive WebSocket URL from the HTTP gateway URL
  const gwUrl = config.gatewayUrl;
  let wsUrl = '';
  try {
    const parsed = new URL(gwUrl);
    const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${wsProtocol}//${parsed.host}/ws`;
  } catch {
    wsUrl = gwUrl.replace(/^http/, 'ws');
  }

  // Return token if:
  // 1. Client is loopback, OR
  // 2. NERVE_LAN_EXPOSE_TOKEN is enabled in .env
  const shouldExposeToken = isLoopback || config.lanExposeToken;

  return c.json({
    wsUrl,
    token: shouldExposeToken ? (config.gatewayToken || null) : null,
    agentName: config.agentName,
  });
});

export default app;
