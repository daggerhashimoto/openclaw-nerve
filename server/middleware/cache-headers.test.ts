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
});
