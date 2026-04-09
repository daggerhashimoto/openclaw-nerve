import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TabbedContentArea } from './TabbedContentArea';
import type { OpenFile } from './types';

const markdownDocumentViewSpy = vi.fn();

vi.mock('./MarkdownDocumentView', () => ({
  MarkdownDocumentView: (props: {
    file: OpenFile;
    onOpenBeadId?: (target: { beadId: string }) => void;
    onOpenWorkspacePath?: (path: string, basePath?: string) => void;
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
        chatPanel={<div>chat</div>}
      />,
    );

    expect(markdownDocumentViewSpy).toHaveBeenCalled();
    const props = markdownDocumentViewSpy.mock.calls.at(-1)?.[0];
    expect(props.file.path).toBe('docs/guide.md');
    expect(props.onOpenBeadId).toBe(onOpenBeadId);
    expect(props.onOpenWorkspacePath).toBe(onOpenWorkspacePath);
    expect(props.workspaceAgentId).toBe('agent-1');
  });
});
