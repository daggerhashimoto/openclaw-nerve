import { describe, expect, it } from 'vitest';
import { addInstanceHeaderToFetch, routeApiPath } from './apiRouting';

describe('routeApiPath', () => {
  it('keeps master path when master is active', () => {
    expect(routeApiPath('/api/sessions', null)).toBe('/api/sessions');
  });

  it('keeps instance management on master', () => {
    expect(routeApiPath('/api/instances', 'cid-a')).toBe('/api/instances');
    expect(routeApiPath('/api/instances/cid-a/token', 'cid-a')).toBe('/api/instances/cid-a/token');
  });

  it('appends instance metadata to routable API paths', () => {
    expect(routeApiPath('/api/sessions?limit=20', 'cid-a')).toBe(
      '/api/sessions?limit=20&instanceId=cid-a',
    );
    expect(routeApiPath('/api/gateway/models', 'cid-a')).toBe(
      '/api/gateway/models?instanceId=cid-a',
    );
  });

  it('keeps unknown API paths on master by default', () => {
    expect(routeApiPath('/api/unknown-endpoint', 'cid-a')).toBe('/api/unknown-endpoint');
  });
});

describe('addInstanceHeaderToFetch', () => {
  const origin = 'http://localhost:3000';

  it('adds header to same-origin routable API URLs', () => {
    const routed = addInstanceHeaderToFetch('/api/memories', undefined, 'cid-a', origin);
    const headers = new Headers(routed.init?.headers);
    expect(headers.get('X-Instance-Id')).toBe('cid-a');
  });

  it('does not touch cross-origin URLs', () => {
    const routed = addInstanceHeaderToFetch('https://example.com/api/memories', undefined, 'cid-a', origin);
    expect(routed.input).toBe('https://example.com/api/memories');
    expect(routed.init).toBeUndefined();
  });

  it('adds headers to Request objects', () => {
    const req = new Request('http://localhost:3000/api/tokens');
    const routed = addInstanceHeaderToFetch(req, undefined, 'cid-a', origin);
    expect(routed.input).toBeInstanceOf(Request);
    expect((routed.input as Request).headers.get('X-Instance-Id')).toBe('cid-a');
    expect(routed.init).toBeUndefined();
  });

  it('keeps master-only APIs untouched', () => {
    const routed = addInstanceHeaderToFetch('/api/instances', undefined, 'cid-a', origin);
    expect(routed.init).toBeUndefined();
  });
});
