/**
 * AuthGate — guards the app behind authentication when enabled.
 *
 * Shows a loading spinner during auth check, the login page when
 * unauthenticated, or renders children (the full app) when authenticated.
 */
import App from '@/App';
import { GatewayProvider } from '@/contexts/GatewayContext';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { SessionProvider } from '@/contexts/SessionContext';
import { ChatProvider } from '@/contexts/ChatContext';
import { LoginPage } from './LoginPage';
import { useAuth } from './useAuth';

export function AuthGate() {
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
