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
import { randomUUID } from 'node:crypto';
import { config, WS_ALLOWED_HOSTS, SESSION_COOKIE_NAME } from './config.js';
import { verifySession, parseSessionCookie } from './session.js';
import { createDeviceBlock, getDeviceIdentity } from './device-identity.js';
import { gatewayRpcCall } from './gateway-rpc.js';
import { canInjectGatewayToken } from './trust-utils.js';
import { isAllowedOrigin } from './origin-utils.js';
import { getTelemetryRuntime } from './telemetry/runtime.js';

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
const CONTROL_UI_CLIENT_ID = 'openclaw-control-ui';
const ROOT_SESSION_KEY_RE = /^agent:[^:]+:main$/;

interface PendingRequest {
  method: string;
  sessionKey?: string;
  sentAt: number;
  markSessionsFeatureUsedOnSuccess?: boolean;
  clearSessionSeenOnSuccess?: boolean;
}

interface PendingTool {
  runId?: string;
  sessionKey?: string;
  toolCallId: string;
  toolName: string;
  startedAt: number;
}

/**
 * Execute a gateway RPC call, bypassing webchat restrictions.
 * Delegates to the shared gateway-rpc module.
 */
function gatewayCall(method: string, params: Record<string, unknown>): Promise<unknown> {
  return gatewayRpcCall(method, params);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function runInBackground(work: Promise<unknown>): void {
  void work.catch(() => {});
}

function isRootSessionKey(sessionKey: string | undefined): sessionKey is string {
  return !!sessionKey && ROOT_SESSION_KEY_RE.test(sessionKey);
}

function extractSessionKey(params: unknown): string | undefined {
  if (!isRecord(params)) return undefined;
  const sessionKey = params.sessionKey ?? params.key;
  return typeof sessionKey === 'string' ? sessionKey : undefined;
}

function requestBootstrapsRootSession(method: string, params: unknown): boolean {
  if (method !== 'sessions.patch' || !isRecord(params)) {
    return false;
  }

  const sessionKey = extractSessionKey(params);
  return isRootSessionKey(sessionKey)
    && Object.prototype.hasOwnProperty.call(params, 'label')
    && (
      Object.prototype.hasOwnProperty.call(params, 'model')
      || Object.prototype.hasOwnProperty.call(params, 'thinkingLevel')
    );
}

function requestChangesSessionLabel(method: string, params: unknown): boolean {
  return method === 'sessions.patch'
    && isRecord(params)
    && Object.prototype.hasOwnProperty.call(params, 'label')
    && !requestBootstrapsRootSession(method, params);
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
      const originHeader = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
      if (!isAllowedOrigin(originHeader)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nOrigin not allowed');
        socket.destroy();
        return;
      }

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
    const clientOrigin = (Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin)
      || `${scheme}://${req.headers.host}`;

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
  /** Whether this connection is using the privileged OpenClaw control UI client id */
  let isControlUiClient = false;
  /** Timeout handle for challenge nonce deadline */
  let challengeTimer: ReturnType<typeof setTimeout> | null = null;

  // Buffer client messages until gateway connection is open (with cap)
  const MAX_PENDING = 100;
  const MAX_BYTES = 1024 * 1024; // 1 MB
  let pending: { data: Buffer | string; isBinary: boolean }[] = [];
  let pendingBytes = 0;
  const pendingRequests = new Map<string, PendingRequest>();
  const pendingTools = new Map<string, PendingTool>();

  function recordMessageSubmitted(request: PendingRequest): void {
    const telemetry = getTelemetryRuntime();
    if (!telemetry) return;

    runInBackground((async () => {
      await telemetry.recordMessageSubmitted({
        sessionKey: request.sessionKey,
        surface: 'chat',
        occurredAt: request.sentAt,
      });

      const sessionKey = request.sessionKey;
      if (!isRootSessionKey(sessionKey)) {
        return;
      }

      const seen = await telemetry.markSessionSeen(sessionKey);
      if (!seen.firstSeen) {
        return;
      }

      await telemetry.recordSessionCreated({
        sessionKey,
        surface: 'sessions',
        explicit: false,
        occurredAt: request.sentAt,
      });
    })());
  }

  function markSessionsFeatureUsed(): void {
    const telemetry = getTelemetryRuntime();
    if (!telemetry) return;
    runInBackground(telemetry.markFeatureUsed('sessions'));
  }

  function clearRootSessionSeen(sessionKey: string | undefined): void {
    const telemetry = getTelemetryRuntime();
    if (!telemetry || !isRootSessionKey(sessionKey)) {
      return;
    }

    runInBackground(telemetry.clearSessionSeen(sessionKey));
  }

  function recordToolCompleted(entry: PendingTool, success: boolean): void {
    const telemetry = getTelemetryRuntime();
    if (!telemetry) return;

    const finishedAt = Date.now();
    runInBackground(telemetry.recordToolCompleted({
      toolName: entry.toolName,
      success,
      startedAt: entry.startedAt,
      finishedAt,
      occurredAt: finishedAt,
      surface: 'chat',
    }));
  }

  function getPendingToolKey(
    runId: string | undefined,
    toolCallId: string,
    sessionKey?: string,
  ): string {
    // When runId is absent (some gateways omit it), include sessionKey in the
    // key so the same toolCallId across different sessions does not collide.
    if (runId) return `${runId}\u0000${toolCallId}`;
    return `\u0000${sessionKey ?? ''}\u0000${toolCallId}`;
  }

  function resolvePendingToolKey(options: {
    runId?: string;
    sessionKey?: string;
    toolCallId: string;
  }): string | undefined {
    if (options.runId) {
      const directKey = getPendingToolKey(options.runId, options.toolCallId, options.sessionKey);
      if (pendingTools.has(directKey)) {
        return directKey;
      }
    }

    const matches = [...pendingTools.entries()].filter(([, entry]) => (
      entry.toolCallId === options.toolCallId
      && (!options.sessionKey || entry.sessionKey === options.sessionKey)
    ));

    if (matches.length === 0) {
      return undefined;
    }

    const runlessMatch = matches.find(([, entry]) => entry.runId === undefined);
    if (runlessMatch) {
      return runlessMatch[0];
    }

    if (matches.length === 1) {
      return matches[0]?.[0];
    }

    return undefined;
  }

  function flushPendingTools(
    success: boolean,
    predicate: (entry: PendingTool) => boolean = () => true,
  ): void {
    for (const [pendingToolKey, entry] of pendingTools.entries()) {
      if (!predicate(entry)) continue;
      pendingTools.delete(pendingToolKey);
      recordToolCompleted(entry, success);
    }
  }

  function flushPendingToolsForFailure(runId: string | undefined, sessionKey: string | undefined): void {
    if (runId) {
      flushPendingTools(false, (entry) => entry.runId === runId);
      return;
    }

    if (sessionKey) {
      flushPendingTools(false, (entry) => entry.sessionKey === sessionKey);
      return;
    }

    flushAllPendingTools(false);
  }

  function flushAllPendingTools(success: boolean): void {
    flushPendingTools(success);
  }

  function handleGatewayTelemetryFrame(message: Record<string, unknown>): void {
    if (message.type === 'res' && typeof message.id === 'string') {
      const request = pendingRequests.get(message.id);
      if (request) {
        pendingRequests.delete(message.id);
        if (message.ok === true) {
          if (request.method === 'chat.send') {
            recordMessageSubmitted(request);
          }
          if (request.markSessionsFeatureUsedOnSuccess) {
            markSessionsFeatureUsed();
          }
          if (request.clearSessionSeenOnSuccess) {
            clearRootSessionSeen(request.sessionKey);
          }
        }
      }
      return;
    }

    if (message.type === 'event' && message.event === 'agent' && isRecord(message.payload)) {
      const payload = message.payload;
      const runId = typeof payload.runId === 'string' ? payload.runId : undefined;
      const sessionKey = typeof payload.sessionKey === 'string' ? payload.sessionKey : undefined;
      const data = isRecord(payload.data) ? payload.data : null;
      if (payload.stream === 'tool' && data?.phase === 'start' && typeof data.toolCallId === 'string' && typeof data.name === 'string') {
        pendingTools.set(getPendingToolKey(runId, data.toolCallId, sessionKey), {
          runId,
          sessionKey,
          toolCallId: data.toolCallId,
          toolName: data.name,
          startedAt: Date.now(),
        });
        return;
      }

      if (payload.stream === 'tool' && data?.phase === 'result' && typeof data.toolCallId === 'string') {
        const pendingToolKey = resolvePendingToolKey({ runId, sessionKey, toolCallId: data.toolCallId });
        if (!pendingToolKey) return;
        const pendingTool = pendingTools.get(pendingToolKey);
        if (!pendingTool) return;
        pendingTools.delete(pendingToolKey);
        recordToolCompleted(pendingTool, true);
        return;
      }

      if (payload.stream === 'lifecycle' && (data?.phase === 'end' || data?.phase === 'error')) {
        flushPendingToolsForFailure(runId, sessionKey);
      }
      return;
    }

    if (message.type === 'event' && message.event === 'chat' && isRecord(message.payload)) {
      const payload = message.payload;
      if (payload.state === 'error' || payload.state === 'aborted') {
        flushPendingToolsForFailure(
          typeof payload.runId === 'string' ? payload.runId : undefined,
          typeof payload.sessionKey === 'string' ? payload.sessionKey : undefined,
        );
      }
    }
  }

  function trackPendingRequest(message: Record<string, unknown>): void {
    if (message.type !== 'req' || typeof message.id !== 'string' || typeof message.method !== 'string') {
      return;
    }

    const sessionKey = extractSessionKey(message.params);
    const markSessionsFeatureUsedOnSuccess = isControlUiClient
      && (requestChangesSessionLabel(message.method, message.params) || message.method === 'sessions.delete');
    const clearSessionSeenOnSuccess = isControlUiClient
      && (message.method === 'sessions.delete' || requestBootstrapsRootSession(message.method, message.params));

    if (message.method === 'chat.send' || markSessionsFeatureUsedOnSuccess || clearSessionSeenOnSuccess) {
      pendingRequests.set(message.id, {
        method: message.method,
        sessionKey,
        sentAt: Date.now(),
        markSessionsFeatureUsedOnSuccess,
        clearSessionSeenOnSuccess,
      });
    }
  }

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

  function updateClientKindFromConnect(msg: Record<string, unknown>): void {
    const params = (msg.params || {}) as ConnectParams;
    isControlUiClient = params.client?.id === CONTROL_UI_CLIENT_ID;
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
      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString()) as Record<string, unknown>;
          // Capture challenge nonce before handshake completes
          if (!handshakeComplete && msg.type === 'event' && msg.event === 'connect.challenge' && isRecord(msg.payload) && typeof msg.payload.nonce === 'string') {
            challengeNonce = msg.payload.nonce;
            // If we have a deferred connect message waiting, send it now with identity
            if (savedConnectMsg && !connectSent && gwWs.readyState === WebSocket.OPEN) {
              dispatchConnect(challengeNonce);
            }
          }

          handleGatewayTelemetryFrame(msg);
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
      flushAllPendingTools(false);
      if (!hasRetried || handshakeComplete) clientWs.close();
    });

    gwWs.on('close', (code, reason) => {
      const reasonStr = reason?.toString() || '';
      console.log(`${tag} Gateway closed: code=${code}, reason=${reasonStr}`);
      clearChallengeTimer();
      flushAllPendingTools(false);

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
          const msg = JSON.parse(data.toString()) as Record<string, unknown>;
          trackPendingRequest(msg);
          if (msg.type === 'req' && msg.method === 'connect' && msg.params) {
            savedConnectMsg = msg;
            updateClientKindFromConnect(msg);
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
          const msg = JSON.parse(data.toString()) as Record<string, unknown>;
          trackPendingRequest(msg);
          if (msg.type === 'req' && msg.method === 'connect' && msg.params) {
            // Last-write-wins if multiple connect frames arrive before dispatch.
            savedConnectMsg = msg;
            updateClientKindFromConnect(msg);
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
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        trackPendingRequest(msg);

        // Intercept connect request — defer until challenge nonce arrives
        if (!handshakeComplete && msg.type === 'req' && msg.method === 'connect' && msg.params) {
          savedConnectMsg = msg;
          updateClientKindFromConnect(msg);
          if (challengeNonce) {
            dispatchConnect(challengeNonce);
          } else {
            startChallengeDeadline();
          }
          return;
        }

        // Intercept restricted RPC methods for plain webchat clients only.
        // Control UI clients are allowed to call these directly on the gateway.
        if (msg.type === 'req' && typeof msg.method === 'string' && RESTRICTED_METHODS.has(msg.method) && !isControlUiClient) {
          const reqId = msg.id;
          const method = msg.method;
          const params = isRecord(msg.params) ? msg.params : {};
          gatewayCall(method, params)
            .then((result) => {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: 'res', id: reqId, ok: true, payload: result }));
              }
              if (requestChangesSessionLabel(method, params) || method === 'sessions.delete') {
                markSessionsFeatureUsed();
              }
              if (method === 'sessions.delete' || requestBootstrapsRootSession(method, params)) {
                clearRootSessionSeen(extractSessionKey(params));
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
    flushAllPendingTools(false);
    const duration = Date.now() - connStartTime;
    console.log(`${tag} Client closed: code=${code}, reason=${reason?.toString()}`);
    console.log(`${tag} Summary: duration=${duration}ms, client->gw=${clientToGatewayCount}, gw->client=${gatewayToClientCount}`);
    if (gwWs) gwWs.close();
  });
  clientWs.on('error', (err) => {
    clearInterval(pingTimer);
    clearChallengeTimer();
    flushAllPendingTools(false);
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
