/**
 * GET /api/connect-defaults — Provides gateway connection defaults for the browser.
 *
 * The ConnectDialog in the frontend needs the WebSocket URL and auth token.
 * Instead of requiring users to enter these manually in the browser,
 * this endpoint exposes the server's configured gateway URL and token
 * so the frontend can pre-fill (or auto-connect).
 *
 * Security: The token field is always null; token injection is handled server-side
 * by the WebSocket proxy for trusted clients (authenticated sessions or loopback).
 */

import { Hono } from 'hono';
import { config } from '../lib/config.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { canInjectGatewayToken } from '../lib/trust-utils.js';
import { getConnInfo } from '@hono/node-server/conninfo';

const app = new Hono();

app.get('/api/connect-defaults', rateLimitGeneral, (c) => {
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

  let remoteAddress: string | undefined;
  try {
    const info = getConnInfo(c);
    remoteAddress = info.remote.address;
  } catch {
    // getConnInfo may fail in test environments
  }

  return c.json({
    wsUrl,
    token: null, // Token injection moved server-side (ws-proxy.ts)
    agentName: config.agentName,
    authEnabled: config.auth,
    serverSideAuth: canInjectGatewayToken({
      socket: { remoteAddress },
      headers: c.req.header(),
    }),
  });
});

export default app;
