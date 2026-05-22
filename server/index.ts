/**
 * Nerve server entry point.
 *
 * Starts HTTP and optional HTTPS servers (for secure-context features like
 * microphone access), sets up WebSocket proxying to the OpenClaw gateway,
 * starts file watchers, and registers graceful shutdown handlers.
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import app from './app.js';
import { releaseWhisperContext } from './services/whisper-local.js';
import { config, validateConfig, printStartupBanner, probeGateway } from './lib/config.js';
import { setupWebSocketProxy, closeAllWebSockets } from './lib/ws-proxy.js';
import { startFileWatcher, stopFileWatcher } from './lib/file-watcher.js';
import { createTelemetryRuntime, setTelemetryRuntime } from './lib/telemetry/runtime.js';

// ── Startup banner + validation ──────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(__dirname, '..', 'package.json');
const pkgVersion: string = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version || '0.0.0';

printStartupBanner(pkgVersion);
validateConfig();

const telemetryRuntime = createTelemetryRuntime({ appVersion: pkgVersion });
setTelemetryRuntime(telemetryRuntime);
void telemetryRuntime.start().catch((err) => {
  console.warn('[telemetry] Failed to start telemetry runtime:', (err as Error).message);
});

// ── Start file watchers ──────────────────────────────────────────────

startFileWatcher();

// ── HTTP server ──────────────────────────────────────────────────────

const httpServer = serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  },
  (info) => {
    console.log(`\x1b[33m[openclaw-ui]\x1b[0m http://${config.host}:${info.port}`);
  },
);

// Friendly error on port conflict
(httpServer as unknown as import('node:net').Server).on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\x1b[31m[openclaw-ui]\x1b[0m Port ${config.port} is already in use. Is another instance running?`);
    process.exit(1);
  }
  throw err;
});

// Set up WS proxy on HTTP server (for remote access without SSL)
setupWebSocketProxy(httpServer as unknown as import('node:http').Server);

// Non-blocking gateway health check
probeGateway();

// ── HTTPS server (for secure context — microphone access, WSS proxy) ─

let sslServer: https.Server | undefined;

if (fs.existsSync(config.certPath) && fs.existsSync(config.keyPath)) {
  const sslOptions = {
    cert: fs.readFileSync(config.certPath),
    key: fs.readFileSync(config.keyPath),
  };

  const MAX_BODY_BYTES = config.limits.maxBodyBytes;

  sslServer = https.createServer(sslOptions, async (req, res) => {
    // Convert Node req/res to fetch Request and forward to Hono
    const protocol = 'https';
    const host = req.headers.host || `localhost:${config.sslPort}`;
    const url = new URL(req.url || '/', `${protocol}://${host}`);

    // Read body with size limit
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of req) {
      totalBytes += (chunk as Buffer).length;
      if (totalBytes > MAX_BODY_BYTES) {
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end('Request body too large');
        return;
      }
      chunks.push(chunk as Buffer);
    }
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v);
        } else {
          headers.set(key, value);
        }
      }
    }

    const request = new Request(url.toString(), {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
      duplex: 'half',
    });

    try {
      // Pass the Node.js IncomingMessage as env.incoming so @hono/node-server's
      // getConnInfo() can read the real socket remote address (fixes rate limiting on HTTPS).
      const response = await app.fetch(request, { incoming: req });

      const responseHeaders = Object.fromEntries(response.headers.entries());
      const contentType = response.headers.get('content-type') || '';

      // Stream SSE responses instead of buffering (Fix #6: SSE over HTTPS)
      if (contentType.includes('text/event-stream') && response.body) {
        res.writeHead(response.status, responseHeaders);
        const reader = response.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { res.end(); return; }
            if (!res.writable) { reader.cancel(); return; }
            res.write(value);
          }
        };
        pump().catch(() => res.end());
        req.on('close', () => reader.cancel());
        return;
      }

      // Buffer non-streaming responses normally
      res.writeHead(response.status, responseHeaders);
      const arrayBuf = await response.arrayBuffer();
      res.end(Buffer.from(arrayBuf));
    } catch (err) {
      console.error('[https] error:', (err as Error).message);
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end('Internal Server Error');
    }
  });

  sslServer.listen(config.sslPort, config.host, () => {
    console.log(`\x1b[33m[openclaw-ui]\x1b[0m https://${config.host}:${config.sslPort}`);
  });

  setupWebSocketProxy(sslServer);
}

// ── Graceful shutdown ────────────────────────────────────────────────

function shutdown(signal: string) {
  console.log(`\n[openclaw-ui] ${signal} received, shutting down...`);

  setTelemetryRuntime(null);
  void telemetryRuntime.stop();
  stopFileWatcher();
  closeAllWebSockets();
  releaseWhisperContext().catch(() => {});

  httpServer.close(() => {
    console.log('[openclaw-ui] HTTP server closed');
  });

  if (sslServer) {
    sslServer.close(() => {
      console.log('[openclaw-ui] HTTPS server closed');
    });
  }

  // Give connections 5s to drain, then force exit
  setTimeout(() => {
    console.log('[openclaw-ui] Force exit');
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
