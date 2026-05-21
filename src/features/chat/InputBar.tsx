import { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react';
import { Mic, Paperclip, X, Loader2, ArrowUp, FileText, FolderOpen, Command } from 'lucide-react';
import type { TreeEntry } from '@/features/file-browser';
import { useVoiceInput } from '@/features/voice/useVoiceInput';
import { useTabCompletion } from '@/hooks/useTabCompletion';
import { useInputHistory } from '@/hooks/useInputHistory';
import { useSessionContext } from '@/contexts/SessionContext';
import { useSettings } from '@/contexts/SettingsContext';
import { MAX_ATTACHMENTS } from '@/lib/constants';
import { compressImage } from './image-compress';
import { formatWorkspacePathAddToChat, mergeAddToChatText } from './addToChat';
import type {
  FileUploadReference,
  ImageAttachment,
  OutgoingUploadPayload,
  UploadAttachmentDescriptor,
  UploadPreparationMetadata,
  UploadMode,
} from './types';
import {
  DEFAULT_UPLOAD_FEATURE_CONFIG,
  getDefaultUploadMode,
  getInlineAttachmentMaxBytes,
  getInlineModeGuardrailError,
  isUploadsEnabled,
  type UploadFeatureConfig,
} from './uploadPolicy';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface InputBarProps {
  onSend: (text: string, attachments?: ImageAttachment[], uploadPayload?: OutgoingUploadPayload) => void | Promise<void>;
  isGenerating: boolean;
  onWakeWordState?: (enabled: boolean, toggle: () => void) => void;
  /** Agent name for dynamic wake phrase (e.g., "Hey Helena") */
  agentName?: string;
  /** Whether to show the compact command-palette launcher inside the composer. */
  showCommandPaletteButton?: boolean;
  /** Open the command palette from the compact composer launcher. */
  onOpenCommandPalette?: () => void;
}

export interface InputBarHandle {
  focus: () => void;
  injectText: (text: string, mode?: 'replace' | 'append') => void;
  addWorkspacePath: (path: string, kind: 'file' | 'directory', agentId?: string) => Promise<void>;
}

interface StagedAttachment {
  id: string;
  file: File;
  origin: 'upload' | 'server_path';
  mode: UploadMode;
  previewUrl?: string;
  relativePath?: string;
}

interface FileTreeResponse {
  ok: boolean;
  root?: string;
  entries?: TreeEntry[];
  workspaceInfo?: {
    isCustomWorkspace: boolean;
    rootPath: string;
  };
  error?: string;
}

interface ComposerSnapshot {
  text: string;
  stagedAttachments: StagedAttachment[];
  attachmentError: string | null;
  showAttachByPathDialog: boolean;
  pathPickerCurrentDir: string;
  pathPickerEntries: TreeEntry[];
  pathPickerSelected: TreeEntry | null;
  pathPickerError: string | null;
  pathPickerCustomRoot: boolean;
}

function createEmptyComposerSnapshot(): ComposerSnapshot {
  return {
    text: '',
    stagedAttachments: [],
    attachmentError: null,
    showAttachByPathDialog: false,
    pathPickerCurrentDir: '',
    pathPickerEntries: [],
    pathPickerSelected: null,
    pathPickerError: null,
    pathPickerCustomRoot: false,
  };
}

let persistedComposerSnapshot: ComposerSnapshot = createEmptyComposerSnapshot();

// eslint-disable-next-line react-refresh/only-export-components -- test helper export is intentional
export function resetInputBarComposerSnapshotForTests() {
  persistedComposerSnapshot = createEmptyComposerSnapshot();
}

interface CanonicalUploadReference {
  kind: 'direct_workspace_reference' | 'imported_workspace_reference';
  canonicalPath: string;
  absolutePath: string;
  uri: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
}

interface UploadReferenceResolveResponse {
  ok: boolean;
  items?: CanonicalUploadReference[];
  error?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error(`Failed to read "${file.name}" as base64.`));
    };
    reader.onerror = () => reject(new Error(`Failed to read "${file.name}" as base64.`));
    reader.readAsDataURL(file);
  });
}

function getBase64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function buildFileUriFromPath(path: string): string {
  if (path.startsWith('file://')) return path;

  const normalized = path.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }
  if (normalized.startsWith('/')) {
    return `file://${encodeURI(normalized)}`;
  }
  return `file:///${encodeURI(normalized)}`;
}

function inferMimeTypeFromName(name: string): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.avif': return 'image/avif';
    case '.svg': return 'image/svg+xml';
    case '.ico': return 'image/x-icon';
    case '.txt': return 'text/plain';
    case '.md': return 'text/markdown';
    case '.json': return 'application/json';
    case '.pdf': return 'application/pdf';
    default: return 'application/octet-stream';
  }
}

function createServerPathBackedFile(params: { name: string; absolutePath: string; sizeBytes?: number; mimeType?: string }): File {
  const file = new File([''], params.name, { type: params.mimeType || inferMimeTypeFromName(params.name) });

  Object.defineProperty(file, 'path', {
    configurable: true,
    value: params.absolutePath,
  });

  if (typeof params.sizeBytes === 'number') {
    Object.defineProperty(file, 'size', {
      configurable: true,
      value: params.sizeBytes,
    });
  }

  return file;
}

function revokeAttachmentPreview(previewUrl?: string) {
  if (previewUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(previewUrl);
  }
}

