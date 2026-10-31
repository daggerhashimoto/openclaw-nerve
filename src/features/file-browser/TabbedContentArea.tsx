/**
 * TabbedContentArea: Container with tab bar that switches between
 * the chat panel and open file editors.
 *
 * Chat panel is always mounted (hidden via CSS, never unmounted)
 * to preserve scroll position, streaming state, and input draft.
 */

import { type ReactNode, lazy, Suspense } from 'react';
import { Loader2, AlertTriangle, X } from 'lucide-react';
import { EditorTabBar } from './EditorTabBar';
import { ImageViewer } from './ImageViewer';
import { MarkdownDocumentView } from './MarkdownDocumentView';
import { PdfViewer } from './PdfViewer';
import { isImageFile, isMarkdownFile, isPdfFile } from './utils/fileTypes';
import type { OpenFile } from './types';
import { BeadViewerTab, type BeadLinkTarget, type OpenBeadTab } from '@/features/beads';

// Lazy-load CodeMirror editor: keeps it out of the initial bundle
const FileEditor = lazy(() => import('./FileEditor'));

function EditorFallback() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-[0.8rem] text-muted-foreground">
      <Loader2 className="animate-spin" size={14} aria-hidden="true" />
      Loading editor
    </div>
  );
}

interface SaveToast {
  agentId?: string;
  path: string;
  type: 'conflict';
}

interface TabbedContentAreaProps {
  activeTab: string;
  openFiles: OpenFile[];
  openBeads?: OpenBeadTab[];
  workspaceAgentId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onContentChange: (path: string, content: string) => void;
  onSaveFile: (path: string) => void;
  onRetryFile: (path: string) => void;
  onReloadFile?: (path: string) => void;
  onOpenWorkspacePath?: (path: string, basePath?: string) => void | Promise<void>;
  onOpenBeadId?: (target: BeadLinkTarget) => void;
  pathLinkPrefixes?: string[];
  pathLinkAliases?: Record<string, string>;
  saveToast?: SaveToast | null;
  onDismissToast?: () => void;
  /** The chat panel rendered as-is (never unmounted). */
  chatPanel: ReactNode;
}

export function TabbedContentArea({
  activeTab,
  openFiles,
  openBeads = [],
  workspaceAgentId,
  onSelectTab,
  onCloseTab,
  onContentChange,
  onSaveFile,
  onRetryFile,
  onReloadFile,
  onOpenWorkspacePath,
  onOpenBeadId,
  pathLinkPrefixes,
  pathLinkAliases,
  saveToast,
  onDismissToast,
  chatPanel,
}: TabbedContentAreaProps) {
  const hasOpenTabs = openFiles.length > 0 || openBeads.length > 0;
  const visibleSaveToast = saveToast && (!saveToast.agentId || saveToast.agentId === workspaceAgentId)
    ? saveToast
    : null;

  return (
    <div className="h-full flex flex-col min-h-0 min-w-0">
      {/* Tab bar: only shown when files are open */}
      {hasOpenTabs && (
        <EditorTabBar
          activeTab={activeTab}
          openFiles={openFiles}
          openBeads={openBeads}
          onSelectTab={onSelectTab}
          onCloseTab={onCloseTab}
        />
      )}

      {/* Content area */}
      <div className="flex-1 min-h-0 relative">
        {/* Chat panel: always mounted, hidden when file tab is active */}
        <div
          className={activeTab === 'chat' || !hasOpenTabs ? 'h-full' : 'hidden'}
          role="tabpanel"
          id="tabpanel-chat"
          aria-labelledby="tab-chat"
        >
          {chatPanel}
        </div>

        {/* File editors: one per open file, only active one visible */}
        {openFiles.map((file) => (
          <div
            key={file.path}
            className={activeTab === file.path ? 'h-full' : 'hidden'}
            role="tabpanel"
            id={`tabpanel-${file.path}`}
            aria-labelledby={`tab-${file.path}`}
          >
            {isImageFile(file.name) ? (
              <ImageViewer file={file} agentId={workspaceAgentId} />
            ) : isPdfFile(file.name) ? (
              <PdfViewer file={file} agentId={workspaceAgentId} />
            ) : isMarkdownFile(file.name) ? (
              <MarkdownDocumentView
                file={file}
                onContentChange={onContentChange}
                onSave={onSaveFile}
                onRetry={onRetryFile}
                onOpenWorkspacePath={onOpenWorkspacePath}
                onOpenBeadId={onOpenBeadId}
                pathLinkAliases={pathLinkAliases}
                workspaceAgentId={workspaceAgentId}
              />
            ) : (
              <Suspense fallback={<EditorFallback />}>
                <FileEditor
                  file={file}
                  onContentChange={onContentChange}
                  onSave={onSaveFile}
                  onRetry={onRetryFile}
                />
              </Suspense>
            )}
          </div>
        ))}

        {/* Bead viewer tabs */}
        {openBeads.map((bead) => (
          <div
            key={bead.id}
            className={activeTab === bead.id ? 'h-full' : 'hidden'}
            role="tabpanel"
            id={`tabpanel-${bead.id}`}
            aria-labelledby={`tab-${bead.id}`}
          >
            <BeadViewerTab
              beadTarget={{
                beadId: bead.beadId,
                explicitTargetPath: bead.explicitTargetPath,
                currentDocumentPath: bead.currentDocumentPath,
                workspaceAgentId: bead.workspaceAgentId,
              }}
              onOpenBeadId={onOpenBeadId}
              onOpenWorkspacePath={onOpenWorkspacePath}
              pathLinkPrefixes={pathLinkPrefixes}
              pathLinkAliases={pathLinkAliases}
            />
          </div>
        ))}

        {/* Save conflict toast */}
        {visibleSaveToast && (
          <div
            role="status"
            className="absolute bottom-4 left-1/2 z-20 flex min-h-9 -translate-x-1/2 items-center gap-2 rounded-[3px] border border-border bg-popover py-1 pl-3 pr-1 text-[0.867rem] shadow-[0_12px_32px_rgba(0,0,0,0.32)] animate-fade-in"
          >
            <AlertTriangle size={14} className="shrink-0 text-destructive" aria-hidden="true" />
            <span className="text-foreground">File changed externally.</span>
            {onReloadFile && (
              <button
                type="button"
                className="inline-flex min-h-[var(--row-unit)] items-center rounded-[3px] border border-border px-2 text-[0.8rem] font-medium text-foreground transition-colors duration-[120ms] hover:bg-raised"
                onClick={() => { onReloadFile(visibleSaveToast.path); onDismissToast?.(); }}
              >
                Reload
              </button>
            )}
            <button
              type="button"
              className="shell-icon-button shrink-0"
              onClick={onDismissToast}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
