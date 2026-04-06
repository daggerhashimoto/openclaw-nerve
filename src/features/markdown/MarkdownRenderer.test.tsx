/** Tests for the MarkdownRenderer component. */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Mock highlight.js to avoid complex setup
vi.mock('@/lib/highlight', () => ({
  hljs: {
    highlightElement: vi.fn(),
    getLanguage: vi.fn(() => null),
  },
}));

// Mock sanitize
vi.mock('@/lib/sanitize', () => ({
  sanitizeHtml: vi.fn((html: string) => html),
}));

// Mock CodeBlockActions to avoid clipboard API issues in jsdom
vi.mock('./CodeBlockActions', () => ({
  CodeBlockActions: () => null,
}));

import { MarkdownRenderer } from './MarkdownRenderer';

describe('MarkdownRenderer', () => {
  it('renders basic text', () => {
    render(<MarkdownRenderer content="Hello world" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders bold text', () => {
    render(<MarkdownRenderer content="This is **bold** text" />);
    const bold = document.querySelector('strong');
    expect(bold).toBeTruthy();
    expect(bold?.textContent).toBe('bold');
  });

  it('renders italic text', () => {
    render(<MarkdownRenderer content="This is *italic* text" />);
    const em = document.querySelector('em');
    expect(em).toBeTruthy();
    expect(em?.textContent).toBe('italic');
  });

  it('renders headers', () => {
    render(<MarkdownRenderer content={'# Heading 1\n## Heading 2'} />);
    expect(document.querySelector('h1')).toBeTruthy();
    expect(document.querySelector('h2')).toBeTruthy();
  });

  it('renders unordered lists', () => {
    render(<MarkdownRenderer content={'- Item 1\n- Item 2\n- Item 3'} />);
    expect(document.querySelector('ul')).toBeTruthy();
    const items = document.querySelectorAll('li');
    expect(items).toHaveLength(3);
  });

  it('renders ordered lists', () => {
    render(<MarkdownRenderer content={'1. First\n2. Second\n3. Third'} />);
    expect(document.querySelector('ol')).toBeTruthy();
    const items = document.querySelectorAll('li');
    expect(items).toHaveLength(3);
  });

  it('renders links', () => {
    render(<MarkdownRenderer content="[example](https://example.com)" />);
    const link = document.querySelector('a');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('https://example.com');
  });

  it('linkifies configured inline /workspace paths', () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="Open /workspace/src/App.tsx now"
        onOpenWorkspacePath={onOpenWorkspacePath}
        pathLinkPrefixes={['/workspace/']}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: '/workspace/src/App.tsx' }));
    expect(onOpenWorkspacePath).toHaveBeenCalledWith('/workspace/src/App.tsx', undefined);
  });

  it('passes current document context to inline path references too', () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="Open /workspace/src/App.tsx now"
        onOpenWorkspacePath={onOpenWorkspacePath}
        pathLinkPrefixes={['/workspace/']}
        currentDocumentPath="notes/index.md"
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: '/workspace/src/App.tsx' }));
    expect(onOpenWorkspacePath).toHaveBeenCalledWith('/workspace/src/App.tsx', 'notes/index.md');
  });

  it('logs and swallows rejected inline workspace path opens', async () => {
    const error = new Error('nope');
    const onOpenWorkspacePath = vi.fn().mockRejectedValueOnce(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <MarkdownRenderer
        content="Open /workspace/src/App.tsx now"
        onOpenWorkspacePath={onOpenWorkspacePath}
        pathLinkPrefixes={['/workspace/']}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: '/workspace/src/App.tsx' }));

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Failed to open workspace path link:', error);
    });

    consoleError.mockRestore();
  });

  it('does not linkify relative paths when only /workspace is configured', () => {
    render(<MarkdownRenderer content="src/App.tsx" pathLinkPrefixes={['/workspace/']} onOpenWorkspacePath={vi.fn()} />);
    expect(screen.queryByRole('link', { name: 'src/App.tsx' })).toBeNull();
  });

  it('does not linkify configured path text inside inline code', () => {
    render(<MarkdownRenderer content="Use `/workspace/src/App.tsx` later" pathLinkPrefixes={['/workspace/']} onOpenWorkspacePath={vi.fn()} />);
    expect(screen.queryByRole('link', { name: '/workspace/src/App.tsx' })).toBeNull();
  });

  it('opens workspace links in-app when a handler is provided', async () => {
    const onOpenWorkspacePath = vi.fn();
    render(<MarkdownRenderer content="[notes](docs/todo.md)" onOpenWorkspacePath={onOpenWorkspacePath} />);

    fireEvent.click(screen.getByRole('link', { name: 'notes' }));

    await waitFor(() => {
      expect(onOpenWorkspacePath).toHaveBeenCalledWith('docs/todo.md', undefined);
    });
  });

  it('passes the current document path for markdown-document-relative links', async () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="[advanced](../advanced.md)"
        currentDocumentPath="docs/guide/index.md"
        onOpenWorkspacePath={onOpenWorkspacePath}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'advanced' }));

    await waitFor(() => {
      expect(onOpenWorkspacePath).toHaveBeenCalledWith('../advanced.md', 'docs/guide/index.md');
    });
  });

  it('preserves leading-slash workspace links for markdown documents', async () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="[todo](/docs/todo.md)"
        currentDocumentPath="notes/index.md"
        onOpenWorkspacePath={onOpenWorkspacePath}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'todo' }));

    await waitFor(() => {
      expect(onOpenWorkspacePath).toHaveBeenCalledWith('/docs/todo.md', 'notes/index.md');
    });
  });

  it('splits fragments from workspace link paths before opening files', async () => {
    const onOpenWorkspacePath = vi.fn().mockResolvedValue(undefined);
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => undefined);

    render(
      <MarkdownRenderer
        content="[guide](docs/guide.md#intro)"
        currentDocumentPath="notes/index.md"
        onOpenWorkspacePath={onOpenWorkspacePath}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'guide' }));

    await waitFor(() => {
      expect(onOpenWorkspacePath).toHaveBeenCalledWith('docs/guide.md', 'notes/index.md');
      expect(replaceState).toHaveBeenCalledWith(null, '', '#intro');
    });

    replaceState.mockRestore();
  });

  it('does not split encoded hash characters in workspace link paths', async () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="[guide](foo%23bar.md)"
        onOpenWorkspacePath={onOpenWorkspacePath}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'guide' }));

    await waitFor(() => {
      expect(onOpenWorkspacePath).toHaveBeenCalledWith('foo#bar.md', undefined);
    });
  });

  it('adds stable ids to headings for same-document anchor navigation', () => {
    render(<MarkdownRenderer content={'## External Links'} />);

    expect(document.querySelector('h2#external-links')).toBeTruthy();
  });

  it('keeps heading ids stable across rerenders', () => {
    const { rerender } = render(<MarkdownRenderer content={'## Intro\n\n## Intro'} />);

    expect(document.getElementById('intro')).toBeTruthy();
    expect(document.getElementById('intro-1')).toBeTruthy();

    rerender(<MarkdownRenderer content={'## Intro\n\n## Intro'} />);

    expect(document.getElementById('intro')).toBeTruthy();
    expect(document.getElementById('intro-1')).toBeTruthy();
    expect(document.getElementById('intro-2')).toBeNull();
  });

  it('keeps non-ascii headings addressable', () => {
    render(<MarkdownRenderer content={'## 日本語'} />);

    expect(document.getElementById('日本語')).toBeTruthy();
  });

  it('handles same-document anchor links in-app instead of opening a new tab', () => {
    const onOpenWorkspacePath = vi.fn();
    const scrollIntoView = vi.fn();
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => undefined);
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'scrollIntoView');

    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      render(
        <MarkdownRenderer
          content={'[Jump](#external-links)\n\n## External Links'}
          onOpenWorkspacePath={onOpenWorkspacePath}
        />,
      );

      const link = screen.getByRole('link', { name: 'Jump' });
      expect(link).not.toHaveAttribute('target', '_blank');

      fireEvent.click(link);

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(replaceState).toHaveBeenCalledWith(null, '', '#external-links');
      expect(onOpenWorkspacePath).not.toHaveBeenCalled();
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
      } else {
        delete (window.HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
      replaceState.mockRestore();
    }
  });

  it('logs and swallows rejected markdown workspace link opens', async () => {
    const error = new Error('nope');
    const onOpenWorkspacePath = vi.fn().mockRejectedValueOnce(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<MarkdownRenderer content="[notes](docs/todo.md)" onOpenWorkspacePath={onOpenWorkspacePath} />);

    fireEvent.click(screen.getByRole('link', { name: 'notes' }));

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Failed to open workspace path link:', error);
    });

    consoleError.mockRestore();
  });

  it('logs and swallows synchronous throws from markdown workspace link opens', async () => {
    const error = new Error('boom');
    const onOpenWorkspacePath = vi.fn(() => {
      throw error;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<MarkdownRenderer content="[notes](docs/todo.md)" onOpenWorkspacePath={onOpenWorkspacePath} />);

    fireEvent.click(screen.getByRole('link', { name: 'notes' }));

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Failed to open workspace path link:', error);
    });

    consoleError.mockRestore();
  });

  it('keeps external links as normal browser links when a handler is provided', () => {
    const onOpenWorkspacePath = vi.fn();
    render(<MarkdownRenderer content="[example](https://example.com)" onOpenWorkspacePath={onOpenWorkspacePath} />);

    const link = screen.getByRole('link', { name: 'example' });
    expect(link).toHaveAttribute('target', '_blank');

    fireEvent.click(link);
    expect(onOpenWorkspacePath).not.toHaveBeenCalled();
  });

  it('preserves markdown-provided link attributes', () => {
    render(<MarkdownRenderer content={'[example](https://example.com "Read more")'} />);

    expect(screen.getByRole('link', { name: 'example' })).toHaveAttribute('title', 'Read more');
  });

  it('renders code blocks', () => {
    render(<MarkdownRenderer content={'```js\nconst x = 1;\n```'} />);
    const code = document.querySelector('code');
    expect(code).toBeTruthy();
  });

  it('renders inline code', () => {
    render(<MarkdownRenderer content="Use `npm install` to install" />);
    const code = document.querySelector('code');
    expect(code).toBeTruthy();
    expect(code?.textContent).toBe('npm install');
  });

  it('handles empty content', () => {
    const { container } = render(<MarkdownRenderer content="" />);
    expect(container.textContent?.trim() || '').toBe('');
  });

  it('renders tables', () => {
    const table = `| A | B |\n| --- | --- |\n| 1 | 2 |`;
    render(<MarkdownRenderer content={table} />);
    expect(document.querySelector('table')).toBeTruthy();
  });

  it('applies custom className', () => {
    const { container } = render(<MarkdownRenderer content="test" className="custom-class" />);
    expect(container.querySelector('.custom-class')).toBeTruthy();
  });

  it('renders blockquotes', () => {
    render(<MarkdownRenderer content="> This is a quote" />);
    const bq = document.querySelector('blockquote');
    expect(bq).toBeTruthy();
  });
});
