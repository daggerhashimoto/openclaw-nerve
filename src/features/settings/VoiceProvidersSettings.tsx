/**
 * Voice Providers Settings - Extended TTS/STT configuration
 * 
 * Supports OpenAI, Edge, Replicate, Deepgram, and Custom providers
 * with dynamic forms, test connections, and voice/model selection.
 */

import { useState, useEffect, useCallback } from 'react';
import { Volume2, Mic, TestTube2, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { InlineSelect } from '@/components/ui/InlineSelect';

interface VoiceProvidersConfig {
  tts: {
    provider: 'openai' | 'edge' | 'replicate' | 'deepgram' | 'custom';
    deepgram?: { model: string; apiKey?: string };
    openai?: { model: string; voice: string; apiKey?: string };
    edge?: { voice: string };
    replicate?: { model: string; apiKey?: string };
    custom?: {
      name: string;
      endpoint: string;
      apiKey?: string;
      headers?: Record<string, string>;
      requestTemplate: string;
      responseParser: string;
    };
  };
  stt: {
    provider: 'local' | 'openai' | 'deepgram' | 'custom';
    deepgram?: { model: string; keywords?: string[]; apiKey?: string };
    openai?: { model: string; apiKey?: string };
    local?: { model: string };
    custom?: {
      name: string;
      endpoint: string;
      apiKey?: string;
      headers?: Record<string, string>;
      requestTemplate: string;
      responseParser: string;
    };
  };
}

interface VoiceModel {
  value: string;
  label: string;
}

const DEEPGRAM_TTS_VOICES: VoiceModel[] = [
  { value: 'aura-2-iris-en', label: '⭐ Iris (Cheerful, Energetic)' },
  { value: 'aura-2-amalthea-en', label: '⭐ Amalthea (Natural, Filipino EN)' },
  { value: 'aura-2-cordelia-en', label: 'Cordelia (Warm, Polite)' },
  { value: 'aura-2-janus-en', label: 'Janus (Southern, Smooth)' },
  { value: 'aura-2-luna-en', label: 'Luna (Professional)' },
  { value: 'aura-2-stella-en', label: 'Stella (Friendly)' },
  { value: 'aura-2-athena-en', label: 'Athena (Authoritative)' },
  { value: 'aura-2-hera-en', label: 'Hera (Sophisticated)' },
  { value: 'aura-2-orion-en', label: 'Orion (Masculine, Deep)' },
  { value: 'aura-2-arcas-en', label: 'Arcas (Masculine, Friendly)' },
];

const DEEPGRAM_STT_MODELS: VoiceModel[] = [
  { value: 'nova-2', label: '⭐ Nova-2 (Best Quality)' },
  { value: 'nova', label: 'Nova (Balanced)' },
  { value: 'base', label: 'Base (Fast, Lower Cost)' },
];

export function VoiceProvidersSettings() {
  const [config, setConfig] = useState<VoiceProvidersConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingTts, setTestingTts] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Load config on mount
  useEffect(() => {
    fetch('/api/voice-providers')
      .then((r) => r.json())
      .then((data) => {
        setConfig(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Save config
  const saveConfig = useCallback(async (updatedConfig: VoiceProvidersConfig) => {
    setSaving(true);
    try {
      const res = await fetch('/api/voice-providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
      if (res.ok) {
        const saved = await res.json();
        setConfig(saved);
      }
    } catch (err) {
      console.error('Failed to save config:', err);
    }
    setSaving(false);
  }, []);

  // Update TTS provider
  const updateTtsProvider = useCallback((provider: VoiceProvidersConfig['tts']['provider']) => {
    if (!config) return;
    const updated = { ...config, tts: { ...config.tts, provider } };
    setConfig(updated);
    saveConfig(updated);
  }, [config, saveConfig]);

  // Update STT provider
  const updateSttProvider = useCallback((provider: VoiceProvidersConfig['stt']['provider']) => {
    if (!config) return;
    const updated = { ...config, stt: { ...config.stt, provider } };
    setConfig(updated);
    saveConfig(updated);
  }, [config, saveConfig]);

  // Update Deepgram TTS model
  const updateDeepgramTtsModel = useCallback((model: string) => {
    if (!config) return;
    const updated = {
      ...config,
      tts: {
        ...config.tts,
        deepgram: { ...(config.tts.deepgram || {}), model },
      },
    };
    setConfig(updated);
    saveConfig(updated);
  }, [config, saveConfig]);

  // Update Deepgram STT model
  const updateDeepgramSttModel = useCallback((model: string) => {
    if (!config) return;
    const updated = {
      ...config,
      stt: {
        ...config.stt,
        deepgram: { ...(config.stt.deepgram || {}), model },
      },
    };
    setConfig(updated);
    saveConfig(updated);
  }, [config, saveConfig]);

  // Test TTS
  const testTts = useCallback(async () => {
    if (!config) return;
    setTestingTts(true);
    setTestResult(null);
    
    try {
      const res = await fetch('/api/voice-providers/test-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: config.tts.provider,
          text: 'Hello, this is a test of the text to speech system.',
        }),
      });
      
      if (res.ok) {
        // Play audio
        const audioBlob = await res.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.play();
        
        setTestResult({ success: true, message: 'TTS test successful!' });
      } else {
        const errorText = await res.text();
        setTestResult({ success: false, message: errorText || 'TTS test failed' });
      }
    } catch (err) {
      setTestResult({ success: false, message: 'TTS test failed: ' + (err as Error).message });
    }
    
    setTestingTts(false);
  }, [config]);

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* TTS Section */}
      <div className="space-y-4">
        <h3 className="text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground flex items-center gap-2">
          <Volume2 size={14} className="text-green" />
          TEXT-TO-SPEECH
        </h3>

        {/* TTS Provider Selection */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => updateTtsProvider('deepgram')}
            className={`px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              config.tts.provider === 'deepgram'
                ? 'bg-purple/20 border-purple text-purple'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            Deepgram
          </button>
          <button
            onClick={() => updateTtsProvider('openai')}
            className={`px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              config.tts.provider === 'openai'
                ? 'bg-primary/20 border-primary text-primary'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            OpenAI
          </button>
          <button
            onClick={() => updateTtsProvider('edge')}
            className={`px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              config.tts.provider === 'edge'
                ? 'bg-green/20 border-green text-green'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            Edge (Free)
          </button>
          <button
            onClick={() => updateTtsProvider('custom')}
            className={`px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              config.tts.provider === 'custom'
                ? 'bg-orange/20 border-orange text-orange'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            Custom
          </button>
        </div>

        {/* Deepgram TTS Settings */}
        {config.tts.provider === 'deepgram' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-3 py-2.5 bg-background border border-border/60 hover:border-muted-foreground transition-colors">
              <span className="text-[12px]">Voice Model</span>
              <InlineSelect
                value={config.tts.deepgram?.model || 'aura-2-iris-en'}
                onChange={updateDeepgramTtsModel}
                options={DEEPGRAM_TTS_VOICES}
                ariaLabel="Deepgram Voice"
                menuClassName="min-w-[280px]"
                dropUp
              />
            </div>
            <div className="px-3 py-2 bg-purple/5 border border-purple/20">
              <span className="text-[10px] text-purple/80">
                ⭐ Iris and Amalthea are prioritized for best quality
              </span>
            </div>
          </div>
        )}

        {/* Test TTS Button */}
        <button
          onClick={testTts}
          disabled={testingTts || saving}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-background border border-green/40 text-green hover:bg-green/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {testingTts ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span className="text-[11px] font-mono uppercase">Testing...</span>
            </>
          ) : (
            <>
              <TestTube2 size={14} />
              <span className="text-[11px] font-mono uppercase">Test TTS</span>
            </>
          )}
        </button>

        {/* Test Result */}
        {testResult && (
          <div className={`flex items-start gap-2 px-3 py-2 border ${
            testResult.success 
              ? 'bg-green/5 border-green/30' 
              : 'bg-red/5 border-red/30'
          }`}>
            {testResult.success ? (
              <CheckCircle size={12} className="text-green shrink-0 mt-0.5" />
            ) : (
              <XCircle size={12} className="text-red shrink-0 mt-0.5" />
            )}
            <span className={`text-[10px] ${testResult.success ? 'text-green' : 'text-red'}`}>
              {testResult.message}
            </span>
          </div>
        )}

        {saving && (
          <div className="px-3 py-2 bg-primary/5 border border-primary/30">
            <span className="text-[10px] text-primary font-mono animate-pulse">Saving...</span>
          </div>
        )}
      </div>

      {/* STT Section */}
      <div className="space-y-4">
        <h3 className="text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground flex items-center gap-2">
          <Mic size={14} className="text-green" />
          SPEECH-TO-TEXT
        </h3>

        {/* STT Provider Selection */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => updateSttProvider('deepgram')}
            className={`px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              config.stt.provider === 'deepgram'
                ? 'bg-purple/20 border-purple text-purple'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            Deepgram
          </button>
          <button
            onClick={() => updateSttProvider('local')}
            className={`px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              config.stt.provider === 'local'
                ? 'bg-green/20 border-green text-green'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            Local (Free)
          </button>
          <button
            onClick={() => updateSttProvider('openai')}
            className={`px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              config.stt.provider === 'openai'
                ? 'bg-primary/20 border-primary text-primary'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            OpenAI
          </button>
          <button
            onClick={() => updateSttProvider('custom')}
            className={`px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              config.stt.provider === 'custom'
                ? 'bg-orange/20 border-orange text-orange'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            Custom
          </button>
        </div>

        {/* Deepgram STT Settings */}
        {config.stt.provider === 'deepgram' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-3 py-2.5 bg-background border border-border/60 hover:border-muted-foreground transition-colors">
              <span className="text-[12px]">Model</span>
              <InlineSelect
                value={config.stt.deepgram?.model || 'nova-2'}
                onChange={updateDeepgramSttModel}
                options={DEEPGRAM_STT_MODELS}
                ariaLabel="Deepgram STT Model"
                menuClassName="min-w-[220px]"
                dropUp
              />
            </div>
            <div className="px-3 py-2 bg-purple/5 border border-purple/20">
              <span className="text-[10px] text-purple/80">
                Keywords: Kora:3, Erapor:3, Philomena:2 (auto-configured)
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
