/**
 * LoginPage — Full-screen login gate for Nerve authentication.
 *
 * Renders a password form matching Nerve's dark cockpit theme.
 * Supports Enter-to-submit and auto-focuses the password input on mount.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocale, type Locale } from '@/i18n';
import NerveLogo from '../../components/NerveLogo';

interface LoginPageProps {
  onLogin: (password: string) => Promise<void>;
  error: string;
}

export function LoginPage({ onLogin, error }: LoginPageProps) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { locale, setLocale, t, supportedLocales, localeLabels } = useLocale();

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--color-primary)_14%,transparent),transparent_34%),radial-gradient(circle_at_bottom_right,color-mix(in_srgb,var(--color-info)_7%,transparent),transparent_32%)]" />
      <div className="shell-panel relative w-full max-w-[min(92vw,980px)] overflow-hidden rounded-[28px]">
        <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
          <div className="border-b border-border/70 bg-gradient-to-br from-background via-card/90 to-secondary/90 px-6 py-8 sm:px-8 lg:border-b-0 lg:border-r">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-background/60">
              <NerveLogo size={30} />
            </div>
            <div className="mt-6 text-[0.667rem] font-medium uppercase tracking-[0.32em] text-primary/80">
              {t('login.kicker')}
            </div>
            <h1 className="mt-3 max-w-[12ch] text-4xl font-semibold tracking-[-0.05em] text-foreground sm:text-5xl">
              {t('login.title')}
            </h1>
            <p className="mt-4 max-w-[48ch] text-sm leading-6 text-muted-foreground sm:text-base">
              {t('login.description')}
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="shell-panel rounded-2xl px-4 py-3">
                <div className="text-[0.667rem] font-medium uppercase tracking-[0.22em] text-muted-foreground">{t('login.featureSessions')}</div>
                <div className="mt-2 text-sm font-medium text-foreground">{t('login.sessions')}</div>
              </div>
              <div className="shell-panel rounded-2xl px-4 py-3">
                <div className="text-[0.667rem] font-medium uppercase tracking-[0.22em] text-muted-foreground">{t('login.featureWorkspace')}</div>
                <div className="mt-2 text-sm font-medium text-foreground">{t('login.workspace')}</div>
              </div>
              <div className="shell-panel rounded-2xl px-4 py-3">
                <div className="text-[0.667rem] font-medium uppercase tracking-[0.22em] text-muted-foreground">{t('login.featureTelemetry')}</div>
                <div className="mt-2 text-sm font-medium text-foreground">{t('login.telemetry')}</div>
              </div>
            </div>
          </div>

          <div className="px-6 py-8 sm:px-8">
            <div className="text-[0.667rem] font-medium uppercase tracking-[0.3em] text-primary/80">
              {t('login.authenticationRequired')}
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-foreground">
              {t('login.heading')}
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {t('login.body')}
            </p>

            <div className="mt-6 rounded-3xl border border-border/70 bg-background/70 p-4">
              <label htmlFor="login-language" className="mb-2 block text-[0.733rem] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                {t('login.languageLabel')}
              </label>
              <select
                id="login-language"
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
                className="w-full rounded-2xl border border-border/70 bg-card/95 px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                {supportedLocales.map((nextLocale) => (
                  <option key={nextLocale} value={nextLocale}>
                    {localeLabels[nextLocale]}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('login.languageHelp')}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div>
                <label htmlFor="nerve-password" className="mb-2 block text-[0.733rem] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  {t('login.passwordLabel')}
                </label>
                <Input
                  ref={inputRef}
                  id="nerve-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('login.passwordPlaceholder')}
                  autoComplete="current-password"
                  disabled={submitting}
                />
              </div>

              {error && (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={submitting || !password.trim()}
                size="lg"
                className="w-full text-[0.733rem] uppercase tracking-[0.22em]"
              >
                {submitting ? t('login.submitting') : t('login.submit')}
              </Button>
            </form>

            <div className="mt-6 text-xs leading-5 text-muted-foreground">
              {t('login.needHelp')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
