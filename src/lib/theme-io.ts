/**
 * Nerve Theme Import/Export
 * 
 * Handles importing themes from:
 * - tweakcn URLs (registry API)
 * - tweakcn theme IDs
 * - Raw JSON objects
 * - CSS snippets
 * 
 * And exporting themes as:
 * - JSON (full NerveTheme)
 * - CSS snippets (custom property block)
 * - tweakcn-compatible JSON
 * 
 * All imports are browser-local (localStorage) — no server-side storage.
 */

import {
  type NerveTheme,
  type TweakcnTheme,
  parseTweakcnInput,
  mapTweakcnColors,
  normalizeThemeColors,
  validateTheme,
} from './theme-schema';

// ────────────────────────────────────────────────────────
// Storage keys
// ────────────────────────────────────────────────────────

const STORAGE_KEY_IMPORTED = 'nerve:theme:imported';
const STORAGE_KEY_LAYOUT = 'nerve:theme:layout';

// ────────────────────────────────────────────────────────
// Import: tweakcn URL fetcher
// ────────────────────────────────────────────────────────

/**
 * Fetch a theme from a tweakcn URL or theme ID.
 * 
 * Supported formats:
 * - Full URL: https://tweakcn.com/r/themes/amethyst-haze
 * - Editor URL: https://tweakcn.com/editor/theme?theme=amethyst-haze
 * - Theme ID: amethyst-haze
 * - Registry path: /themes/amethyst-haze
 */
export async function fetchTweakcnTheme(input: string): Promise<NerveTheme> {
  const parsed = parseTweakcnInput(input);
  
  let themeData: TweakcnTheme;
  
  switch (parsed.type) {
    case 'url': {
      // Extract theme ID from URL patterns
      const themeId = extractTweakcnThemeId(parsed.value);
      if (!themeId) {
        throw new Error(`Could not extract theme ID from URL: ${parsed.value}`);
      }
      themeData = await fetchTweakcnRegistry(themeId);
      break;
    }
    
    case 'id': {
      themeData = await fetchTweakcnRegistry(parsed.value);
      break;
    }
    
    case 'json': {
      const parsed = JSON.parse(parsed.value);
      themeData = {
        name: parsed.name || 'Imported Theme',
        colors: parsed.colors || parsed,
      };
      break;
    }
    
    default:
      throw new Error(`Unsupported theme input format`);
  }
  
  // Map tweakcn colors to Nerve variables
  const nerveColors = mapTweakcnColors(themeData.colors);
  const normalizedColors = normalizeThemeColors(nerveColors);
  
  const theme: NerveTheme = {
    name: `imported-${themeData.name || Date.now()}`,
    label: themeData.label || themeData.name || 'Imported Theme',
    colors: normalizedColors,
    hljsTheme: 'github-dark-dimmed', // Default for imported themes
    source: 'imported',
  };
  
  // Validate
  const missing = validateTheme(theme.colors);
  if (missing.length > 0) {
    console.warn(`Imported theme is missing variables: ${missing.join(', ')}. They will fall back to defaults.`);
  }
  
  return theme;
}

/**
 * Extract theme ID from various tweakcn URL patterns.
 */
function extractTweakcnThemeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    
    // /r/themes/<id>
    const rMatch = parsed.pathname.match(/\/r\/themes\/([^/]+)/);
    if (rMatch) return rMatch[1];
    
    // /themes/<id>
    const tMatch = parsed.pathname.match(/\/themes\/([^/]+)/);
    if (tMatch) return tMatch[1];
    
    // /editor/theme?theme=<id>
    const themeParam = parsed.searchParams.get('theme');
    if (themeParam) return themeParam;
    
    return null;
  } catch {
    // Not a valid URL, treat as ID
    return url.trim();
  }
}

/**
 * Fetch theme data from the tweakcn registry API.
 */
async function fetchTweakcnRegistry(themeId: string): Promise<TweakcnTheme> {
  const url = `https://tweakcn.com/r/themes/${themeId}`;
  
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch theme "${themeId}": ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  
  return {
    name: data.name || themeId,
    label: data.label || data.name || themeId,
    colors: data.colors || data.cssVariables || {},
  };
}

// ────────────────────────────────────────────────────────
// Import: CSS snippet parser
// ────────────────────────────────────────────────

/**
 * Parse a CSS snippet containing custom properties.
 * Extracts all --variable: value declarations.
 */
