import { useState, useRef, useEffect, useCallback } from 'react';
import { Volume2, VolumeX, Mic, MicOff, Download, AlertTriangle, KeyRound } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { InlineSelect } from '@/components/ui/InlineSelect';
import type { TTSProvider } from '@/features/tts/useTTS';
import type { STTProvider } from '@/contexts/SettingsContext';
import { useTTSConfig } from '@/features/tts/useTTSConfig';

/** Single-line input that expands into a textarea on focus, collapses on blur. */
function ExpandableInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const collapse = useCallback(() => {
    // Small delay so click inside textarea doesn't trigger collapse
    setTimeout(() => {
      if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
        setExpanded(false);
      }
    }, 100);
  }, []);

  useEffect(() => {
    if (expanded && textareaRef.current) {
      textareaRef.current.focus();
      // Move cursor to end
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [expanded]);

  return (
    <div ref={containerRef} className="flex flex-col gap-1 px-3 py-2.5 bg-background border border-border/60 hover:border-muted-foreground transition-all">
      <span className="text-[10px] text-muted-foreground uppercase tracking-[1px]">{label}</span>
      {expanded ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={collapse}
          rows={4}
          className="w-full bg-transparent text-[11px] font-mono text-foreground/80 resize-none outline-none border-none p-0 transition-all"
          placeholder={placeholder}
        />
      ) : (
        <div
          onClick={() => setExpanded(true)}
          className="w-full text-[11px] font-mono text-foreground/80 truncate cursor-text opacity-70 hover:opacity-100 transition-opacity"
          title={value || placeholder}
        >
          {value || <span className="text-muted-foreground">{placeholder}</span>}
        </div>
      )}
    </div>
  );
}

interface AudioSettingsProps {
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
  agentName?: string;
}

/** STT model selector with download progress and GPU warning. */
function SttModelSelector({ model, onModelChange }: { model: string; onModelChange: (m: string) => void }) {
  const [download, setDownload] = useState<{ model: string; downloading: boolean; percent: number; error?: string } | null>(null);
  const [hasGpu, setHasGpu] = useState<boolean | null>(null);

  // Fetch GPU info once on mount
  useEffect(() => {
    fetch('/api/transcribe/config')
      .then((r) => r.json())
      .then((data) => { if (typeof data.hasGpu === 'boolean') setHasGpu(data.hasGpu); })
      .catch(() => {});
  }, []);

  // Poll for download progress when a download is active
  useEffect(() => {
    if (!download?.downloading) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/transcribe/config');
        if (!res.ok) return;
        const data = await res.json();
        if (data.download) {
          setDownload(data.download);
          if (!data.download.downloading) {
            // Download finished — stop polling after a beat
            setTimeout(() => setDownload(null), 2000);
          }
        } else {
          setDownload(null);
        }
      } catch { /* ignore */ }
    }, 500);
    return () => clearInterval(interval);
  }, [download?.downloading]);

  const handleModelChange = useCallback(async (newModel: string) => {
    onModelChange(newModel);
    // Check if server started a download
    try {
      await new Promise((r) => setTimeout(r, 300)); // brief wait for PUT to process
      const res = await fetch('/api/transcribe/config');
      if (res.ok) {
        const data = await res.json();
        if (data.download?.downloading) {
          setDownload(data.download);
        }
      }
    } catch { /* ignore */ }
  }, [onModelChange]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between px-3 py-2.5 bg-background border border-border/60 hover:border-muted-foreground transition-colors">
        <span className="text-[12px]">Model</span>
        <InlineSelect
          value={model}
          onChange={handleModelChange}
          options={[
            { value: 'tiny.en', label: 'tiny.en (75MB, fast)' },
            { value: 'base.en', label: 'base.en (142MB, balanced)' },
            { value: 'small.en', label: 'small.en (466MB, accurate)' },
          ]}
          ariaLabel="STT Model"
          menuClassName="min-w-[220px]"
          dropUp
        />
      </div>

      {/* Download progress */}
      {download?.downloading && (
        <div className="flex flex-col gap-1 px-3 py-2 bg-background border border-primary/30">
          <div className="flex items-center gap-2">
            <Download size={12} className="text-primary animate-pulse" />
            <span className="text-[10px] text-primary font-mono">
              Downloading {download.model}... {download.percent}%
            </span>
          </div>
          <div className="w-full h-1 bg-border/40 overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${download.percent}%` }}
            />
          </div>
        </div>
      )}

      {download && !download.downloading && download.error && (
        <div className="px-3 py-2 bg-background border border-red/30">
          <span className="text-[10px] text-red font-mono">Download failed: {download.error}</span>
        </div>
      )}

      {download && !download.downloading && !download.error && (
        <div className="px-3 py-2 bg-background border border-green/30">
          <span className="text-[10px] text-green font-mono animate-pulse">✓ Model ready</span>
        </div>
      )}

      {/* No-GPU warning for heavier models */}
      {hasGpu === false && model !== 'tiny.en' && (
        <div className="flex items-start gap-2 px-3 py-2 bg-background border border-orange/30">
          <AlertTriangle size={12} className="text-orange shrink-0 mt-0.5" />
          <span className="text-[10px] text-orange/80">
            No GPU detected — {model === 'small.en' ? 'small.en will be very slow on CPU' : 'base.en may be slow on CPU'}. Use tiny.en for faster results.
          </span>
        </div>
      )}
    </div>
  );
}

