/**
 * VoicePhrasesModal — configure voice phrases per language.
 *
 * Opened from Settings → Audio for any supported language.
 *
 * Lets the user set:
 * - Wake phrases (activate listening)
 * - Stop phrases (send message)
 * - Cancel phrases (discard message)
 *
 * Pre-populated with language defaults.
 */

import { useState, useEffect, useCallback } from 'react';
import { Globe, Plus, Trash2, Mic, Send, XCircle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface VoicePhrasesModalProps {
  open: boolean;
  onClose: () => void;
  languageCode: string;
  languageName: string;
  languageNativeName: string;
}

interface PhrasesData {
  source: string;
  stopPhrases: string[];
  cancelPhrases: string[];
  wakePhrases?: string[];
}

interface PhraseItem {
  id: string;
  value: string;
}

let phraseIdCounter = 0;
function nextPhraseId(): string {
  return `phrase-${++phraseIdCounter}`;
}

function toPhraseItems(strings: string[]): PhraseItem[] {
  return strings.map((value) => ({ id: nextPhraseId(), value }));
}

function PhraseList({
  phrases,
  onChange,
  onAdd,
  onRemove,
  placeholder,
}: {
  phrases: PhraseItem[];
  onChange: (index: number, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      {phrases.map((phrase, i) => (
        <div key={phrase.id} className="flex items-center gap-2">
          <input
            type="text"
            value={phrase.value}
            onChange={e => onChange(i, e.target.value)}
            className="cockpit-input h-10 flex-1 rounded-xl px-3 text-sm"
            placeholder={`${placeholder} ${i + 1}...`}
            dir="auto"
          />
          {phrases.length > 1 && (
            <Button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`Remove ${placeholder.toLowerCase()} ${i + 1}`}
              variant="ghost"
              size="icon-xs"
              className="size-8 rounded-lg text-muted-foreground hover:text-destructive"
            >
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        onClick={onAdd}
        variant="outline"
        size="xs"
        className="w-fit"
      >
        <Plus size={10} /> Add
      </Button>
    </div>
  );
}

export function VoicePhrasesModal({
  open,
  onClose,
  languageCode,
  languageName,
  languageNativeName,
}: VoicePhrasesModalProps) {
  const [wakePhrase, setWakePhrase] = useState('');
  const [stopPhrases, setStopPhrases] = useState<PhraseItem[]>([]);
  const [cancelPhrases, setCancelPhrases] = useState<PhraseItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load defaults/existing phrases when modal opens
  useEffect(() => {
    if (!open || !languageCode) return;
    setSaveError(null);

    const controller = new AbortController();
    fetch(`/api/voice-phrases/${languageCode}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load phrases (${r.status})`);
        return r.json();
      })
      .then((data: PhrasesData) => {
        setWakePhrase(data.wakePhrases?.find((phrase) => phrase.trim().length > 0) || '');
        setStopPhrases(toPhraseItems(data.stopPhrases.length > 0 ? data.stopPhrases : ['']));
        setCancelPhrases(toPhraseItems(data.cancelPhrases.length > 0 ? data.cancelPhrases : ['']));
      })
      .catch((err) => {
        if ((err as DOMException)?.name === 'AbortError' || controller.signal.aborted) return;
        setWakePhrase('');
        setStopPhrases(toPhraseItems(['']));
        setCancelPhrases(toPhraseItems(['']));
      });

    return () => controller.abort();
  }, [open, languageCode]);

  const updatePhrase = useCallback(
    (type: 'stop' | 'cancel', index: number, value: string) => {
      const setter = type === 'stop' ? setStopPhrases : setCancelPhrases;
      setter((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], value };
        return next;
      });
    },
    [],
  );

  const addPhrase = useCallback((type: 'stop' | 'cancel') => {
    const setter = type === 'stop' ? setStopPhrases : setCancelPhrases;
    setter((prev) => [...prev, { id: nextPhraseId(), value: '' }]);
  }, []);

  const removePhrase = useCallback((type: 'stop' | 'cancel', index: number) => {
    const setter = type === 'stop' ? setStopPhrases : setCancelPhrases;
    setter((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);

    try {
      const body: Record<string, string[]> = {
        stopPhrases: stopPhrases.map(p => p.value).filter(v => v.trim()),
        cancelPhrases: cancelPhrases.map(p => p.value).filter(v => v.trim()),
      };
      const wake = wakePhrase.trim();
      if (wake.length > 0) {
        body.wakePhrases = [wake];
      }
      const resp = await fetch(`/api/voice-phrases/${languageCode}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const msg = await resp.text().catch(() => 'Failed to save phrases');
        setSaveError(msg || 'Failed to save phrases');
        return;
      }

      onClose();
    } catch {
      setSaveError('Failed to save phrases. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [languageCode, wakePhrase, stopPhrases, cancelPhrases, onClose]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Globe size={16} className="text-primary" />
            Voice Phrases — {languageName}
          </DialogTitle>
          <DialogDescription className="text-[0.8rem] text-muted-foreground">
            Set the phrases you'll say in {languageNativeName} to control voice input.
            {languageCode !== 'en' && ' English phrases always work as fallback for send & cancel.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[58vh] overflow-y-auto pr-1">
            {/* Wake Phrase */}
            <section className="cockpit-surface p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Mic size={14} className="text-primary" />
                <label className="cockpit-field-label text-primary">
                  Wake Phrase
                </label>
              </div>
              <span className="cockpit-field-hint block">
                One wake phrase per language. Leave empty to use the default phrase for this language.
              </span>
              <input
                type="text"
                value={wakePhrase}
                onChange={(e) => setWakePhrase(e.target.value)}
                className="cockpit-input h-11 rounded-xl px-3 text-sm"
                placeholder="Wake phrase"
                dir="auto"
              />
            </section>

            {/* Stop (Send) Phrases */}
            <section className="cockpit-surface p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Send size={12} className="text-green" />
                <label className="cockpit-field-label text-green">
                  Send Phrases
                </label>
              </div>
              <span className="cockpit-field-hint block">
                Say any of these to send your message.
              </span>
              <PhraseList
                phrases={stopPhrases}
                onChange={(i, v) => updatePhrase('stop', i, v)}
                onAdd={() => addPhrase('stop')}
                onRemove={(i) => removePhrase('stop', i)}
                placeholder="Send phrase"
              />
            </section>

            {/* Cancel Phrases */}
            <section className="cockpit-surface p-4 space-y-3">
              <div className="flex items-center gap-2">
                <XCircle size={12} className="text-orange" />
                <label className="cockpit-field-label text-orange">
                  Cancel Phrases
                </label>
              </div>
              <span className="cockpit-field-hint block">
                Say any of these to discard your message.
              </span>
              <PhraseList
                phrases={cancelPhrases}
                onChange={(i, v) => updatePhrase('cancel', i, v)}
                onAdd={() => addPhrase('cancel')}
                onRemove={(i) => removePhrase('cancel', i)}
                placeholder="Cancel phrase"
              />
            </section>
          </div>

        <DialogFooter className="mt-1 items-center gap-2">
          {saveError && (
            <span className="text-[0.733rem] text-destructive sm:mr-auto">{saveError}</span>
          )}
          <Button
            type="button"
            onClick={onClose}
            variant="outline"
            size="sm"
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
            size="sm"
            className="min-w-[132px]"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Saving...' : 'Save Phrases'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
