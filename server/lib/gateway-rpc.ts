/**
 * Shared gateway RPC client.
 *
 * Makes direct WebSocket RPC calls to the OpenClaw gateway for workspace
 * file access. Uses a single persistent connection that multiplexes all
 * RPC calls, avoiding the overhead and session conflicts of per-request
 * connections.
 *
 * Used as a fallback when the workspace directory is not locally accessible
 * (e.g. Nerve on DGX host, workspace in OpenShell sandbox).
 * @module
 */

import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { config } from './config.js';
import { createDeviceBlock } from './device-identity.js';

// ── Types ────────────────────────────────────────────────────────────

export interface GatewayFileEntry {
  name: string;
  path: string;
  missing: boolean;
  size: number;
  updatedAtMs: number;
}

export interface GatewayFileWithContent extends GatewayFileEntry {
  content: string;
}

// ── Persistent connection ────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10_000;
const RECONNECT_DELAY_MS = 3_000;

/** Derive the WebSocket URL from the HTTP gateway URL. */
function getGatewayWsUrl(): string {
  const httpUrl = config.gatewayUrl;
  let wsUrl: string;
  if (httpUrl.startsWith('ws://') || httpUrl.startsWith('wss://')) {
    wsUrl = httpUrl;
  } else {
    wsUrl = httpUrl.replace(/^http/, 'ws');
  }
  if (!wsUrl.endsWith('/ws')) {
    wsUrl = wsUrl.replace(/\/$/, '') + '/ws';
  }
  return wsUrl;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let ws: WebSocket | null = null;
let connected = false;
let connecting = false;
const pending = new Map<string, PendingCall>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectPromise: Promise<void> | null = null;
let connectResolve: (() => void) | null = null;
let connectReject: ((err: Error) => void) | null = null;

function buildConnectParams(nonce: string) {
  const clientId = 'openclaw-control-ui';
  const clientMode = 'webchat';
  const role = 'operator';
  const scopes = ['operator.admin', 'operator.read', 'operator.write'];
  const token = config.gatewayToken;

  return {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: clientId,
      version: '0.1.0',
      platform: 'web',
      mode: clientMode,
      instanceId: `nerve-rpc-${randomUUID().slice(0, 8)}`,
    },
    role,
    scopes,
    auth: { token },
    device: createDeviceBlock({
      clientId,
      clientMode,
      role,
      scopes,
      token,
      nonce,
    }),
  };
}

/** Send a raw message, ensuring the connection is ready. */
function wsSend(data: string): boolean {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(data);
    return true;
  }
  return false;
}

/** Clean up all pending calls with an error. */
function rejectAllPending(reason: string): void {
  for (const [id, call] of pending) {
    clearTimeout(call.timer);
    call.reject(new Error(reason));
    pending.delete(id);
  }
}

/** Reject and clear the in-flight connect promise. */
function rejectConnect(reason: string): void {
  if (connectReject) {
    connectReject(new Error(reason));
  }
  connectPromise = null;
  connectResolve = null;
  connectReject = null;
}

