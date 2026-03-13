/**
 * WebSocket proxy — bridges browser clients to the OpenClaw gateway.
 *
 * Clients connect to `ws(s)://host:port/ws?target=<gateway-ws-url>` and this
 * module opens a corresponding connection to the gateway, relaying messages
 * bidirectionally. During the connect handshake, injects Nerve's Ed25519-signed
 * device identity so the gateway grants operator.read/write scopes.
 *
 * On the first ever connection the gateway creates a pending pairing request.
 * The user must approve it once via `openclaw devices approve <requestId>`.
 * If the device is rejected for any reason, the proxy retries without device
 * identity — the browser still connects but with reduced (token-only) scopes.
 * @module
 */

import type { Server as HttpsServer } from 'node:https';
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, WS_ALLOWED_HOSTS, SESSION_COOKIE_NAME } from './config.js';
import { verifySession, parseSessionCookie } from './session.js';
import { createDeviceBlock, getDeviceIdentity } from './device-identity.js';
import { resolveOpenclawBin } from './openclaw-bin.js';
import { canInjectGatewayToken } from './trust-utils.js';

/** @internal — exported for test overrides */
export const _internals = { challengeTimeoutMs: 5_000 };

/**
 * Methods the gateway restricts for webchat clients.
 * We intercept these and proxy via `openclaw gateway call` (full CLI scopes).
 */
const RESTRICTED_METHODS = new Set([
  'sessions.patch',
  'sessions.delete',
  'sessions.reset',
  'sessions.compact',
]);

/**
 * Execute a gateway RPC call via the CLI, bypassing webchat restrictions.
 */
function gatewayCall(method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bin = resolveOpenclawBin();
    const args = ['gateway', 'call', method, '--params', JSON.stringify(params)];
    // Ensure nvm/fnm/volta node is in PATH for #!/usr/bin/env node shebangs
    const nodeBinDir = dirname(process.execPath);
    const existingPath = process.env.PATH;
    const env = { ...process.env, PATH: existingPath ? `${nodeBinDir}:${existingPath}` : nodeBinDir };
    execFile(bin, args, { timeout: 10_000, maxBuffer: 1024 * 1024, env }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ ok: true, raw: stdout.trim() });
      }
    });
  });
}

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
    const connId = randomUUID().slice(0, 8);
    const tag = `[ws-proxy:${connId}]`;
    const url = new URL(req.url || '/', 'https://localhost');
    const target = url.searchParams.get('target');

    console.log(`${tag} New connection: target=${target}`);

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
      console.warn(`${tag} Rejected: target not allowed: ${target}`);
      clientWs.close(1008, 'Target not allowed');
      return;
    }

    const targetPort = Number(targetUrl.port) || (targetUrl.protocol === 'wss:' ? 443 : 80);
    if (targetPort < 1 || targetPort > 65535) {
      console.warn(`${tag} Rejected: invalid port ${targetPort}`);
      clientWs.close(1008, 'Invalid target port');
      return;
    }

    const isEncrypted = !!(req.socket as unknown as { encrypted?: boolean }).encrypted;
    const scheme = isEncrypted ? 'https' : 'http';
    const clientOrigin = req.headers.origin || `${scheme}://${req.headers.host}`;

    // Determine if the client is trusted enough for token injection.
    // canInjectGatewayToken accounts for both auth state and loopback detection (proxy-aware).
    const isTrusted = canInjectGatewayToken(req);

    createGatewayRelay(clientWs, targetUrl, clientOrigin, connId, isTrusted);
  });
}

/**
 * Create a relay between a browser WebSocket and the gateway.
 *
 * Injects Nerve's device identity into the connect handshake for full
 * operator scopes. The connect message is held until the gateway sends a
 * `connect.challenge` nonce so that device identity can always be injected.
 * If the nonce doesn't arrive within `_internals.challengeTimeoutMs`, the
 * connect message is sent without identity (graceful degradation).
 *
 * If the gateway rejects the device (pairing required, token mismatch),
 * transparently retries without device identity.
 */
