import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { cacheHeaders } from './cache-headers.js';

const publicDir = resolve(__dirname, '../../public');

describe('cacheHeaders', () => {
  it('revalidates the web app manifest and its icons instead of caching them as hashed assets', async () => {
    // A name like apple-touch-icon.png looks like a Vite hash to the immutable rule,
    // which would pin an old icon for a year
    const manifest = JSON.parse(readFileSync(resolve(publicDir, 'manifest.webmanifest'), 'utf8')) as {
      icons: { src: string }[];
    };
    const appleIcon = readFileSync(resolve(publicDir, '../index.html'), 'utf8').match(
      /rel="apple-touch-icon"[^>]*href="([^"]+)"/,
    )?.[1];
    const paths = ['/manifest.webmanifest', ...manifest.icons.map((icon) => icon.src), appleIcon];
    expect(appleIcon).toBeDefined();

    const app = new Hono();
    app.use('*', cacheHeaders);
    app.get('*', (c) => c.body('file'));

    for (const path of paths) {
      const res = await app.request(path!);
      expect(res.headers.get('Cache-Control'), path).toBe('public, max-age=0, must-revalidate');
    }
  });

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
