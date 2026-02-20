/**
 * useAuth — React hook for authentication state management.
 *
 * Checks `/api/auth/status` on mount and provides login/logout functions.
 * When auth is disabled server-side, immediately resolves to 'authenticated'.
 */

import { useState, useEffect, useCallback } from 'react';

export type AuthState = 'loading' | 'authenticated' | 'login';

export function useAuth() {
  const [state, setState] = useState<AuthState>('loading');
  const [error, setError] = useState('');

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      if (!data.authEnabled || data.authenticated) {
        setState('authenticated');
      } else {
        setState('login');
      }
    } catch {
      // If we can't reach the server, show as authenticated
      // (the real error will surface when the app tries to connect)
      setState('authenticated');
    }
  }, []);

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
        setState('authenticated');
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
    setState('login');
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  return { state, error, login, logout };
}