/** Inline API key input shown when a provider needs a key that isn't configured. */
function ApiKeyInput({
  keyName,
  provider,
  fieldName,
  onSaved,
}: {
  keyName: string;
  provider: string;
  fieldName: 'openaiKey' | 'replicateToken';
  onSaved: () => void;
}) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [fieldName]: value.trim() }),
      });
      if (res.ok) {
        setSaved(true);
        onSaved();
        setTimeout(() => setSaved(false), 2000);
      }
    } catch { /* ignore */ }
    setSaving(false);
  }, [value, fieldName, onSaved]);

  if (saved) {
    return (
      <div className="px-3 py-2 bg-background border border-green/30">
        <span className="text-[10px] text-green font-mono">✓ {keyName} saved</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 bg-background border border-orange/30">
      <div className="flex items-center gap-2">
        <KeyRound size={12} className="text-orange shrink-0" />
        <span className="text-[10px] text-orange">{keyName} required for {provider}</span>
      </div>
      <div className="flex gap-1.5">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`Paste your ${keyName}...`}
          className="flex-1 bg-background/60 border border-border/60 px-2 py-1 text-[10px] font-mono text-foreground/80 outline-none focus:border-orange/60 placeholder:text-muted-foreground/40"
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
        />
        <button
          onClick={handleSave}
          disabled={saving || !value.trim()}
          className="px-2 py-1 text-[10px] font-mono uppercase tracking-wide border border-orange/40 text-orange hover:bg-orange/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? '...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/** Available models per provider. */
const PROVIDER_MODELS: Record<TTSProvider, { value: string; label: string }[]> = {
  openai: [
    { value: '', label: 'gpt-4o-mini-tts (default)' },
    { value: 'tts-1', label: 'tts-1' },
    { value: 'tts-1-hd', label: 'tts-1-hd' },
  ],
  replicate: [
    { value: '', label: 'qwen-tts (default)' },
  ],
  deepgram: [
    { value: 'aura-2-iris-en', label: '⭐ Iris (Cheerful, Energetic)' },
    { value: 'aura-2-amalthea-en', label: '⭐ Amalthea (Natural, Filipino EN)' },
    { value: 'aura-2-cordelia-en', label: 'Cordelia (Warm, Polite)' },
    { value: 'aura-2-janus-en', label: 'Janus (Southern, Smooth)' },
    { value: 'aura-2-luna-en', label: 'Luna (Professional)' },
    { value: 'aura-2-stella-en', label: 'Stella (Friendly)' },
  ],
  edge: [],
  custom: [],
};

/** Settings section for notification sounds, TTS provider/model, and wake-word toggle. */
export function AudioSettings({
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
  agentName = 'Agent',
}: AudioSettingsProps) {
  const models = PROVIDER_MODELS[ttsProvider] || [];
  const { config, saved, updateField } = useTTSConfig();

  // Fetch API key status once on mount
  const [apiKeys, setApiKeys] = useState<{ openai: boolean; replicate: boolean }>({ openai: true, replicate: true });
  useEffect(() => {
    fetch('/api/transcribe/config')
      .then((r) => r.json())
      .then((data) => {
        setApiKeys({
          openai: !!data.openaiKeySet,
          replicate: !!data.replicateKeySet,
        });
      })
      .catch(() => {});
  }, []);

  const OPENAI_VOICES = [
    { value: 'alloy', label: 'Alloy' },
    { value: 'echo', label: 'Echo' },
    { value: 'fable', label: 'Fable' },
    { value: 'onyx', label: 'Onyx' },
    { value: 'nova', label: 'Nova' },
    { value: 'shimmer', label: 'Shimmer' },
  ];

  const EDGE_VOICES = [
    { value: 'en-US-AriaNeural', label: 'Aria (US)' },
    { value: 'en-US-JennyNeural', label: 'Jenny (US)' },
    { value: 'en-US-GuyNeural', label: 'Guy (US)' },
    { value: 'en-GB-SoniaNeural', label: 'Sonia (GB)' },
    { value: 'en-GB-RyanNeural', label: 'Ryan (GB)' },
    { value: 'en-AU-NatashaNeural', label: 'Natasha (AU)' },
    { value: 'en-IE-EmilyNeural', label: 'Emily (IE)' },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground flex items-center gap-2">
        <span className="text-green">◆</span>
        AUDIO
      </h3>

      {/* Sound Effects */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-background border border-border/60 hover:border-muted-foreground transition-colors">
        <div className="flex items-center gap-3">
          {soundEnabled ? (
            <Volume2 size={14} className="text-green" aria-hidden="true" />
          ) : (
            <VolumeX size={14} className="text-muted-foreground" aria-hidden="true" />
          )}
          <span className="text-[12px]" id="sound-label">Sound Effects</span>
        </div>
        <Switch
          checked={soundEnabled}
          onCheckedChange={onToggleSound}
          aria-label="Toggle sound effects"
        />
      </div>

      {/* TTS Provider */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-muted-foreground uppercase tracking-[1px]">TTS Provider</span>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onTtsProviderChange('deepgram')}
            className={`px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              ttsProvider === 'deepgram'
                ? 'bg-purple/20 border-purple text-purple'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            Deepgram
          </button>
          <button
            onClick={() => onTtsProviderChange('openai')}
            className={`px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              ttsProvider === 'openai'
                ? 'bg-primary/20 border-primary text-primary'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            OpenAI
          </button>
          <button
            onClick={() => onTtsProviderChange('replicate')}
            className={`px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              ttsProvider === 'replicate'
                ? 'bg-orange/20 border-orange text-orange'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            Replicate
          </button>
          <button
            onClick={() => onTtsProviderChange('edge')}
            className={`px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              ttsProvider === 'edge'
                ? 'bg-green/20 border-green text-green'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            Edge (Free)
          </button>
          <button
            onClick={() => onTtsProviderChange('custom')}
            className={`col-span-2 px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              ttsProvider === 'custom'
                ? 'bg-orange/20 border-orange text-orange'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            Custom Endpoint
          </button>
        </div>
      </div>

      {/* TTS API key input */}
      {ttsProvider === 'openai' && !apiKeys.openai && (
        <ApiKeyInput keyName="OPENAI_API_KEY" provider="OpenAI TTS" fieldName="openaiKey" onSaved={() => setApiKeys(k => ({ ...k, openai: true }))} />
      )}
      {ttsProvider === 'replicate' && !apiKeys.replicate && (
        <ApiKeyInput keyName="REPLICATE_API_TOKEN" provider="Replicate TTS" fieldName="replicateToken" onSaved={() => setApiKeys(k => ({ ...k, replicate: true }))} />
      )}

      {/* TTS Model (shown when provider has multiple models) */}
      {models.length > 0 && (
        <div className="flex items-center justify-between px-3 py-2.5 bg-background border border-border/60 hover:border-muted-foreground transition-colors">
          <span className="text-[12px]">Model</span>
          <InlineSelect
            value={ttsModel}
            onChange={onTtsModelChange}
            options={models}
            ariaLabel="TTS Model"
            menuClassName="min-w-[200px]"
          />
        </div>
      )}

      {/* Voice Config */}
      {config && (
        <div className="space-y-2">
          {saved && (
            <span className="text-[10px] text-green font-mono animate-pulse">Saved ✓</span>
          )}

          {ttsProvider === 'deepgram' && models.length > 0 && (
            <div className="flex items-center justify-between px-3 py-2.5 bg-background border border-border/60 hover:border-muted-foreground transition-colors">
              <span className="text-[12px]">Voice</span>
              <InlineSelect
                value={ttsModel}
                onChange={onTtsModelChange}
                options={models}
                ariaLabel="Deepgram Voice"
                menuClassName="min-w-[280px]"
                dropUp
              />
            </div>
          )}

          {ttsProvider === 'openai' && (
            <>
              <div className="flex items-center justify-between px-3 py-2.5 bg-background border border-border/60 hover:border-muted-foreground transition-colors">
                <span className="text-[12px]">Voice</span>
                <InlineSelect
                  value={config.openai.voice}
                  onChange={(v) => updateField('openai', 'voice', v)}
                  options={OPENAI_VOICES}
                  ariaLabel="OpenAI Voice"
                  menuClassName="min-w-[140px]"
                />
              </div>
              <ExpandableInput
                label="Voice Instructions"
                value={config.openai.instructions}
                onChange={(v) => updateField('openai', 'instructions', v)}
                placeholder="Describe how the voice should sound..."
              />
            </>
          )}

          {ttsProvider === 'edge' && (
            <div className="flex items-center justify-between px-3 py-2.5 bg-background border border-border/60 hover:border-muted-foreground transition-colors">
              <span className="text-[12px]">Voice</span>
              <InlineSelect
                value={config.edge.voice}
                onChange={(v) => updateField('edge', 'voice', v)}
                options={EDGE_VOICES}
                ariaLabel="Edge Voice"
                menuClassName="min-w-[160px]"
              />
            </div>
          )}

          {ttsProvider === 'replicate' && (
            <>
              <ExpandableInput
                label="Voice Description"
                value={config.qwen.voiceDescription}
                onChange={(v) => updateField('qwen', 'voiceDescription', v)}
                placeholder="Describe the voice character..."
              />
              <ExpandableInput
                label="Style Instruction"
                value={config.qwen.styleInstruction}
                onChange={(v) => updateField('qwen', 'styleInstruction', v)}
                placeholder="Emotion and style guidance..."
              />
            </>
          )}
        </div>
      )}

      {/* Wake Word */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-background border border-border/60 hover:border-muted-foreground transition-colors">
        <div className="flex items-center gap-3">
          {wakeWordEnabled ? (
            <Mic size={14} className="text-green" aria-hidden="true" />
          ) : (
            <MicOff size={14} className="text-muted-foreground" aria-hidden="true" />
          )}
          <div className="flex flex-col">
            <span className="text-[12px]" id="wake-word-label">Wake Word</span>
            <span className="text-[10px] text-muted-foreground">Say "Hey {agentName}" to activate</span>
          </div>
        </div>
        <Switch
          checked={wakeWordEnabled}
          onCheckedChange={onToggleWakeWord}
          aria-label="Toggle wake word detection"
        />
      </div>

      {/* Speech-to-Text */}
      <h3 className="text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground flex items-center gap-2 mt-6">
        <span className="text-green">◆</span>
        SPEECH-TO-TEXT
      </h3>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-muted-foreground uppercase tracking-[1px]">STT Provider</span>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onSttProviderChange('deepgram')}
            className={`px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              sttProvider === 'deepgram'
                ? 'bg-purple/20 border-purple text-purple'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            Deepgram
          </button>
          <button
            onClick={() => onSttProviderChange('local')}
            className={`px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              sttProvider === 'local'
                ? 'bg-green/20 border-green text-green'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            Local (Free)
          </button>
          <button
            onClick={() => onSttProviderChange('openai')}
            className={`px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              sttProvider === 'openai'
                ? 'bg-primary/20 border-primary text-primary'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            OpenAI
          </button>
          <button
            onClick={() => onSttProviderChange('custom')}
            className={`px-3 py-2 text-[11px] font-mono uppercase tracking-wide border transition-colors ${
              sttProvider === 'custom'
                ? 'bg-orange/20 border-orange text-orange'
                : 'bg-background border-border/60 text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            Custom
          </button>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {sttProvider === 'deepgram'
            ? 'Using Deepgram Nova-2 — keywords auto-configured'
            : sttProvider === 'local'
              ? 'Using built-in Whisper model — no API key needed'
              : sttProvider === 'openai'
                ? apiKeys.openai ? 'Using OpenAI Whisper API' : 'OpenAI Whisper API — enter your API key below'
                : 'Custom STT endpoint configured'}
        </span>
      </div>

      {/* STT API key input */}
      {sttProvider === 'openai' && !apiKeys.openai && (
        <ApiKeyInput keyName="OPENAI_API_KEY" provider="OpenAI Whisper" fieldName="openaiKey" onSaved={() => setApiKeys(k => ({ ...k, openai: true }))} />
      )}

      {/* STT Model selector for Deepgram */}
      {sttProvider === 'deepgram' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between px-3 py-2.5 bg-background border border-border/60 hover:border-muted-foreground transition-colors">
            <span className="text-[12px]">Model</span>
            <InlineSelect
              value={sttModel}
              onChange={onSttModelChange}
              options={[
                { value: 'nova-2', label: '⭐ Nova-2 (Best Quality)' },
                { value: 'nova', label: 'Nova (Balanced)' },
                { value: 'base', label: 'Base (Fast, Lower Cost)' },
              ]}
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

      {/* STT Model selector (only for local provider) */}
      {sttProvider === 'local' && (
        <SttModelSelector model={sttModel} onModelChange={onSttModelChange} />
      )}
    </div>
  );
}
