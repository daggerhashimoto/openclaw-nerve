/**
 * LoginPage — Full-screen login gate for Nerve authentication.
 *
 * Renders a password form matching Nerve's dark theme with purple accents.
 * Supports Enter-to-submit and auto-focuses the password input on mount.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import NerveLogo from '../../components/NerveLogo';

interface LoginPageProps {
  onLogin: (password: string) => Promise<void>;
  error: string;
}

export function LoginPage({ onLogin, error }: LoginPageProps) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onLogin(password);
    } finally {
      setSubmitting(false);
    }
  }, [password, submitting, onLogin]);

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-4">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-2">
            <NerveLogo size={36} />
          </div>
          <div className="text-2xl font-bold text-primary mb-1">Nerve</div>
          <div className="text-xs text-muted-foreground font-mono tracking-wider uppercase">
            Authentication Required
          </div>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="nerve-password" className="block text-[11px] font-mono text-muted-foreground mb-1.5 uppercase tracking-wider">
              Password
            </label>
            <input
              ref={inputRef}
              id="nerve-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
              disabled={submitting}
              className="w-full px-3 py-2.5 bg-card border border-border rounded-sm text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors disabled:opacity-50 font-mono"
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="text-[11px] text-red-400 font-mono px-1">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !password.trim()}
            className="w-full py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-mono uppercase tracking-wider"
          >
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        {/* Footer hint */}
        <div className="mt-6 text-center text-[10px] text-muted-foreground/40 font-mono">
          Your gateway token can also be used as a password
        </div>
      </div>
    </div>
  );
}
