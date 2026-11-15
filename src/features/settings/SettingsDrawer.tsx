import { useEffect, useCallback, useRef, useState } from 'react';
import { X, LogOut } from 'lucide-react';
import { ConnectionSettings } from './ConnectionSettings';
import { AudioSettings } from './AudioSettings';
import { AppearanceSettings } from './AppearanceSettings';
import type { TTSProvider } from '@/features/tts/useTTS';
import type { STTInputMode, STTProvider } from '@/contexts/SettingsContext';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  // Connection settings
  gatewayUrl: string;
  gatewayToken: string;
  onUrlChange: (url: string) => void;
  onTokenChange: (token: string) => void;
  onReconnect: () => void;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  // Audio settings
  soundEnabled: boolean;
  onToggleSound: () => void;
  ttsProvider: TTSProvider;
  ttsModel: string;
  onTtsProviderChange: (provider: TTSProvider) => void;
  onTtsModelChange: (model: string) => void;
  sttProvider: STTProvider;
  sttInputMode: STTInputMode;
  sttModel: string;
  onSttProviderChange: (provider: STTProvider) => void;
  onSttInputModeChange: (mode: STTInputMode) => void;
  onSttModelChange: (model: string) => void;
  wakeWordEnabled: boolean;
  onToggleWakeWord: () => void;
  liveTranscriptionPreview: boolean;
  onToggleLiveTranscriptionPreview: () => void;
  // Agent identity
  agentName?: string;
  // Auth
  onLogout?: () => void;
  // Gateway restart
  onGatewayRestart?: () => void;
  gatewayRestarting?: boolean;
}

type SettingsCategory = 'advanced' | 'audio' | 'appearance';
type LegacySettingsCategory = SettingsCategory | 'audio-input' | 'voice-output';

const SETTINGS_CATEGORY_KEY = 'nerve:settings-category';

function normalizeSavedCategory(value: string | null): SettingsCategory | null {
  const raw = value as LegacySettingsCategory | null;
  if (!raw) return null;
  if (raw === 'audio-input' || raw === 'voice-output') return 'audio';
  if (raw === 'advanced' || raw === 'audio' || raw === 'appearance') return raw;
  return null;
}

const SETTINGS_CATEGORIES = [
  { key: 'advanced', label: 'Connection' },
  { key: 'audio', label: 'Audio' },
  { key: 'appearance', label: 'Appearance' },
] as const satisfies ReadonlyArray<{ key: SettingsCategory; label: string }>;

/**
 * Slide-in drawer containing connection, audio, and appearance settings.
 * A floating Panel plate on the right with the edge light along its inner edge; the
 * header is a nameplate row, the categories are the same underline tabs as the
 * workspace column, and the content is a list of rows separated by hairlines.
 */