export function parseCSSSnippet(css: string): Record<string, string> {
  const result: Record<string, string> = {};
  
  // Match --variable-name: value;
  const regex = /(--[a-zA-Z0-9-]+)\s*:\s*([^;}\n]+)/g;
  let match: RegExpExecArray | null;
  
  while ((match = regex.exec(css)) !== null) {
    const property = match[1].trim();
    const value = match[2].trim();
    if (property && value) {
      result[property] = value;
    }
  }
  
  return result;
}

/**
 * Import a theme from a CSS snippet.
 */
export function importFromCSS(css: string, name?: string): NerveTheme {
  const colors = parseCSSSnippet(css);
  const normalizedColors = normalizeThemeColors(colors);
  
  return {
    name: name || `css-import-${Date.now()}`,
    label: name || 'CSS Import',
    colors: normalizedColors,
    source: 'imported',
  };
}

// ────────────────────────────────────────────────────────
// Export
// ────────────────────────────────────────

/**
 * Export a NerveTheme as a CSS custom property block.
 */
export function exportAsCSS(theme: NerveTheme): string {
  const lines = Object.entries(theme.colors)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([property, value]) => `  ${property}: ${value};`);
  
  return `:root {\n${lines.join('\n')}\n}`;
}

/**
 * Export a NerveTheme as JSON.
 */
export function exportAsJSON(theme: NerveTheme): string {
  return JSON.stringify({
    name: theme.name,
    label: theme.label,
    colors: Object.fromEntries(
      Object.entries(theme.colors).sort(([a], [b]) => a.localeCompare(b))
    ),
    hljsTheme: theme.hljsTheme,
  }, null, 2);
}

/**
 * Export a NerveTheme in tweakcn-compatible format.
 * Maps Nerve variables back to tweakcn color tokens where possible.
 */
export function exportAsTweakcn(theme: NerveTheme): string {
  const tweakcnColors: Record<string, string> = {};
  
  // Reverse map: --background -> background, --primary -> primary, etc.
  for (const [key, value] of Object.entries(theme.colors)) {
    if (key.startsWith('--color-')) {
      // --color-background -> background
      const tweakcnKey = key.slice(8); // Remove '--color-'
      tweakcnColors[tweakcnKey] = value;
    } else if (key.startsWith('--') && !key.startsWith('--nerve-') && !key.startsWith('--deck-') && !key.startsWith('--cm-') && !key.startsWith('--shell-') && !key.startsWith('--font-') && !key.startsWith('--radius') && !key.startsWith('--shadow')) {
      // --background -> background
      const tweakcnKey = key.slice(2); // Remove '--'
      if (!tweakcnColors[tweakcnKey]) {
        tweakcnColors[tweakcnKey] = value;
      }
    }
  }
  
  return JSON.stringify({
    name: theme.label || theme.name,
    type: 'dark', // Nerve themes are predominantly dark
    colors: tweakcnColors,
  }, null, 2);
}

// ────────────────────────────────────────────────────────
// Browser-local persistence
// ────────────────────────────────────────────────

/**
 * Save the imported theme to localStorage.
 * Overwrites any previously imported theme (single slot, like Control UI).
 */
export function saveImportedTheme(theme: NerveTheme): void {
  try {
    localStorage.setItem(STORAGE_KEY_IMPORTED, JSON.stringify({
      name: theme.name,
      label: theme.label,
      colors: theme.colors,
      hljsTheme: theme.hljsTheme,
      source: theme.source,
    }));
  } catch (e) {
    console.error('Failed to save imported theme:', e);
  }
}

/**
 * Load the imported theme from localStorage.
 * Returns null if no theme has been imported.
 */
export function loadImportedTheme(): NerveTheme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_IMPORTED);
    if (!stored) return null;
    return JSON.parse(stored) as NerveTheme;
  } catch (e) {
    console.error('Failed to load imported theme:', e);
    return null;
  }
}

/**
 * Remove the imported theme from localStorage.
 */
export function clearImportedTheme(): void {
  localStorage.removeItem(STORAGE_KEY_IMPORTED);
}

/**
 * Save the selected layout template to localStorage.
 */
export function saveLayoutTemplate(templateName: string | null): void {
  if (templateName) {
    localStorage.setItem(STORAGE_KEY_LAYOUT, templateName);
  } else {
    localStorage.removeItem(STORAGE_KEY_LAYOUT);
  }
}

/**
 * Load the selected layout template from localStorage.
 */
export function loadLayoutTemplate(): string | null {
  return localStorage.getItem(STORAGE_KEY_LAYOUT);
}