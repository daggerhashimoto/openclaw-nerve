/** Tests for the global error handler middleware. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { errorHandler } from './error-handler.js';

describe('errorHandler middleware', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function createApp(routePath: string, error: Error) {
    const app = new Hono();
    app.onError(errorHandler);
    app.get(routePath, () => { throw error; });
    return app;
  }

  it('returns JSON 500 for /api/* routes', async () => {
    const app = createApp('/api/foo', new Error('boom'));
    const res = await app.request('/api/foo');
    expect(res.status).toBe(500);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('Internal server error');
  });

  it('returns plain text 500 for non-API routes', async () => {
    const app = createApp('/some-page', new Error('boom'));
    const res = await app.request('/some-page');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe('Internal server error');
  });

  it('does not leak stack traces in the response', async () => {
    const app = createApp('/api/crash', new Error('secret details'));
    const res = await app.request('/api/crash');
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('Internal server error');
    expect(JSON.stringify(json)).not.toContain('secret details');
  });

  it('logs the error message', async () => {
    const app = createApp('/api/test', new Error('test error'));
    await app.request('/api/test');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[server]'),
      expect.stringContaining('test error'),
    );
  });

  it('handles /api path without trailing slash as API', async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.get('/api', () => { throw new Error('root api'); });
    const res = await app.request('/api');
    expect(res.status).toBe(500);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('Internal server error');
  });

  it('preserves 4xx HTTPException status codes (such as malformed JSON from validators) instead of returning 500', async () => {
    const app = createApp('/api/memories', new HTTPException(400, { message: 'Malformed JSON in request body' }));
    const res = await app.request('/api/memories');
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toEqual({ ok: false, error: 'Malformed JSON in request body' });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('does not treat lookalike paths such as /api-docs as API routes', async () => {
    const app = createApp('/api-docs', new Error('boom'));
    const res = await app.request('/api-docs');
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('Internal server error');

    const app4xx = createApp('/apiary', new HTTPException(404, { message: 'Not here' }));
    const res4xx = await app4xx.request('/apiary');
    expect(res4xx.status).toBe(404);
    expect(await res4xx.text()).toBe('Not here');
  });

  it('returns the response attached to a 4xx HTTPException with its headers', async () => {
    const attached = new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="nerve"' },
    });
    const app = createApp('/api/secure', new HTTPException(401, { res: attached }));
    const res = await app.request('/api/secure');
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="nerve"');
    expect(await res.text()).toBe('Unauthorized');
  });
});
