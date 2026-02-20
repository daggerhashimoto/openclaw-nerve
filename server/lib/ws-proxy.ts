/**
 * WebSocket proxy — bridges browser clients to the OpenClaw gateway.
 *
 * Clients connect to `ws(s)://host:port/ws?target=<gateway-ws-url>` and this
 * module opens a corresponding connection to the gateway, relaying messages
 * bidirectionally. During the initial handshake it intercepts the
 * `connect.challenge` event and injects an Ed25519-signed device identity
 * block so the gateway grants `operator.read` / `operator.write` scopes.
 * @module
 */

import type { Server as HttpsServer } from 'node:https';
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { config, WS_ALLOWED_HOSTS, SESSION_COOKIE_NAME } from './config.js';
import { verifySession, parseSessionCookie } from './session.js';
import { createDeviceBlock, getDeviceIdentity } from './device-identity.js';

/** Active WSS instances — used for graceful shutdown */
const activeWssInstances: WebSocketServer[] = [];

/** Close all active WebSocket connections */
export function closeAllWebSockets(): void {
  for (const wss of activeWssInstances) {
    for (const client of wss.clients) client.close(1001, 'Server shutting down');
    wss.close();
  }
  activeWssInstances.length = 0;
}

/**
 * Set up the WS/WSS proxy on an HTTP or HTTPS server.
 * Proxies ws(s)://host:port/ws?target=ws://gateway/ws to the OpenClaw gateway.
 */
export function setupWebSocketProxy(server: HttpServer | HttpsServer): void {
  const wss = new WebSocketServer({ noServer: true });
  activeWssInstances.push(wss);

  // Eagerly load device identity at startup
  getDeviceIdentity();

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.startsWith('/ws')) {
      // Auth check for WebSocket connections
      if (config.auth) {
        const token = parseSessionCookie(req.headers.cookie, SESSION_COOKIE_NAME);
        if (!token || !verifySession(token, config.sessionSecret)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nAuthentication required');
          socket.destroy();
          return;
        }
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (clientWs: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '/', 'https://localhost');
    const target = url.searchParams.get('target');

    console.log(`[ws-proxy] New connection: target=${target}`);

    if (!target) {
      clientWs.close(1008, 'Missing ?target= param');
      return;
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(target);
    } catch {
      clientWs.close(1008, 'Invalid target URL');
      return;
    }

    if (!['ws:', 'wss:'].includes(targetUrl.protocol) || !WS_ALLOWED_HOSTS.has(targetUrl.hostname)) {
      console.warn(`[ws-proxy] Rejected: target not allowed: ${target}`);
      clientWs.close(1008, 'Target not allowed');
      return;
    }

    // Forward origin header for gateway auth
    const isEncrypted = !!(req.socket as unknown as { encrypted?: boolean }).encrypted;
    const scheme = isEncrypted ? 'https' : 'http';
    const clientOrigin = req.headers.origin || `${scheme}://${req.headers.host}`;

    // Delegate to the relay function (supports retry without device identity)
    relayToGateway(clientWs, targetUrl, clientOrigin, /* useDeviceIdentity */ true);
  });
}

/**
 * Relay a client WebSocket connection to the gateway.
 *
 * On the first attempt, injects device identity for full operator scopes.
 * If the gateway rejects with `device_token_mismatch` (device not paired),
 * automatically retries without device identity — falling back to plain
 * token auth. This ensures fresh installs work without manual pairing.
 */
