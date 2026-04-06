import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownDocumentView } from './MarkdownDocumentView';
import type { OpenFile } from './types';

vi.mock('@/features/markdown/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content, className }: { content: string; className?: string }) => (
    <div data-testid="markdown-renderer" className={className}>{content}</div>
  ),
}));

vi.mock('./FileEditor', () => ({
  FileEditor: () => <div data-testid="file-editor" />,
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

describe('MarkdownDocumentView', () => {
  it('renders preview mode with light full-width gutters and no nested card', () => {
    render(
      <MarkdownDocumentView
        file={file}
        onContentChange={vi.fn()}
        onSave={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const renderer = screen.getByTestId('markdown-renderer');
    expect(renderer.closest('article')).toBeNull();
    expect(renderer.parentElement).toHaveClass('px-4');
    expect(renderer.parentElement).toHaveClass('md:px-6');
  });

  it('uses a segmented button switcher to toggle between preview and edit', () => {
    render(
      <MarkdownDocumentView
        file={file}
        onContentChange={vi.fn()}
        onSave={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole('tablist', { name: 'Document mode' })).toBeNull();

    const previewButton = screen.getByRole('button', { name: 'Preview' });
    const editButton = screen.getByRole('button', { name: 'Edit' });

    expect(previewButton).toHaveAttribute('aria-pressed', 'true');
    expect(editButton).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();

    fireEvent.click(editButton);

    expect(editButton).toHaveAttribute('aria-pressed', 'true');
    expect(previewButton).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('file-editor')).toBeInTheDocument();
  });

  it('shows the loading state in preview mode instead of a blank markdown pane', () => {
    render(
      <MarkdownDocumentView
        file={{ ...file, loading: true, content: '' }}
        onContentChange={vi.fn()}
        onSave={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText('Loading guide.md...')).toBeInTheDocument();
    expect(screen.queryByTestId('markdown-renderer')).toBeNull();
  });

  it('shows the error state in preview mode and allows retry', () => {
    const onRetry = vi.fn();

    render(
      <MarkdownDocumentView
        file={{ ...file, error: 'boom' }}
        onContentChange={vi.fn()}
        onSave={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText(/Failed to load/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('docs/guide.md');
  });
});
