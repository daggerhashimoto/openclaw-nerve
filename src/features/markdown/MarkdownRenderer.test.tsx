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

  it('embeds a standalone Google Maps share embed in chat while preserving its link', () => {
    const url = 'https://www.google.com/maps/embed?pb=%21example';
    render(<MarkdownRenderer content={`[View map](${url})`} embedGoogleMaps />);

    expect(screen.getByRole('link', { name: 'View map' })).toHaveAttribute('href', url);
    expect(screen.getByTitle('Google Maps')).toHaveAttribute('src', url);
  });

  it('does not embed ordinary Maps links, lookalike hosts, or inline links', () => {
    const { rerender } = render(<MarkdownRenderer content="[Map](https://www.google.com/maps/place/London)" embedGoogleMaps />);
    expect(screen.queryByTitle('Google Maps')).not.toBeInTheDocument();

    rerender(<MarkdownRenderer content="[Map](https://www.google.com.evil.test/maps/embed?pb=x)" embedGoogleMaps />);
    expect(screen.queryByTitle('Google Maps')).not.toBeInTheDocument();

    rerender(<MarkdownRenderer content="See [Map](https://www.google.com/maps/embed?pb=x) nearby" embedGoogleMaps />);
    expect(screen.queryByTitle('Google Maps')).not.toBeInTheDocument();

    rerender(<MarkdownRenderer content="[Map](https://www.google.com/maps/embed?pb=x)" />);
    expect(screen.queryByTitle('Google Maps')).not.toBeInTheDocument();
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

  describe('math rendering', () => {
    const renderMarkdown = (content: string) => render(<MarkdownRenderer content={content} />).container;
    // KaTeX keeps the TeX source of every rendered expression in a MathML
    // annotation, so this lists exactly which parts of the input became math.
    const texSources = (root: ParentNode) =>
      Array.from(root.querySelectorAll('annotation[encoding="application/x-tex"]'), (node) => node.textContent);
    const expectNoMath = (root: ParentNode) => {
      expect(root.querySelector('.katex')).toBeNull();
      expect(root.querySelector('.katex-error')).toBeNull();
    };

    describe('currency prose stays literal', () => {
      it.each([
        'This run cost $5 and the next one $10.',
        'Spent $0.42 on input, $1.20 on output.',
        '$5-$10',
        'Pricing is between $5 and $10 per $1M tokens.',
        'Price is $5 today.',
        'Input $3/1M, output $15/1M, cached $0.30/$0.60.',
        'Budget: $5,000 for March, $7,500 for April.',
        'Costs went from $5\nto $10 overnight.',
      ])('keeps %j as plain text', (content) => {
        const container = renderMarkdown(content);
        expectNoMath(container);
        expect(container.textContent).toBe(content);
      });

      it('keeps a currency amount literal when the next dollar sign is inside inline code', () => {
        const container = renderMarkdown('It costs $5 with `PRICE=$x` set.');
        expectNoMath(container);
        expect(container.querySelector('code')?.textContent).toBe('PRICE=$x');
        expect(container.textContent).toBe('It costs $5 with PRICE=$x set.');
      });

      it('keeps prices in a table cell literal while a neighbouring cell renders math', () => {
        const container = renderMarkdown([
          '| Item | Value |',
          '| --- | --- |',
          '| formula | $x^2$ |',
          '| price | $5 per $1M tokens |',
        ].join('\n'));
        const cells = container.querySelectorAll('td');
        expect(cells).toHaveLength(4);
        expect(texSources(cells[1])).toEqual(['x^2']);
        expect(cells[3].textContent).toBe('$5 per $1M tokens');
        expect(texSources(container)).toEqual(['x^2']);
      });

      it.each([
        ['$ x$', 'opening dollar followed by a space'],
        ['$x $', 'closing dollar preceded by a space'],
        ['$x$5', 'closing dollar followed by a digit'],
      ])('keeps %j literal (%s)', (content) => {
        const container = renderMarkdown(content);
        expectNoMath(container);
        expect(container.textContent).toBe(content);
      });

      it.each([
        ['$HOME/$USER', 'closing dollar followed by a letter'],
        ['US$x$', 'opening dollar preceded by a letter'],
        ['a$x$b', 'dollars touching letters on both sides'],
        ['5$x$', 'opening dollar preceded by a digit'],
        ['$x$b', 'closing dollar followed by a letter'],
      ])('keeps %j literal (%s)', (content) => {
        const container = renderMarkdown(content);
        expectNoMath(container);
        expect(container.textContent).toBe(content);
      });
    });

    it.each(['It is $x$.', 'Wrap it ($x$) here.', 'Then $x$, and more.'])(
      'renders single-dollar math next to punctuation in %j',
      (content) => {
        expect(texSources(renderMarkdown(content))).toEqual(['x']);
      },
    );

    it('renders single-dollar math inside strong emphasis', () => {
      const container = renderMarkdown('This is **$x$** in bold.');
      expect(texSources(container.querySelector('strong')!)).toEqual(['x']);
    });

    describe('escaped square brackets', () => {
      it.each([
        ['see \\[1\\] and \\[2\\]', 'see [1] and [2]'],
        ['\\[x\\](http://a.b)', '[x](http://a.b)'],
        ['usage: cmd \\[--flag=value\\] file', 'usage: cmd [--flag=value] file'],
      ])('keeps %j literal, as plain markdown renders it', (content, text) => {
        const container = renderMarkdown(content);
        expectNoMath(container);
        expect(container.textContent).toBe(text);
      });

      it.each([
        [String.raw`Energy \[ E = mc^2 \] holds.`, 'E = mc^2', 'padded with spaces'],
        [String.raw`Square \[x^2\] it.`, 'x^2', 'contains a caret'],
        [String.raw`Divide \[\frac{a}{b}\] now.`, String.raw`\frac{a}{b}`, 'contains a backslash'],
        ['Wide \\[\nx\n\\] sum.', 'x', 'padded with line endings'],
      ])('renders %j as display math (%s)', (content, tex) => {
        const container = renderMarkdown(content);
        expect(texSources(container)).toEqual([tex]);
        expect(container.querySelector('.katex-display')).toBeTruthy();
      });

      it('keeps the block form unchanged even when its content is a bare number', () => {
        const container = renderMarkdown(['\\[', '1', '\\]'].join('\n'));
        expect(texSources(container)).toEqual(['1']);
        expect(container.querySelector('.katex-display')).toBeTruthy();
      });
    });

    it('treats \\(optional\\) in prose as inline math (deliberate: \\( is always a math opener)', () => {
      const container = renderMarkdown('Pass \\(optional\\) thing.');
      expect(texSources(container)).toEqual(['optional']);
      expect(container.querySelector('.katex-display')).toBeNull();
    });

    it('does not let a currency dollar swallow a later valid expression', () => {
      const container = renderMarkdown('I paid $5 for $x^2$ lessons.');
      expect(texSources(container)).toEqual(['x^2']);
      expect(container.textContent?.startsWith('I paid $5 for ')).toBe(true);
      expect(container.textContent?.endsWith(' lessons.')).toBe(true);
    });

    it('keeps an escaped dollar literal', () => {
      const container = renderMarkdown('An escaped \\$5 and \\$x^2\\$ stay literal.');
      expectNoMath(container);
      expect(container.textContent).toBe('An escaped $5 and $x^2$ stay literal.');
    });

    it('renders inline math delimited by single dollars', () => {
      const container = renderMarkdown('The identity $x^2 + y^2 = z^2$ holds.');
      expect(texSources(container)).toEqual(['x^2 + y^2 = z^2']);
      expect(container.querySelector('.katex-display')).toBeNull();
    });

    it.each(['$x^2$', '$E=mc^2$'])('renders %j as inline math', (content) => {
      const container = renderMarkdown(content);
      expect(texSources(container)).toEqual([content.slice(1, -1)]);
      expect(container.querySelector('.katex-display')).toBeNull();
    });

    it('lets an escaped dollar sit inside single-dollar math', () => {
      const container = renderMarkdown('Cost is $a\\$b$ here.');
      expect(texSources(container)).toEqual(['a\\$b']);
    });

    it('renders double-dollar math inside a sentence as display math', () => {
      const container = renderMarkdown(String.raw`The area $$\int_0^1 x\,dx$$ is one half.`);
      expect(texSources(container)).toEqual([String.raw`\int_0^1 x\,dx`]);
      expect(container.querySelector('.katex-display')).toBeTruthy();
    });

    it('renders block math delimited by double dollars on their own lines as a display equation', () => {
      const container = renderMarkdown('Before\n\n$$\n\\int_0^1 x \\, dx\n$$\n\nAfter');
      const display = container.querySelector('.katex-display');
      expect(display).toBeTruthy();
      expect(display?.querySelector('.katex')).toBeTruthy();
      expect(texSources(container)).toEqual(['\\int_0^1 x \\, dx']);
    });

    it('renders double-dollar display math whose delimiters share lines with the content', () => {
      const container = renderMarkdown(
        ['$$\\begin{aligned}', 'a &= b \\\\', 'c &= d', '\\end{aligned}$$', '', 'After'].join('\n'),
      );
      expect(container.querySelector('.katex-display')).toBeTruthy();
      expect(container.querySelector('.katex-error')).toBeNull();
      expect(container.querySelector('p:last-child')?.textContent).toBe('After');
    });

    it('renders \\(...\\) as inline math', () => {
      const container = renderMarkdown(String.raw`Add \(a+b\) to both sides.`);
      expect(texSources(container)).toEqual(['a+b']);
      expect(container.querySelector('.katex-display')).toBeNull();
      expect(container.textContent).not.toContain('\\(');
    });

    it('renders \\[...\\] inside a paragraph as display math', () => {
      const container = renderMarkdown(String.raw`The sum \[ \sum_{i=1}^n i \] is triangular.`);
      expect(texSources(container)).toEqual([String.raw`\sum_{i=1}^n i`]);
      expect(container.querySelector('.katex-display')).toBeTruthy();
    });

    it('renders a \\[ block on its own lines as display math even when a line looks like a list item', () => {
      const container = renderMarkdown(['Total:', '', '\\[', '\\sum_{i=1}^n i', '- \\frac{n}{2}', '\\]', '', 'Done.'].join('\n'));
      expect(texSources(container)).toEqual(['\\sum_{i=1}^n i\n- \\frac{n}{2}']);
      expect(container.querySelector('.katex-display')).toBeTruthy();
      expect(container.querySelector('ul')).toBeNull();
      expect(container.textContent?.endsWith('Done.')).toBe(true);
    });

    it('renders block math inside block quotes and list items', () => {
      const container = renderMarkdown(['> $$', '> x^2', '> $$', '', '- item', '', '  \\[', '  y^2', '  \\]'].join('\n'));
      expect(texSources(container.querySelector('blockquote')!)).toEqual(['x^2']);
      expect(texSources(container.querySelector('li')!)).toEqual(['y^2']);
      expect(container.querySelectorAll('.katex-display')).toHaveLength(2);
    });

    it('renders the issue 312 example as typeset math', () => {
      const { container } = render(
        <MarkdownRenderer content={'The figure of merit $FoM = \\frac{S}{FWHM_n + FWHM_\\gamma}$ matters.'} />,
      );
      expect(container.querySelector('.katex')).toBeTruthy();
      // KaTeX preserves the LaTeX source in the MathML annotation for screen readers;
      // visual confirmation that the math was rendered comes from the .katex span above.
      // The visual HTML output contains the typeset fraction characters (no backslash).
      expect(container.querySelector('.katex-html')?.textContent ?? '').not.toContain('\\frac');
    });

    it('does not parse dollar signs inside fenced code blocks as math', () => {
      render(<MarkdownRenderer content={'```python\nprice = $5\nother = $10\n```'} />);
      const pre = document.querySelector('pre');
      expect(pre).toBeTruthy();
      expect(pre?.textContent).toContain('$5');
      expect(pre?.textContent).toContain('$10');
      expect(document.querySelector('.katex')).toBeNull();
    });

    it('does not parse fenced ```math code blocks as equations (treats them as LaTeX code)', () => {
      render(<MarkdownRenderer content={'```math\n\\frac{1}{2}\n```'} />);
      // Verify the block is typeset as code, NOT as a KaTeX equation.
      expect(document.querySelector('.katex')).toBeNull();
      // Verify it routed through the CodeBlock component (which wraps the
      // <pre> in .code-block-wrapper and adds a .code-lang label) rather
      // than falling to the inline-code path that would lose the block UI.
      const wrapper = document.querySelector('.code-block-wrapper');
      expect(wrapper).toBeTruthy();
      const langLabel = wrapper?.querySelector('.code-lang');
      expect(langLabel?.textContent).toBe('latex');
      const pre = wrapper?.querySelector('pre');
      expect(pre?.textContent).toContain('\\frac{1}{2}');
    });

    it('does not parse dollar signs inside inline code as math', () => {
      render(<MarkdownRenderer content="Use the `$variable` syntax for shell expansion" />);
      const code = document.querySelector('code');
      expect(code).toBeTruthy();
      expect(code?.textContent).toBe('$variable');
      expect(document.querySelector('.katex')).toBeNull();
    });

    it('leaves every math delimiter inside inline code alone', () => {
      const container = renderMarkdown('Write `$x^2$`, `$$y$$`, `\\(a\\)` and `\\[b\\]` literally.');
      expectNoMath(container);
      expect(Array.from(container.querySelectorAll('code'), (node) => node.textContent))
        .toEqual(['$x^2$', '$$y$$', '\\(a\\)', '\\[b\\]']);
    });

    it('leaves every math delimiter inside a fenced code block alone', () => {
      const source = ['$x^2$ and $$y$$', '\\(a\\) and \\[b\\]', '$$', 'z', '$$'].join('\n');
      const container = renderMarkdown('```text\n' + source + '\n```');
      expectNoMath(container);
      expect(container.querySelector('pre')?.textContent).toContain(source);
    });

    it('does not throw on malformed LaTeX and renders a visible error fallback', () => {
      let container: HTMLElement | null = null;
      expect(() => {
        const result = render(<MarkdownRenderer content="Try $\\frac{1$ now" />);
        container = result.container;
      }).not.toThrow();
      // R4: malformed LaTeX should not crash; rehype-katex catches the parse error
      // and emits a .katex-error span (or, in some edge cases, the raw source).
      const errorSpan = container!.querySelector('.katex-error');
      const rawSourceVisible = container!.textContent?.includes('\\frac');
      expect(errorSpan ?? rawSourceVisible ?? null).toBeTruthy();
    });

    it('keeps KaTeX trust disabled so \\href cannot produce a link', () => {
      const container = renderMarkdown(String.raw`Click $\href{javascript:alert(1)}{x}$ now.`);
      expect(texSources(container)).toEqual([String.raw`\href{javascript:alert(1)}{x}`]);
      expect(container.querySelector('a, [href]')).toBeNull();
    });

    describe('streaming partial input', () => {
      it.each([
        ['an unclosed single-dollar expression', 'Consider $x^2', 'Consider $x^2'],
        ['an unclosed double-dollar expression', 'Consider $$x^2', 'Consider $$x^2'],
        ['an unclosed \\( expression', 'Consider \\(x^2 + y', 'Consider (x^2 + y'],
        ['an unclosed \\[ expression', 'Consider \\[x^2', 'Consider [x^2'],
      ])('renders %s as plain text', (_label, content, text) => {
        const container = renderMarkdown(content);
        expectNoMath(container);
        expect(container.textContent).toBe(text);
      });

      it('renders an unclosed $$ block as plain text until its closing fence arrives', () => {
        const { container, rerender } = render(<MarkdownRenderer content={'Formula:\n\n$$\n\\frac{1}{'} />);
        expectNoMath(container);
        expect(container.textContent).toContain('\\frac{1}{');

        rerender(<MarkdownRenderer content={'Formula:\n\n$$\n\\frac{1}{2}\n$'} />);
        expectNoMath(container);

        rerender(<MarkdownRenderer content={'Formula:\n\n$$\n\\frac{1}{2}\n$$'} />);
        expect(texSources(container)).toEqual(['\\frac{1}{2}']);
        expect(container.querySelector('.katex-error')).toBeNull();
      });

      it('keeps an unclosed block inside a block quote as plain text without swallowing what follows', () => {
        const container = renderMarkdown(['> $$', '> x^2', '', 'After the quote.'].join('\n'));
        expectNoMath(container);
        expect(container.querySelector('blockquote')?.textContent?.trim()).toBe('$$\nx^2');
        expect(container.querySelector(':scope > div > p:last-child')?.textContent).toBe('After the quote.');
      });

      it('renders an unclosed \\[ block as plain text until its closing fence arrives', () => {
        const { container, rerender } = render(<MarkdownRenderer content={'\\[\n\\sum_{i=1}^n'} />);
        expectNoMath(container);
        expect(container.textContent).toContain('\\sum_{i=1}^n');

        rerender(<MarkdownRenderer content={'\\[\n\\sum_{i=1}^n i\n\\]'} />);
        expect(texSources(container)).toEqual(['\\sum_{i=1}^n i']);
      });

      it('never shows a KaTeX error while a mixed sentence streams in one character at a time', () => {
        const full = String.raw`Since $\frac{a}{b}$ and \(\sqrt{x}\) hold, $$\int_0^1 f$$ follows for $5.`;
        const { container, rerender } = render(<MarkdownRenderer content="" />);
        for (let end = 1; end <= full.length; end += 1) {
          rerender(<MarkdownRenderer content={full.slice(0, end)} />);
          expect(container.querySelector('.katex-error')).toBeNull();
        }
        expect(texSources(container)).toEqual([String.raw`\frac{a}{b}`, String.raw`\sqrt{x}`, String.raw`\int_0^1 f`]);
        expect(container.textContent?.endsWith(' follows for $5.')).toBe(true);
      });
    });
  });
});
