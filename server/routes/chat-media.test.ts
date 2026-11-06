/** Tests for GET /api/chat-media, the proxy for gateway-hosted chat images. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

const mockConfig = { gatewayUrl: 'http://127.0.0.1:18789', gatewayToken: 'gw-token' };

vi.mock('../lib/config.js', () => ({ config: mockConfig }));
vi.mock('../middleware/rate-limit.js', () => ({
  rateLimitGeneral: async (_c: unknown, next: () => Promise<void>) => next(),
}));

const MEDIA_PATH = '/api/chat/media/outgoing/agent%3Amain%3Amain/784f0288-9a9a-4a96-8c9a-c3b846b7a796/full';

function imageResponse(type = 'image/png', status = 200) {
  return new Response(new Uint8Array([137, 80, 78, 71]), { status, headers: { 'Content-Type': type } });
}

describe('GET /api/chat-media', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn().mockResolvedValue(imageResponse());
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    mockConfig.gatewayUrl = 'http://127.0.0.1:18789';
    mockConfig.gatewayToken = 'gw-token';
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function request(path: string | null) {
    const mod = await import('./chat-media.js');
    const app = new Hono();
    app.route('/', mod.default);
    const query = path === null ? '' : `?path=${encodeURIComponent(path)}`;
    return app.request(`/api/chat-media${query}`);
  }

  it('streams the image from the gateway with the gateway token', async () => {
    const res = await request(MEDIA_PATH);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:18789${MEDIA_PATH}`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gw-token');
    expect(init.redirect).toBe('manual');
  });

  it('derives the HTTP origin when the gateway URL is a WebSocket URL', async () => {
    mockConfig.gatewayUrl = 'ws://127.0.0.1:18789/ws';
    await request(MEDIA_PATH);
    expect(fetchMock.mock.calls[0][0]).toBe(`http://127.0.0.1:18789${MEDIA_PATH}`);
  });

  it.each([
    ['a missing path', null],
    ['another gateway endpoint', '/api/config'],
    ['a dot-segment escape', '/api/chat/media/outgoing/../../config/x/full'],
    ['an encoded dot-segment escape', '/api/chat/media/outgoing/%2e%2e/%2E%2E/x/full'],
    ['an absolute URL', 'http://evil.example/api/chat/media/outgoing/a/b/full'],
    ['a protocol-relative URL', '//evil.example/api/chat/media/outgoing/a/b/full'],
    ['a query string', `${MEDIA_PATH}?x=1`],
    ['an extra segment', `${MEDIA_PATH}/more`],
  ])('refuses %s without calling the gateway', async (_label, path) => {
    const res = await request(path);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses when no gateway token is configured', async () => {
    mockConfig.gatewayToken = '';
    const res = await request(MEDIA_PATH);
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes a gateway 404 through as 404', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } }));
    const res = await request(MEDIA_PATH);
    expect(res.status).toBe(404);
  });

  it('answers 502 for other gateway failures', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } }));
    expect((await request(MEDIA_PATH)).status).toBe(502);

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect((await request(MEDIA_PATH)).status).toBe(502);
  });

  it.each(['image/svg+xml', 'text/html', 'application/json'])(
    'refuses to serve %s from the gateway',
    async (type) => {
      fetchMock.mockResolvedValue(imageResponse(type));
      const res = await request(MEDIA_PATH);
      expect(res.status).toBe(502);
    },
  );
});
