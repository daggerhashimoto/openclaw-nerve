/**
 * GET /api/chat-media?path=<gateway path>
 *
 * Proxies images the gateway hosts for chat replies. When an agent delivers a
 * generated image as an attachment, the gateway stores it and puts an image
 * block in the assistant message whose `url` is a gateway path such as
 * `/api/chat/media/outgoing/<sessionKey>/<id>/full`. That path needs the
 * gateway token, which the browser must never hold, so Nerve fetches it here.
 *
 * Only that one gateway path shape is accepted, and only raster images are
 * passed through (an SVG served from Nerve's origin could run script).
 */

import { Hono } from 'hono';
import { config } from '../lib/config.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();

/** `/api/chat/media/outgoing/<encoded session key>/<media id>/<variant>`, nothing else. */
const CHAT_MEDIA_PATH_RE = /^\/api\/chat\/media\/outgoing\/[A-Za-z0-9%._~-]+\/[A-Za-z0-9_-]+\/[a-z]+$/;

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

const FETCH_TIMEOUT_MS = 30_000;

/** The gateway's HTTP origin, also when it is configured as a WebSocket URL. */
function gatewayOrigin(): string {
  const url = new URL(config.gatewayUrl.replace(/^ws(s?):/, 'http$1:'));
  return url.origin;
}

/** The gateway URL for an accepted media path, or null when the path is refused. */
export function resolveChatMediaUrl(path: string): string | null {
  if (!CHAT_MEDIA_PATH_RE.test(path)) return null;
  const origin = gatewayOrigin();
  const target = new URL(path, origin);
  // Percent-encoded dot segments are normalised by the URL parser; refuse anything it rewrote.
  if (target.origin !== origin || target.pathname !== path || target.search || target.hash) return null;
  return target.toString();
}

app.get('/api/chat-media', rateLimitGeneral, async (c) => {
  const path = c.req.query('path') ?? '';
  const target = resolveChatMediaUrl(path);
  if (!target) return c.json({ ok: false, error: 'Not a chat media path' }, 400);
  if (!config.gatewayToken) return c.json({ ok: false, error: 'Gateway token is not configured' }, 503);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: { Authorization: `Bearer ${config.gatewayToken}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('[chat-media] gateway fetch failed:', (err as Error).message);
    return c.json({ ok: false, error: 'Gateway unreachable' }, 502);
  }

  if (upstream.status === 404) return c.json({ ok: false, error: 'Media not found' }, 404);
  const contentType = (upstream.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (!upstream.ok || !ALLOWED_IMAGE_TYPES.has(contentType)) {
    await upstream.body?.cancel().catch(() => {});
    return c.json({ ok: false, error: 'Gateway did not return an image' }, 502);
  }

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  };
  const length = upstream.headers.get('Content-Length');
  if (length) headers['Content-Length'] = length;
  return new Response(upstream.body, { status: 200, headers });
});

export default app;
