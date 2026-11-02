/**
 * LoginPage: the operator's first window.
 *
 * The sign over Midnight with the brand pane lit cantaloupe (Nerve is waiting on
 * you), one window for the password that warms while you type in it, and a red
 * pane on the line that reports a failed attempt. Enter submits; the input is
 * focused on mount.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Pane } from '@/components/ui/Pane';

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

  const canSubmit = !submitting && password.trim().length > 0;

  return (
    <div className="nerve-login flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-[26rem]">
        <span className="nerve-wordmark">
          <span>Nerve</span>
          <Pane state="operator" className="nerve-brand-pane" label="Waiting on you" />
        </span>
        <p className="mt-3 text-[1rem] leading-relaxed text-muted-foreground">
          Sign in to your agents.
        </p>

        <form
          onSubmit={handleSubmit}
          className="nerve-window-frame nerve-login-window mt-6 overflow-hidden rounded-[4px]"
        >
          <div className="nerve-window">
            <label htmlFor="nerve-password" className="sr-only">Password</label>
            <input
              ref={inputRef}
              id="nerve-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              disabled={submitting}
              spellCheck={false}
              className="block w-full border-0 bg-transparent px-4 pb-2 pt-4 text-[1.067rem] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
            <div className="flex items-center gap-3 px-3 pb-3 pt-1">
              <span className="flex min-w-0 items-center gap-2 text-[0.8rem] text-muted-foreground">
                <Pane state="off" size="sm" className="nerve-window-pane" />
                <span className="truncate">{submitting ? 'Signing in' : 'Waiting on you'}</span>
              </span>
              <span className="ml-auto hidden items-center gap-1.5 text-[0.8rem] text-muted-foreground sm:flex">
                <kbd className="cockpit-kbd">Enter</kbd>
                <span>sign in</span>
              </span>
              <Button
                type="submit"
                disabled={!canSubmit}
                className="send-btn ml-auto sm:ml-0"
              >
                Sign in
                <ArrowRight size={14} aria-hidden="true" />
              </Button>
            </div>
          </div>
        </form>

        <div aria-live="polite" aria-atomic="true" className="min-h-[1.867rem]">
          {error && (
            <p className="flex min-h-[1.867rem] items-center gap-2 pl-3 text-[0.867rem] text-destructive">
              <Pane state="error" size="sm" label="Failed" />
              <span>{error}</span>
            </p>
          )}
        </div>

        <p className="mt-4 pl-3 text-[0.8rem] leading-relaxed text-muted-foreground">
          Enter the password configured for this deployment. The gateway token also works where password auth falls back to it.
        </p>
      </div>
    </div>
  );
}
