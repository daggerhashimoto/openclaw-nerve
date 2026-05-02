/**
 * Nerve Theme Schema
 * 
 * Defines the type system for Nerve themes, including:
 * - NerveTheme: the full theme definition with CSS variables
 * - ThemeVariableSpec: metadata for each CSS variable (for the visual editor)
 * - LayoutTemplate: spacing/sizing overrides (independent of color theme)
 * - ThemeComposition: a color theme + optional layout template
 * 
 * This module is the single source of truth for theme structure.
 * Import types from here; import theme data from themes.ts.
 */

// ────────────────────────────────────────────────────────
// Theme definition
// ────────────────────────────────────────────────────────

/** A complete Nerve theme: a name + map of CSS custom properties to values. */
export interface NerveTheme {
  /** Unique theme identifier (kebab-case, e.g. "midnight", "dracula"). */
  name: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** CSS custom property overrides. Keys include the `--` prefix. */
  colors: Record<string, string>;
  /** Optional: highlight.js theme name for code blocks. */
  hljsTheme?: string;
  /** Optional: whether this is a built-in or imported theme. */
  source?: 'built-in' | 'imported' | 'custom';
}

// ────────────────────────────────────────────────────────
// Layout templates (independent of color themes)
// ────────────────────────────────────────────────────────

/** Layout template: overrides spacing, radii, sizing without touching colors. */
export interface LayoutTemplate {
  /** Unique template identifier (kebab-case). */
  name: string;
  /** Human-readable label. */
  label: string;
  /** CSS custom property overrides for layout/spacing/sizing. */
  overrides: Record<string, string>;
}

// ────────────────────────────────────────────────────────
// Theme composition (color theme + optional layout)
// ────────────────────────────────────────────────────────

/** A composed theme: color theme + optional layout template. */
export interface ThemeComposition {
  /** The color theme. */
  theme: string; // ThemeName or imported theme ID
  /** Optional layout template (null = use theme defaults). */
  layout?: string | null;
}

// ────────────────────────────────────────────────────────
// Variable metadata (for visual theme editor)
// ────────────────────────────────────────────────────────

/** Variable type for the theme editor. */
export type VariableType = 'color' | 'length' | 'font' | 'duration' | 'easing' | 'shadow' | 'ratio';

/** Grouping for the theme editor UI. */
export type VariableGroup =
  | 'brand-colors'
  | 'surface-colors'
  | 'text-colors'
  | 'status-colors'
  | 'sidebar-colors'
  | 'chart-colors'
  | 'message-colors'
  | 'component-colors'
  | 'typography'
  | 'spacing'
  | 'borders-radii'
  | 'shadows'
  | 'animation'
  | 'layout'
  | 'deck-layout'
  | 'editor';

/** Metadata for a single CSS custom property, used by the theme editor. */
export interface VariableSpec {
  /** The CSS property name, including `--` prefix. */
  property: string;
  /** Human-readable label. */
  label: string;
  /** Which editor group this belongs to. */
  group: VariableGroup;
  /** What kind of value this is (determines editor widget). */
  type: VariableType;
  /** Default value (from :root in foundation.css or index.css). */
  default: string;
  /** Short description / help text. */
  description?: string;
  /** For color type: whether this is derived (e.g., color-mix) rather than a base. */
  derived?: boolean;
}

// ────────────────────────────────────────────────────────
// tweakcn compatibility
// ────────────────────────────────────────────────────────

/** 
 * tweakcn theme format (what we import from tweakcn URLs).
 * This is a subset of the tweakcn theme schema — we only use
 * the color tokens that map to our CSS variables.
 */
export interface TweakcnTheme {
  name: string;
  label?: string;
  colors: Record<string, string>;
  // tweakcn has more fields but we only need colors for mapping
}

/** 
 * Mapping from tweakcn color token names to Nerve CSS variable names.
 * tweakcn uses kebab-case names like "background", "foreground", "primary", etc.
 * Nerve uses --background, --foreground, --primary, etc.
 */
export const TWEAKCN_TO_NERVE_MAP: Record<string, string> = {
  // Core semantic colors (direct mapping)
  'background': '--background',
  'foreground': '--foreground',
  'card': '--card',
  'card-foreground': '--card-foreground',
  'popover': '--popover',
  'popover-foreground': '--popover-foreground',
  'primary': '--primary',
  'primary-foreground': '--primary-foreground',
  'secondary': '--secondary',
  'secondary-foreground': '--secondary-foreground',
  'muted': '--muted',
  'muted-foreground': '--muted-foreground',
  'accent': '--accent',
  'accent-foreground': '--accent-foreground',
  'destructive': '--destructive',
  'destructive-foreground': '--destructive-foreground',
  'border': '--border',
  'input': '--input',
  'ring': '--ring',
  // Sidebar (tweakcn doesn't have these, but we can map from core)
  'sidebar': '--sidebar',
  'sidebar-foreground': '--sidebar-foreground',
  'sidebar-primary': '--sidebar-primary',
  'sidebar-primary-foreground': '--sidebar-primary-foreground',
  'sidebar-accent': '--sidebar-accent',
  'sidebar-accent-foreground': '--sidebar-accent-foreground',
  'sidebar-border': '--sidebar-border',
  'sidebar-ring': '--sidebar-ring',
  // Chart (tweakcn has chart-1 through chart-5)
  'chart-1': '--chart-1',
  'chart-2': '--chart-2',
  'chart-3': '--chart-3',
  'chart-4': '--chart-4',
  'chart-5': '--chart-5',
};