function relayToGateway(
  clientWs: WebSocket,
  targetUrl: URL,
  clientOrigin: string,
  useDeviceIdentity: boolean,
): void {
  const gwWs = new WebSocket(targetUrl.toString(), {
    headers: { Origin: clientOrigin },
  });

  // State machine for connect handshake interception
  let challengeNonce: string | null = null;
  let handshakeComplete = false;

  // Track whether we're retrying (to avoid infinite loops)
  let retrying = false;

  // Store the original connect message for retry
  let savedConnectMsg: Record<string, unknown> | null = null;

  // Buffer client messages until gateway connection is open (with cap)
  const MAX_PENDING_MESSAGES = 100;
  const MAX_PENDING_BYTES = 1024 * 1024; // 1 MB
  const pendingMessages: { data: Buffer | string; isBinary: boolean }[] = [];
  let pendingBytes = 0;

  clientWs.on('message', (data: Buffer | string, isBinary: boolean) => {
    if (gwWs.readyState !== WebSocket.OPEN) {
      const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
      if (pendingMessages.length >= MAX_PENDING_MESSAGES || pendingBytes + size > MAX_PENDING_BYTES) {
        clientWs.close(1008, 'Too many pending messages');
        return;
      }
      pendingBytes += size;
      pendingMessages.push({ data, isBinary });
      return;
    }

    // Intercept connect request to inject device identity
    if (!handshakeComplete && !isBinary && challengeNonce) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'req' && msg.method === 'connect' && msg.params) {
          // Save original connect message for potential retry
          savedConnectMsg = msg;
          const modified = useDeviceIdentity ? injectDeviceIdentity(msg, challengeNonce) : msg;
          gwWs.send(JSON.stringify(modified));
          handshakeComplete = true;
          return;
        }
      } catch {
        // Not JSON or parse error — pass through
      }
    }

    gwWs.send(isBinary ? data : data.toString());
  });

  // Register gateway→client relay IMMEDIATELY (before open) to avoid
  // dropping messages that arrive between readyState=OPEN and the 'open' callback.
  gwWs.on('message', (data: Buffer | string, isBinary: boolean) => {
    // Intercept connect.challenge to capture nonce
    if (!handshakeComplete && !isBinary) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'event' && msg.event === 'connect.challenge' && msg.payload?.nonce) {
          challengeNonce = msg.payload.nonce;
        }
      } catch { /* ignore */ }
    }

    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(isBinary ? data : data.toString());
    }
  });

  gwWs.on('open', () => {
    // Flush buffered messages
    for (const msg of pendingMessages) {
      // Check for connect request in buffered messages too
      if (!handshakeComplete && !msg.isBinary && challengeNonce) {
        try {
          const parsed = JSON.parse(msg.data.toString());
          if (parsed.type === 'req' && parsed.method === 'connect' && parsed.params) {
            savedConnectMsg = parsed;
            const modified = useDeviceIdentity ? injectDeviceIdentity(parsed, challengeNonce) : parsed;
            gwWs.send(JSON.stringify(modified));
            handshakeComplete = true;
            continue;
          }
        } catch { /* pass through */ }
      }
      gwWs.send(msg.isBinary ? msg.data : msg.data.toString());
    }
    pendingMessages.length = 0;
  });

  gwWs.on('error', (err) => {
    console.error('[ws-proxy] Gateway error:', err.message);
    if (!retrying) clientWs.close();
  });

  gwWs.on('close', (code, reason) => {
    const reasonStr = reason?.toString() || '';
    console.log(`[ws-proxy] Gateway closed: code=${code}, reason=${reasonStr}`);

    // If rejected for device_token_mismatch and we haven't retried yet,
    // reconnect without device identity (plain token auth fallback)
    if (
      useDeviceIdentity &&
      !retrying &&
      code === 1008 &&
      reasonStr.includes('device token mismatch') &&
      clientWs.readyState === WebSocket.OPEN
    ) {
      retrying = true;
      console.log('[ws-proxy] Device not paired — retrying without device identity (plain token auth)');
      relayToGateway(clientWs, targetUrl, clientOrigin, /* useDeviceIdentity */ false);
      return;
    }

    clientWs.close();
  });

  clientWs.on('close', (code, reason) => {
    console.log(`[ws-proxy] Client closed: code=${code}, reason=${reason?.toString()}`);
    gwWs.close();
  });
  clientWs.on('error', (err) => {
    console.error('[ws-proxy] Client error:', err.message);
    gwWs.close();
  });
}

/**
 * Inject Nerve's device identity into a connect request.
 * This adds the `device` block with Ed25519 signature so the gateway
 * grants operator.read/operator.write scopes.
 */
interface ConnectParams {
  client?: { id?: string; mode?: string };
  role?: string;
  scopes?: string[];
  auth?: { token?: string };
}

function injectDeviceIdentity(msg: Record<string, unknown>, nonce: string): Record<string, unknown> {
  const params = (msg.params || {}) as ConnectParams;
  const clientId = params.client?.id || 'webchat-ui';
  const clientMode = params.client?.mode || 'webchat';
  const role = params.role || 'operator';
  const scopes = params.scopes || ['operator.admin', 'operator.read', 'operator.write'];
  const token = params.auth?.token || '';

  // Ensure scopes include read/write
  const scopeSet = new Set(scopes);
  scopeSet.add('operator.read');
  scopeSet.add('operator.write');
  const finalScopes = [...scopeSet] as string[];

  const device = createDeviceBlock({
    clientId,
    clientMode,
    role,
    scopes: finalScopes,
    token,
    nonce,
  });

  console.log(`[ws-proxy] Injected device identity: ${device.id.substring(0, 12)}…`);

  return {
    ...msg,
    params: {
      ...params,
      scopes: finalScopes,
      device,
    },
  };
}