function createGatewayRelay(
  clientWs: WebSocket,
  targetUrl: URL,
  clientOrigin: string,
  connId: string,
  isTrusted: boolean,
): void {
  const tag = `[ws-proxy:${connId}]`;
  const connStartTime = Date.now();
  let clientToGatewayCount = 0;
  let gatewayToClientCount = 0;

  // ─── Keepalive: ping both sides every 30s, kill dead connections ────────
  const PING_INTERVAL = 30_000;
  let clientAlive = true;
  let gatewayAlive = true;

  clientWs.on('pong', () => { clientAlive = true; });

  const pingTimer = setInterval(() => {
    // Check client
    if (!clientAlive) {
      console.log(`${tag} Client pong timeout — terminating`);
      clientWs.terminate();
      return;
    }
    clientAlive = false;
    if (clientWs.readyState === WebSocket.OPEN) clientWs.ping();

    // Check gateway
    if (gwWs && !gatewayAlive) {
      console.log(`${tag} Gateway pong timeout — terminating`);
      gwWs.terminate();
      return;
    }
    gatewayAlive = false;
    if (gwWs?.readyState === WebSocket.OPEN) gwWs.ping();
  }, PING_INTERVAL);

  let gwWs: WebSocket;
  let challengeNonce: string | null = null;
  let handshakeComplete = false;
  let useDeviceIdentity = true;
  let hasRetried = false;
  /** Saved connect message — held separately from pending until challenge arrives */
  let savedConnectMsg: Record<string, unknown> | null = null;
  /** Whether the saved connect message has been dispatched to the gateway */
  let connectSent = false;
  /** Timeout handle for challenge nonce deadline */
  let challengeTimer: ReturnType<typeof setTimeout> | null = null;

  // Buffer client messages until gateway connection is open (with cap)
  const MAX_PENDING = 100;
  const MAX_BYTES = 1024 * 1024; // 1 MB
  let pending: { data: Buffer | string; isBinary: boolean }[] = [];
  let pendingBytes = 0;

  /** Queue a client message for deferred forwarding. Returns false if limits exceeded. */
  function enqueuePending(data: Buffer | string, isBinary: boolean): boolean {
    const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
    if (pending.length >= MAX_PENDING || pendingBytes + size > MAX_BYTES) {
      return false;
    }
    pendingBytes += size;
    pending.push({ data, isBinary });
    return true;
  }

  /** Flush buffered messages to gateway in FIFO order. */
  function flushPending(): void {
    if (!gwWs || gwWs.readyState !== WebSocket.OPEN) return;
    for (const msg of pending) {
      gwWs.send(msg.isBinary ? msg.data : msg.data.toString());
    }
    pending = [];
    pendingBytes = 0;
  }

  /** Clear the challenge nonce timeout if active. */
  function clearChallengeTimer(): void {
    if (challengeTimer) {
      clearTimeout(challengeTimer);
      challengeTimer = null;
    }
  }

  /**
   * Dispatch the saved connect message to the gateway.
   * Injects device identity when `useDeviceIdentity` is true and a nonce is available.
   */
  function dispatchConnect(nonce: string | null): void {
    if (!savedConnectMsg || connectSent) return;
    if (gwWs.readyState !== WebSocket.OPEN) return;
    connectSent = true;
    clearChallengeTimer();

    let modified = savedConnectMsg;
    // Inject gateway token proxy-side for trusted clients if not provided by browser
    if (isTrusted && config.gatewayToken && !(modified.params as ConnectParams)?.auth?.token) {
      modified = {
        ...modified,
        params: {
          ...(modified.params as object),
          auth: {
            ...((modified.params as ConnectParams)?.auth as object),
            token: config.gatewayToken,
          },
        },
      };
    }

    const final = (useDeviceIdentity && nonce)
      ? injectDeviceIdentity(modified, nonce)
      : modified;

    gwWs.send(JSON.stringify(final));
    handshakeComplete = true;
    flushPending();
  }

  /** Start a deadline timer — sends connect without identity on expiry. */
  function startChallengeDeadline(): void {
    clearChallengeTimer();
    challengeTimer = setTimeout(() => {
      console.log('[ws-proxy] Challenge nonce timeout — sending connect without device identity');
      dispatchConnect(null);
    }, _internals.challengeTimeoutMs);
  }

  function openGateway(): void {
    gatewayAlive = true;
    challengeNonce = null;
    handshakeComplete = false;
    connectSent = false;
    clearChallengeTimer();

    gwWs = new WebSocket(targetUrl.toString(), {
      headers: { Origin: clientOrigin },
    });

    gwWs.on('pong', () => { gatewayAlive = true; });

    // Gateway → Client
    gwWs.on('message', (data: Buffer | string, isBinary: boolean) => {
      // Capture challenge nonce before handshake completes
      if (!handshakeComplete && !isBinary) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'event' && msg.event === 'connect.challenge' && msg.payload?.nonce) {
            challengeNonce = msg.payload.nonce;
            // If we have a deferred connect message waiting, send it now with identity
            if (savedConnectMsg && !connectSent && gwWs.readyState === WebSocket.OPEN) {
              dispatchConnect(challengeNonce);
            }
          }
        } catch { /* ignore */ }
      }

      if (clientWs.readyState === WebSocket.OPEN) {
        gatewayToClientCount++;
        clientWs.send(isBinary ? data : data.toString());
      }
    });

    gwWs.on('open', () => {
      // Handle deferred connect message first. Non-connect pending messages are
      // flushed only after connect is dispatched to preserve protocol ordering.
      if (savedConnectMsg && !connectSent) {
        if (hasRetried) {
          // Retry path — send immediately without device identity
          dispatchConnect(null);
        } else if (challengeNonce) {
          // Challenge already arrived — send with identity
          dispatchConnect(challengeNonce);
        } else {
          // Wait for challenge nonce; timeout sends without identity (graceful degradation)
          startChallengeDeadline();
        }
      } else {
        // No deferred connect waiting — safe to flush pending traffic immediately.
        flushPending();
      }
    });

    gwWs.on('error', (err) => {
      console.error(`${tag} Gateway error:`, err.message);
      clearChallengeTimer();
      if (!hasRetried || handshakeComplete) clientWs.close();
    });

    gwWs.on('close', (code, reason) => {
      const reasonStr = reason?.toString() || '';
      console.log(`${tag} Gateway closed: code=${code}, reason=${reasonStr}`);
      clearChallengeTimer();

      // Device auth rejected — retry without device identity
      const isDeviceRejection = code === 1008 && (
        reasonStr.includes('device token mismatch') ||
        reasonStr.includes('device signature invalid') ||
        reasonStr.includes('unknown device') ||
        reasonStr.includes('pairing required')
      );

      if (useDeviceIdentity && !hasRetried && isDeviceRejection && clientWs.readyState === WebSocket.OPEN) {
        console.log(`${tag} Device rejected (${reasonStr}) — retrying without device identity`);
        useDeviceIdentity = false;
        hasRetried = true;
        openGateway();
        return;
      }

      clientWs.close();
    });
  }

  // Client → Gateway (attached once, references mutable gwWs)
  clientWs.on('message', (data: Buffer | string, isBinary: boolean) => {
    if (!gwWs || gwWs.readyState !== WebSocket.OPEN) {
      // Gateway not open — intercept connect messages and hold them separately
      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'req' && msg.method === 'connect' && msg.params) {
            savedConnectMsg = msg;
            return; // Do NOT add to pending buffer
          }
        } catch { /* pass through */ }
      }

      if (!enqueuePending(data, isBinary)) {
        clientWs.close(1008, 'Too many pending messages');
        return;
      }
      return;
    }

    // Gateway is open, but if connect is still deferred, queue non-connect
    // traffic until connect is dispatched.
    if (!handshakeComplete && savedConnectMsg && !connectSent) {
      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'req' && msg.method === 'connect' && msg.params) {
            // Last-write-wins if multiple connect frames arrive before dispatch.
            savedConnectMsg = msg;
            if (challengeNonce) {
              dispatchConnect(challengeNonce);
            } else {
              startChallengeDeadline();
            }
            return;
          }
        } catch { /* pass through to pending queue */ }
      }

      if (!enqueuePending(data, isBinary)) {
        clientWs.close(1008, 'Too many pending messages');
      }
      return;
    }

    // Gateway is open — parse message for interception
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString());

        // Intercept connect request — defer until challenge nonce arrives
        if (!handshakeComplete && msg.type === 'req' && msg.method === 'connect' && msg.params) {
          savedConnectMsg = msg;
          if (challengeNonce) {
            dispatchConnect(challengeNonce);
          } else {
            startChallengeDeadline();
          }
          return;
        }

        // Intercept restricted RPC methods — proxy via CLI (full scopes)
        if (msg.type === 'req' && RESTRICTED_METHODS.has(msg.method)) {
          const reqId = msg.id;
          gatewayCall(msg.method, msg.params || {})
            .then((result) => {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: 'res', id: reqId, ok: true, payload: result }));
              }
            })
            .catch((err) => {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                  type: 'res',
                  id: reqId,
                  ok: false,
                  error: { code: -32000, message: (err as Error).message },
                }));
              }
            });
          return;
        }
      } catch { /* pass through */ }
    }

    clientToGatewayCount++;
    gwWs.send(isBinary ? data : data.toString());
  });

  clientWs.on('close', (code, reason) => {
    clearInterval(pingTimer);
    clearChallengeTimer();
    const duration = Date.now() - connStartTime;
    console.log(`${tag} Client closed: code=${code}, reason=${reason?.toString()}`);
    console.log(`${tag} Summary: duration=${duration}ms, client->gw=${clientToGatewayCount}, gw->client=${gatewayToClientCount}`);
    if (gwWs) gwWs.close();
  });
  clientWs.on('error', (err) => {
    clearInterval(pingTimer);
    clearChallengeTimer();
    console.error(`${tag} Client error:`, err.message);
    if (gwWs) gwWs.close();
  });

  openGateway();
}

/**
 * Inject Nerve's device identity into a connect request.
 */
interface ConnectParams {
  client?: { id?: string; mode?: string; instanceId?: string; [key: string]: unknown };
  role?: string;
  scopes?: string[];
  auth?: { token?: string };
}

function injectDeviceIdentity(msg: Record<string, unknown>, nonce: string, logTag = '[ws-proxy]'): Record<string, unknown> {
  const params = (msg.params || {}) as ConnectParams;
  const clientId = params.client?.id || 'nerve-ui';
  const clientMode = params.client?.mode || 'webchat';
  const role = params.role || 'operator';
  const scopes = params.scopes || ['operator.admin', 'operator.read', 'operator.write'];
  const token = params.auth?.token || '';

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

  console.log(`${logTag} Injected device identity: ${device.id.substring(0, 12)}...`);

  return {
    ...msg,
    params: {
      ...params,
      scopes: finalScopes,
      device,
    },
  };
}
