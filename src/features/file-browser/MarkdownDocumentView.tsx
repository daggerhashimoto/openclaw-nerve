import { useState } from 'react';
import { AlertTriangle, Eye, Loader2, PencilLine, RotateCw } from 'lucide-react';
import { MarkdownRenderer } from '@/features/markdown/MarkdownRenderer';
import type { OpenFile } from './types';
import { FileEditor } from './FileEditor';

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
    <div className="h-full flex flex-col min-h-0 bg-background/20">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2 shrink-0 bg-card/55">
        <div className="min-w-0">
          <div className="text-[0.733rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Markdown document
          </div>
          <div className="truncate text-[0.8rem] text-foreground/90">{file.path}</div>
        </div>
        <div className="inline-flex items-center rounded-xl border border-border/70 bg-background/55 p-1" role="group" aria-label="Document mode">
          <button
            type="button"
            aria-pressed={mode === 'preview'}
            className={`inline-flex min-h-8 items-center gap-2 rounded-[10px] px-3 text-[0.733rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              mode === 'preview'
                ? 'bg-card text-foreground shadow-[0_10px_30px_rgba(0,0,0,0.12)]'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            data-active={mode === 'preview'}
            onClick={() => setMode('preview')}
          >
            <Eye size={14} />
            Preview
          </button>
          <button
            type="button"
            aria-pressed={mode === 'edit'}
            className={`inline-flex min-h-8 items-center gap-2 rounded-[10px] px-3 text-[0.733rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              mode === 'edit'
                ? 'bg-card text-foreground shadow-[0_10px_30px_rgba(0,0,0,0.12)]'
                : 'text-muted-foreground hover:text-foreground'
            }`}
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
            <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="animate-spin" size={14} />
              Loading {file.name}...
            </div>
          ) : file.error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <AlertTriangle size={24} className="text-destructive" />
              <div className="text-sm">
                Failed to load <span className="font-mono text-foreground">{file.name}</span>
              </div>
              <div className="text-xs">{file.error}</div>
              <button
                type="button"
                onClick={() => onRetry(file.path)}
                className="mt-1 flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <RotateCw size={12} />
                Retry
              </button>
            </div>
          ) : (
            <MarkdownRenderer
              content={file.content}
              className="markdown-document-content"
              currentDocumentPath={file.path}
              onOpenBeadId={onOpenBeadId}
              onOpenWorkspacePath={(targetPath, basePath) => onOpenWorkspacePath?.(targetPath, basePath ?? file.path)}
              pathLinkAliases={pathLinkAliases}
              workspaceAgentId={workspaceAgentId}
            />
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <FileEditor
            file={file}
            onContentChange={onContentChange}
            onSave={onSave}
            onRetry={onRetry}
          />
        </div>
      )}
    </div>
  );
}