function resolveFileReference(file: File): FileUploadReference {
  const fileWithPath = file as File & { path?: string; webkitRelativePath?: string };
  const maybePath = fileWithPath.path || fileWithPath.webkitRelativePath;
  if (!maybePath) {
    throw new Error(`"${file.name}" does not expose a local path for file-reference mode.`);
  }

  const path = maybePath.startsWith('file://')
    ? decodeURI(maybePath.replace(/^file:\/\//, ''))
    : maybePath;

  return {
    kind: 'local_path',
    path,
    uri: buildFileUriFromPath(path),
  };
}

function hasResolvableLocalPath(file: File): boolean {
  const fileWithPath = file as File & { path?: string; webkitRelativePath?: string };
  return Boolean(fileWithPath.path || fileWithPath.webkitRelativePath);
}

async function importBrowserUploadsToCanonicalReferences(files: File[]): Promise<CanonicalUploadReference[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file, file.name));

  const response = await fetch('/api/upload-reference/resolve', {
    method: 'POST',
    body: formData,
  });

  const payload = await response.json().catch(() => null) as UploadReferenceResolveResponse | null;
  if (!response.ok || payload?.ok !== true || !Array.isArray(payload.items)) {
    throw new Error(payload?.error || 'Failed to import browser uploads.');
  }

  return payload.items;
}

async function resolveWorkspacePathToCanonicalReference(
  targetPath: string,
  agentId?: string,
): Promise<CanonicalUploadReference> {
  const response = await fetch('/api/upload-reference/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: targetPath, ...(agentId ? { agentId } : {}) }),
  });

  const payload = await response.json().catch(() => null) as UploadReferenceResolveResponse | null;
  const item = Array.isArray(payload?.items) ? payload.items[0] : null;
  if (!response.ok || payload?.ok !== true || !item) {
    throw new Error(payload?.error || 'Failed to resolve selected workspace path.');
  }

  return item;
}

