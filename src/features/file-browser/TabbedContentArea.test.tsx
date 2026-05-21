import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TabbedContentArea } from './TabbedContentArea';
import type { OpenFile } from './types';

const markdownDocumentViewSpy = vi.fn();
const beadViewerTabSpy = vi.fn();

vi.mock('./MarkdownDocumentView', () => ({
  MarkdownDocumentView: (props: {
    file: OpenFile;
    onOpenBeadId?: (target: { beadId: string }) => void;
    onOpenWorkspacePath?: (path: string, basePath?: string) => void;
    pathLinkAliases?: Record<string, string>;
    workspaceAgentId?: string;
  }) => {
    markdownDocumentViewSpy(props);
    return <div data-testid="markdown-document-view">{props.file.path}</div>;
  },
}));

vi.mock('./ImageViewer', () => ({
  ImageViewer: () => <div data-testid="image-viewer" />,
}));

vi.mock('./FileEditor', () => ({
  default: () => <div data-testid="file-editor" />,
}));

vi.mock('@/features/beads', () => ({
  BeadViewerTab: (props: {
    beadTarget: { beadId: string; workspaceAgentId?: string };
    onOpenBeadId?: (target: { beadId: string }) => void;
    onOpenWorkspacePath?: (path: string, basePath?: string) => void;
    pathLinkPrefixes?: string[];
    pathLinkAliases?: Record<string, string>;
  }) => {
    beadViewerTabSpy(props);
    return <div data-testid="bead-viewer-tab">{props.beadTarget.beadId}</div>;
  },
}));

const file: OpenFile = {
  path: 'docs/guide.md',
  name: 'guide.md',
  content: '# Guide',
  savedContent: '# Guide',
  dirty: false,
  locked: false,
  mtime: 0,
  loading: false,
};

describe('TabbedContentArea', () => {
  it('passes the bead-open handler into markdown document preview tabs', () => {
    const onOpenBeadId = vi.fn();
    const onOpenWorkspacePath = vi.fn();

    render(
      <TabbedContentArea
        activeTab="docs/guide.md"
        openFiles={[file]}
        openBeads={[]}
        workspaceAgentId="agent-1"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onContentChange={vi.fn()}
        onSaveFile={vi.fn()}
        onRetryFile={vi.fn()}
        onOpenWorkspacePath={onOpenWorkspacePath}
        onOpenBeadId={onOpenBeadId}
        pathLinkAliases={{ 'docs/': '/workspace/docs/' }}
        chatPanel={<div>chat</div>}
      />,
    );

    expect(markdownDocumentViewSpy).toHaveBeenCalled();
    const props = markdownDocumentViewSpy.mock.calls.at(-1)?.[0];
    expect(props.file.path).toBe('docs/guide.md');
    expect(props.onOpenBeadId).toBe(onOpenBeadId);
    expect(props.onOpenWorkspacePath).toBe(onOpenWorkspacePath);
    expect(props.pathLinkAliases).toEqual({ 'docs/': '/workspace/docs/' });
    expect(props.workspaceAgentId).toBe('agent-1');
  });

  it('passes chat path link prefixes into bead viewer tabs', () => {
    const onOpenBeadId = vi.fn();
    const onOpenWorkspacePath = vi.fn();

    render(
      <TabbedContentArea
        activeTab="bead:nerve-4gpd"
        openFiles={[]}
        openBeads={[{ id: 'bead:nerve-4gpd', beadId: 'nerve-4gpd', name: 'nerve-4gpd', workspaceAgentId: 'agent-1' }]}
        workspaceAgentId="agent-1"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onContentChange={vi.fn()}
        onSaveFile={vi.fn()}
        onRetryFile={vi.fn()}
        onOpenWorkspacePath={onOpenWorkspacePath}
        onOpenBeadId={onOpenBeadId}
        pathLinkPrefixes={['/workspace/', '~/workspace/']}
        pathLinkAliases={{ 'docs/': '/workspace/docs/' }}
        chatPanel={<div>chat</div>}
      />,
    );

    expect(beadViewerTabSpy).toHaveBeenCalled();
    const props = beadViewerTabSpy.mock.calls.at(-1)?.[0];
    expect(props.beadTarget).toEqual({
      beadId: 'nerve-4gpd',
      explicitTargetPath: undefined,
      currentDocumentPath: undefined,
      workspaceAgentId: 'agent-1',
    });
    expect(props.onOpenBeadId).toBe(onOpenBeadId);
    expect(props.onOpenWorkspacePath).toBe(onOpenWorkspacePath);
    expect(props.pathLinkPrefixes).toEqual(['/workspace/', '~/workspace/']);
    expect(props.pathLinkAliases).toEqual({ 'docs/': '/workspace/docs/' });
  });
});