/**
 * Convert a tweakcn theme name to a Nerve-compatible theme.
 * Handles URL patterns, theme IDs, and raw JSON objects.
 */
export function parseTweakcnInput(input: string): { type: 'url' | 'id' | 'json'; value: string } {
  const trimmed = input.trim();
  
  // URL patterns
  if (trimmed.startsWith('https://tweakcn.com/') || trimmed.startsWith('http://tweakcn.com/')) {
    return { type: 'url', value: trimmed };
  }
  
  // Try parsing as JSON
  if (trimmed.startsWith('{')) {
    try {
      JSON.parse(trimmed);
      return { type: 'json', value: trimmed };
    } catch {
      // Not valid JSON, fall through
    }
  }
  
  // Otherwise treat as a theme ID
  return { type: 'id', value: trimmed };
}

/**
 * Map tweakcn colors to Nerve CSS variables.
 * Takes the colors from a tweakcn theme and returns Nerve-compatible overrides.
 */
export function mapTweakcnColors(colors: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  
  for (const [tweakcnKey, nerveVar] of Object.entries(TWEAKCN_TO_NERVE_MAP)) {
    if (colors[tweakcnKey]) {
      result[nerveVar] = colors[tweakcnKey];
      // Also set the --color-* variant for the existing dual-property system
      result[`--color-${tweakcnKey}`] = colors[tweakcnKey];
    }
  }
  
  // Nerve-specific colors that don't have tweakcn equivalents
  // Map from closest semantic equivalents if not provided
  const nerveExtras: Record<string, string[]> = {
    '--green': ['green', 'success'],
    '--red': ['destructive', 'error'],
    '--orange': ['warning', 'orange'],
    '--purple': ['purple', 'accent'],
    '--info': ['info', 'primary'],
    '--message-user': ['message-user'],
    '--message-assistant': ['message-assistant'],
    '--message-system': ['message-system'],
    '--scrollbar': ['border'],
    '--scrollbar-hover': ['border'],
  };
  
  for (const [nerveVar, fallbacks] of Object.entries(nerveExtras)) {
    if (!result[nerveVar]) {
      for (const fallback of fallbacks) {
        if (colors[fallback]) {
          // For scrollbar, lighten/darken the border color
          if (nerveVar === '--scrollbar' || nerveVar === '--scrollbar-hover') {
            result[nerveVar] = colors[fallback]; // Use as-is; themes can refine
          } else {
            result[nerveVar] = colors[fallback];
          }
          break;
        }
      }
    }
  }
  
  return result;
}

// ────────────────────────────────────────────────────────
// Theme validation
// ────────────────────────────────────────────────────────

/** Required CSS variables that every theme must define. */
export const REQUIRED_THEME_VARIABLES = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
] as const;

/**
 * Validate a theme has all required variables.
 * Returns an array of missing variable names (empty = valid).
 */
export function validateTheme(colors: Record<string, string>): string[] {
  return REQUIRED_THEME_VARIABLES.filter(v => !(v in colors) && !(`--color${v}` in colors));
}

/**
 * Convert between --color-* and --* property naming.
 * Nerve themes historically use --color-background which also sets --background.
 * This function normalizes a theme to include BOTH forms.
 */
export function normalizeThemeColors(colors: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = { ...colors };
  
  for (const [key, value] of Object.entries(colors)) {
    // --color-X also sets --X
    if (key.startsWith('--color-')) {
      const baseKey = '--' + key.slice(8); // Remove '--color-' prefix
      if (!(baseKey in result)) {
        result[baseKey] = value;
      }
    }
    // --X also sets --color-X
    else if (key.startsWith('--') && !key.startsWith('--color-') && !key.startsWith('--nerve-') && !key.startsWith('--deck-') && !key.startsWith('--cm-') && !key.startsWith('--shell-') && !key.startsWith('--font-') && !key.startsWith('--radius') && !key.startsWith('--shadow') && !key.startsWith('--duration') && !key.startsWith('--ease')) {
      const colorKey = '--color-' + key.slice(2);
      if (!(colorKey in result)) {
        result[colorKey] = value;
      }
    }
  }
  
  return result;
}