/** Chat input bar with file attachments, voice input, and model effort selector. */
export const InputBar = forwardRef<InputBarHandle, InputBarProps>(function InputBar({
  onSend,
  isGenerating,
  onWakeWordState,
  agentName = 'Agent',
  showCommandPaletteButton = false,
  onOpenCommandPalette,
}, ref) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deferredResizeFrameRef = useRef<number | null>(null);
  const deferredResizeSettledFrameRef = useRef<number | null>(null);
  const [draftText, setDraftText] = useState(() => persistedComposerSnapshot.text);
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>(() => persistedComposerSnapshot.stagedAttachments);
  const [uploadConfig, setUploadConfig] = useState<UploadFeatureConfig>(DEFAULT_UPLOAD_FEATURE_CONFIG);
  const [attachmentError, setAttachmentError] = useState<string | null>(() => persistedComposerSnapshot.attachmentError);
  const [isDragging, setIsDragging] = useState(false);
  const [isPreparingInline, setIsPreparingInline] = useState(false);
  const [showAttachByPathDialog, setShowAttachByPathDialog] = useState(() => persistedComposerSnapshot.showAttachByPathDialog);
  const [pathPickerCurrentDir, setPathPickerCurrentDir] = useState(() => persistedComposerSnapshot.pathPickerCurrentDir);
  const [pathPickerEntries, setPathPickerEntries] = useState<TreeEntry[]>(() => persistedComposerSnapshot.pathPickerEntries);
  const [pathPickerSelected, setPathPickerSelected] = useState<TreeEntry | null>(() => persistedComposerSnapshot.pathPickerSelected);
  const [pathPickerLoading, setPathPickerLoading] = useState(false);
  const [pathPickerError, setPathPickerError] = useState<string | null>(() => persistedComposerSnapshot.pathPickerError);
  const [pathPickerCustomRoot, setPathPickerCustomRoot] = useState(() => persistedComposerSnapshot.pathPickerCustomRoot);
  const [sendPulse, setSendPulse] = useState(false);
  const [sendError, setSendError] = useState(false);

  const uploadsEnabled = isUploadsEnabled(uploadConfig);
  const attachByPathEnabled = uploadConfig.fileReferenceEnabled;

  // Persistent command history (terminal-style up/down navigation)
  const inputHistory = useInputHistory();

  // Tab completion for session names
  const { sessions, agentName: ctxAgentName } = useSessionContext();
  const { liveTranscriptionPreview, sttInputMode, sttProvider } = useSettings();
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

  const resizeInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  }, []);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
    // Add brief highlight animation
    inputRef.current?.classList.add('ring-2', 'ring-primary', 'ring-offset-1');
    setTimeout(() => {
      inputRef.current?.classList.remove('ring-2', 'ring-primary', 'ring-offset-1');
    }, 500);
  }, []);

  const scheduleDeferredResize = useCallback(() => {
    if (deferredResizeFrameRef.current !== null) {
      cancelAnimationFrame(deferredResizeFrameRef.current);
    }
    if (deferredResizeSettledFrameRef.current !== null) {
      cancelAnimationFrame(deferredResizeSettledFrameRef.current);
    }

    deferredResizeFrameRef.current = requestAnimationFrame(() => {
      resizeInput();
      deferredResizeSettledFrameRef.current = requestAnimationFrame(() => {
        resizeInput();
        const input = inputRef.current;
        if (!input) return;
        input.setSelectionRange(input.value.length, input.value.length);
      });
    });
  }, [resizeInput]);

  useEffect(() => () => {
    if (deferredResizeFrameRef.current !== null) {
      cancelAnimationFrame(deferredResizeFrameRef.current);
    }
    if (deferredResizeSettledFrameRef.current !== null) {
      cancelAnimationFrame(deferredResizeSettledFrameRef.current);
    }
  }, []);

  useEffect(() => {
    persistedComposerSnapshot = {
      text: draftText,
      stagedAttachments,
      attachmentError,
      showAttachByPathDialog,
      pathPickerCurrentDir,
      pathPickerEntries,
      pathPickerSelected,
      pathPickerError,
      pathPickerCustomRoot,
    };
  }, [
    attachmentError,
    draftText,
    pathPickerCurrentDir,
    pathPickerCustomRoot,
    pathPickerEntries,
    pathPickerError,
    pathPickerSelected,
    showAttachByPathDialog,
    stagedAttachments,
  ]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    if (input.value !== draftText) {
      input.value = draftText;
    }
    resizeInput();
  }, [draftText, resizeInput]);

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/upload-config', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (controller.signal.aborted || !data) return;
        const nextConfig: UploadFeatureConfig = {
          twoModeEnabled: Boolean(data.twoModeEnabled),
          inlineEnabled: Boolean(data.inlineEnabled),
          fileReferenceEnabled: Boolean(data.fileReferenceEnabled),
          modeChooserEnabled: Boolean(data.modeChooserEnabled),
          inlineAttachmentMaxMb:
            typeof data.inlineAttachmentMaxMb === 'number' && data.inlineAttachmentMaxMb > 0
              ? data.inlineAttachmentMaxMb
              : DEFAULT_UPLOAD_FEATURE_CONFIG.inlineAttachmentMaxMb,
          inlineImageContextMaxBytes:
            typeof data.inlineImageContextMaxBytes === 'number' && data.inlineImageContextMaxBytes > 0
              ? data.inlineImageContextMaxBytes
              : DEFAULT_UPLOAD_FEATURE_CONFIG.inlineImageContextMaxBytes,
          inlineImageAutoDowngradeToFileReference: data.inlineImageAutoDowngradeToFileReference !== false,
          inlineImageShrinkMinDimension:
            typeof data.inlineImageShrinkMinDimension === 'number' && data.inlineImageShrinkMinDimension > 0
              ? data.inlineImageShrinkMinDimension
              : DEFAULT_UPLOAD_FEATURE_CONFIG.inlineImageShrinkMinDimension,
          inlineImageMaxDimension:
            typeof data.inlineImageMaxDimension === 'number' && data.inlineImageMaxDimension > 0
              ? data.inlineImageMaxDimension
              : DEFAULT_UPLOAD_FEATURE_CONFIG.inlineImageMaxDimension,
          inlineImageWebpQuality:
            typeof data.inlineImageWebpQuality === 'number' && data.inlineImageWebpQuality > 0
              ? data.inlineImageWebpQuality
              : DEFAULT_UPLOAD_FEATURE_CONFIG.inlineImageWebpQuality,
          exposeInlineBase64ToAgent: Boolean(data.exposeInlineBase64ToAgent),
        };
        setUploadConfig(nextConfig);
      })
      .catch((err) => {
        if ((err as DOMException)?.name === 'AbortError') return;
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (uploadsEnabled) return;
    if (stagedAttachments.length > 0) {
      stagedAttachments.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      setStagedAttachments([]);
    }
  }, [uploadsEnabled, stagedAttachments]);

  const injectComposerText = useCallback((text: string, mode: 'replace' | 'append' = 'append') => {
    const input = inputRef.current;
    if (!input) return;

    input.value = mode === 'append'
      ? mergeAddToChatText(input.value, text)
      : text;
    setDraftText(input.value);
    resizeInput();
    focusInput();
    scheduleDeferredResize();
    input.setSelectionRange(input.value.length, input.value.length);
    resetTabCompletion();
  }, [focusInput, resetTabCompletion, resizeInput, scheduleDeferredResize]);

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
    const input = inputRef.current;
    if (input) {
      input.value = '';
      input.style.height = 'auto';
      input.style.fontStyle = '';
      input.style.opacity = '';
    }
    setDraftText('');
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

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const selected = Array.from(files);
    if (selected.length === 0) return;
    setAttachmentError(null);

    if (!uploadsEnabled) {
      setAttachmentError('Uploads are disabled by configuration.');
      return;
    }

    const availableSlots = MAX_ATTACHMENTS - stagedAttachments.length;
    if (availableSlots <= 0) {
      setAttachmentError(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
      return;
    }

    const filesToStage = selected.slice(0, availableSlots);
    if (selected.length > availableSlots) {
      setAttachmentError(`Only ${MAX_ATTACHMENTS} files are allowed per message.`);
    }

    const inlineCapBytes = getInlineAttachmentMaxBytes(uploadConfig);
    const accepted: File[] = [];
    let firstError: string | null = null;

    for (const file of filesToStage) {
      const defaultMode = getDefaultUploadMode(file, uploadConfig);
      if (!defaultMode) {
        firstError ||= 'Uploads are disabled by configuration.';
        continue;
      }

      if (!uploadConfig.inlineEnabled) {
        firstError ||= 'Browser uploads are disabled by configuration. Enable uploads or browse by path.';
        continue;
      }

      if (!file.type.startsWith('image/') && file.size > inlineCapBytes) {
        const maxMb = Number.isInteger(uploadConfig.inlineAttachmentMaxMb)
          ? String(uploadConfig.inlineAttachmentMaxMb)
          : uploadConfig.inlineAttachmentMaxMb.toFixed(1);
        firstError ||= `"${file.name}" is too large to send as a browser upload (${maxMb}MB max inline). Choose a smaller file or browse by path.`;
        continue;
      }

      accepted.push(file);
    }

    if (accepted.length > 0) {
      try {
        const staged = await importBrowserUploadsToCanonicalReferences(accepted);
        const next = staged.map((artifact, index) => {
          const sourceFile = accepted[index];
          const mimeType = artifact.mimeType || sourceFile?.type || 'application/octet-stream';
          const stagedFile = createServerPathBackedFile({
            name: sourceFile?.name || artifact.originalName,
            absolutePath: artifact.absolutePath,
            sizeBytes: artifact.sizeBytes,
            mimeType,
          });

          return {
            id: crypto.randomUUID ? crypto.randomUUID() : `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            file: stagedFile,
            origin: 'upload' as const,
            mode: 'file_reference' as const,
            previewUrl: mimeType.startsWith('image/') && sourceFile ? URL.createObjectURL(sourceFile) : undefined,
            relativePath: artifact.canonicalPath,
          };
        });

        setStagedAttachments((prev) => [...prev, ...next]);
      } catch (error) {
        firstError ||= error instanceof Error ? error.message : 'Failed to stage browser uploads.';
      }
    }

    if (firstError) {
      setAttachmentError(firstError);
    }
  }, [stagedAttachments.length, uploadConfig, uploadsEnabled]);

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

  // Paste images — use ref to avoid re-registering on every stagedAttachments change
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

  const removeStagedAttachment = useCallback((id: string) => {
    setStagedAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      revokeAttachmentPreview(target?.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
    setAttachmentError(null);
  }, []);

  const clearStagedAttachments = useCallback(() => {
    setStagedAttachments((prev) => {
      prev.forEach((item) => revokeAttachmentPreview(item.previewUrl));
      return [];
    });
  }, []);

  const stageWorkspaceFileReference = useCallback(async (path: string, agentId?: string) => {
    if (!attachByPathEnabled) {
      setAttachmentError('Workspace path attachments are disabled by configuration.');
      return;
    }

    const availableSlots = MAX_ATTACHMENTS - stagedAttachments.length;
    if (availableSlots <= 0) {
      setAttachmentError(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
      return;
    }

    setAttachmentError(null);
    const reference = await resolveWorkspacePathToCanonicalReference(path, agentId);
    const mimeType = reference.mimeType || inferMimeTypeFromName(reference.originalName || path);
    const syntheticFile = createServerPathBackedFile({
      name: reference.originalName,
      absolutePath: reference.absolutePath,
      sizeBytes: reference.sizeBytes,
      mimeType,
    });
    const previewUrl = mimeType.startsWith('image/')
      ? `/api/files/raw?path=${encodeURIComponent(reference.canonicalPath)}`
      : undefined;

    setStagedAttachments((prev) => ([...prev, {
      id: crypto.randomUUID ? crypto.randomUUID() : `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file: syntheticFile,
      origin: 'server_path',
      mode: 'file_reference',
      previewUrl,
      relativePath: reference.canonicalPath,
    }]));
    focusInput();
  }, [attachByPathEnabled, focusInput, stagedAttachments.length]);

  // Expose focus/add-to-chat methods to parent
  useImperativeHandle(ref, () => ({
    focus: focusInput,
    injectText: injectComposerText,
    addWorkspacePath: async (path: string, kind: 'file' | 'directory', agentId?: string) => {
      if (kind === 'directory') {
        injectComposerText(formatWorkspacePathAddToChat({
          source: 'Workspace',
          kind,
          path,
        }), 'append');
        return;
      }

      await stageWorkspaceFileReference(path, agentId);
    },
  }), [focusInput, injectComposerText, stageWorkspaceFileReference]);

  const loadPathPickerDirectory = useCallback(async (dirPath: string) => {
    setPathPickerLoading(true);
    setPathPickerError(null);
    try {
      const query = dirPath ? `?path=${encodeURIComponent(dirPath)}&depth=1` : '?depth=1';
      const response = await fetch(`/api/files/tree${query}`);
      const payload = await response.json().catch(() => null) as FileTreeResponse | null;
      if (!response.ok || !payload?.ok || !Array.isArray(payload.entries) || !payload.workspaceInfo?.rootPath) {
        throw new Error(payload?.error || 'Failed to load workspace files.');
      }

      setPathPickerEntries(payload.entries);
      setPathPickerCurrentDir(payload.root === '.' ? '' : (payload.root || dirPath));
      setPathPickerSelected(null);
      setPathPickerCustomRoot(Boolean(payload.workspaceInfo.isCustomWorkspace));
    } catch (error) {
      setPathPickerError(error instanceof Error ? error.message : 'Failed to load workspace files.');
      setPathPickerEntries([]);
      setPathPickerSelected(null);
    } finally {
      setPathPickerLoading(false);
    }
  }, []);

  const attachSelectedServerPath = useCallback(async () => {
    if (!pathPickerSelected || pathPickerSelected.type !== 'file') return;

    try {
      await stageWorkspaceFileReference(pathPickerSelected.path);
      setShowAttachByPathDialog(false);
    } catch (error) {
      setPathPickerError(error instanceof Error ? error.message : 'Failed to resolve selected workspace path.');
    }
  }, [pathPickerSelected, stageWorkspaceFileReference]);

  useEffect(() => {
    if (!showAttachByPathDialog) return;
    void loadPathPickerDirectory(pathPickerCurrentDir);
  }, [loadPathPickerDirectory, pathPickerCurrentDir, showAttachByPathDialog]);

  // Report wake word state to parent
  useEffect(() => {
    onWakeWordState?.(wakeWordEnabled, toggleWakeWord);
  }, [wakeWordEnabled, toggleWakeWord, onWakeWordState]);

  const buildInlineAttachment = useCallback(async (item: StagedAttachment): Promise<{
    attachment: ImageAttachment;
    preparation?: UploadPreparationMetadata;
  }> => {
    if (item.file.type.startsWith('image/')) {
      const compressed = await compressImage(item.file, {
        contextMaxBytes: uploadConfig.inlineImageContextMaxBytes,
        contextTargetBytes: Math.floor(uploadConfig.inlineImageContextMaxBytes * 0.9),
        maxDimension: uploadConfig.inlineImageMaxDimension,
        minDimension: uploadConfig.inlineImageShrinkMinDimension,
        webpQuality: uploadConfig.inlineImageWebpQuality,
      });
      return {
        attachment: {
          id: item.id,
          mimeType: compressed.mimeType,
          content: compressed.base64,
          preview: compressed.preview,
          name: item.file.name,
        },
        preparation: {
          sourceMode: 'inline',
          finalMode: 'inline',
          outcome: 'optimized_inline',
          reason: `Adaptive inline shrink fit within the context-safe budget (${formatFileSize(compressed.bytes)} <= ${formatFileSize(uploadConfig.inlineImageContextMaxBytes)}).`,
          originalMimeType: item.file.type || 'application/octet-stream',
          originalSizeBytes: item.file.size,
          inlineBase64Bytes: compressed.bytes,
          contextSafetyMaxBytes: uploadConfig.inlineImageContextMaxBytes,
          inlineTargetBytes: compressed.targetBytes,
          inlineChosenWidth: compressed.width,
          inlineChosenHeight: compressed.height,
          inlineIterations: compressed.iterations,
          inlineMinDimension: compressed.minDimension,
          localPathAvailable: hasResolvableLocalPath(item.file),
        },
      };
    }

    const dataUrl = await readAsDataUrl(item.file);
    const [, base64 = ''] = dataUrl.split(',', 2);
    return {
      attachment: {
        id: item.id,
        mimeType: item.file.type || 'application/octet-stream',
        content: base64,
        preview: dataUrl,
        name: item.file.name,
      },
    };
  }, [
    uploadConfig.inlineImageMaxDimension,
    uploadConfig.inlineImageWebpQuality,
    uploadConfig.inlineImageContextMaxBytes,
    uploadConfig.inlineImageShrinkMinDimension,
  ]);

  const buildInlineDescriptor = useCallback((
    item: StagedAttachment,
    attachment: ImageAttachment,
    preparation?: UploadPreparationMetadata,
  ): UploadAttachmentDescriptor => ({
    id: item.id,
    origin: item.origin,
    mode: 'inline',
    name: item.file.name,
    mimeType: attachment.mimeType,
    sizeBytes: item.file.size,
    inline: {
      encoding: 'base64',
      base64: attachment.content,
      base64Bytes: getBase64ByteLength(attachment.content),
      previewUrl: attachment.preview,
      compressed: item.file.type.startsWith('image/'),
    },
    preparation,
    policy: {
      forwardToSubagents: true,
    },
  }), []);

  const buildFileReferenceDescriptor = useCallback(async (
    item: StagedAttachment,
    preparation?: UploadPreparationMetadata,
  ): Promise<UploadAttachmentDescriptor> => ({
    id: item.id,
    origin: item.origin,
    mode: 'file_reference',
    name: item.file.name,
    mimeType: item.file.type || 'application/octet-stream',
    sizeBytes: item.file.size,
    reference: resolveFileReference(item.file),
    preparation,
    policy: {
      forwardToSubagents: true,
    },
  }), []);

  const prepareInlineItem = useCallback(async (item: StagedAttachment): Promise<{
    inlineAttachment?: ImageAttachment;
    descriptor: UploadAttachmentDescriptor;
  }> => {
    const { attachment: inlineAttachment, preparation } = await buildInlineAttachment(item);
    const inlineBase64Bytes = getBase64ByteLength(inlineAttachment.content);
    const localPathAvailable = hasResolvableLocalPath(item.file);

    if (!item.file.type.startsWith('image/')) {
      return {
        inlineAttachment,
        descriptor: buildInlineDescriptor(item, inlineAttachment, {
          sourceMode: 'inline',
          finalMode: 'inline',
          outcome: 'inline_ready',
          originalMimeType: item.file.type || 'application/octet-stream',
          originalSizeBytes: item.file.size,
          inlineBase64Bytes,
          localPathAvailable,
        }),
      };
    }

    if (inlineBase64Bytes <= uploadConfig.inlineImageContextMaxBytes) {
      return {
        inlineAttachment,
        descriptor: buildInlineDescriptor(item, inlineAttachment, {
          ...preparation,
          sourceMode: 'inline',
          finalMode: 'inline',
          outcome: 'optimized_inline',
          reason: preparation?.inlineBase64Bytes != null && preparation.inlineTargetBytes != null && preparation.inlineBase64Bytes <= preparation.inlineTargetBytes
            ? `Adaptive inline shrink fit under the target budget (${formatFileSize(preparation.inlineBase64Bytes)} <= ${formatFileSize(preparation.inlineTargetBytes)}).`
            : `Adaptive inline shrink fit within the context-safe budget (${formatFileSize(inlineBase64Bytes)} <= ${formatFileSize(uploadConfig.inlineImageContextMaxBytes)}).`,
          originalMimeType: item.file.type || 'application/octet-stream',
          originalSizeBytes: item.file.size,
          inlineBase64Bytes,
          contextSafetyMaxBytes: uploadConfig.inlineImageContextMaxBytes,
          localPathAvailable,
        }),
      };
    }

    const fallbackReason = `Adaptive inline shrinking hit the minimum dimension (${uploadConfig.inlineImageShrinkMinDimension}px) without reaching the context-safe budget.`;

    if (
      item.origin === 'server_path'
      && uploadConfig.inlineImageAutoDowngradeToFileReference
      && uploadConfig.fileReferenceEnabled
      && localPathAvailable
    ) {
      return {
        descriptor: await buildFileReferenceDescriptor(item, {
          ...preparation,
          sourceMode: 'inline',
          finalMode: 'file_reference',
          outcome: 'downgraded_to_file_reference',
          reason: `${fallbackReason} Falling back to file reference (${formatFileSize(inlineBase64Bytes)} > ${formatFileSize(uploadConfig.inlineImageContextMaxBytes)}).`,
          originalMimeType: item.file.type || 'application/octet-stream',
          originalSizeBytes: item.file.size,
          inlineBase64Bytes,
          contextSafetyMaxBytes: uploadConfig.inlineImageContextMaxBytes,
          inlineFallbackReason: 'minimum inline dimension reached; used file reference fallback',
          localPathAvailable: true,
        }),
      };
    }

    if (item.origin === 'upload') {
      throw new Error(
        `"${item.file.name}" was blocked after adaptive inline shrinking reached the minimum dimension (${uploadConfig.inlineImageShrinkMinDimension}px) and browser uploads cannot preserve a true file-reference fallback (${formatFileSize(inlineBase64Bytes)} > ${formatFileSize(uploadConfig.inlineImageContextMaxBytes)}). Send a smaller image or browse by path.`,
      );
    }

    throw new Error(
      uploadConfig.fileReferenceEnabled
        ? `"${item.file.name}" was blocked after adaptive inline shrinking reached the minimum dimension (${uploadConfig.inlineImageShrinkMinDimension}px) and no file-reference fallback was available (${formatFileSize(inlineBase64Bytes)} > ${formatFileSize(uploadConfig.inlineImageContextMaxBytes)}).`
        : `"${item.file.name}" was blocked after adaptive inline shrinking reached the minimum dimension (${uploadConfig.inlineImageShrinkMinDimension}px) (${formatFileSize(inlineBase64Bytes)} > ${formatFileSize(uploadConfig.inlineImageContextMaxBytes)}). Enable file-reference mode or choose a smaller image.`,
    );
  }, [
    buildFileReferenceDescriptor,
    buildInlineAttachment,
    buildInlineDescriptor,
    uploadConfig.fileReferenceEnabled,
    uploadConfig.inlineImageAutoDowngradeToFileReference,
    uploadConfig.inlineImageContextMaxBytes,
    uploadConfig.inlineImageShrinkMinDimension,
  ]);

  const handleSend = useCallback(async () => {
    const text = inputRef.current?.value.trim();
    if (!text && stagedAttachments.length === 0) {
      // Shake on empty send attempt
      setSendError(true);
      setTimeout(() => setSendError(false), 400);
      return;
    }

    const inlineGuardrailViolation = stagedAttachments
      .filter((item) => item.mode === 'inline')
      .map((item) => getInlineModeGuardrailError(item.file, uploadConfig))
      .find(Boolean);
    if (inlineGuardrailViolation) {
      setAttachmentError(inlineGuardrailViolation);
      return;
    }

    // Add to persistent command history (deduplication handled by hook)
    if (text) inputHistory.addToHistory(text);

    setIsPreparingInline(true);
    try {
      const inlineAttachments: ImageAttachment[] = [];
      const descriptors: UploadAttachmentDescriptor[] = [];

      for (const item of stagedAttachments) {
        if (item.mode === 'inline') {
          const prepared = await prepareInlineItem(item);
          if (prepared.inlineAttachment) {
            inlineAttachments.push(prepared.inlineAttachment);
          }
          descriptors.push(prepared.descriptor);
          continue;
        }

        const descriptor = await buildFileReferenceDescriptor(item, {
          sourceMode: 'file_reference',
          finalMode: 'file_reference',
          outcome: 'file_reference_ready',
          reason: 'Sent as file reference.',
          originalMimeType: item.file.type || 'application/octet-stream',
          originalSizeBytes: item.file.size,
          localPathAvailable: hasResolvableLocalPath(item.file),
        });
        descriptors.push(descriptor);
      }

      const uploadPayload: OutgoingUploadPayload | undefined = descriptors.length > 0
        ? {
          descriptors,
          manifest: {
            enabled: true,
            exposeInlineBase64ToAgent: uploadConfig.exposeInlineBase64ToAgent,
            allowSubagentForwarding: true,
          },
        }
        : undefined;

      // Trigger pulse animation on successful send
      setSendPulse(true);
      setTimeout(() => setSendPulse(false), 400);

      const input = inputRef.current;
      if (input) {
        input.value = '';
        input.style.height = 'auto';
      }
      setDraftText('');

      await onSend(text || '', inlineAttachments.length > 0 ? inlineAttachments : undefined, uploadPayload);
      clearStagedAttachments();
      setAttachmentError(null);
      clearVoiceError();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to prepare attachment payload.';
      if (message.includes('does not expose a local path')) {
        setAttachmentError(`${message} Choose inline mode when available or attach from a local workspace path.`);
      } else {
        setAttachmentError(message);
      }
    } finally {
      setIsPreparingInline(false);
    }
  }, [
    stagedAttachments,
    uploadConfig,
    inputHistory,
    buildFileReferenceDescriptor,
    onSend,
    prepareInlineItem,
    clearStagedAttachments,
    clearVoiceError,
  ]);

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
      setDraftText('');
      return;
    }

    // Cmd+Enter or Ctrl+Enter to send (works even with Shift held)
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSend();
      return;
    }
    // Plain Enter sends (Shift+Enter for newline)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
      return;
    }

    // Up arrow history behavior for single-line inputs:
    // 1) caret not at start -> move caret to start
    // 2) caret already at start -> load older history entry
    // Multi-line input keeps native ArrowUp behavior.
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      const input = inputRef.current;
      if (!input) return;

      const isAtStart = input.selectionStart === 0 && input.selectionEnd === 0;
      const isSingleLine = !input.value.includes('\n');

      if (!isSingleLine) return;

      if (!isAtStart) {
        e.preventDefault();
        input.setSelectionRange(0, 0);
        return;
      }

      const entry = inputHistory.navigateUp(input.value);
      if (entry !== null) {
        e.preventDefault();
        input.value = entry;
        setDraftText(entry);
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 160) + 'px';
        input.setSelectionRange(input.value.length, input.value.length);
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
          setDraftText(entry);
        } else {
          input.value = '';
          setDraftText('');
        }
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 160) + 'px';
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  };

  const handleInput = () => {
    if (!inputRef.current) return;
    setDraftText(inputRef.current.value);
    resetTabCompletion();
    clearVoiceError();
    resizeInput();
  };

  const openUploadFilesPicker = useCallback(() => {
    if (!uploadsEnabled) return;
    fileInputRef.current?.click();
  }, [uploadsEnabled]);

  const pathPickerBreadcrumbs = pathPickerCurrentDir
    ? pathPickerCurrentDir.split('/').filter(Boolean)
    : [];
  const fileAccept = uploadConfig.fileReferenceEnabled || uploadConfig.twoModeEnabled ? '*/*' : 'image/*';

  return (
    <>
      {/* Drag overlay — rendered by parent via dragHandlers */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary flex items-center justify-center pointer-events-none">
          <span className="text-primary font-bold text-lg">Drop files here</span>
        </div>
      )}

      {/* Staged attachments preview */}
      {stagedAttachments.length > 0 && (
        <div className="flex flex-col gap-2 px-4 py-2 bg-card border-t border-border">
          <div className="flex gap-2 flex-wrap">
            {stagedAttachments.map((item) => {
              const relativePathBasename = item.relativePath?.split('/').filter(Boolean).pop();
              const showRelativePath = item.origin === 'server_path'
                && Boolean(item.relativePath)
                && relativePathBasename !== item.file.name;

              return (
                <div key={item.id} className="relative group border border-border rounded px-2 py-1.5 bg-background min-w-[190px] max-w-[260px]">
                  <button
                    onClick={() => removeStagedAttachment(item.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center text-[10px] opacity-80 hover:opacity-100 cursor-pointer"
                  >
                    <X size={10} />
                  </button>

                  <div className="flex items-center gap-2 pr-3">
                    {item.previewUrl ? (
                      <img src={item.previewUrl} alt={item.file.name} className="w-10 h-10 object-cover rounded border border-border" />
                    ) : (
                      <div className="w-10 h-10 rounded border border-border flex items-center justify-center bg-muted">
                        <FileText size={14} className="text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] truncate">{item.file.name}</div>
                      <div className="text-[10px] text-muted-foreground">{formatFileSize(item.file.size)}</div>
                      {showRelativePath && (
                        <div className="text-[9px] mt-0.5 truncate text-muted-foreground">{item.relativePath}</div>
                      )}
                      <div className="text-[9px] mt-0.5 text-primary/90 uppercase">{item.origin === 'server_path' ? 'Local File' : 'Upload'}</div>
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        </div>
      )}
      {attachmentError && (
        <div className="px-4 pb-1.5 text-[10px] text-destructive bg-card">{attachmentError}</div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={fileAccept}
        multiple
        className="hidden"
        onChange={e => { if (e.target.files) { processFiles(e.target.files); e.target.value = ''; } }}
      />
      {/* Input row */}
      <div
        className={`flex items-start gap-0 border-t shrink-0 bg-card focus-within:border-t-primary/40 focus-within:shadow-[0_-1px_8px_rgba(232,168,56,0.1)] ${voiceState === 'recording' ? 'border-t-red-500 shadow-[0_-1px_12px_rgba(239,68,68,0.3)]' : 'border-border'}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {voiceState === 'recording' ? (
          <span className="self-start pl-3.5 pt-3 shrink-0 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <Mic size={14} className="text-red-500" />
          </span>
        ) : voiceState === 'transcribing' ? (
          <span className="self-start pl-3.5 pt-3 shrink-0 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <Mic size={14} className="text-primary" />
          </span>
        ) : (
          <span className="self-start text-primary text-base leading-none font-bold pl-3.5 pt-3 shrink-0 animate-prompt-pulse">›</span>
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
        {showCommandPaletteButton && onOpenCommandPalette && (
          <button
            type="button"
            onClick={onOpenCommandPalette}
            className="bg-transparent border-none text-muted-foreground hover:text-primary cursor-pointer px-2.5 self-stretch h-full flex items-center justify-center"
            title="Open command palette"
            aria-label="Open command palette"
          >
            <Command size={16} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={openUploadFilesPicker}
          disabled={!uploadsEnabled}
          className="bg-transparent border-none text-muted-foreground hover:text-primary cursor-pointer px-2 self-stretch h-full flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
          title={uploadsEnabled ? 'Attach files' : 'Uploads disabled by configuration'}
          aria-label={uploadsEnabled ? 'Attach files' : 'Uploads disabled by configuration'}
        >
          <Paperclip size={16} />
        </button>
        <button
          onClick={() => { void handleSend(); }}
          disabled={isGenerating || isPreparingInline}
          aria-label={isGenerating ? 'Generating response...' : (isPreparingInline ? 'Preparing attachments...' : 'Send message')}
          aria-busy={isGenerating || isPreparingInline}
          className={`send-btn font-mono bg-primary text-primary-foreground border-none px-4.5 text-sm cursor-pointer font-bold self-stretch flex items-center justify-center transition-transform ${isGenerating || isPreparingInline ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-110 active:scale-95'} ${sendPulse ? 'animate-send-pulse' : ''} ${sendError ? 'animate-shake' : ''}`}
        >
          {isGenerating || isPreparingInline ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground px-4 pb-1.5 pl-10 bg-card">
        <span>
          {voiceState === 'recording'
            ? 'Recording… Left Shift to send · Double Left Shift to discard'
            : voiceState === 'transcribing'
            ? 'Transcribing…'
            : 'Enter or ⌘Enter to send · Shift+Enter for newline · Double Left Shift for voice · ⌘K command palette'}
        </span>
      </div>
      {voiceError && (
        <div className="text-[10px] text-destructive px-4 pb-1.5 pl-10 bg-card" role="alert">
          {voiceError}
        </div>
      )}
      <Dialog open={showAttachByPathDialog} onOpenChange={setShowAttachByPathDialog}>
        <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="shrink-0 px-6 pt-6">
            <DialogTitle>Browse workspace files</DialogTitle>
            <DialogDescription>
              Pick a validated workspace file. The selected path will be attached directly as a file reference.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 space-y-3 overflow-y-auto px-6 pb-4">
            <div className="flex flex-wrap items-center gap-1 rounded border border-border/70 bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
              <button
                type="button"
                onClick={() => setPathPickerCurrentDir('')}
                className="rounded px-1.5 py-0.5 hover:bg-accent hover:text-accent-foreground"
              >
                {pathPickerCustomRoot ? 'Server root' : 'Workspace'}
              </button>
              {pathPickerBreadcrumbs.map((segment, index) => {
                const nextPath = pathPickerBreadcrumbs.slice(0, index + 1).join('/');
                return (
                  <span key={nextPath} className="flex items-center gap-1">
                    <span>/</span>
                    <button
                      type="button"
                      onClick={() => setPathPickerCurrentDir(nextPath)}
                      className="rounded px-1.5 py-0.5 hover:bg-accent hover:text-accent-foreground"
                    >
                      {segment}
                    </button>
                  </span>
                );
              })}
            </div>

            <div className="rounded border border-border/70">
              <div className="max-h-[320px] overflow-y-auto">
                {pathPickerLoading ? (
                  <div className="flex items-center justify-center gap-2 px-3 py-8 text-[12px] text-muted-foreground">
                    <Loader2 size={14} className="animate-spin" />
                    Loading files…
                  </div>
                ) : pathPickerError ? (
                  <div className="px-3 py-8 text-center text-[12px] text-destructive">{pathPickerError}</div>
                ) : pathPickerEntries.length === 0 ? (
                  <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">No files in this directory.</div>
                ) : (
                  <div className="divide-y divide-border/60">
                    {pathPickerEntries.map((entry) => {
                      const isSelected = pathPickerSelected?.path === entry.path;
                      const isFile = entry.type === 'file';
                      return (
                        <button
                          key={entry.path}
                          type="button"
                          onClick={() => {
                            if (entry.type === 'directory') {
                              setPathPickerCurrentDir(entry.path);
                              return;
                            }
                            setPathPickerSelected(entry);
                          }}
                          className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12px] hover:bg-accent/60 ${isSelected ? 'bg-accent/70 text-accent-foreground' : ''}`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {entry.type === 'directory' ? <FolderOpen size={14} className="shrink-0 text-primary" /> : <FileText size={14} className="shrink-0 text-muted-foreground" />}
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{entry.name}</span>
                              <span className="block truncate text-[10px] text-muted-foreground">{entry.path}</span>
                            </span>
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">{isFile ? formatFileSize(entry.size ?? 0) : 'Folder'}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded border border-border/70 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
              {pathPickerSelected
                ? <>Selected: <span className="font-medium text-foreground">{pathPickerSelected.path}</span></>
                : 'Select a file to attach it as a server path reference.'}
            </div>
          </div>
          <DialogFooter showCloseButton className="shrink-0 border-t border-border/70 px-6 py-4">
            <button
              type="button"
              onClick={() => {
                const current = pathPickerCurrentDir;
                if (!current) return;
                const parent = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '';
                setPathPickerCurrentDir(parent);
              }}
              disabled={!pathPickerCurrentDir || pathPickerLoading}
              className="rounded border border-border px-3 py-1.5 text-[11px] text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              Up
            </button>
            <button
              type="button"
              onClick={() => { void loadPathPickerDirectory(pathPickerCurrentDir); }}
              disabled={pathPickerLoading}
              className="rounded border border-border px-3 py-1.5 text-[11px] text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => { void attachSelectedServerPath(); }}
              disabled={!pathPickerSelected || pathPickerLoading}
              className="rounded bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              Attach selected path
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
