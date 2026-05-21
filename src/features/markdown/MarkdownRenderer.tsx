import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { hljs } from '@/lib/highlight';
import { sanitizeHtml } from '@/lib/sanitize';
import { escapeRegex } from '@/lib/constants';
import { CodeBlockActions } from './CodeBlockActions';
import { parseBeadLinkHref, type BeadLinkTarget } from '@/features/beads';
import { renderInlinePathReferences } from './inlineReferences';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  searchQuery?: string;
  suppressImages?: boolean;
  currentDocumentPath?: string;
  onOpenWorkspacePath?: (path: string, basePath?: string) => void | Promise<void>;
  pathLinkPrefixes?: string[];
  pathLinkAliases?: Record<string, string>;
  onOpenBeadId?: (target: BeadLinkTarget) => void | Promise<void>;
  workspaceAgentId?: string;
}

interface MarkdownAstNode {
  type?: string;
  value?: string;
  alt?: string;
  children?: MarkdownAstNode[];
  data?: {
    hProperties?: Record<string, unknown>;
  };
}

interface MarkdownNodeProps {
  node?: { tagName?: string };
}

type HeadingProps = React.HTMLAttributes<HTMLHeadingElement> & MarkdownNodeProps & {
  children?: React.ReactNode;
};

type ParagraphProps = React.HTMLAttributes<HTMLParagraphElement> & MarkdownNodeProps & {
  children?: React.ReactNode;
};

type ListItemProps = React.LiHTMLAttributes<HTMLLIElement> & MarkdownNodeProps & {
  children?: React.ReactNode;
};

type TableCellProps = React.TdHTMLAttributes<HTMLTableCellElement> & MarkdownNodeProps & {
  children?: React.ReactNode;
};

type TableHeaderProps = React.ThHTMLAttributes<HTMLTableHeaderCellElement> & MarkdownNodeProps & {
  children?: React.ReactNode;
};

type MarkdownLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & MarkdownNodeProps & {
  children?: React.ReactNode;
  href?: string;
};

const MarkdownLinkContext = createContext(false);

function InlineCodeContent({
  codeString,
  children,
  pathLinkPrefixes,
  pathLinkAliases,
  currentDocumentPath,
  onOpenWorkspacePath,
}: {
  codeString: string;
  children?: React.ReactNode;
  pathLinkPrefixes?: string[];
  pathLinkAliases?: Record<string, string>;
  currentDocumentPath?: string;
  onOpenWorkspacePath?: (path: string, basePath?: string) => void | Promise<void>;
}) {
  const isInsideMarkdownLink = useContext(MarkdownLinkContext);

  if (isInsideMarkdownLink) {
    return <>{children}</>;
  }

  return renderInlinePathReferences(codeString, {
    prefixes: pathLinkPrefixes,
    aliases: pathLinkAliases,
    onOpenPath: onOpenWorkspacePath
      ? (path: string) => onOpenWorkspacePath(path, currentDocumentPath)
      : undefined,
  });
}

function slugifyHeadingText(text: string): string {
  const normalized = text
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'section';
}

function collectMarkdownAstText(node?: MarkdownAstNode): string {
  if (!node) return '';

  let result = '';
  if (typeof node.value === 'string') result += node.value;
  if (typeof node.alt === 'string') result += node.alt;
  if (Array.isArray(node.children)) {
    node.children.forEach((child) => {
      result += collectMarkdownAstText(child);
    });
  }

  return result;
}

function walkMarkdownAst(node: MarkdownAstNode | undefined, visit: (node: MarkdownAstNode) => void): void {
  if (!node) return;
  visit(node);
  if (!Array.isArray(node.children)) return;
  node.children.forEach((child) => walkMarkdownAst(child, visit));
}

function remarkStableHeadingIds() {
  return (tree: MarkdownAstNode) => {
    const headingSlugCounts = new Map<string, number>();

    walkMarkdownAst(tree, (node) => {
      if (node.type !== 'heading') return;

      const baseSlug = slugifyHeadingText(collectMarkdownAstText(node));
      const seenCount = headingSlugCounts.get(baseSlug) ?? 0;
      headingSlugCounts.set(baseSlug, seenCount + 1);
      const id = seenCount === 0 ? baseSlug : `${baseSlug}-${seenCount}`;

      node.data ??= {};
      node.data.hProperties ??= {};
      node.data.hProperties.id = id;
    });
  };
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="search-highlight">{part}</mark>
    ) : part,
  );
}

