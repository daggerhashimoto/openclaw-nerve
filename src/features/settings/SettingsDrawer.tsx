import { useEffect, useCallback, useRef, useState } from 'react';
import { X, Settings, LogOut, Mic, Monitor, Shield } from 'lucide-react';
import { ConnectionSettings } from './ConnectionSettings';
import { AudioSettings } from './AudioSettings';
import { AppearanceSettings } from './AppearanceSettings';
import type { TTSProvider } from '@/features/tts/useTTS';
import type { STTProvider } from '@/contexts/SettingsContext';

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
  sttModel: string;
  onSttProviderChange: (provider: STTProvider) => void;
  onSttModelChange: (model: string) => void;
  wakeWordEnabled: boolean;
  onToggleWakeWord: () => void;
  // Agent identity
  agentName?: string;
  // Auth
  onLogout?: () => void;
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
  sttModel,
  onSttProviderChange,
  onSttModelChange,
  wakeWordEnabled,
  onToggleWakeWord,
  agentName,
  onLogout,
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
        className="fixed inset-0 bg-black/60 z-40 animate-fade-in"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="fixed right-0 top-0 h-full w-full sm:w-[375px] sm:max-w-[94vw] bg-card border-l border-border z-50 overflow-hidden flex flex-col animate-slide-in-right"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-2">
            <Settings size={14} className="text-primary" aria-hidden="true" />
            <span id="settings-title" className="text-[11px] font-bold tracking-[2px] uppercase text-primary">
              SETTINGS
            </span>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-background/50 transition-colors"
            title="Close (Esc)"
            aria-label="Close settings"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="border-b border-border/50 bg-background/30 p-2 shrink-0">
            <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Settings categories">
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
                    className={`shrink-0 flex items-center gap-2 px-2.5 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-primary/20 border-primary text-primary'
                        : 'bg-card border-border/60 text-muted-foreground hover:border-muted-foreground hover:text-foreground'
                    } ${disabled ? 'opacity-50 cursor-not-allowed hover:border-border/60 hover:text-muted-foreground' : ''}`}
                  >
                    <Icon size={12} aria-hidden="true" />
                    <span>{category.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
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
                sttModel={sttModel}
                onSttProviderChange={onSttProviderChange}
                onSttModelChange={onSttModelChange}
                wakeWordEnabled={wakeWordEnabled}
                onToggleWakeWord={onToggleWakeWord}
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
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border bg-card shrink-0 space-y-2">
          {onLogout && (
            <button
              onClick={onLogout}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[11px] font-mono text-muted-foreground hover:text-red-400 hover:bg-red-400/10 border border-border hover:border-red-400/30 rounded-sm transition-colors uppercase tracking-wider"
            >
              <LogOut size={12} aria-hidden="true" />
              Sign Out
            </button>
          )}
          <div className="text-center text-muted-foreground/40 text-[10px] font-mono tracking-wide">
            NERVE v{__APP_VERSION__}
          </div>
        </div>
      </div>
    </>
  );
}
