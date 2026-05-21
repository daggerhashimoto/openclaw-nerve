/**
 * Server-Sent Events (SSE) endpoint for real-time push updates.
 *
 * GET  /api/events      — SSE stream for real-time updates
 * POST /api/events/test — Debug: broadcast a test event
 *
 * Event types:
 * - memory.changed  — Memory file was modified
 * - tokens.updated  — Token usage changed
 * - status.changed  — Gateway status changed
 * - ping            — Keep-alive (every 30s)
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { BoundedSSEWriter } from '../lib/sse-backpressure.js';

const app = new Hono();

// ── Broadcaster (singleton) ──────────────────────────────────────────

export interface SSEEvent {
  event: string;
  data: unknown;
  ts: number;
}

class SSEBroadcaster extends EventEmitter {
  private static instance: SSEBroadcaster;

  private constructor() {
    super();
    this.setMaxListeners(100); // one per connected client
  }

  static getInstance(): SSEBroadcaster {
    if (!SSEBroadcaster.instance) {
      SSEBroadcaster.instance = new SSEBroadcaster();
    }
    return SSEBroadcaster.instance;
  }

  broadcast(event: string, data: unknown = {}): void {
    this.emit('message', { event, data, ts: Date.now() } satisfies SSEEvent);
  }
}

export const broadcaster = SSEBroadcaster.getInstance();

/** Convenience: broadcast an event to all connected SSE clients. */
export function broadcast(event: string, data: unknown = {}): void {
  broadcaster.broadcast(event, data);
}

// ── SSE stream ───────────────────────────────────────────────────────

const PING_INTERVAL_MS = 30_000;

/** Track active SSE client connections. Exported for testing. */
export const _sseClients = new Map<string, { connectedAt: number }>();

app.get('/api/events', async (c) => {
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no');

  return streamSSE(c, async (stream) => {
    const clientId = randomUUID().slice(0, 8);
    const tag = `[sse:${clientId}]`;
    let connected = true;
    let resolveDisconnect: (() => void) | undefined;
    let writer: BoundedSSEWriter | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    _sseClients.set(clientId, { connectedAt: Date.now() });
    console.log(`${tag} Client connected (active=${_sseClients.size})`);

    const onMessage = (payload: SSEEvent) => {
      if (!connected) return;
      writer?.enqueue({ event: payload.event, data: JSON.stringify(payload) });
    };

    function disconnect(reason = 'client disconnect') {
      if (!connected) return;
      connected = false;
      if (pingTimer) clearInterval(pingTimer);
      broadcaster.off('message', onMessage);
      _sseClients.delete(clientId);
      writer?.close();
      console.log(`${tag} Client disconnected: ${reason} (active=${_sseClients.size})`);
      resolveDisconnect?.();
    }

    writer = new BoundedSSEWriter(stream, {
      label: tag,
      onDisconnect: disconnect,
    });

    broadcaster.on('message', onMessage);

    writer.enqueue({
      event: 'connected',
      data: JSON.stringify({ event: 'connected', ts: Date.now() }),
    });

    pingTimer = setInterval(() => {
      if (!connected) {
        if (pingTimer) clearInterval(pingTimer);
        return;
      }
      writer?.enqueue({ event: 'ping', data: JSON.stringify({ event: 'ping', ts: Date.now() }) });
    }, PING_INTERVAL_MS);

    stream.onAbort(() => disconnect('abort'));

    // Keep stream open until client disconnects (no polling needed)
    await new Promise<void>((resolve) => {
      resolveDisconnect = resolve;
      if (!connected) resolve();
    });
  });
});

// ── Debug endpoint (dev only) ────────────────────────────────────────

if (process.env.NODE_ENV === 'development') {
  app.post('/api/events/test', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const event = (body.event as string) || 'test';
    const data = body.data || { message: 'Test broadcast' };
    broadcast(event, data);
    return c.json({ ok: true, event, data });
  });
}

export default app;
