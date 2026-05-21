export interface ChatPathLinksConfig {
  prefixes: string[];
  aliases: Record<string, string>;
}

export interface ChatPathLinksSeedContext {
  platform?: string;
  homeDir?: string;
  username?: string;
  workspaceRoot?: string;
}

const DEFAULT_PREFIX = '/workspace/';
const CANONICAL_WORKSPACE_PREFIX = '/workspace/';
const BARE_WORKSPACE_PREFIX = 'workspace/';
const FILE_WORKSPACE_PREFIX = 'file:///workspace/';
const SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function normalizePrefixPath(value: string): string {
  const trimmed = value.trim().replaceAll('\\', '/');
  if (!trimmed) return '';
  return withTrailingSlash(trimmed);
}

function dedupePrefixes(prefixes: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const prefix of prefixes) {
    const normalized = normalizePrefixPath(prefix);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function inferHomeDirFromWorkspaceRoot(workspaceRoot?: string): string | null {
  if (!workspaceRoot) return null;

  const normalizedWorkspaceRoot = stripTrailingSlash(normalizePrefixPath(workspaceRoot));
  if (!normalizedWorkspaceRoot) return null;

  const openclawMatch = normalizedWorkspaceRoot.match(/^(.*)\/\.openclaw\/workspace(?:-[^/]+)?$/);
  if (openclawMatch?.[1]) {
    return openclawMatch[1];
  }

  const workspaceMatch = normalizedWorkspaceRoot.match(/^(.*)\/workspace(?:-[^/]+)?$/);
  if (workspaceMatch?.[1]) {
    return workspaceMatch[1];
  }

  return null;
}

function inferHomeDir(context: ChatPathLinksSeedContext): string | null {
  if (context.homeDir) return stripTrailingSlash(normalizePrefixPath(context.homeDir));

  const workspaceRootHome = inferHomeDirFromWorkspaceRoot(context.workspaceRoot);
  if (workspaceRootHome) return workspaceRootHome;

  const username = context.username?.trim();
  if (!username) return null;

  const platform = (context.platform ?? '').toLowerCase();
  if (platform === 'darwin' || platform === 'mac' || platform === 'macos') {
    return `/Users/${username}`;
  }
  if (platform === 'linux') {
    return `/home/${username}`;
  }
  if (platform === 'win32' || platform === 'windows') {
    return `C:/Users/${username}`;
  }

  return null;
}

export function createDefaultChatPathLinksConfig(context: ChatPathLinksSeedContext = {}): ChatPathLinksConfig {
  const prefixes: string[] = [DEFAULT_PREFIX];
  const workspaceRoot = context.workspaceRoot ? normalizePrefixPath(context.workspaceRoot) : '';
  const homeDir = inferHomeDir(context);

  if (workspaceRoot) {
    prefixes.push(workspaceRoot);
  }

  if (homeDir) {
    prefixes.push(`${homeDir}/.openclaw/workspace/`);
    prefixes.push(`${homeDir}/workspace/`);
  }

  return {
    prefixes: dedupePrefixes(prefixes),
    aliases: {},
  };
}

export const DEFAULT_CHAT_PATH_LINKS_CONFIG: ChatPathLinksConfig = createDefaultChatPathLinksConfig();

function normalizeAliasKey(value: string): string {
  const normalized = normalizePrefixPath(value);
  if (!normalized) return '';
  if (normalized.startsWith('/') || normalized.startsWith('file://') || SCHEME_RE.test(normalized)) return '';
  // Reserve workspace/... for the built-in product shorthand, not user-defined aliases.
  if (normalized.startsWith(BARE_WORKSPACE_PREFIX)) return '';
  return normalized;
}

function normalizeAliasValue(value: string): string {
  const normalized = normalizePrefixPath(value);
  if (!normalized) return '';

  if (normalized.startsWith(FILE_WORKSPACE_PREFIX)) {
    const canonical = normalized.slice('file://'.length);
    return canonical.startsWith(CANONICAL_WORKSPACE_PREFIX) ? canonical : '';
  }

  if (normalized.startsWith(CANONICAL_WORKSPACE_PREFIX)) {
    return normalized;
  }

  if (normalized.startsWith(BARE_WORKSPACE_PREFIX)) {
    return `${CANONICAL_WORKSPACE_PREFIX}${normalized.slice(BARE_WORKSPACE_PREFIX.length)}`;
  }

  return '';
}

export function normalizeChatPathLinkPrefixes(rawPrefixes: unknown): string[] {
  if (!Array.isArray(rawPrefixes)) return [...DEFAULT_CHAT_PATH_LINKS_CONFIG.prefixes];

  const normalized = dedupePrefixes(
    rawPrefixes.filter((value): value is string => typeof value === 'string'),
  );

  return normalized.length > 0 ? normalized : [...DEFAULT_CHAT_PATH_LINKS_CONFIG.prefixes];
}

export function normalizeChatPathLinkAliases(rawAliases: unknown): Record<string, string> {
  if (!rawAliases || typeof rawAliases !== 'object' || Array.isArray(rawAliases)) return {};

  const entries = Object.entries(rawAliases as Record<string, unknown>);
  const normalized: Record<string, string> = {};

  for (const [rawKey, rawValue] of entries) {
    if (typeof rawValue !== 'string') continue;

    const key = normalizeAliasKey(rawKey);
    const value = normalizeAliasValue(rawValue);
    if (!key || !value) continue;

    normalized[key] = value;
  }

  return normalized;
}

export function parseChatPathLinksConfig(content: string): ChatPathLinksConfig {
  const parsed = JSON.parse(content) as { prefixes?: unknown; aliases?: unknown };
  return {
    prefixes: normalizeChatPathLinkPrefixes(parsed?.prefixes),
    aliases: normalizeChatPathLinkAliases(parsed?.aliases),
  };
}

export function stringifyChatPathLinksConfig(config: ChatPathLinksConfig): string {
  return `${JSON.stringify({
    prefixes: normalizeChatPathLinkPrefixes(config.prefixes),
    aliases: normalizeChatPathLinkAliases(config.aliases),
  }, null, 2)}\n`;
}

export function createChatPathLinksTemplate(context: ChatPathLinksSeedContext = {}): string {
  return stringifyChatPathLinksConfig(createDefaultChatPathLinksConfig(context));
}
