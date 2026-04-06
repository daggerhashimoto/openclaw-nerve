import React from 'react';

const LEADING_WRAP_RE = /^[([{"']+/;
const TRAILING_WRAP_RE = /[)\]}"'.,:;!?]+$/;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

function trimCandidate(token: string): { leading: string; candidate: string; trailing: string } {
  const leading = token.match(LEADING_WRAP_RE)?.[0] ?? '';
  const withoutLeading = token.slice(leading.length);
  const trailing = withoutLeading.match(TRAILING_WRAP_RE)?.[0] ?? '';
  const candidate = trailing ? withoutLeading.slice(0, -trailing.length) : withoutLeading;
  return { leading, candidate, trailing };
}

function isConfiguredPathCandidate(candidate: string, prefixes: string[]): boolean {
  if (!candidate) return false;
  if (SCHEME_RE.test(candidate) || candidate.startsWith('//')) return false;
  return prefixes.some((prefix) => candidate.startsWith(prefix) && candidate.length > prefix.length);
}

export function renderInlinePathReferences(
  text: string,
  options: {
    prefixes?: string[];
    onOpenPath?: (path: string) => void | Promise<void>;
    renderPlainText?: (text: string) => React.ReactNode;
  } = {},
): React.ReactNode {
  const { prefixes = [], onOpenPath, renderPlainText = (value: string) => value } = options;
  if (!text || prefixes.length === 0 || !onOpenPath) {
    return renderPlainText(text);
  }

  const tokens = text.split(/(\s+)/);
  let hasLink = false;

  const rendered = tokens.map((token, index) => {
    if (!token) return null;
    if (/^\s+$/.test(token)) {
      return <React.Fragment key={`ws-${index}-${token}`}>{renderPlainText(token)}</React.Fragment>;
    }

    const { leading, candidate, trailing } = trimCandidate(token);
    if (!isConfiguredPathCandidate(candidate, prefixes)) {
      return <React.Fragment key={`txt-${index}-${token}`}>{renderPlainText(token)}</React.Fragment>;
    }

    hasLink = true;
    return (
      <React.Fragment key={`path-${index}-${candidate}-${leading}-${trailing}`}>
        {leading ? renderPlainText(leading) : null}
        <a
          href={candidate}
          className="markdown-link"
          onClick={(event) => {
            event.preventDefault();
            Promise.resolve(onOpenPath(candidate)).catch((error) => {
              console.error('Failed to open workspace path link:', error);
            });
          }}
        >
          {candidate}
        </a>
        {trailing ? renderPlainText(trailing) : null}
      </React.Fragment>
    );
  });

  return hasLink ? rendered : renderPlainText(text);
}
