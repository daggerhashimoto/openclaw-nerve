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
import { Pane } from '@/components/ui/Pane';

export function AuthGate() {
  const { state, error, login, logout } = useAuth();

  if (state === 'loading') {
    // The sign with its pane off: the building before the lights come on
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background" aria-busy="true" aria-label="Loading">
        <span className="nerve-wordmark">
          <span>Nerve</span>
          <Pane state="off" className="nerve-brand-pane" />
        </span>
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