function processChildren(
  children: React.ReactNode,
  options: {
    searchQuery?: string;
    pathLinkPrefixes?: string[];
    pathLinkAliases?: Record<string, string>;
    onOpenWorkspacePath?: (path: string) => void | Promise<void>;
  } = {},
): React.ReactNode {
  const { searchQuery, pathLinkPrefixes, pathLinkAliases, onOpenWorkspacePath } = options;
  const renderPlainText = (text: string) => highlightText(text, searchQuery ?? '');

  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return renderInlinePathReferences(child, {
        prefixes: pathLinkPrefixes,
        aliases: pathLinkAliases,
        onOpenPath: onOpenWorkspacePath,
        renderPlainText,
      });
    }

    if (React.isValidElement<{ children?: React.ReactNode; node?: { tagName?: string } }>(child)) {
      const tagName = typeof child.type === 'string' ? child.type : '';
      const markdownTagName = child.props.node?.tagName ?? '';
      if (tagName === 'code' || tagName === 'pre' || tagName === 'a' || markdownTagName === 'code' || markdownTagName === 'pre' || markdownTagName === 'a') {
        return child;
      }

      if (child.props.children) {
        return React.cloneElement(child, {
          children: processChildren(child.props.children, options),
        });
      }
    }

    return child;
  });
}

function isWorkspacePathLink(href: string): boolean {
  if (!href) return false;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#')) return false;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)) return false;
  if (trimmed.startsWith('//')) return false;
  return true;
}

