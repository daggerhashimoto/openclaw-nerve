/**
 * main.tsx — Nerve application entry point.
 *
 * Mounts the React root and wraps the app in ErrorBoundary → StrictMode → AuthGate.
 * The auth gate checks `/api/auth/status` before rendering the main app.
 * When auth is disabled or the user is authenticated, the app renders normally.
 * When auth is enabled and the user is unauthenticated, the login page is shown.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AuthGate } from '@/features/auth'
import { applyTheme, loadStoredTheme } from '@/lib/themes'

// Apply the stored theme before anything renders: the login page sits outside
// SettingsProvider, and the first frame should already be in the operator's theme.
applyTheme(loadStoredTheme())

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <StrictMode>
      <AuthGate />
    </StrictMode>
  </ErrorBoundary>,
)
