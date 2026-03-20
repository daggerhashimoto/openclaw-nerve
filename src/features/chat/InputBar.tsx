import { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react';
import { Mic, Paperclip, X, Loader2, ArrowUp } from 'lucide-react';
import { useVoiceInput } from '@/features/voice/useVoiceInput';
import { useTabCompletion } from '@/hooks/useTabCompletion';
import { useInputHistory } from '@/hooks/useInputHistory';
import { useSessionContext } from '@/contexts/SessionContext';
import { useSettings } from '@/contexts/SettingsContext';
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from '@/lib/constants';
import { getSessionDisplayLabel } from '@/features/sessions/sessionKeys';
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
  const { sessions, currentSession, agentName: ctxAgentName } = useSessionContext();
  const { liveTranscriptionPreview, sttInputMode, sttProvider } = useSettings();
  const getSessionLabels = useMemo(() => {
    // Build a closure that returns current session labels
    const labels = sessions.map((session) => getSessionDisplayLabel(session, ctxAgentName));
    return () => labels;
  }, [sessions, ctxAgentName]);

  const { handleKeyDown: handleTabKey, reset: resetTabCompletion } = useTabCompletion(getSessionLabels, inputRef);
  const hasActiveSession = Boolean(currentSession);

  const indicateMissingSession = useCallback(() => {
    setAttachmentError('Create or select an agent session before sending a message.');
    setSendError(true);
    setTimeout(() => setSendError(false), 400);
  }, []);

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

  const effectiveSttInputMode = sttProvider === 'openai' ? 'local' : sttInputMode;

  const { voiceState, interimTranscript, wakeWordEnabled, toggleWakeWord, error: voiceError, clearError: clearVoiceError } = useVoiceInput((text) => {
    if (!hasActiveSession) {
      indicateMissingSession();
      return;
    }
    const input = inputRef.current;
    if (input) {
      input.value = '';
      input.style.height = 'auto';
      input.style.fontStyle = '';
      input.style.opacity = '';
    }
    onSend('[voice] ' + text);
  }, agentName, voiceLang, voicePhrasesVersion, effectiveSttInputMode);

  // Live transcription preview: write interim transcript to textarea during recording
  useEffect(() => {
    if (!inputRef.current) return;

    if (!liveTranscriptionPreview) {
      // Ensure temporary preview styling is removed when feature is disabled.
      inputRef.current.style.fontStyle = '';
      inputRef.current.style.opacity = '';
      return;
    }

    if (voiceState === 'recording') {
      if (interimTranscript) {
        inputRef.current.value = interimTranscript;
        inputRef.current.style.fontStyle = 'italic';
        inputRef.current.style.opacity = '0.5';
        inputRef.current.style.height = 'auto';
        inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + 'px';
      } else {
        inputRef.current.value = '';
        inputRef.current.style.height = 'auto';
      }
    } else {
      // Clear provisional styling when not recording
      const hadVoicePreviewStyling =
        inputRef.current.style.fontStyle === 'italic' || inputRef.current.style.opacity === '0.5';
      inputRef.current.style.fontStyle = '';
      inputRef.current.style.opacity = '';
      if (voiceState === 'transcribing' || hadVoicePreviewStyling) {
        inputRef.current.value = '';
        inputRef.current.style.height = 'auto';
      }
    }
  }, [interimTranscript, liveTranscriptionPreview, voiceState]);

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
    if (!hasActiveSession) {
      indicateMissingSession();
      return;
    }
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
    clearVoiceError();
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
    clearVoiceError();
    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + 'px';
  };

  return (
    <>
      {/* Drag overlay — rendered by parent via dragHandlers */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center border-2 border-dashed border-primary/60 bg-primary/12 backdrop-blur-sm pointer-events-none">
          <div className="cockpit-note" data-tone="primary">
            Drop images to attach them to the next message.
          </div>
        </div>
      )}

      {/* Pending images preview */}
      {pendingImages.length > 0 && (
        <div className="flex flex-wrap gap-3 border-t border-border/60 bg-card/72 px-4 py-3">
          {pendingImages.map(img => (
            <div key={img.id} className="relative group rounded-2xl border border-border/75 bg-background/60 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <img src={img.preview} alt={img.name} className="h-16 w-16 rounded-xl border border-border/70 object-cover" />
              <button
                onClick={() => removePendingImage(img.id)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white opacity-85 transition-opacity hover:opacity-100 cursor-pointer"
              >
                <X size={10} />
              </button>
              <span className="mt-2 block max-w-[64px] truncate text-center text-[0.667rem] text-muted-foreground">{img.name}</span>
            </div>
          ))}
        </div>
      )}
      {attachmentError && (
        <div className="border-t border-border/60 bg-card/72 px-4 py-2 text-[0.733rem] text-destructive">{attachmentError}</div>
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
        className={`flex items-end gap-1.5 border-t px-2.5 py-2.5 shrink-0 bg-card/92 focus-within:border-t-primary/40 focus-within:shadow-[0_-1px_10px_rgba(232,168,56,0.12)] sm:gap-2 sm:px-3 sm:py-3 ${voiceState === 'recording' ? 'border-t-red-500 shadow-[0_-1px_12px_rgba(239,68,68,0.24)]' : 'border-border/70'}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {voiceState === 'recording' ? (
          <span className="cockpit-badge shrink-0 self-center" data-tone="danger">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <Mic size={14} className="text-red-500" />
          </span>
        ) : voiceState === 'transcribing' ? (
          <span className="cockpit-badge shrink-0 self-center" data-tone="primary">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <Mic size={14} className="text-primary" />
          </span>
        ) : (
          <span
            className="flex h-10 w-5 shrink-0 select-none items-center justify-center self-center font-mono text-[1.0625rem] font-semibold leading-none text-primary/78"
            aria-hidden="true"
          >
            &gt;
          </span>
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
          placeholder={hasActiveSession ? 'Message...' : 'Create or select an agent to start chatting'}
          aria-label="Message input"
          rows={1}
          disabled={!hasActiveSession}
          className="min-h-[46px] max-h-[160px] flex-1 resize-none border-none bg-transparent px-1 py-2 text-base text-foreground outline-none placeholder:text-muted-foreground sm:text-[1rem]"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!hasActiveSession}
          className="cockpit-toolbar-button min-h-11 self-end px-3"
          title="Attach image"
          aria-label="Attach image"
        >
          <Paperclip size={16} />
        </button>
        <button
          onClick={handleSend}
          disabled={isGenerating || !hasActiveSession}
          aria-label={
            !hasActiveSession
              ? 'Create or select an agent session before sending'
              : isGenerating ? 'Generating response...' : 'Send message'
          }
          aria-busy={isGenerating}
          className={`send-btn flex min-h-11 items-center justify-center gap-2 self-end rounded-2xl bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-[0_16px_34px_rgba(0,0,0,0.24)] transition-transform sm:px-4 ${(isGenerating || !hasActiveSession) ? 'cursor-not-allowed opacity-50' : 'hover:-translate-y-px hover:bg-primary/95 active:scale-95'} ${sendPulse ? 'animate-send-pulse' : ''} ${sendError ? 'animate-shake' : ''}`}
        >
          {isGenerating ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}
          <span className="hidden sm:inline">{isGenerating ? 'Sending' : 'Send'}</span>
        </button>
      </div>
      <div className="bg-card/92 px-3 pb-2 text-[0.733rem] text-muted-foreground sm:px-4">
        {!hasActiveSession
          ? 'Create a top-level agent to start a new branch, or select an existing session to continue.'
          : voiceState === 'recording'
          ? (
            <>
              <span className="sm:hidden">Recording… Shift to send · Double Shift to discard</span>
              <span className="hidden sm:inline">Recording… Left Shift to send · Double Left Shift to discard</span>
            </>
          )
          : voiceState === 'transcribing'
          ? 'Transcribing…'
          : (
            <>
              <span className="sm:hidden">Enter to send · Shift+Enter newline · Double Shift voice</span>
              <span className="hidden sm:inline">Enter or ⌘Enter to send · Shift+Enter for newline · Double Left Shift for voice · Ctrl+F search</span>
            </>
          )}
      </div>
      {voiceError && (
        <div className="bg-card/92 px-4 pb-3 text-[0.733rem] text-destructive" role="alert">
          {voiceError}
        </div>
      )}
    </>
  );
});
