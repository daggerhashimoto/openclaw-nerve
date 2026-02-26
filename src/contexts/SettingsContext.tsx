/* eslint-disable react-refresh/only-export-components -- hook intentionally co-located with provider */
import { createContext, useContext, useCallback, useRef, useState, useEffect, useMemo, type ReactNode } from 'react';
import { useTTS, migrateTTSProvider, type TTSProvider } from '@/features/tts/useTTS';
import { type ThemeName, applyTheme, themeNames } from '@/lib/themes';
import { type FontName, applyFont, fontNames } from '@/lib/fonts';

export type STTProvider = 'local' | 'openai';

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
  logVisible: boolean;
  toggleLog: () => void;
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
    return saved === 'openai' ? 'openai' : 'local';
  });
  const [sttModel, setSttModelState] = useState(() => localStorage.getItem('oc-stt-model') || 'tiny');
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
  const [logVisible, setLogVisible] = useState(() => {
    return localStorage.getItem('nerve:showLog') === 'true'; // Default to false (hidden)
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
  }, []);

  const changeTtsModel = useCallback((model: string) => {
    setTtsModelState(model);
    localStorage.setItem('oc-tts-model', model);
  }, []);

  // Sync STT provider to server on mount (in case server restarted)
  useEffect(() => {
    if (sttProvider) {
      fetch('/api/transcribe/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: sttProvider }),
      }).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const changeSttProvider = useCallback((provider: STTProvider) => {
    setSttProviderState(provider);
    localStorage.setItem('oc-stt-provider', provider);
    // Notify server to switch provider
    fetch('/api/transcribe/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    }).catch(() => {});
  }, []);

  const changeSttModel = useCallback((model: string) => {
    setSttModelState(model);
    localStorage.setItem('oc-stt-model', model);
    // Notify server to switch model
    fetch('/api/transcribe/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    }).catch(() => {}); // Best-effort — server will use new model on next request
  }, []);

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

  const toggleLog = useCallback(() => {
    setLogVisible(prev => {
      const next = !prev;
      localStorage.setItem('nerve:showLog', String(next));
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
    logVisible,
    toggleLog,
    theme,
    setTheme,
    font,
    setFont,
  }), [
    soundEnabled, toggleSound, ttsProvider, ttsModel, changeTtsProvider, changeTtsModel, toggleTtsProvider,
    sttProvider, changeSttProvider, sttModel, changeSttModel,
    wakeWordEnabled, handleToggleWakeWord, handleWakeWordState,
    speak, panelRatio, setPanelRatio, telemetryVisible, toggleTelemetry,
    eventsVisible, toggleEvents, logVisible, toggleLog, theme, setTheme, font, setFont,
  ]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
