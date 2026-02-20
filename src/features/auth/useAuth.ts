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
      const data = await res.json();
      if (data.ok) {
        setAuthSnapshot('authenticated');
      } else {
        setError(data.error || 'Login failed');
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
