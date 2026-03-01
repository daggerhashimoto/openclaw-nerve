/**
 * Hono app definition + middleware stack.
 *
 * Assembles all middleware (CORS, security headers, body limits, compression,
 * cache-control) and mounts every API route under `/api/`. Also serves the
 * Vite-built SPA from `dist/` with a catch-all fallback to `index.html`.
 * @module
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';

import { cacheHeaders } from './middleware/cache-headers.js';
import { errorHandler } from './middleware/error-handler.js';
import { securityHeaders } from './middleware/security-headers.js';
import { authMiddleware } from './middleware/auth.js';
import { config } from './lib/config.js';

import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import ttsRoutes from './routes/tts.js';
import transcribeRoutes from './routes/transcribe.js';
import agentLogRoutes from './routes/agent-log.js';
import tokensRoutes from './routes/tokens.js';
import memoriesRoutes from './routes/memories.js';
import eventsRoutes from './routes/events.js';
import serverInfoRoutes from './routes/server-info.js';
import codexLimitsRoutes from './routes/codex-limits.js';
import claudeCodeLimitsRoutes from './routes/claude-code-limits.js';
import versionRoutes from './routes/version.js';
import channelsRoutes from './routes/channels.js';
import versionCheckRoutes from './routes/version-check.js';
import gatewayRoutes from './routes/gateway.js';
import connectDefaultsRoutes from './routes/connect-defaults.js';
import workspaceRoutes from './routes/workspace.js';
import cronsRoutes from './routes/crons.js';
import sessionsRoutes from './routes/sessions.js';
import apiKeysRoutes from './routes/api-keys.js';
import skillsRoutes from './routes/skills.js';
import filesRoutes from './routes/files.js';
import voicePhrasesRoutes from './routes/voice-phrases.js';
import fileBrowserRoutes from './routes/file-browser.js';
import kanbanRoutes from './routes/kanban.js';
// activity routes removed — tab dropped from workspace panel

const app = new Hono();

// ── CORS — only allow requests from known local origins ──────────────

const ALLOWED_ORIGINS = new Set([
  `http://localhost:${config.port}`,
  `https://localhost:${config.sslPort}`,
  `http://127.0.0.1:${config.port}`,
  `https://127.0.0.1:${config.sslPort}`,
]);

// Allow additional origins via ALLOWED_ORIGINS env var (comma-separated)
// Normalizes via URL constructor to prevent malformed entries; rejects "null" origins
const extraOrigins = process.env.ALLOWED_ORIGINS;
if (extraOrigins) {
  for (const raw of extraOrigins.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === 'null') continue;
    try {
      ALLOWED_ORIGINS.add(new URL(trimmed).origin);
    } catch {
      // skip malformed origins
    }
  }
}

// ── Middleware ────────────────────────────────────────────────────────

app.onError(errorHandler);
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: (origin) => {
      // No Origin header: allow only when bound to localhost (same-origin / non-browser).
      // When network-exposed (HOST=0.0.0.0), reject to prevent server-to-server CSRF.
      if (!origin) {
        const isLocal = config.host === '127.0.0.1' || config.host === 'localhost' || config.host === '::1';
        return isLocal ? origin : null;
      }
      return ALLOWED_ORIGINS.has(origin) ? origin : null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use('*', securityHeaders);
app.use(
  '/api/*',
  bodyLimit({
    maxSize: config.limits.maxBodyBytes,
    onError: (c) => c.text('Request body too large', 413),
  }),
);
// Authentication — after bodyLimit (reject oversized before auth), before compress/routes
app.use('*', authMiddleware);
// Apply compression to all routes except SSE (compression buffers chunks and breaks streaming)
app.use('*', async (c, next) => {
  if (c.req.path === '/api/events') return next();
  return compress()(c, next);
});
app.use('*', cacheHeaders);

// ── API routes ───────────────────────────────────────────────────────

const routes = [
  healthRoutes, authRoutes, ttsRoutes, transcribeRoutes, agentLogRoutes,
  tokensRoutes, memoriesRoutes, eventsRoutes, serverInfoRoutes,
  codexLimitsRoutes, claudeCodeLimitsRoutes, versionRoutes, versionCheckRoutes,
  gatewayRoutes, connectDefaultsRoutes,
  workspaceRoutes, cronsRoutes, sessionsRoutes, skillsRoutes, filesRoutes, apiKeysRoutes,
  voicePhrasesRoutes, fileBrowserRoutes, channelsRoutes, kanbanRoutes,
];
for (const route of routes) app.route('/', route);

// ── Static files + SPA fallback ──────────────────────────────────────

app.use('/assets/*', serveStatic({ root: './dist/' }));
// Serve static files but skip API routes
app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/api/')) return next();
  return serveStatic({ root: './dist/' })(c, next);
});
// SPA fallback — serve index.html for non-API routes (client-side routing)
app.get('*', async (c, next) => {
  if (c.req.path.startsWith('/api/')) return next();
  return serveStatic({ root: './dist/', path: 'index.html' })(c, next);
});

export default app;
