/* eslint-disable react-refresh/only-export-components -- hook intentionally co-located with provider */
import { createContext, useContext, useCallback, useRef, useState, useEffect, useMemo, type ReactNode } from 'react';
import { useTTS, migrateTTSProvider, type TTSProvider } from '@/features/tts/useTTS';
import { type ThemeName, applyTheme, themeNames } from '@/lib/themes';
import { type FontName, applyFont, fontNames } from '@/lib/fonts';

export type STTProvider = 'local' | 'openai' | 'deepgram' | 'custom';

interface SettingsContextValue {
  soundEnabled: boolean;
  toggleSound: () => void;
  ttsProvider: TTSProvider;
  ttsModel: string;
  setTtsProvider: (provider: TTSProvider) => void;
  setTtsModel: (model: string) => void;
  toggleTtsProvider: () => void;
  sttProvider: STTProvider;
  setSttProvider: (provider: STTProvider) => void;
  sttModel: string;
  setSttModel: (model: string) => void;
  wakeWordEnabled: boolean;
  setWakeWordEnabled: (enabled: boolean) => void;
  handleToggleWakeWord: () => void;
  handleWakeWordState: (enabled: boolean, toggle: () => void) => void;
  speak: (text: string) => Promise<void>;
  panelRatio: number;
  setPanelRatio: (ratio: number) => void;
  telemetryVisible: boolean;
  toggleTelemetry: () => void;
  eventsVisible: boolean;
  toggleEvents: () => void;
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  font: FontName;
  setFont: (font: FontName) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [soundEnabled, setSoundEnabled] = useState(localStorage.getItem('oc-sound') === 'true');
  const [ttsProvider, setTtsProvider] = useState<TTSProvider>(() => migrateTTSProvider(localStorage.getItem('oc-tts-provider') || 'edge'));
  const [ttsModel, setTtsModelState] = useState(() => localStorage.getItem('oc-tts-model') || '');
  const [sttProvider, setSttProviderState] = useState<STTProvider>(() => {
    const saved = localStorage.getItem('oc-stt-provider') as STTProvider | null;
    // Return saved value if valid, otherwise default to 'local'
    if (saved === 'openai' || saved === 'deepgram' || saved === 'custom') return saved;
    return 'local';
  });
  const [sttModel, setSttModelState] = useState(() => localStorage.getItem('oc-stt-model') || 'tiny.en');
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [panelRatio, setPanelRatioState] = useState(() => {
    const saved = localStorage.getItem('oc-panel-ratio');
    return saved ? Number(saved) : 55;
  });
  const [telemetryVisible, setTelemetryVisible] = useState(() => {
    const saved = localStorage.getItem('oc-telemetry-visible');
    return saved !== 'false'; // Default to true (visible)
  });
  const [eventsVisible, setEventsVisible] = useState(() => {
    return localStorage.getItem('nerve:showEvents') === 'true'; // Default to false (hidden)
  });
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const saved = localStorage.getItem('oc-theme') as ThemeName | null;
    return saved && themeNames.includes(saved) ? saved : 'ayu-dark';
  });
  const [font, setFontState] = useState<FontName>(() => {
    const saved = localStorage.getItem('oc-font') as FontName | null;
    return saved && fontNames.includes(saved) ? saved : 'jetbrains-mono';
  });
  const { speak } = useTTS(soundEnabled, ttsProvider, ttsModel || undefined);
  const wakeWordToggleRef = useRef<(() => void) | null>(null);

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Apply font on mount and when it changes
  useEffect(() => {
    applyFont(font);
  }, [font]);

  const toggleSound = useCallback(() => {
    setSoundEnabled(prev => {
      const next = !prev;
      localStorage.setItem('oc-sound', String(next));
      return next;
    });
  }, []);

  const changeTtsProvider = useCallback((provider: TTSProvider) => {
    setTtsProvider(provider);
    localStorage.setItem('oc-tts-provider', provider);
    
    // Set default model for the new provider
    const defaults: Record<TTSProvider, { deepgram?: { model: string }; openai?: { model: string; voice: string }; edge?: { voice: string }; replicate?: { model: string } }> = {
      deepgram: { deepgram: { model: 'aura-2-iris-en' } },
      openai: { openai: { model: 'tts-1', voice: 'nova' } },
      edge: { edge: { voice: 'en-US-AriaNeural' } },
      replicate: { replicate: { model: 'qwen-tts' } },
      custom: {},
    };
    
    // Update voice-providers.json with provider and its default config
    fetch('/api/voice-providers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        tts: {
          provider,
          ...defaults[provider],
        }
      }),
    }).catch(() => {});
  }, []);

  const changeTtsModel = useCallback((model: string, provider?: TTSProvider) => {
    setTtsModelState(model);
    localStorage.setItem('oc-tts-model', model);
    // Update voice-providers.json with the model
    const currentProvider = provider || ttsProvider;
    const updates: Record<string, unknown> = { provider: currentProvider };
    
    if (currentProvider === 'deepgram') {
      updates.deepgram = { model };
    } else if (currentProvider === 'openai') {
      const voice = model.split(':')[1] || 'nova';
      const modelName = model.split(':')[0] || 'tts-1';
      updates.openai = { model: modelName, voice };
    } else if (currentProvider === 'edge') {
      updates.edge = { voice: model };
    }
    
    fetch('/api/voice-providers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tts: updates }),
    }).catch(() => {});
  }, [ttsProvider]);

  // Sync providers to server on mount (in case server restarted)
  useEffect(() => {
    if (sttProvider || ttsProvider) {
      const updates: { tts?: { provider: string }; stt?: { provider: string } } = {};
      if (ttsProvider) updates.tts = { provider: ttsProvider };
      if (sttProvider) updates.stt = { provider: sttProvider };
      
      fetch('/api/voice-providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      }).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const changeSttProvider = useCallback((provider: STTProvider) => {
    setSttProviderState(provider);
    localStorage.setItem('oc-stt-provider', provider);
    
    // Set default model for the new provider
    const defaults: Record<STTProvider, { deepgram?: { model: string; keywords?: string[] }; openai?: { model: string }; local?: { model: string } }> = {
      deepgram: { deepgram: { model: 'nova-2', keywords: ['Kora:3', 'Erapor:3', 'Philomena:2'] } },
      openai: { openai: { model: 'whisper-1' } },
      local: { local: { model: 'tiny.en' } },
      custom: {},
    };
    
    // Update voice-providers.json (primary source of truth) with provider and its default config
    fetch('/api/voice-providers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        stt: {
          provider,
          ...defaults[provider],
        }
      }),
    }).catch(() => {});
    // Also update transcribe config for backward compatibility
    fetch('/api/transcribe/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    }).catch(() => {});
  }, []);

  const changeSttModel = useCallback((model: string, provider?: STTProvider) => {
    setSttModelState(model);
    localStorage.setItem('oc-stt-model', model);
    // Update voice-providers.json with the model
    const currentProvider = provider || sttProvider;
    const updates: Record<string, unknown> = { provider: currentProvider };
    
    if (currentProvider === 'deepgram') {
      updates.deepgram = { model };
    } else if (currentProvider === 'openai') {
      updates.openai = { model };
    } else if (currentProvider === 'local') {
      updates.local = { model };
    }
    
    fetch('/api/voice-providers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stt: updates }),
    }).catch(() => {});
    // Also update transcribe config for backward compatibility
    fetch('/api/transcribe/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    }).catch(() => {});
  }, [sttProvider]);

  const toggleTtsProvider = useCallback(() => {
    setTtsProvider(prev => {
      const order: TTSProvider[] = ['openai', 'replicate', 'edge'];
      const next = order[(order.indexOf(prev) + 1) % order.length]!;
      localStorage.setItem('oc-tts-provider', next);
      return next;
    });
  }, []);

  const handleWakeWordState = useCallback((enabled: boolean, toggle: () => void) => {
    setWakeWordEnabled(enabled);
    wakeWordToggleRef.current = toggle;
  }, []);

  const handleToggleWakeWord = useCallback(() => {
    wakeWordToggleRef.current?.();
  }, []);

  const setPanelRatio = useCallback((ratio: number) => {
    setPanelRatioState(ratio);
    localStorage.setItem('oc-panel-ratio', String(ratio));
  }, []);

  const toggleTelemetry = useCallback(() => {
    setTelemetryVisible(prev => {
      const next = !prev;
      localStorage.setItem('oc-telemetry-visible', String(next));
      return next;
    });
  }, []);

  const toggleEvents = useCallback(() => {
    setEventsVisible(prev => {
      const next = !prev;
      localStorage.setItem('nerve:showEvents', String(next));
      return next;
    });
  }, []);

  const setTheme = useCallback((newTheme: ThemeName) => {
    setThemeState(newTheme);
    localStorage.setItem('oc-theme', newTheme);
  }, []);

  const setFont = useCallback((newFont: FontName) => {
    setFontState(newFont);
    localStorage.setItem('oc-font', newFont);
  }, []);

  const value = useMemo<SettingsContextValue>(() => ({
    soundEnabled,
    toggleSound,
    ttsProvider,
    ttsModel,
    setTtsProvider: changeTtsProvider,
    setTtsModel: changeTtsModel,
    toggleTtsProvider,
    sttProvider,
    setSttProvider: changeSttProvider,
    sttModel,
    setSttModel: changeSttModel,
    wakeWordEnabled,
    setWakeWordEnabled,
    handleToggleWakeWord,
    handleWakeWordState,
    speak,
    panelRatio,
    setPanelRatio,
    telemetryVisible,
    toggleTelemetry,
    eventsVisible,
    toggleEvents,
    theme,
    setTheme,
    font,
    setFont,
  }), [
    soundEnabled, toggleSound, ttsProvider, ttsModel, changeTtsProvider, changeTtsModel, toggleTtsProvider,
    sttProvider, changeSttProvider, sttModel, changeSttModel,
    wakeWordEnabled, handleToggleWakeWord, handleWakeWordState,
    speak, panelRatio, setPanelRatio, telemetryVisible, toggleTelemetry,
    eventsVisible, toggleEvents, theme, setTheme, font, setFont,
  ]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
