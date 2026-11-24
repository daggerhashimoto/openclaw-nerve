import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { cacheHeaders } from './cache-headers.js';

describe('cacheHeaders', () => {
  it('does not cache missing hashed assets as immutable', async () => {
    const app = new Hono();
    app.use('*', cacheHeaders);
    app.get('/assets/index-AbCdEf1.js', (c) => c.notFound());

    const res = await app.request('/assets/index-AbCdEf1.js');

    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('preserves a Cache-Control header explicitly set by an API route', async () => {
    const app = new Hono();
    app.use('*', cacheHeaders);
    app.get('/api/sessions/media', (c) => {
      c.header('Cache-Control', 'private, max-age=3600');
      return c.text('img');
    });

    const res = await app.request('/api/sessions/media');

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
  });

  it('does not preserve a public Cache-Control header on an API route', async () => {
    const app = new Hono();
    app.use('*', cacheHeaders);
    app.get('/api/files/image', (c) => {
      c.header('Cache-Control', 'public, max-age=3600');
      return c.text('img');
    });

    const res = await app.request('/api/files/image');

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });
});
