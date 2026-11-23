/**
 * useAuth — React hook for authentication state management.
 *
 * Checks `/api/auth/status` on mount and provides login/logout functions.
 * When auth is disabled server-side, immediately resolves to 'authenticated'.
 */

import { useState, useCallback, useSyncExternalStore } from 'react';

export type AuthState = 'loading' | 'authenticated' | 'login';

/** Minimal external store so the initial auth check doesn't trigger cascading renders. */
let authSnapshot: AuthState = 'loading';
const listeners = new Set<() => void>();
function setAuthSnapshot(s: AuthState) {
  authSnapshot = s;
  listeners.forEach(l => l());
}
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const getSnapshot = () => authSnapshot;

// Fire the initial auth check once (module-level, not inside an effect)
fetch('/api/auth/status')
  .then(r => r.json())
  .then(data => setAuthSnapshot(!data.authEnabled || data.authenticated ? 'authenticated' : 'login'))
  .catch(() => setAuthSnapshot('authenticated'));

/** Message for a 429 from the auth rate limiter, naming the wait when the server gave one. */
function rateLimitMessage(retryAfter: string | null): string {
  // The limiter sends whole seconds; anything else (missing, zero, a date) gets the generic copy.
  const seconds = retryAfter !== null && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) : 0;
  if (seconds > 0) {
    return `Too many attempts. Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
  }
  return 'Too many attempts. Wait a minute and try again.';
}

export function useAuth() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [error, setError] = useState('');

  const login = useCallback(async (password: string) => {
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'include',
      });
      // The rate limiter answers 429 with a plain-text body, so check the status before parsing.
      if (res.status === 429) {
        setError(rateLimitMessage(res.headers.get('Retry-After')));
        return;
      }
      // A non-JSON body (a proxy error page, say) must not read as a lost connection
      // unless it is a 5xx, which is what a gateway that cannot reach Nerve returns.
      const data = await res.json().catch(() => null);
      if (data?.ok) {
        setAuthSnapshot('authenticated');
      } else if (data?.error) {
        setError(data.error);
      } else {
        setError(res.status >= 500 ? 'Unable to connect to server' : 'Login failed');
      }
    } catch {
      setError('Unable to connect to server');
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore errors — clear local state regardless
    }
    setAuthSnapshot('login');
  }, []);

  return { state, error, login, logout };
}
