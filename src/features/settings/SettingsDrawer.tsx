import { useEffect, useCallback, useRef, useState } from 'react';
import { X, Settings, LogOut, Mic, Monitor, Shield } from 'lucide-react';
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
  { key: 'advanced', label: 'Connection', icon: Shield },
  { key: 'audio', label: 'Audio', icon: Mic },
  { key: 'appearance', label: 'Appearance', icon: Monitor },
] as const satisfies ReadonlyArray<{ key: SettingsCategory; label: string; icon: typeof Mic }>;

/** Slide-in drawer containing connection, audio, and appearance settings. */
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
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 animate-fade-in bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="fixed right-0 top-0 z-50 flex h-full w-full flex-col overflow-hidden border-l border-border/80 bg-card/92 shadow-[0_32px_90px_rgba(0,0,0,0.36)] backdrop-blur-2xl animate-slide-in-right sm:w-[410px] sm:max-w-[94vw]"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-border/70 bg-secondary/45 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <span className="cockpit-kicker" id="settings-title">
                <Settings size={14} className="text-primary" aria-hidden="true" />
                Control Room
              </span>
              <div className="cockpit-title text-[1.1rem]">Settings</div>
            </div>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="shell-icon-button min-h-9 px-3"
              title="Close (Esc)"
              aria-label="Close settings"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="shrink-0 border-b border-border/60 bg-background/24 px-4 py-3">
            <div className="-mx-0.5 flex flex-wrap gap-2 px-0.5 py-1 sm:flex-nowrap sm:overflow-x-auto" role="tablist" aria-label="Settings categories">
              {SETTINGS_CATEGORIES.map((category) => {
                const Icon = category.icon;
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
                    className={`shell-chip min-h-11 min-w-[calc(50%-0.25rem)] flex-1 justify-center whitespace-nowrap px-3.5 text-[12px] font-medium sm:min-h-10 sm:min-w-0 sm:flex-none sm:justify-start ${disabled ? 'cursor-not-allowed opacity-45 hover:translate-y-0 hover:border-border/80 hover:text-muted-foreground' : ''}`}
                  >
                      <Icon size={12} aria-hidden="true" />
                    <span>{category.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-5">
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
        </div>

        {/* Footer */}
        <div className="shrink-0 space-y-3 border-t border-border/70 bg-secondary/35 px-4 py-4">
          {onLogout && (
            <button
              onClick={onLogout}
              className="cockpit-toolbar-button w-full justify-center"
              data-tone="danger"
            >
              <LogOut size={14} aria-hidden="true" />
              Sign Out
            </button>
          )}
          <div className="flex items-center justify-between gap-3 px-1 text-[11px] text-muted-foreground/70">
            <span>OpenClaw Nerve</span>
            <span className="font-mono text-[10px] tracking-[0.08em]">v{__APP_VERSION__}</span>
          </div>
        </div>
      </div>
    </>
  );
}
