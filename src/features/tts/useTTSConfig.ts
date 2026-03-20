import { useState, useEffect, useRef, useCallback } from 'react';

export interface TTSVoiceConfig {
  qwen: {
    mode: string;
    language: string;
    speaker: string;
    voiceDescription: string;
    styleInstruction: string;
  };
  openai: {
    model: string;
    voice: string;
    instructions: string;
  };
  edge: {
    voice: string;
  };
  xiaomi: {
    model: string;
    voice: string;
    style: string;
  };
}

interface UseTTSConfigReturn {
  config: TTSVoiceConfig | null;
  loading: boolean;
  error: string | null;
  saved: boolean;
  updateField: (provider: keyof TTSVoiceConfig, field: string, value: string) => void;
}

/**
 * Hook that loads and auto-saves TTS voice configuration from `/api/tts/config`.
 *
 * Text fields (instructions, voice descriptions) are debounced before saving;
 * all other fields save immediately on change.
 */
export function useTTSConfig(): UseTTSConfigReturn {
  const [config, setConfig] = useState<TTSVoiceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    fetch('/api/tts/config')
      .then((r) => {
        if (!r.ok) throw new Error(`TTS config request failed: ${r.status}`);
        return r.json();
      })
      .then((data) => { setConfig(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  const saveConfig = useCallback((patch: Record<string, unknown>) => {
    fetch('/api/tts/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`TTS config request failed: ${r.status}`);
        return r.json();
      })
      .then((updated) => {
        setConfig(updated);
        setSaved(true);
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 1500);
      })
      .catch((e) => setError(e.message));
  }, []);

  const updateField = useCallback(
    (provider: keyof TTSVoiceConfig, field: string, value: string) => {
      // Optimistic update
      setConfig((prev) => {
        if (!prev) return prev;
        return { ...prev, [provider]: { ...prev[provider], [field]: value } };
      });

      const patch = { [provider]: { [field]: value } };
      const key = `${provider}.${field}`;
      const isTextField = field === 'instructions' || field === 'voiceDescription' || field === 'styleInstruction' || field === 'style';

      if (isTextField) {
        clearTimeout(debounceTimers.current[key]);
        debounceTimers.current[key] = setTimeout(() => saveConfig(patch), 500);
      } else {
        saveConfig(patch);
      }
    },
    [saveConfig],
  );

  // Cleanup timers
  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
      clearTimeout(savedTimer.current);
    };
  }, []);

  return { config, loading, error, saved, updateField };
}
