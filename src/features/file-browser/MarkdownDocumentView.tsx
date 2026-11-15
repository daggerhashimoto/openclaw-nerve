import { lazy, Suspense, useState } from 'react';
import { AlertTriangle, Eye, Loader2, PencilLine, RotateCw } from 'lucide-react';
import type { OpenFile } from './types';

const MarkdownRenderer = lazy(() =>
  import('@/features/markdown/MarkdownRenderer').then((module) => ({
    default: module.MarkdownRenderer,
  })),
);
const FileEditor = lazy(() =>
  import('./FileEditor').then((module) => ({
    default: module.FileEditor,
  })),
);

interface MarkdownDocumentViewProps {
  file: OpenFile;
  onContentChange: (path: string, content: string) => void;
  onSave: (path: string) => void;
  onRetry: (path: string) => void;
  onOpenWorkspacePath?: (path: string, basePath?: string) => void | Promise<void>;
  onOpenBeadId?: (target: import('@/features/beads').BeadLinkTarget) => void | Promise<void>;
  pathLinkAliases?: Record<string, string>;
  workspaceAgentId?: string;
}

function PaneFallback({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-[0.8rem] text-muted-foreground">
      <Loader2 className="animate-spin" size={14} />
      {label}
    </div>
  );
}

export function MarkdownDocumentView({
  file,
  onContentChange,
  onSave,
  onRetry,
  onOpenWorkspacePath,
  onOpenBeadId,
  pathLinkAliases,
  workspaceAgentId,
}: MarkdownDocumentViewProps) {
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');

  return (
    <div className="h-full flex flex-col min-h-0 bg-background">
      <div className="flex min-h-[var(--row-unit)] shrink-0 items-center justify-between gap-3 border-b border-border bg-card pl-3 pr-1">
        <div className="min-w-0 truncate font-mono text-[0.8rem] text-muted-foreground" title={file.path}>
          {file.path}
        </div>
        <div className="inline-flex shrink-0 items-center gap-0.5" role="group" aria-label="Document mode">
          <button
            type="button"
            aria-pressed={mode === 'preview'}
            className="shell-chip"
            data-active={mode === 'preview'}
            onClick={() => setMode('preview')}
          >
            <Eye size={14} />
            Preview
          </button>
          <button
            type="button"
            aria-pressed={mode === 'edit'}
            className="shell-chip"
            data-active={mode === 'edit'}
            onClick={() => setMode('edit')}
          >
            <PencilLine size={14} />
            Edit
          </button>
        </div>
      </div>

      {mode === 'preview' ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 md:px-6">
          {file.loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-[0.8rem] text-muted-foreground">
              <Loader2 className="animate-spin" size={14} />
              Loading {file.name}...
            </div>
          ) : file.error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <AlertTriangle size={16} className="text-destructive" />
              <div className="text-[0.867rem]">
                Failed to load <span className="font-mono text-foreground">{file.name}</span>
              </div>
              <div className="text-[0.8rem]">{file.error}</div>
              <button
                type="button"
                onClick={() => onRetry(file.path)}
                className="mt-1 inline-flex min-h-[var(--row-unit)] items-center gap-1.5 rounded-[3px] px-2 text-[0.867rem] text-foreground transition-colors duration-[120ms] hover:bg-raised"
              >
                <RotateCw size={14} />
                Retry
              </button>
            </div>
          ) : (
            <Suspense fallback={<PaneFallback label="Loading preview..." />}>
              <MarkdownRenderer
                content={file.content}
                className="markdown-document-content"
                currentDocumentPath={file.path}
                onOpenBeadId={onOpenBeadId}
                onOpenWorkspacePath={(targetPath, basePath) => onOpenWorkspacePath?.(targetPath, basePath ?? file.path)}
                pathLinkAliases={pathLinkAliases}
                workspaceAgentId={workspaceAgentId}
              />
            </Suspense>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <Suspense fallback={<PaneFallback label="Loading editor..." />}>
            <FileEditor
              file={file}
              onContentChange={onContentChange}
              onSave={onSave}
              onRetry={onRetry}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
