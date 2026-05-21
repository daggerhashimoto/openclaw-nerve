import React from 'react';

const TRAILING_PUNCTUATION_RE = /[.,:;!?]+$/;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const CANONICAL_WORKSPACE_PREFIX = '/workspace/';
// Intentionally supported shorthand for the canonical /workspace/... path contract.
// Keep this narrow: workspace/... is accepted, but malformed forms like bare workspace/
// or interior-token junk (for example path=workspace/foo.md) are still rejected by the
// tokenization and suffix checks below.
const BARE_WORKSPACE_PREFIX = 'workspace/';
const FILE_WORKSPACE_PREFIX = 'file:///workspace/';
const WRAPPER_PAIRS: Array<{ opener: string; closer: string }> = [
  { opener: '`', closer: '`' },
  { opener: "'", closer: "'" },
  { opener: '"', closer: '"' },
  { opener: '<', closer: '>' },
];

function stripTrailingPunctuation(token: string): { core: string; trailing: string } {
  const trailing = token.match(TRAILING_PUNCTUATION_RE)?.[0] ?? '';
  return {
    core: trailing ? token.slice(0, -trailing.length) : token,
    trailing,
  };
}

function decodeWorkspaceCandidate(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function rewriteAliasPrefix(candidate: string, aliases: Record<string, string>): string {
  const matchingAlias = Object.entries(aliases)
    .filter(([aliasPrefix, targetPrefix]) => aliasPrefix && targetPrefix && candidate.startsWith(aliasPrefix))
    .sort(([leftAlias], [rightAlias]) => rightAlias.length - leftAlias.length)[0];

  if (!matchingAlias) return candidate;

  const [aliasPrefix, targetPrefix] = matchingAlias;
  return `${targetPrefix}${candidate.slice(aliasPrefix.length)}`;
}

function normalizeWorkspaceCandidate(
  candidate: string,
  prefixes: string[],
  aliases: Record<string, string> = {},
): string | null {
  const rewrittenCandidate = rewriteAliasPrefix(candidate, aliases);

  if (rewrittenCandidate.startsWith(FILE_WORKSPACE_PREFIX)) {
    const normalized = decodeWorkspaceCandidate(rewrittenCandidate.slice('file://'.length));
    return normalized.length > CANONICAL_WORKSPACE_PREFIX.length ? normalized : null;
  }

  if (rewrittenCandidate.startsWith(CANONICAL_WORKSPACE_PREFIX)) {
    const normalized = decodeWorkspaceCandidate(rewrittenCandidate);
    return normalized.length > CANONICAL_WORKSPACE_PREFIX.length ? normalized : null;
  }

  if (rewrittenCandidate.startsWith(BARE_WORKSPACE_PREFIX)) {
    const suffix = rewrittenCandidate.slice(BARE_WORKSPACE_PREFIX.length);
    if (!suffix) return null;

    return decodeWorkspaceCandidate(`${CANONICAL_WORKSPACE_PREFIX}${suffix}`);
  }

  for (const prefix of prefixes) {
    if (!prefix || prefix === CANONICAL_WORKSPACE_PREFIX) continue;
    if (!rewrittenCandidate.startsWith(prefix)) continue;

    const suffix = rewrittenCandidate.slice(prefix.length);
    if (!suffix) return null;

    return decodeWorkspaceCandidate(`${CANONICAL_WORKSPACE_PREFIX}${suffix.replace(/^\/+/, '')}`);
  }

  return null;
}

function extractWrappedPathSlice(
  core: string,
  prefixes: string[],
  aliases: Record<string, string>,
): { display: string; candidate: string } | null {
  for (const { opener, closer } of WRAPPER_PAIRS) {
    if (!core.startsWith(opener) || !core.endsWith(closer)) continue;

    const inner = core.slice(opener.length, core.length - closer.length);
    const candidate = normalizeWorkspaceCandidate(inner, prefixes, aliases);
    if (!candidate) return null;

    return {
      display: core,
      candidate,
    };
  }

  return null;
}

function findConfiguredPathSlice(
  token: string,
  prefixes: string[],
  aliases: Record<string, string>,
): { before: string; display: string; candidate: string; after: string } | null {
  if (!token) return null;
  if (token.startsWith('//')) return null;

  const { core, trailing } = stripTrailingPunctuation(token);
  if (!core) return null;

  const plainCandidate = normalizeWorkspaceCandidate(core, prefixes, aliases);
  if (plainCandidate) {
    return { before: '', display: core, candidate: plainCandidate, after: trailing };
  }

  const wrapped = extractWrappedPathSlice(core, prefixes, aliases);
  if (wrapped) {
    return {
      before: '',
      display: wrapped.display,
      candidate: wrapped.candidate,
      after: trailing,
    };
  }

  if (SCHEME_RE.test(core)) return null;

  return null;
}

export function renderInlinePathReferences(
  text: string,
  options: {
    prefixes?: string[];
    aliases?: Record<string, string>;
    onOpenPath?: (path: string) => void | Promise<void>;
    renderPlainText?: (text: string) => React.ReactNode;
  } = {},
): React.ReactNode {
  const { prefixes = [], aliases = {}, onOpenPath, renderPlainText = (value: string) => value } = options;
  if (!text || !onOpenPath || (prefixes.length === 0 && Object.keys(aliases).length === 0)) {
    return renderPlainText(text);
  }

  const tokens = text.split(/(\s+)/);
  let hasLink = false;

  const rendered = tokens.map((token, index) => {
    if (!token) return null;
    if (/^\s+$/.test(token)) {
      return <React.Fragment key={`ws-${index}-${token}`}>{renderPlainText(token)}</React.Fragment>;
    }

    const pathSlice = findConfiguredPathSlice(token, prefixes, aliases);
    if (!pathSlice) {
      return <React.Fragment key={`txt-${index}-${token}`}>{renderPlainText(token)}</React.Fragment>;
    }

    hasLink = true;
    const { before, display, candidate, after } = pathSlice;

    return (
      <React.Fragment key={`path-${index}-${display}-${candidate}-${before}-${after}`}>
        {before ? renderPlainText(before) : null}
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
          {display}
        </a>
        {after ? renderPlainText(after) : null}
      </React.Fragment>
    );
  });

  return hasLink ? rendered : renderPlainText(text);
}