export function SettingsDrawer({
  open,
  onClose,
  gatewayUrl,
  gatewayToken,
  onUrlChange,
  onTokenChange,
  onReconnect,
  connectionState,
  soundEnabled,
  onToggleSound,
  ttsProvider,
  ttsModel,
  onTtsProviderChange,
  onTtsModelChange,
  sttProvider,
  sttInputMode,
  sttModel,
  onSttProviderChange,
  onSttInputModeChange,
  onSttModelChange,
  wakeWordEnabled,
  onToggleWakeWord,
  liveTranscriptionPreview,
  onToggleLiveTranscriptionPreview,
  agentName,
  onLogout,
  onGatewayRestart,
  gatewayRestarting,
}: SettingsDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isConnected = connectionState === 'connected' || connectionState === 'reconnecting';
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(() => {
    try {
      return normalizeSavedCategory(localStorage.getItem(SETTINGS_CATEGORY_KEY)) || 'advanced';
    } catch {
      return 'advanced';
    }
  });
  const currentCategory: SettingsCategory = isConnected ? activeCategory : 'advanced';

  // Persist the user's preferred category once connected.
  useEffect(() => {
    if (!isConnected) return;

    try {
      localStorage.setItem(SETTINGS_CATEGORY_KEY, activeCategory);
    } catch {
      // ignore storage errors
    }
  }, [activeCategory, isConnected]);

  // Handle escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  // Focus trap - keep focus within the drawer
  const handleTabKey = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !drawerRef.current) return;

    const focusableElements = drawerRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement?.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement?.focus();
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('keydown', handleTabKey);
      // Focus the close button when drawer opens
      closeButtonRef.current?.focus();
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('keydown', handleTabKey);
      };
    }
  }, [open, handleKeyDown, handleTabKey]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop: the room dims, nothing blurs */}
      <div
        className="fixed inset-0 z-40 animate-fade-in bg-background/60"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="nerve-drawer fixed right-0 top-0 z-50 flex h-full w-full flex-col overflow-hidden animate-slide-in-right sm:w-[410px] sm:max-w-[94vw]"
      >
        {/* Header: a nameplate row */}
        <div className="flex min-h-[2.933rem] shrink-0 items-center justify-between gap-3 border-b border-border pl-4 pr-2">
          <h2 id="settings-title" className="nerve-nameplate text-foreground">Settings</h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="shell-icon-button"
            title="Close (Esc)"
            aria-label="Close settings"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Categories: the same underline tabs as the workspace column */}
        <div
          className="flex shrink-0 items-stretch border-b border-border px-2"
          role="tablist"
          aria-label="Settings categories"
        >
          {SETTINGS_CATEGORIES.map((category) => {
            const isActive = currentCategory === category.key;
            const disabled = !isConnected && category.key !== 'advanced';
            return (
              <button
                key={category.key}
                role="tab"
                aria-selected={isActive}
                disabled={disabled}
                onClick={() => setActiveCategory(category.key)}
                data-active={isActive}
                className={`-mb-px flex min-h-11 items-center border-b-2 px-3 text-[0.867rem] transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:min-h-[var(--row-unit)] ${
                  isActive
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                } ${disabled ? 'cursor-not-allowed opacity-45 hover:text-muted-foreground' : ''}`}
              >
                {category.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {currentCategory === 'audio' && (
            <AudioSettings
              section="all"
              soundEnabled={soundEnabled}
              onToggleSound={onToggleSound}
              ttsProvider={ttsProvider}
              ttsModel={ttsModel}
              onTtsProviderChange={onTtsProviderChange}
              onTtsModelChange={onTtsModelChange}
              sttProvider={sttProvider}
              sttInputMode={sttInputMode}
              sttModel={sttModel}
              onSttProviderChange={onSttProviderChange}
              onSttInputModeChange={onSttInputModeChange}
              onSttModelChange={onSttModelChange}
              wakeWordEnabled={wakeWordEnabled}
              onToggleWakeWord={onToggleWakeWord}
              liveTranscriptionPreview={liveTranscriptionPreview}
              onToggleLiveTranscriptionPreview={onToggleLiveTranscriptionPreview}
              agentName={agentName}
            />
          )}

          {currentCategory === 'appearance' && <AppearanceSettings />}

          {currentCategory === 'advanced' && (
            <ConnectionSettings
              url={gatewayUrl}
              token={gatewayToken}
              onUrlChange={onUrlChange}
              onTokenChange={onTokenChange}
              onReconnect={onReconnect}
              connectionState={connectionState}
              onGatewayRestart={onGatewayRestart}
              gatewayRestarting={gatewayRestarting}
            />
          )}
        </div>

        {/* Footer: one quiet row, sign out at the left, the version at the right */}
        <div className="flex min-h-[var(--row-unit)] shrink-0 items-center justify-between gap-3 border-t border-border py-1 pl-2 pr-4">
          {onLogout ? (
            <button
              onClick={onLogout}
              className="shell-chip"
            >
              <LogOut size={14} aria-hidden="true" />
              Sign out
            </button>
          ) : <span />}
          <span className="text-[0.8rem] text-muted-foreground">
            OpenClaw Nerve <span className="font-mono tabular">v{__APP_VERSION__}</span>
          </span>
        </div>
      </div>
    </>
  );
}
