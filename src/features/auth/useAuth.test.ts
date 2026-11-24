/** Tests for useAuth hook. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

describe('useAuth', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function importUseAuth(
    statusResponse: Record<string, unknown> = { authEnabled: false, authenticated: true },
    loginOverride?: () => Response | Promise<Response>,
  ) {
    // Mock fetch before importing the module (module fires fetch on load)
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/auth/status')) {
        return { ok: true, json: async () => statusResponse };
      }
      if (typeof url === 'string' && url.includes('/api/auth/login')) {
        if (loginOverride) return loginOverride();
        const body = JSON.parse(opts?.body as string || '{}');
        if (body.password === 'correct') {
          return { ok: true, json: async () => ({ ok: true }) };
        }
        return { ok: true, json: async () => ({ ok: false, error: 'Invalid password' }) };
      }
      if (typeof url === 'string' && url.includes('/api/auth/logout')) {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const mod = await import('./useAuth.js');
    return mod.useAuth;
  }

  it('resolves to authenticated when auth is disabled', async () => {
    const useAuth = await importUseAuth({ authEnabled: false, authenticated: true });
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.state).toBe('authenticated');
    });
  });

  it('resolves to login when auth is enabled and not authenticated', async () => {
    const useAuth = await importUseAuth({ authEnabled: true, authenticated: false });
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.state).toBe('login');
    });
  });

  it('login with correct password transitions to authenticated', async () => {
    const useAuth = await importUseAuth({ authEnabled: true, authenticated: false });
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.state).toBe('login');
    });

    await act(async () => {
      await result.current.login('correct');
    });

    expect(result.current.state).toBe('authenticated');
  });

  it('login with wrong password sets error', async () => {
    const useAuth = await importUseAuth({ authEnabled: true, authenticated: false });
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.state).toBe('login');
    });

    await act(async () => {
      await result.current.login('wrong');
    });

    expect(result.current.error).toContain('Invalid password');
    expect(result.current.state).toBe('login');
  });

  describe('login failures', () => {
    // Mirrors server/middleware/rate-limit.ts: a plain-text body with Retry-After in whole seconds.
    const rateLimited = (headers: Record<string, string> = {}) => () =>
      new Response('Too many requests. Please try again later.', {
        status: 429,
        headers: { 'Content-Type': 'text/plain; charset=UTF-8', ...headers },
      });

    async function loginWith(loginOverride: () => Response | Promise<Response>) {
      const useAuth = await importUseAuth({ authEnabled: true, authenticated: false }, loginOverride);
      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.state).toBe('login');
      });

      await act(async () => {
        await result.current.login('anything');
      });

      return result;
    }

    it('names the wait when a 429 carries Retry-After', async () => {
      const result = await loginWith(rateLimited({ 'Retry-After': '42' }));

      expect(result.current.error).toBe('Too many attempts. Try again in 42 seconds.');
      expect(result.current.state).toBe('login');
    });

    it('uses the singular for a one second wait', async () => {
      const result = await loginWith(rateLimited({ 'Retry-After': '1' }));

      expect(result.current.error).toBe('Too many attempts. Try again in 1 second.');
    });

    it('falls back to a generic message when a 429 has no Retry-After', async () => {
      const result = await loginWith(rateLimited());

      expect(result.current.error).toBe('Too many attempts. Wait a minute and try again.');
      expect(result.current.state).toBe('login');
    });

    it.each(['0', '-5', 'soon', '1.5', 'Wed, 21 Oct 2026 07:28:00 GMT'])(
      'falls back to the generic message for an unusable Retry-After (%s)',
      async (value) => {
        const result = await loginWith(rateLimited({ 'Retry-After': value }));

        expect(result.current.error).toBe('Too many attempts. Wait a minute and try again.');
      },
    );

    it('still prefers the server message for a JSON error body', async () => {
      const result = await loginWith(
        () => new Response(JSON.stringify({ error: 'Password required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      expect(result.current.error).toBe('Password required');
    });

    it('reports a failed login, not a lost connection, for a non-JSON client error', async () => {
      const result = await loginWith(() => new Response('Forbidden', { status: 403 }));

      expect(result.current.error).toBe('Login failed');
      expect(result.current.state).toBe('login');
    });

    it('keeps the connection message for a non-JSON server error', async () => {
      const result = await loginWith(
        () => new Response('<html>Bad Gateway</html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        }),
      );

      expect(result.current.error).toBe('Unable to connect to server');
      expect(result.current.state).toBe('login');
    });

    it('reports a lost connection when the login request itself fails', async () => {
      const result = await loginWith(() => Promise.reject(new Error('Network error')));

      expect(result.current.error).toBe('Unable to connect to server');
      expect(result.current.state).toBe('login');
    });
  });

  it('logout transitions to login', async () => {
    const useAuth = await importUseAuth({ authEnabled: false, authenticated: true });
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.state).toBe('authenticated');
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.state).toBe('login');
  });

  it('resolves to login when initial status fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.resetModules();

    const mod = await import('./useAuth.js');
    const { result } = renderHook(() => mod.useAuth());

    await waitFor(() => {
      expect(result.current.state).toBe('login');
    });
  });

  it('resolves to login when initial status returns a non-JSON body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<html>Bad Gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    vi.resetModules();

    const mod = await import('./useAuth.js');
    const { result } = renderHook(() => mod.useAuth());

    await waitFor(() => {
      expect(result.current.state).toBe('login');
    });
  });
});
