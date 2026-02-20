/**
 * WebSocket proxy — bridges browser clients to the OpenClaw gateway.
 *
 * Clients connect to `ws(s)://host:port/ws?target=<gateway-ws-url>` and this
 * module opens a corresponding connection to the gateway, relaying messages
 * bidirectionally. The browser sends the gateway token in its connect request;
 * the proxy forwards it as-is. Since the proxy always connects to the gateway
 * on 127.0.0.1, no device identity / pairing is needed.
 * @module
 */

import type { Server as HttpsServer } from 'node:https';
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { config, WS_ALLOWED_HOSTS, SESSION_COOKIE_NAME } from './config.js';
import { verifySession, parseSessionCookie } from './session.js';

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

    relayToGateway(clientWs, targetUrl, clientOrigin);
  });
}

/**
 * Simple bidirectional relay between a browser WebSocket and the gateway.
 * Messages are buffered until the gateway connection is open, then flushed.
 */
function relayToGateway(
  clientWs: WebSocket,
  targetUrl: URL,
  clientOrigin: string,
): void {
  const gwWs = new WebSocket(targetUrl.toString(), {
    headers: { Origin: clientOrigin },
  });

  // Buffer client messages until gateway connection is open (with cap)
  const MAX_PENDING = 100;
  const MAX_BYTES = 1024 * 1024; // 1 MB
  const pending: { data: Buffer | string; isBinary: boolean }[] = [];
  let pendingBytes = 0;

  // Client → Gateway
  clientWs.on('message', (data: Buffer | string, isBinary: boolean) => {
    if (gwWs.readyState !== WebSocket.OPEN) {
      const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
      if (pending.length >= MAX_PENDING || pendingBytes + size > MAX_BYTES) {
        clientWs.close(1008, 'Too many pending messages');
        return;
      }
      pendingBytes += size;
      pending.push({ data, isBinary });
      return;
    }
    gwWs.send(isBinary ? data : data.toString());
  });

  // Gateway → Client
  gwWs.on('message', (data: Buffer | string, isBinary: boolean) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(isBinary ? data : data.toString());
    }
  });

  gwWs.on('open', () => {
    for (const msg of pending) {
      gwWs.send(msg.isBinary ? msg.data : msg.data.toString());
    }
    pending.length = 0;
    pendingBytes = 0;
  });

  gwWs.on('error', (err) => {
    console.error('[ws-proxy] Gateway error:', err.message);
    clientWs.close();
  });

  gwWs.on('close', (code, reason) => {
    console.log(`[ws-proxy] Gateway closed: code=${code}, reason=${reason?.toString()}`);
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
