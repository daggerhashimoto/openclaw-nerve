import { describe, expect, it } from 'vitest';
import { routeApiPath, routeFetchInput } from './apiRouting';

describe('routeApiPath', () => {
  it('keeps master path when master is active', () => {
    expect(routeApiPath('/api/sessions', null)).toBe('/api/sessions');
  });

  it('keeps instance management on master', () => {
    expect(routeApiPath('/api/instances', 'cid-a')).toBe('/api/instances');
    expect(routeApiPath('/api/instances/cid-a/token', 'cid-a')).toBe('/api/instances/cid-a/token');
  });

  it('proxies allowlisted API paths for selected instance', () => {
    expect(routeApiPath('/api/sessions?limit=20', 'cid-a')).toBe(
      '/api/instances/cid-a/proxy/api/sessions?limit=20',
    );
    expect(routeApiPath('/api/gateway/models', 'cid-a')).toBe(
      '/api/instances/cid-a/proxy/api/gateway/models',
    );
  });

  it('keeps unknown API paths on master by default', () => {
    expect(routeApiPath('/api/unknown-endpoint', 'cid-a')).toBe('/api/unknown-endpoint');
  });
});

describe('routeFetchInput', () => {
  const origin = 'http://localhost:3000';

  it('rewrites same-origin relative API URLs', () => {
    expect(routeFetchInput('/api/memories', 'cid-a', origin)).toBe('/api/instances/cid-a/proxy/api/memories');
  });

  it('does not rewrite cross-origin URLs', () => {
    expect(routeFetchInput('https://example.com/api/memories', 'cid-a', origin)).toBe('https://example.com/api/memories');
  });

  it('rewrites same-origin Request objects', () => {
    const req = new Request('http://localhost:3000/api/tokens');
    const rewritten = routeFetchInput(req, 'cid-a', origin);
    expect(rewritten).toBeInstanceOf(Request);
    expect((rewritten as Request).url).toBe('http://localhost:3000/api/instances/cid-a/proxy/api/tokens');
  });
});
