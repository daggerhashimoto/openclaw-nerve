/**
 * main.tsx — Nerve application entry point.
 *
 * Mounts the React root and wraps {@link App} in the provider hierarchy:
 * ErrorBoundary → StrictMode → AuthGate → Gateway → Settings → Session → Chat.
 *
 * The auth gate checks `/api/auth/status` before rendering the main app.
 * When auth is disabled or the user is authenticated, the app renders normally.
 * When auth is enabled and the user is unauthenticated, the login page is shown.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { GatewayProvider } from '@/contexts/GatewayContext'
import { SettingsProvider } from '@/contexts/SettingsContext'
import { SessionProvider } from '@/contexts/SessionContext'
import { ChatProvider } from '@/contexts/ChatContext'
import { LoginPage, useAuth } from '@/features/auth'

function AuthGate() {
  const { state, error, login, logout } = useAuth();

  if (state === 'loading') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="text-xs text-muted-foreground font-mono animate-pulse">Loading…</div>
      </div>
    );
  }

  if (state === 'login') {
    return <LoginPage onLogin={login} error={error} />;
  }

  return (
    <GatewayProvider>
      <SettingsProvider>
        <SessionProvider>
          <ChatProvider>
            <App onLogout={logout} />
          </ChatProvider>
        </SessionProvider>
      </SettingsProvider>
    </GatewayProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <StrictMode>
      <AuthGate />
    </StrictMode>
  </ErrorBoundary>,
)
