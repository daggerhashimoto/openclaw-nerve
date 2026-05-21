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

  it('rewrites configured shorthand aliases to canonical workspace targets exactly once', () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="Open projects/openclaw-nerve/src/App.tsx now"
        onOpenWorkspacePath={onOpenWorkspacePath}
        pathLinkPrefixes={['/workspace/', '/home/derrick/.openclaw/workspace/']}
        pathLinkAliases={{ 'projects/': '/workspace/projects/' }}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'projects/openclaw-nerve/src/App.tsx' }));
    expect(onOpenWorkspacePath).toHaveBeenCalledWith('/workspace/projects/openclaw-nerve/src/App.tsx', undefined);
  });

  it('linkifies alias-only configs by normalizing rewritten targets to canonical workspace paths', () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="Open projects/openclaw-nerve/src/App.tsx now"
        onOpenWorkspacePath={onOpenWorkspacePath}
        pathLinkPrefixes={[]}
        pathLinkAliases={{ 'projects/': '/workspace/projects/' }}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'projects/openclaw-nerve/src/App.tsx' }));
    expect(onOpenWorkspacePath).toHaveBeenCalledWith('/workspace/projects/openclaw-nerve/src/App.tsx', undefined);
  });

  it('supports alias-only configs that rewrite file workspace urls to canonical workspace paths', () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="Open shortcut/openclaw-nerve/src/App.tsx now"
        onOpenWorkspacePath={onOpenWorkspacePath}
        pathLinkPrefixes={[]}
        pathLinkAliases={{ 'shortcut/': 'file:///workspace/projects/' }}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'shortcut/openclaw-nerve/src/App.tsx' }));
    expect(onOpenWorkspacePath).toHaveBeenCalledWith('/workspace/projects/openclaw-nerve/src/App.tsx', undefined);
  });

  it('supports wrapped alias shorthand without widening interior-token matching', () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="Open 'projects/openclaw-nerve/README.md' and path=projects/nope.md now"
        onOpenWorkspacePath={onOpenWorkspacePath}
        pathLinkPrefixes={['/workspace/']}
        pathLinkAliases={{ 'projects/': '/workspace/projects/' }}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: "'projects/openclaw-nerve/README.md'" }));
    expect(onOpenWorkspacePath).toHaveBeenCalledWith('/workspace/projects/openclaw-nerve/README.md', undefined);
    expect(screen.queryByRole('link', { name: 'projects/nope.md' })).toBeNull();
  });

  it('prefers the longest matching alias prefix when aliases overlap', () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="Open projects/openclaw-nerve/src/App.tsx now"
        onOpenWorkspacePath={onOpenWorkspacePath}
        pathLinkPrefixes={['/workspace/']}
        pathLinkAliases={{
          'projects/': '/workspace/projects-generic/',
          'projects/openclaw-nerve/': '/workspace/projects/openclaw-nerve/',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'projects/openclaw-nerve/src/App.tsx' }));
    expect(onOpenWorkspacePath).toHaveBeenCalledWith('/workspace/projects/openclaw-nerve/src/App.tsx', undefined);
  });

  it('does not recurse through alias-to-alias chains', () => {
    render(
      <MarkdownRenderer
        content="Open shortcut/demo.md now"
        onOpenWorkspacePath={vi.fn()}
        pathLinkPrefixes={['/workspace/']}
        pathLinkAliases={{ 'shortcut/': 'projects/', 'projects/': '/workspace/projects/' }}
      />,
    );

    expect(screen.queryByRole('link', { name: 'shortcut/demo.md' })).toBeNull();
  });

  it('does not linkify /workspace paths when they only appear as an interior token slice', () => {
    render(
      <MarkdownRenderer
        content="Open path=/workspace/src/App.tsx, now"
        onOpenWorkspacePath={vi.fn()}
        pathLinkPrefixes={['/workspace/']}
      />,
    );

    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('does not linkify a bare /workspace prefix with no path after it', () => {
    render(
      <MarkdownRenderer
        content="Open /workspace/ later"
        onOpenWorkspacePath={vi.fn()}
        pathLinkPrefixes={['/workspace/']}
      />,
    );

    expect(screen.queryByRole('link', { name: '/workspace/' })).toBeNull();
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

  it('does linkify bare workspace/... forms while normalizing them to the canonical workspace target', () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="Open workspace/AGENTS.md and workspace/agents-sections/12-maintenance-and-updates.md now"
        pathLinkPrefixes={['/workspace/']}
        onOpenWorkspacePath={onOpenWorkspacePath}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'workspace/AGENTS.md' }));
    fireEvent.click(screen.getByRole('link', { name: 'workspace/agents-sections/12-maintenance-and-updates.md' }));

    expect(onOpenWorkspacePath).toHaveBeenNthCalledWith(1, '/workspace/AGENTS.md', undefined);
    expect(onOpenWorkspacePath).toHaveBeenNthCalledWith(2, '/workspace/agents-sections/12-maintenance-and-updates.md', undefined);
  });

  it('treats bare workspace/... as an intentional shorthand even when host-absolute prefixes are configured', () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="Open workspace/src/App.tsx and workspace/docs/Guide.md now"
        pathLinkPrefixes={['/home/derrick/.openclaw/workspace/']}
        onOpenWorkspacePath={onOpenWorkspacePath}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'workspace/src/App.tsx' }));
    fireEvent.click(screen.getByRole('link', { name: 'workspace/docs/Guide.md' }));

    expect(onOpenWorkspacePath).toHaveBeenNthCalledWith(1, '/workspace/src/App.tsx', undefined);
    expect(onOpenWorkspacePath).toHaveBeenNthCalledWith(2, '/workspace/docs/Guide.md', undefined);
  });

  it('does not linkify relative paths when only /workspace is configured', () => {
    render(<MarkdownRenderer content="src/App.tsx" pathLinkPrefixes={['/workspace/']} onOpenWorkspacePath={vi.fn()} />);
    expect(screen.queryByRole('link', { name: 'src/App.tsx' })).toBeNull();
  });

  it('does not promote interior bare workspace tails or a bare workspace/ prefix into links', () => {
    render(
      <MarkdownRenderer
        content="Open path=workspace/AGENTS.md and workspace/ later"
        pathLinkPrefixes={['/workspace/']}
        onOpenWorkspacePath={vi.fn()}
      />,
    );

    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'workspace/' })).toBeNull();
  });

  it('linkifies wrapped file URIs while normalizing the opened workspace path', () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="Open file:///workspace/src/App.tsx, now"
        pathLinkPrefixes={['/workspace/']}
        onOpenWorkspacePath={onOpenWorkspacePath}
      />,
    );

    const link = screen.getByRole('link', { name: 'file:///workspace/src/App.tsx' });
    expect(link.parentElement?.textContent).toBe('Open file:///workspace/src/App.tsx, now');

    fireEvent.click(link);
    expect(onOpenWorkspacePath).toHaveBeenCalledWith('/workspace/src/App.tsx', undefined);
  });

  it('decodes percent-escaped inline workspace link targets before dispatch', () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="Open file:///workspace/My%20Doc.md and /workspace/foo%23bar.md now"
        pathLinkPrefixes={['/workspace/']}
        onOpenWorkspacePath={onOpenWorkspacePath}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'file:///workspace/My%20Doc.md' }));
    fireEvent.click(screen.getByRole('link', { name: '/workspace/foo%23bar.md' }));

    expect(onOpenWorkspacePath).toHaveBeenNthCalledWith(1, '/workspace/My Doc.md', undefined);
    expect(onOpenWorkspacePath).toHaveBeenNthCalledWith(2, '/workspace/foo#bar.md', undefined);
  });

  it('linkifies full host-absolute workspace paths while opening the canonical workspace target', () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="Open /home/derrick/.openclaw/workspace/src/App.tsx now"
        pathLinkPrefixes={['/workspace/', '/home/derrick/.openclaw/workspace/']}
        onOpenWorkspacePath={onOpenWorkspacePath}
      />,
    );

    const link = screen.getByRole('link', { name: '/home/derrick/.openclaw/workspace/src/App.tsx' });
    expect(link.parentElement?.textContent).toBe('Open /home/derrick/.openclaw/workspace/src/App.tsx now');

    fireEvent.click(link);
    expect(onOpenWorkspacePath).toHaveBeenCalledWith('/workspace/src/App.tsx', undefined);
  });

  it('does not promote interior host-absolute workspace tails into links', () => {
    render(
      <MarkdownRenderer
        content="Open path=/home/derrick/.openclaw/workspace/src/App.tsx now"
        pathLinkPrefixes={['/workspace/', '/home/derrick/.openclaw/workspace/']}
        onOpenWorkspacePath={vi.fn()}
      />,
    );

    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('linkifies wrapped workspace-rooted paths as single inline tokens while normalizing host-absolute forms', () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content={"Open '/workspace/src/App.tsx' \"/workspace/src/Main.tsx\" </workspace/src/Guide.md> 'workspace/src/Inline.tsx' '/home/derrick/.openclaw/workspace/src/Host.tsx' now"}
        pathLinkPrefixes={['/workspace/', '/home/derrick/.openclaw/workspace/']}
        onOpenWorkspacePath={onOpenWorkspacePath}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: "'/workspace/src/App.tsx'" }));
    fireEvent.click(screen.getByRole('link', { name: '"/workspace/src/Main.tsx"' }));
    fireEvent.click(screen.getByRole('link', { name: '</workspace/src/Guide.md>' }));
    fireEvent.click(screen.getByRole('link', { name: "'workspace/src/Inline.tsx'" }));
    fireEvent.click(screen.getByRole('link', { name: "'/home/derrick/.openclaw/workspace/src/Host.tsx'" }));

    expect(onOpenWorkspacePath).toHaveBeenNthCalledWith(1, '/workspace/src/App.tsx', undefined);
    expect(onOpenWorkspacePath).toHaveBeenNthCalledWith(2, '/workspace/src/Main.tsx', undefined);
    expect(onOpenWorkspacePath).toHaveBeenNthCalledWith(3, '/workspace/src/Guide.md', undefined);
    expect(onOpenWorkspacePath).toHaveBeenNthCalledWith(4, '/workspace/src/Inline.tsx', undefined);
    expect(onOpenWorkspacePath).toHaveBeenNthCalledWith(5, '/workspace/src/Host.tsx', undefined);
  });

  it('keeps trailing punctuation outside wrapped workspace links', () => {
    render(
      <MarkdownRenderer
        content="Open '/workspace/src/App.tsx', now"
        pathLinkPrefixes={['/workspace/']}
        onOpenWorkspacePath={vi.fn()}
      />,
    );

    const link = screen.getByRole('link', { name: "'/workspace/src/App.tsx'" });
    expect(link.parentElement?.textContent).toBe("Open '/workspace/src/App.tsx', now");
  });

  it('does not linkify bare wrapped workspace prefixes or bare file workspace prefixes', () => {
    render(
      <MarkdownRenderer
        content="Open '/workspace/' and file:///workspace/ later"
        pathLinkPrefixes={['/workspace/']}
        onOpenWorkspacePath={vi.fn()}
      />,
    );

    expect(screen.queryByRole('link', { name: "'/workspace/'" })).toBeNull();
    expect(screen.queryByRole('link', { name: 'file:///workspace/' })).toBeNull();
  });

  it('does not turn unmatched wrappers into inner-tail links', () => {
    render(
      <MarkdownRenderer
        content="Open '/workspace/src/App.tsx later"
        pathLinkPrefixes={['/workspace/']}
        onOpenWorkspacePath={vi.fn()}
      />,
    );

    expect(screen.queryByRole('link', { name: "'/workspace/src/App.tsx" })).toBeNull();
    expect(screen.queryByRole('link', { name: '/workspace/src/App.tsx' })).toBeNull();
  });

  it('linkifies configured path text inside inline code spans', () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="Use `file:///workspace/src/App.tsx` and `/workspace/src/Main.tsx` later"
        pathLinkPrefixes={['/workspace/']}
        onOpenWorkspacePath={onOpenWorkspacePath}
      />,
    );

    const fileUriLink = screen.getByRole('link', { name: 'file:///workspace/src/App.tsx' });
    const workspaceLink = screen.getByRole('link', { name: '/workspace/src/Main.tsx' });

    expect(fileUriLink.closest('code')).not.toBeNull();
    expect(workspaceLink.closest('code')).not.toBeNull();

    fireEvent.click(fileUriLink);
    fireEvent.click(workspaceLink);

    expect(onOpenWorkspacePath).toHaveBeenNthCalledWith(1, '/workspace/src/App.tsx', undefined);
    expect(onOpenWorkspacePath).toHaveBeenNthCalledWith(2, '/workspace/src/Main.tsx', undefined);
  });

  it('does not create nested workspace anchors inside markdown links that wrap inline code', async () => {
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="[`/workspace/src/App.tsx`](docs/todo.md)"
        pathLinkPrefixes={['/workspace/']}
        onOpenWorkspacePath={onOpenWorkspacePath}
      />,
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent('/workspace/src/App.tsx');
    expect(links[0].querySelector('a')).toBeNull();
    expect(document.querySelectorAll('code a')).toHaveLength(0);

    fireEvent.click(links[0]);

    await waitFor(() => {
      expect(onOpenWorkspacePath).toHaveBeenCalledWith('docs/todo.md', undefined);
    });
    expect(onOpenWorkspacePath).toHaveBeenCalledTimes(1);
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

  it('opens explicit bead-scheme links in-app when a bead handler is provided', async () => {
    const onOpenBeadId = vi.fn();
    render(<MarkdownRenderer content="[viewer](bead:nerve-fms2)" onOpenBeadId={onOpenBeadId} />);

    fireEvent.click(screen.getByRole('link', { name: 'viewer' }));

    await waitFor(() => {
      expect(onOpenBeadId).toHaveBeenCalledWith({ beadId: 'nerve-fms2' });
    });
  });

  it('passes same-context metadata through for legacy bead links when document context is available', async () => {
    const onOpenBeadId = vi.fn();
    render(
      <MarkdownRenderer
        content="[viewer](bead:nerve-fms2)"
        currentDocumentPath="repos/demo/docs/beads.md"
        workspaceAgentId="research"
        onOpenBeadId={onOpenBeadId}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'viewer' }));

    await waitFor(() => {
      expect(onOpenBeadId).toHaveBeenCalledWith({
        beadId: 'nerve-fms2',
        currentDocumentPath: 'repos/demo/docs/beads.md',
        workspaceAgentId: 'research',
      });
    });
  });

  it('logs and swallows rejected bead link opens', async () => {
    const error = new Error('nope');
    const onOpenBeadId = vi.fn().mockRejectedValueOnce(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<MarkdownRenderer content="[viewer](bead:nerve-fms2)" onOpenBeadId={onOpenBeadId} />);

    fireEvent.click(screen.getByRole('link', { name: 'viewer' }));

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Failed to open bead link:', error);
    });

    consoleError.mockRestore();
  });

  it('logs and swallows synchronous throws from bead link opens', async () => {
    const error = new Error('boom');
    const onOpenBeadId = vi.fn(() => {
      throw error;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<MarkdownRenderer content="[viewer](bead:nerve-fms2)" onOpenBeadId={onOpenBeadId} />);

    fireEvent.click(screen.getByRole('link', { name: 'viewer' }));

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Failed to open bead link:', error);
    });

    consoleError.mockRestore();
  });

  it('routes explicit bead-scheme links to bead tabs before workspace resolution or browser fallback', async () => {
    const onOpenBeadId = vi.fn();
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="[viewer](bead:nerve-fms2)"
        onOpenBeadId={onOpenBeadId}
        onOpenWorkspacePath={onOpenWorkspacePath}
      />,
    );

    const link = screen.getByRole('link', { name: 'viewer' });
    expect(link).toHaveAttribute('href', 'bead:nerve-fms2');
    expect(link).not.toHaveAttribute('target', '_blank');

    fireEvent.click(link);

    await waitFor(() => {
      expect(onOpenBeadId).toHaveBeenCalledWith({ beadId: 'nerve-fms2' });
    });
    expect(onOpenWorkspacePath).not.toHaveBeenCalled();
  });

  it('does not treat bare bead ids as bead links when a workspace handler is also present', async () => {
    const onOpenBeadId = vi.fn();
    const onOpenWorkspacePath = vi.fn();
    render(
      <MarkdownRenderer
        content="[viewer](nerve-fms2)"
        onOpenBeadId={onOpenBeadId}
        onOpenWorkspacePath={onOpenWorkspacePath}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'viewer' }));

    expect(onOpenBeadId).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onOpenWorkspacePath).toHaveBeenCalledWith('nerve-fms2', undefined);
    });
  });

  it('passes explicit bead lookup context through for cross-context links', async () => {
    const onOpenBeadId = vi.fn();
    render(
      <MarkdownRenderer
        content="[viewer](bead:///home/derrick/.openclaw/workspace/projects/virtra-apex-docs/.beads#virtra-apex-docs-id2)"
        currentDocumentPath="bead-link-dogfood.md"
        workspaceAgentId="main"
        onOpenBeadId={onOpenBeadId}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'viewer' }));

    await waitFor(() => {
      expect(onOpenBeadId).toHaveBeenCalledWith({
        beadId: 'virtra-apex-docs-id2',
        explicitTargetPath: '/home/derrick/.openclaw/workspace/projects/virtra-apex-docs/.beads',
        currentDocumentPath: 'bead-link-dogfood.md',
        workspaceAgentId: 'main',
      });
    });
  });

  it('does not preserve relative explicit bead links when this renderer lacks the context to open them', () => {
    const onOpenBeadId = vi.fn();
    render(
      <MarkdownRenderer
        content="[viewer](bead://../projects/virtra-apex-docs/.beads#virtra-apex-docs-id2)"
        onOpenBeadId={onOpenBeadId}
      />,
    );

    expect(screen.queryByRole('link', { name: 'viewer' })).toBeNull();
    expect(screen.getByText('viewer').tagName).toBe('SPAN');
    expect(onOpenBeadId).not.toHaveBeenCalled();
  });

  it('preserves explicit bead links when this renderer instance can open them', () => {
    render(
      <MarkdownRenderer
        content="[viewer](bead:///home/derrick/.openclaw/workspace/projects/virtra-apex-docs/.beads#virtra-apex-docs-id2)"
        onOpenBeadId={vi.fn()}
      />,
    );

    const link = screen.getByRole('link', { name: 'viewer' });
    expect(link).toHaveAttribute('href', 'bead:///home/derrick/.openclaw/workspace/projects/virtra-apex-docs/.beads#virtra-apex-docs-id2');
    expect(link).not.toHaveAttribute('target', '_blank');
  });

  it('routes relative explicit bead links in-app once current document context is available', async () => {
    const onOpenBeadId = vi.fn();
    render(
      <MarkdownRenderer
        content="[viewer](bead://../projects/virtra-apex-docs/.beads#virtra-apex-docs-id2)"
        currentDocumentPath="notes/bead-link-dogfood.md"
        workspaceAgentId="main"
        onOpenBeadId={onOpenBeadId}
      />,
    );

    const link = screen.getByRole('link', { name: 'viewer' });
    expect(link).toHaveAttribute('href', 'bead://../projects/virtra-apex-docs/.beads#virtra-apex-docs-id2');
    expect(link).not.toHaveAttribute('target', '_blank');

    fireEvent.click(link);

    await waitFor(() => {
      expect(onOpenBeadId).toHaveBeenCalledWith({
        beadId: 'virtra-apex-docs-id2',
        explicitTargetPath: '../projects/virtra-apex-docs/.beads',
        currentDocumentPath: 'notes/bead-link-dogfood.md',
        workspaceAgentId: 'main',
      });
    });
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
