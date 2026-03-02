import { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react';
import { Mic, Paperclip, X, Loader2, ArrowUp } from 'lucide-react';
import { useVoiceInput } from '@/features/voice/useVoiceInput';
import { useTabCompletion } from '@/hooks/useTabCompletion';
import { useInputHistory } from '@/hooks/useInputHistory';
import { useSessionContext } from '@/contexts/SessionContext';
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from '@/lib/constants';
import { compressImage } from './image-compress';
import type { ImageAttachment } from './types';

interface InputBarProps {
  onSend: (text: string, attachments?: ImageAttachment[]) => void;
  isGenerating: boolean;
  onWakeWordState?: (enabled: boolean, toggle: () => void) => void;
  /** Agent name for dynamic wake phrase (e.g., "Hey Helena") */
  agentName?: string;
}

export interface InputBarHandle {
  focus: () => void;
}

/** Chat input bar with file attachments, voice input, and model effort selector. */
export const InputBar = forwardRef<InputBarHandle, InputBarProps>(function InputBar({ onSend, isGenerating, onWakeWordState, agentName = 'Agent' }, ref) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sendPulse, setSendPulse] = useState(false);
  const [sendError, setSendError] = useState(false);

  // Persistent command history (terminal-style up/down navigation)
  const inputHistory = useInputHistory();

  // Tab completion for session names
  const { sessions, agentName: ctxAgentName } = useSessionContext();
  const getSessionLabels = useMemo(() => {
    // Build a closure that returns current session labels
    const labels = sessions.map((s) => {
      const sessionKey = s.sessionKey || s.key || s.id || '';
      return (
        s.label ||
        (sessionKey === 'agent:main:main'
          ? `${ctxAgentName} (main)`
          : sessionKey.split(':').pop()?.slice(0, 10) || sessionKey)
      );
    });
    return () => labels;
  }, [sessions, ctxAgentName]);

  const { handleKeyDown: handleTabKey, reset: resetTabCompletion } = useTabCompletion(getSessionLabels, inputRef);

  // Expose focus method to parent
  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
      // Add brief highlight animation
      inputRef.current?.classList.add('ring-2', 'ring-primary', 'ring-offset-1');
      setTimeout(() => {
        inputRef.current?.classList.remove('ring-2', 'ring-primary', 'ring-offset-1');
      }, 500);
    }
  }), []);

  // Fetch current language for voice phrase matching
  const [voiceLang, setVoiceLang] = useState('en');
  const [voicePhrasesVersion, setVoicePhrasesVersion] = useState(0);

  useEffect(() => {
    let currentController: AbortController | null = null;

    const fetchLang = () => {
      currentController?.abort();
      const controller = new AbortController();
      currentController = controller;

      fetch('/api/language', { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!controller.signal.aborted && data?.language) {
            setVoiceLang(data.language);
          }
        })
        .catch((err) => {
          if ((err as DOMException)?.name === 'AbortError') return;
        });
    };

    const handlePhrasesChanged = () => {
      setVoicePhrasesVersion((v) => v + 1);
    };

    fetchLang();
    // Listen for language changes from settings
    window.addEventListener('nerve:language-changed', fetchLang);
    window.addEventListener('nerve:voice-phrases-changed', handlePhrasesChanged);
    return () => {
      window.removeEventListener('nerve:language-changed', fetchLang);
      window.removeEventListener('nerve:voice-phrases-changed', handlePhrasesChanged);
      currentController?.abort();
    };
  }, []);

  const { voiceState, wakeWordEnabled, toggleWakeWord } = useVoiceInput((text) => {
    onSend('[voice] ' + text);
  }, agentName, voiceLang, voicePhrasesVersion);

  const processFiles = useCallback((files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    setAttachmentError(null);

    const availableSlots = MAX_ATTACHMENTS - pendingImages.length;
    if (availableSlots <= 0) {
      setAttachmentError(`You can attach up to ${MAX_ATTACHMENTS} images per message.`);
      return;
    }

    const filesToRead = imageFiles.slice(0, availableSlots);
    if (imageFiles.length > availableSlots) {
      setAttachmentError(`Only ${MAX_ATTACHMENTS} images are allowed per message.`);
    }

    // Process all files concurrently and collect errors (avoids fire-and-forget forEach)
    void Promise.allSettled(
      filesToRead.map(async (file) => {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          const maxMb = Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024));
          throw new Error(`"${file.name}" exceeds the ${maxMb}MB limit.`);
        }
        const { base64, mimeType, preview } = await compressImage(file);
        setPendingImages(prev => {
          if (prev.length >= MAX_ATTACHMENTS) return prev;
          return [...prev, {
            id: crypto.randomUUID ? crypto.randomUUID() : 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2),
            mimeType,
            content: base64,
            preview,
            name: file.name,
          }];
        });
      })
    ).then(results => {
      const errors = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map(r => r.reason instanceof Error ? r.reason.message : `Failed to process file.`);
      if (errors.length > 0) setAttachmentError(errors[0]);
    });
  }, [pendingImages.length]);

  // Drag & drop handlers (exposed via className on parent)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files);
  }, [processFiles]);

  // Paste images — use ref to avoid re-registering on every pendingImages change
  const processFilesRef = useRef(processFiles);
  useEffect(() => {
    processFilesRef.current = processFiles;
  }, [processFiles]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageItems: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) imageItems.push(file);
        }
      }
      if (imageItems.length > 0) {
        e.preventDefault();
        processFilesRef.current(imageItems);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, []);

  const removePendingImage = useCallback((id: string) => {
    setPendingImages(prev => prev.filter(img => img.id !== id));
    setAttachmentError(null);
  }, []);

  // Report wake word state to parent
  useEffect(() => {
    onWakeWordState?.(wakeWordEnabled, toggleWakeWord);
  }, [wakeWordEnabled, toggleWakeWord, onWakeWordState]);

  const handleSend = () => {
    const text = inputRef.current?.value.trim();
    if (!text && pendingImages.length === 0) {
      // Shake on empty send attempt
      setSendError(true);
      setTimeout(() => setSendError(false), 400);
      return;
    }

    // Add to persistent command history (deduplication handled by hook)
    if (text) inputHistory.addToHistory(text);
    
    // Trigger pulse animation on successful send
    setSendPulse(true);
    setTimeout(() => setSendPulse(false), 400);
    
    const input = inputRef.current;
    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }
    onSend(text || '', pendingImages.length > 0 ? [...pendingImages] : undefined);
    setPendingImages([]);
    setAttachmentError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // IME composition guard: during active CJK composition the browser may
    // fire keydown for Enter/Escape/etc.  Let the IME handle them – acting
    // on these events causes ghost messages (issue #65).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    // Tab completion for session names (Tab cycles, Escape cancels)
    if (e.key === 'Tab' || e.key === 'Escape') {
      const consumed = handleTabKey(e as React.KeyboardEvent<HTMLTextAreaElement>);
      if (consumed) return;
    }

    // Escape clears history navigation and returns to empty input
    if (e.key === 'Escape' && inputHistory.isNavigating()) {
      e.preventDefault();
      inputHistory.reset();
      const input = inputRef.current;
      if (input) {
        input.value = '';
        input.style.height = 'auto';
      }
      return;
    }

    // Cmd+Enter or Ctrl+Enter to send (works even with Shift held)
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
      return;
    }
    // Plain Enter sends (Shift+Enter for newline)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    
    // Up arrow — navigate to older history (only when cursor at start or input is empty)
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      const input = inputRef.current;
      if (!input) return;

      // Only trigger if cursor is at the beginning or input is single line
      const isAtStart = input.selectionStart === 0 && input.selectionEnd === 0;
      const isSingleLine = !input.value.includes('\n');

      if (isAtStart || isSingleLine) {
        const entry = inputHistory.navigateUp(input.value);
        if (entry !== null) {
          e.preventDefault();
          input.value = entry;
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 160) + 'px';
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }
      return;
    }

    // Down arrow — navigate to newer history or back to draft
    if (e.key === 'ArrowDown' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      if (inputHistory.isNavigating()) {
        const input = inputRef.current;
        if (!input) return;
        e.preventDefault();

        const entry = inputHistory.navigateDown();
        if (entry !== null) {
          input.value = entry;
        } else {
          input.value = '';
        }
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 160) + 'px';
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  };

  const handleInput = () => {
    if (!inputRef.current) return;
    resetTabCompletion();
    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + 'px';
  };

  return (
    <>
      {/* Drag overlay — rendered by parent via dragHandlers */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary flex items-center justify-center pointer-events-none">
          <span className="text-primary font-bold text-lg">Drop image here</span>
        </div>
      )}

      {/* Pending images preview */}
      {pendingImages.length > 0 && (
        <div className="flex gap-2 px-4 py-2 bg-card border-t border-border flex-wrap">
          {pendingImages.map(img => (
            <div key={img.id} className="relative group">
              <img src={img.preview} alt={img.name} className="w-16 h-16 object-cover rounded border border-border" />
              <button
                onClick={() => removePendingImage(img.id)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center text-[10px] opacity-80 hover:opacity-100 cursor-pointer"
              >
                <X size={10} />
              </button>
              <span className="text-[9px] text-muted-foreground block text-center truncate max-w-[64px]">{img.name}</span>
            </div>
          ))}
        </div>
      )}
      {attachmentError && (
        <div className="px-4 pb-1.5 text-[10px] text-destructive bg-card">{attachmentError}</div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => { if (e.target.files) { processFiles(e.target.files); e.target.value = ''; } }}
      />
      {/* Input row */}
      <div
        className={`flex items-center gap-0 border-t shrink-0 bg-card focus-within:border-t-primary/40 focus-within:shadow-[0_-1px_8px_rgba(232,168,56,0.1)] ${voiceState === 'recording' ? 'border-t-red-500 shadow-[0_-1px_12px_rgba(239,68,68,0.3)]' : 'border-border'}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {voiceState === 'recording' ? (
          <span className="pl-3.5 shrink-0 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <Mic size={14} className="text-red-500" />
          </span>
        ) : voiceState === 'transcribing' ? (
          <span className="pl-3.5 shrink-0 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <Mic size={14} className="text-primary" />
          </span>
        ) : (
          <span className="text-primary text-base font-bold pl-3.5 shrink-0 animate-prompt-pulse">›</span>
        )}
        {/* Uncontrolled textarea — value is read/written via inputRef.
            This is intentional: useTabCompletion and history navigation
            set input.value directly, which is safe without a `value` prop.
            Do NOT add a `value={state}` prop without also passing a
            setValue callback to useTabCompletion. */}
        <textarea
          ref={inputRef}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="Message..."
          aria-label="Message input"
          rows={1}
          className="flex-1 font-mono text-[13px] bg-transparent text-foreground border-none px-2.5 py-3 resize-none outline-none min-h-[42px] max-h-[160px]"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="bg-transparent border-none text-muted-foreground hover:text-primary cursor-pointer px-2 self-stretch flex items-center"
          title="Attach image"
          aria-label="Attach image"
        >
          <Paperclip size={16} />
        </button>
        <button
          onClick={handleSend}
          disabled={isGenerating}
          aria-label={isGenerating ? "Generating response..." : "Send message"}
          aria-busy={isGenerating}
          className={`send-btn font-mono bg-primary text-primary-foreground border-none px-4.5 text-sm cursor-pointer font-bold self-stretch flex items-center justify-center transition-transform ${isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-110 active:scale-95'} ${sendPulse ? 'animate-send-pulse' : ''} ${sendError ? 'animate-shake' : ''}`}
        >
          {isGenerating ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}
        </button>
      </div>
      <div className="text-[10px] text-muted-foreground px-4 pb-1.5 pl-10 bg-card">
        {voiceState === 'recording'
          ? 'Recording… Left Shift to send · Double Left Shift to discard'
          : voiceState === 'transcribing'
          ? 'Transcribing…'
          : 'Enter or ⌘Enter to send · Shift+Enter for newline · Double Left Shift for voice · Ctrl+F search'}
      </div>
    </>
  );
});