function decodeWorkspacePathLink(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function canHandleBeadLink(
  url: string,
  options: {
    currentDocumentPath?: string;
    workspaceAgentId?: string;
    onOpenBeadId?: MarkdownRendererProps['onOpenBeadId'];
  } = {},
): boolean {
  if (!options.onOpenBeadId) return false;
  return parseBeadLinkHref(url, {
    currentDocumentPath: options.currentDocumentPath,
    workspaceAgentId: options.workspaceAgentId,
  }) !== null;
}

function transformMarkdownUrl(
  url: string,
  options: {
    currentDocumentPath?: string;
    workspaceAgentId?: string;
    onOpenBeadId?: MarkdownRendererProps['onOpenBeadId'];
  } = {},
): string {
  if (canHandleBeadLink(url, options) || isWorkspacePathLink(url)) {
    return url;
  }
  return defaultUrlTransform(url);
}

function splitWorkspaceLinkTarget(href: string): { path: string; fragment: string | null } {
  const trimmed = href.trim();
  const hashIndex = trimmed.indexOf('#');
  const rawPath = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const rawFragment = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : '';

  return {
    path: decodeWorkspacePathLink(rawPath).trim(),
    fragment: rawFragment ? decodeWorkspacePathLink(rawFragment).trim() : null,
  };
}

function normalizeWorkspaceLinkTarget(href: string): string {
  return splitWorkspaceLinkTarget(href).path;
}

function getWorkspaceLinkFragment(href: string): string | null {
  return splitWorkspaceLinkTarget(href).fragment;
}

function CodeBlock({ code, language, highlightedHtml }: {
  code: string;
  language: string;
  highlightedHtml?: string;
}) {
  return (
    <div className="code-block-wrapper">
      <CodeBlockActions code={code} language={language} />
      <pre className="hljs">
        <span className="code-lang">{language}</span>
        {highlightedHtml
          ? <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
          : <code>{code}</code>
        }
      </pre>
    </div>
  );
}

/** Render markdown content with syntax highlighting, search highlighting, inline path refs, and in-doc anchors. */
export function MarkdownRenderer({
  content,
  className = '',
  searchQuery,
  suppressImages,
  currentDocumentPath,
  onOpenWorkspacePath,
  pathLinkPrefixes,
  pathLinkAliases,
  onOpenBeadId,
  workspaceAgentId,
}: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const childOptions = useMemo(() => ({
    searchQuery,
    pathLinkPrefixes,
    pathLinkAliases,
    onOpenWorkspacePath: onOpenWorkspacePath
      ? (path: string) => onOpenWorkspacePath(path, currentDocumentPath)
      : undefined,
  }), [searchQuery, pathLinkPrefixes, pathLinkAliases, onOpenWorkspacePath, currentDocumentPath]);

  const scrollToAnchorId = useCallback((anchorId: string, behavior: ScrollBehavior = 'smooth') => {
    const root = containerRef.current;
    if (!root || !anchorId) return false;

    const escapedAnchorId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(anchorId)
      : anchorId.replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');

    const target = root.querySelector<HTMLElement>(`#${escapedAnchorId}, a[name="${escapedAnchorId}"]`);
    if (!target) return false;

    target.scrollIntoView({ behavior, block: 'start' });
    return true;
  }, []);

  const updateLocationHash = useCallback((anchorId: string) => {
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', `#${anchorId}`);
    }
  }, []);

  const scrollToAnchor = useCallback((href: string, behavior: ScrollBehavior = 'smooth') => {
    const rawAnchor = href.replace(/^#/, '').trim();
    if (!rawAnchor) return false;

    const anchorId = decodeWorkspacePathLink(rawAnchor);
    const didScroll = scrollToAnchorId(anchorId, behavior);
    if (didScroll) {
      updateLocationHash(anchorId);
    }
    return didScroll;
  }, [scrollToAnchorId, updateLocationHash]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const rawHash = window.location.hash.replace(/^#/, '').trim();
    if (!rawHash) return undefined;

    const frame = window.requestAnimationFrame(() => {
      scrollToAnchor(`#${rawHash}`, 'auto');
    });

    return () => window.cancelAnimationFrame(frame);
  }, [content, currentDocumentPath, scrollToAnchor]);

  const components = useMemo(() => {
    const createHeading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
      ({ children, node, ...props }: HeadingProps) => {
        void node;
        return <Tag {...props}>{processChildren(children, childOptions)}</Tag>;
      };

    return {
      h1: createHeading('h1'),
      h2: createHeading('h2'),
      h3: createHeading('h3'),
      h4: createHeading('h4'),
      h5: createHeading('h5'),
      h6: createHeading('h6'),
      p: ({ children, node, ...props }: ParagraphProps) => {
        void node;
        return <p {...props}>{processChildren(children, childOptions)}</p>;
      },
      li: ({ children, node, ...props }: ListItemProps) => {
        void node;
        return <li {...props}>{processChildren(children, childOptions)}</li>;
      },
      td: ({ children, node, ...props }: TableCellProps) => {
        void node;
        return <td {...props}>{processChildren(children, childOptions)}</td>;
      },
      th: ({ children, node, ...props }: TableHeaderProps) => {
        void node;
        return <th {...props}>{processChildren(children, childOptions)}</th>;
      },
      code: ({ className: codeClassName, children, ...props }: { className?: string; children?: React.ReactNode }) => {
        const match = /language-(\w+)/.exec(codeClassName || '');
        const lang = match ? match[1] : '';
        const codeString = String(children).replace(/\n$/, '');
        const inline = !codeClassName;

        if (!inline && lang) {
          try {
            const highlighted = hljs.getLanguage(lang)
              ? hljs.highlight(codeString, { language: lang }).value
              : hljs.highlightAuto(codeString).value;

            return (
              <CodeBlock
                code={codeString}
                language={lang}
                highlightedHtml={sanitizeHtml(highlighted)}
              />
            );
          } catch {
            return <CodeBlock code={codeString} language={lang} />;
          }
        }

        const inlineContent = inline
          ? (
            <InlineCodeContent
              codeString={codeString}
              pathLinkPrefixes={pathLinkPrefixes}
              pathLinkAliases={pathLinkAliases}
              currentDocumentPath={currentDocumentPath}
              onOpenWorkspacePath={onOpenWorkspacePath}
            >
              {children}
            </InlineCodeContent>
          )
          : children;

        return (
          <code className={codeClassName} {...props}>
            {inlineContent}
          </code>
        );
      },
      table: ({ children }: { children?: React.ReactNode }) => (
        <div className="table-wrapper">
          <table className="markdown-table">{children}</table>
        </div>
      ),
      a: ({ children, href, className: linkClassName, node, ...props }: MarkdownLinkProps) => {
        void node;
        if (!href) {
          return <span>{children}</span>;
        }

        const mergedClassName = [linkClassName, 'markdown-link'].filter(Boolean).join(' ');

        if (href.trim().startsWith('#')) {
          return (
            <a
              {...props}
              href={href}
              className={mergedClassName}
              onClick={(event) => {
                event.preventDefault();
                scrollToAnchor(href);
              }}
            >
              {children}
            </a>
          );
        }

        const beadTarget = parseBeadLinkHref(href, { currentDocumentPath, workspaceAgentId });
        if (onOpenBeadId && beadTarget) {
          return (
            <a
              {...props}
              href={href}
              className={mergedClassName}
              onClick={(event) => {
                event.preventDefault();
                Promise.resolve()
                  .then(() => onOpenBeadId(beadTarget))
                  .catch((error) => {
                    console.error('Failed to open bead link:', error);
                  });
              }}
            >
              {children}
            </a>
          );
        }

        if (onOpenWorkspacePath && isWorkspacePathLink(href)) {
          const normalizedTarget = normalizeWorkspaceLinkTarget(href);
          const fragment = getWorkspaceLinkFragment(href);
          return (
            <MarkdownLinkContext.Provider value={true}>
              <a
                {...props}
                href={href}
                className={mergedClassName}
                onClick={(event) => {
                  event.preventDefault();
                  Promise.resolve()
                    .then(() => onOpenWorkspacePath(normalizedTarget, currentDocumentPath))
                    .then(() => {
                      if (fragment) {
                        updateLocationHash(fragment);
                      }
                    })
                    .catch((error) => {
                      console.error('Failed to open workspace path link:', error);
                    });
                }}
              >
                {children}
              </a>
            </MarkdownLinkContext.Provider>
          );
        }

        return (
          <MarkdownLinkContext.Provider value={true}>
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={mergedClassName}
            >
              {children}
            </a>
          </MarkdownLinkContext.Provider>
        );
      },
      ...(suppressImages ? { img: () => null } : {}),
    };
  }, [
    childOptions,
    currentDocumentPath,
    onOpenBeadId,
    onOpenWorkspacePath,
    pathLinkPrefixes,
    pathLinkAliases,
    scrollToAnchor,
    suppressImages,
    updateLocationHash,
    workspaceAgentId,
  ]);

  return (
    <div ref={containerRef} className={`markdown-content ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkStableHeadingIds]}
        urlTransform={(url) => transformMarkdownUrl(url, {
          currentDocumentPath,
          workspaceAgentId,
          onOpenBeadId,
        })}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
