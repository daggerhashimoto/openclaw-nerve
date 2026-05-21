/* eslint-disable react-refresh/only-export-components -- hook intentionally co-located with provider */
import { createContext, useContext, useCallback, useRef, useState, useEffect, useMemo, type ReactNode } from 'react';
import { useTTS, migrateTTSProvider, type TTSProvider } from '@/features/tts/useTTS';
import { type ThemeName, applyTheme, themeNames } from '@/lib/themes';
import { type FontName, applyFont, fontNames } from '@/lib/fonts';

export type STTProvider = 'local' | 'openai';
export type STTInputMode = 'browser' | 'local' | 'hybrid';

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
  sttInputMode: STTInputMode;
  setSttInputMode: (mode: STTInputMode) => void;
  sttModel: string;
  setSttModel: (model: string) => void;
  wakeWordEnabled: boolean;
  setWakeWordEnabled: (enabled: boolean) => void;
  handleToggleWakeWord: () => void;
  handleWakeWordState: (enabled: boolean, toggle: () => void) => void;
  liveTranscriptionPreview: boolean;
  toggleLiveTranscriptionPreview: () => void;
  speak: (text: string) => Promise<void>;
  panelRatio: number;
  setPanelRatio: (ratio: number) => void;
  telemetryVisible: boolean;
  toggleTelemetry: () => void;
  eventsVisible: boolean;
  toggleEvents: () => void;
  logVisible: boolean;
  toggleLog: () => void;
  showHiddenWorkspaceEntries: boolean;
  toggleShowHiddenWorkspaceEntries: () => void;
  commandPaletteButtonVisible: boolean;
  toggleCommandPaletteButtonVisible: () => void;
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  font: FontName;
  setFont: (font: FontName) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
  editorFontSize: number;
  setEditorFontSize: (size: number) => void;
  kanbanVisible: boolean;
  toggleKanbanVisible: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);
const FONT_REFRESH_STORAGE_KEY = 'nerve:font-refresh-20260312';
const KANBAN_VISIBILITY_STORAGE_KEY = 'nerve:workspace:kanban-visible';
const COMMAND_PALETTE_BUTTON_STORAGE_KEY = 'nerve:showChatboxCommandPaletteButton';
const LEGACY_TOPBAR_COMMAND_PALETTE_BUTTON_STORAGE_KEY = 'nerve:showTopBarCommandPaletteButton';
const LEGACY_COMPACT_COMMAND_PALETTE_BUTTON_STORAGE_KEY = 'nerve:showFloatingCommandPaletteButton';

const ALLOWED_FONT_SIZES = new Set([10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24]);
const ALLOWED_EDITOR_FONT_SIZES = new Set([10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24]);

function normalizeFontSize(size: number): number {
  return Number.isFinite(size) && ALLOWED_FONT_SIZES.has(size) ? size : 15;
}

function normalizeEditorFontSize(size: number): number {
  return Number.isFinite(size) && ALLOWED_EDITOR_FONT_SIZES.has(size) ? size : 13;
}

function resolveInitialCommandPaletteButtonVisible(): boolean {
  const saved = localStorage.getItem(COMMAND_PALETTE_BUTTON_STORAGE_KEY);
  if (saved !== null) return saved !== 'false';

  const legacyCompactSaved = localStorage.getItem(LEGACY_COMPACT_COMMAND_PALETTE_BUTTON_STORAGE_KEY);
  if (legacyCompactSaved !== null) return legacyCompactSaved !== 'false';

  const legacyTopbarSaved = localStorage.getItem(LEGACY_TOPBAR_COMMAND_PALETTE_BUTTON_STORAGE_KEY);
  if (legacyTopbarSaved !== null) return legacyTopbarSaved !== 'false';

  return true;
}

