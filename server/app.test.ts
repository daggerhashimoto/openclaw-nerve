import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StaticContext = {
  text: (body: string) => Response | Promise<Response>;
};

type Next = () => Promise<Response | void> | Response | void;

describe('server app static fallback', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('@hono/node-server/serve-static');
  });

  it('serves the SPA fallback for dotted app routes while still 404ing missing assets', async () => {
    vi.doMock('@hono/node-server/serve-static', () => ({
      serveStatic: ({ path }: { path?: string }) => async (c: StaticContext, next: Next) => {
        if (path === 'index.html') return c.text('index fallback');
        return next();
      },
    }));
    const { default: app } = await import('./app.js');

    const dottedRoute = await app.request('/users/john.doe');
    expect(dottedRoute.status).toBe(200);
    expect(await dottedRoute.text()).toBe('index fallback');

    const missingAsset = await app.request('/assets/index-AbCdEf1.js');
    expect(missingAsset.status).toBe(404);
  });
});