/** Establish the persistent gateway connection. */
function ensureConnection(): void {
  if (ws || connecting) return;
  if (!config.gatewayToken) return; // No token = can't connect

  connecting = true;
  connectPromise = new Promise<void>((resolve, reject) => {
    connectResolve = resolve;
    connectReject = reject;
  });
  const wsUrl = getGatewayWsUrl();

  const socket = new WebSocket(wsUrl, {
    headers: { Origin: `http://127.0.0.1:${config.port}` },
  });

  socket.on('open', () => {
    // Wait for connect.challenge
  });

  socket.on('message', (data: Buffer | string) => {
    try {
      const msg = JSON.parse(data.toString());

      // Handle connect.challenge → send connect
      if (msg.type === 'event' && msg.event === 'connect.challenge' && msg.payload?.nonce) {
        socket.send(JSON.stringify({
          type: 'req',
          id: '__connect__',
          method: 'connect',
          params: buildConnectParams(msg.payload.nonce),
        }));
        return;
      }

      // Handle connect response
      if (msg.type === 'res' && msg.id === '__connect__') {
        connecting = false;
        if (msg.ok) {
          ws = socket;
          connected = true;
          if (connectResolve) {
            connectResolve();
          }
          connectResolve = null;
          connectReject = null;
          console.log('[gateway-rpc] Connected to gateway (persistent)');
        } else {
          const reason = msg.error?.message || 'Gateway connect rejected';
          console.error('[gateway-rpc] Gateway connect rejected:', reason);
          rejectConnect(reason);
          socket.close();
        }
        return;
      }

      // Handle RPC responses
      if (msg.type === 'res' && pending.has(msg.id)) {
        const call = pending.get(msg.id)!;
        pending.delete(msg.id);
        clearTimeout(call.timer);
        if (msg.ok === false) {
          call.reject(new Error(msg.error?.message || 'RPC error'));
        } else {
          call.resolve(msg.payload ?? msg.result ?? msg);
        }
        return;
      }

      // Ignore other events (chat messages, etc.)
    } catch {
      // Ignore parse errors
    }
  });

  socket.on('error', (err) => {
    console.warn('[gateway-rpc] WebSocket error:', err.message);
  });

  socket.on('close', () => {
    const wasConnected = connected;
    const wasConnecting = connecting;
    ws = null;
    connected = false;
    connecting = false;

    if (!wasConnected && wasConnecting) {
      rejectConnect('Gateway connection closed before connect completed');
    } else {
      connectPromise = null;
      connectResolve = null;
      connectReject = null;
    }

    rejectAllPending('Gateway connection closed');

    // Auto-reconnect after a delay (only if we had a working connection)
    if (wasConnected && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        ensureConnection();
      }, RECONNECT_DELAY_MS);
    }
  });
}

// ── Core RPC call ────────────────────────────────────────────────────

/**
 * Execute a gateway RPC call via the persistent WebSocket connection.
 */
export async function gatewayRpcCall(
  method: string,
  params: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  // Ensure connection exists
  ensureConnection();

  // Wait for connection if not yet connected
  if (!connected && connectPromise) {
    await connectPromise;
  }

  return new Promise((resolve, reject) => {
    const reqId = randomUUID();

    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error(`Gateway RPC timeout after ${timeoutMs}ms calling ${method}`));
    }, timeoutMs);

    pending.set(reqId, { resolve, reject, timer });

    const sent = wsSend(JSON.stringify({ type: 'req', id: reqId, method, params }));
    if (!sent) {
      pending.delete(reqId);
      clearTimeout(timer);
      reject(new Error('Gateway connection not ready'));
    }
  });
}

// ── Typed file RPC wrappers ──────────────────────────────────────────

/**
 * List top-level workspace files for an agent via gateway RPC.
 */
export async function gatewayFilesList(agentId: string): Promise<GatewayFileEntry[]> {
  const result = await gatewayRpcCall('agents.files.list', { agentId }) as {
    files?: GatewayFileEntry[];
  };
  return result.files ?? [];
}

/**
 * Read a top-level workspace file via gateway RPC.
 * Returns null if the file is not found or unsupported.
 *
 * Gateway response shape: `{ agentId, workspace, file: { name, content, ... } }`
 */
export async function gatewayFilesGet(agentId: string, name: string): Promise<GatewayFileWithContent | null> {
  try {
    const result = await gatewayRpcCall('agents.files.get', { agentId, name }) as {
      file?: GatewayFileWithContent;
    } & GatewayFileWithContent;
    const file = result.file ?? result;
    if (!file || file.missing) return null;
    return file;
  } catch (err) {
    console.debug('[gateway-rpc] filesGet error:', (err as Error).message);
    return null;
  }
}

/**
 * Write a top-level workspace file via gateway RPC.
 */
export async function gatewayFilesSet(agentId: string, name: string, content: string): Promise<void> {
  await gatewayRpcCall('agents.files.set', { agentId, name, content });
}