function resolveInitialFont(): FontName {
  const saved = localStorage.getItem('oc-font');
  const hasRefreshedFont = localStorage.getItem(FONT_REFRESH_STORAGE_KEY) === 'true';

  if (!hasRefreshedFont) {
    const shouldAdoptInstrumentSans =
      saved === null ||
      saved === 'inter' ||
      saved === 'system' ||
      saved === 'jetbrains-mono';

    localStorage.setItem(FONT_REFRESH_STORAGE_KEY, 'true');

    if (shouldAdoptInstrumentSans) {
      localStorage.setItem('oc-font', 'instrument-sans');
      return 'instrument-sans';
    }

    if (saved && fontNames.includes(saved as FontName)) {
      return saved as FontName;
    }
  }

  return saved && fontNames.includes(saved as FontName) ? saved as FontName : 'instrument-sans';
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [soundEnabled, setSoundEnabled] = useState(localStorage.getItem('oc-sound') === 'true');
  const [ttsProvider, setTtsProvider] = useState<TTSProvider>(() => migrateTTSProvider(localStorage.getItem('oc-tts-provider') || 'edge'));
  const [ttsModel, setTtsModelState] = useState(() => localStorage.getItem('oc-tts-model') || '');
  const [sttProvider, setSttProviderState] = useState<STTProvider>(() => {
    const saved = localStorage.getItem('oc-stt-provider') as STTProvider | null;
    return saved === 'openai' ? 'openai' : 'local';
  });
  const [sttInputMode, setSttInputModeState] = useState<STTInputMode>(() => {
    const saved = localStorage.getItem('nerve:sttInputMode') as STTInputMode | null;
    return saved === 'browser' || saved === 'local' || saved === 'hybrid' ? saved : 'hybrid';
  });
  const [sttModel, setSttModelState] = useState(() => localStorage.getItem('oc-stt-model') || 'base');
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [liveTranscriptionPreview, setLiveTranscriptionPreview] = useState(() => {
    const saved = localStorage.getItem('nerve:liveTranscriptionPreview');
    return saved === 'true'; // Default to disabled (fresh installs)
  });
  const [panelRatio, setPanelRatioState] = useState(() => {
    const saved = localStorage.getItem('oc-panel-ratio');
    return saved ? Number(saved) : 75;
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
  const [showHiddenWorkspaceEntries, setShowHiddenWorkspaceEntries] = useState(() => {
    return localStorage.getItem('nerve:showHiddenWorkspaceEntries') === 'true';
  });
  const [commandPaletteButtonVisible, setCommandPaletteButtonVisible] = useState(resolveInitialCommandPaletteButtonVisible);
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const saved = localStorage.getItem('oc-theme') as ThemeName | null;
    return saved && themeNames.includes(saved) ? saved : 'ayu-dark';
  });
  const [font, setFontState] = useState<FontName>(resolveInitialFont);
  const [fontSize, setFontSizeState] = useState<number>(() => {
    const saved = localStorage.getItem('nerve:font-size');
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return normalizeFontSize(parsed);
  });
  const [editorFontSize, setEditorFontSizeState] = useState<number>(() => {
    const saved = localStorage.getItem('nerve:editor-font-size');
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return normalizeEditorFontSize(parsed);
  });
  const [kanbanVisible, setKanbanVisible] = useState(() => {
    const saved = localStorage.getItem(KANBAN_VISIBILITY_STORAGE_KEY);
    return saved !== 'false';
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

  // Apply font size on mount and when it changes
  useEffect(() => {
    document.documentElement.style.setProperty('--font-size-base', `${fontSize}px`);
  }, [fontSize]);

  // Apply editor font size on mount and when it changes
  useEffect(() => {
    document.documentElement.style.setProperty('--editor-font-size', `${editorFontSize}px`);
  }, [editorFontSize]);

  const toggleSound = useCallback(() => {
    setSoundEnabled(prev => {
      const next = !prev;
      localStorage.setItem('oc-sound', String(next));
      return next;
    });
  }, []);

  const toggleLiveTranscriptionPreview = useCallback(() => {
    setLiveTranscriptionPreview(prev => {
      const next = !prev;
      localStorage.setItem('nerve:liveTranscriptionPreview', String(next));
      return next;
    });
  }, []);

  const changeTtsProvider = useCallback((provider: TTSProvider) => {
    setTtsProvider(provider);
    localStorage.setItem('oc-tts-provider', provider);
    // Reset model when switching providers — models are provider-specific
    setTtsModelState('');
    localStorage.setItem('oc-tts-model', '');
  }, []);

  const changeTtsModel = useCallback((model: string) => {
    setTtsModelState(model);
    localStorage.setItem('oc-tts-model', model);
  }, []);

  // Sync STT settings to server on mount (in case server restarted).
  // GET first to avoid overwriting server state with stale local values.
  useEffect(() => {
    if (!sttProvider) return;
    fetch('/api/transcribe/config')
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => {
        const serverProvider = data?.provider as STTProvider | undefined;
        const serverModel = typeof data?.model === 'string' ? data.model : '';

        // Model: trust server on startup to avoid stale localStorage mismatches
        // (e.g. UI says tiny.en while server is actually tiny).
        if (serverModel && serverModel !== sttModel) {
          setSttModelState(serverModel);
          localStorage.setItem('oc-stt-model', serverModel);
        }

        // Provider: preserve prior behavior (push local preference to server).
        if (serverProvider !== sttProvider) {
          return fetch('/api/transcribe/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: sttProvider }),
          });
        }
      })
      .catch(() => {});
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

  const changeSttInputMode = useCallback((mode: STTInputMode) => {
    setSttInputModeState(mode);
    localStorage.setItem('nerve:sttInputMode', mode);
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
      const order: TTSProvider[] = ['openai', 'replicate', 'xiaomi', 'edge'];
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

  const toggleShowHiddenWorkspaceEntries = useCallback(() => {
    setShowHiddenWorkspaceEntries(prev => {
      const next = !prev;
      localStorage.setItem('nerve:showHiddenWorkspaceEntries', String(next));
      return next;
    });
  }, []);

  const toggleCommandPaletteButtonVisible = useCallback(() => {
    setCommandPaletteButtonVisible(prev => {
      const next = !prev;
      localStorage.setItem(COMMAND_PALETTE_BUTTON_STORAGE_KEY, String(next));
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

  const setFontSize = useCallback((size: number) => {
    const normalized = normalizeFontSize(size);
    setFontSizeState(normalized);
    localStorage.setItem('nerve:font-size', String(normalized));
  }, []);

  const setEditorFontSize = useCallback((size: number) => {
    const normalized = normalizeEditorFontSize(size);
    setEditorFontSizeState(normalized);
    localStorage.setItem('nerve:editor-font-size', String(normalized));
  }, []);

  const toggleKanbanVisible = useCallback(() => {
    setKanbanVisible(prev => {
      const next = !prev;
      localStorage.setItem(KANBAN_VISIBILITY_STORAGE_KEY, String(next));
      return next;
    });
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
    sttInputMode,
    setSttInputMode: changeSttInputMode,
    sttModel,
    setSttModel: changeSttModel,
    wakeWordEnabled,
    setWakeWordEnabled,
    handleToggleWakeWord,
    handleWakeWordState,
    liveTranscriptionPreview,
    toggleLiveTranscriptionPreview,
    speak,
    panelRatio,
    setPanelRatio,
    telemetryVisible,
    toggleTelemetry,
    eventsVisible,
    toggleEvents,
    logVisible,
    toggleLog,
    showHiddenWorkspaceEntries,
    toggleShowHiddenWorkspaceEntries,
    commandPaletteButtonVisible,
    toggleCommandPaletteButtonVisible,
    theme,
    setTheme,
    font,
    setFont,
    fontSize,
    setFontSize,
    editorFontSize,
    setEditorFontSize,
    kanbanVisible,
    toggleKanbanVisible,
  }), [
    soundEnabled, toggleSound, ttsProvider, ttsModel, changeTtsProvider, changeTtsModel, toggleTtsProvider,
    sttProvider, changeSttProvider, sttInputMode, changeSttInputMode, sttModel, changeSttModel,
    wakeWordEnabled, handleToggleWakeWord, handleWakeWordState,
    liveTranscriptionPreview, toggleLiveTranscriptionPreview,
    speak, panelRatio, setPanelRatio, telemetryVisible, toggleTelemetry,
    eventsVisible, toggleEvents, logVisible, toggleLog, showHiddenWorkspaceEntries, toggleShowHiddenWorkspaceEntries,
    commandPaletteButtonVisible, toggleCommandPaletteButtonVisible,
    theme, setTheme, font, setFont,
    fontSize, setFontSize, editorFontSize, setEditorFontSize, kanbanVisible, toggleKanbanVisible,
  ]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
