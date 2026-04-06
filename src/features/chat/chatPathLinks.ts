export interface ChatPathLinksConfig {
  prefixes: string[];
}

export const DEFAULT_CHAT_PATH_LINKS_CONFIG: ChatPathLinksConfig = {
  prefixes: ['/workspace/'],
};

function normalizePrefixes(rawPrefixes: unknown): string[] {
  if (!Array.isArray(rawPrefixes)) return [...DEFAULT_CHAT_PATH_LINKS_CONFIG.prefixes];

  const normalized = rawPrefixes
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return normalized.length > 0 ? normalized : [...DEFAULT_CHAT_PATH_LINKS_CONFIG.prefixes];
}

export function parseChatPathLinksConfig(content: string): ChatPathLinksConfig {
  const parsed = JSON.parse(content) as { prefixes?: unknown };
  return {
    prefixes: normalizePrefixes(parsed?.prefixes),
  };
}
