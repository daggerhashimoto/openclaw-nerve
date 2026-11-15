// Theme definitions for Nerve UI
//
// Every theme keeps one meaning for colour, never decoration:
//   live      blue: agent work in progress (running, streaming, tool calls)
//   operator  cantaloupe: the operator and anything waiting on the operator
//   red       errors only
// Everything finished or idle goes dark (pane-off).
//
// Two worlds carry that meaning. Night light (Night, Daylight) is the console as a
// building lit at night. Workbench (Workbench Night, Workbench Paper) is the same
// console printed as a working drawing, from the Ruled Workbench design system:
// graphite or paper sheets, drawn rules, Workbench's cobalt as the live light. The
// world is set as data-world on the root, so index.css can carry the parts of a
// world that are not colours (faces, rules, shadows, grain).
//
// Workbench Night is the default since 2026-11-15. The 14 community themes, and
// the Classic skin that carried them after the redesign, were retired on
// 2026-11-02; stored values from either era resolve in resolveThemeName().

import { loadWorkbenchFonts } from './fonts';

export type ThemeName = 'nerve-dark' | 'nerve-light' | 'workbench-night' | 'workbench-paper';

/** The visual world a theme belongs to; set as data-world on the document root. */
export type ThemeWorld = 'night-light' | 'workbench';

export interface Theme {
  name: ThemeName;
  label: string;
  /** Value for the root color-scheme and data-theme attribute. */
  scheme: 'dark' | 'light';
  world: ThemeWorld;
  colors: Record<string, string>;
}

export const DEFAULT_THEME: ThemeName = 'workbench-night';

/** localStorage key holding the operator's theme. */
export const THEME_STORAGE_KEY = 'oc-theme';

/**
 * Marks the one-time move of a stored Night onto Workbench Night when it became
 * the default. public/theme-boot.js reads the same key and value.
 */
export const THEME_DEFAULT_MIGRATION_KEY = 'oc-theme-default';
export const THEME_DEFAULT_MIGRATION = 'workbench-night-2026-11';

export const themes: Record<ThemeName, Theme> = {
  'nerve-dark': {
    name: 'nerve-dark',
    label: 'Night',
    scheme: 'dark',
    world: 'night-light',
    colors: {
      // Deeper midnight: the centre column is the night, the wings are lifted a step,
      // and rules sit low so plates read by value and edge light, not by drawn lines.
      '--color-background': '#06080E',
      '--color-foreground': '#ECE6DA',
      '--color-card': '#0D121C',
      '--color-plate': '#121926',
      '--color-card-foreground': '#ECE6DA',
      '--color-popover': '#1B2334',
      '--color-popover-foreground': '#ECE6DA',
      '--color-primary': '#FFA567',
      '--color-primary-foreground': '#06080E',
      '--color-secondary': '#131927',
      '--color-secondary-foreground': '#ECE6DA',
      '--color-muted': '#131927',
      '--color-muted-foreground': '#8C94A6',
      '--color-accent': '#182030',
      '--color-accent-foreground': '#ECE6DA',
      '--color-destructive': '#FF5A5A',
      '--color-destructive-foreground': '#06080E',
      '--color-border': '#171E2C',
      '--color-input': '#1F2736',
      '--color-ring': '#FFA567',
      '--color-green': '#7CC99A',
      '--color-red': '#FF5A5A',
      '--color-orange': '#FFA567',
      '--color-purple': '#B9A7FF',
      '--color-info': '#3D7EFF',
      // The operator's plate: card warmed by 10% cantaloupe
      '--color-message-user': '#372A25',
      '--color-message-assistant': '#06080E',
      '--color-message-system': '#0D121C',
      '--color-scrollbar': '#1D2433',
      '--color-scrollbar-hover': '#2B3449',
      // World tokens
      '--color-live': '#3D7EFF',
      '--color-live-text': '#4F8BFF',
      '--color-operator': '#FFA567',
      '--color-operator-text': '#FFA567',
      '--color-pane-off': '#161D2C',
      '--color-pane-edge': '#263044',
      '--color-raised': '#1A2232',
      // Sidebar colors
      '--color-sidebar': '#0D121C',
      '--color-sidebar-foreground': '#ECE6DA',
      '--color-sidebar-primary': '#FFA567',
      '--color-sidebar-primary-foreground': '#06080E',
      '--color-sidebar-accent': '#182030',
      '--color-sidebar-accent-foreground': '#ECE6DA',
      '--color-sidebar-border': '#171E2C',
      '--color-sidebar-ring': '#FFA567',
      // Chart colors: data plates may use the full set
      '--color-chart-1': '#3D7EFF',
      '--color-chart-2': '#FFA567',
      '--color-chart-3': '#7FD1C7',
      '--color-chart-4': '#B9A7FF',
      '--color-chart-5': '#FF5A5A',
    },
  },
  'nerve-light': {
    name: 'nerve-light',
    label: 'Daylight',
    scheme: 'light',
    world: 'night-light',
    colors: {
      '--color-background': '#F3F5F9',
      '--color-foreground': '#131722',
      '--color-card': '#FFFFFF',
      '--color-plate': '#F7F9FC',
      '--color-card-foreground': '#131722',
      '--color-popover': '#FFFFFF',
      '--color-popover-foreground': '#131722',
      '--color-primary': '#FF9F55',
      '--color-primary-foreground': '#131722',
      '--color-secondary': '#EAEEF4',
      '--color-secondary-foreground': '#131722',
      '--color-muted': '#EAEEF4',
      '--color-muted-foreground': '#566072',
      '--color-accent': '#E4E9F1',
      '--color-accent-foreground': '#131722',
      '--color-destructive': '#C8322F',
      '--color-destructive-foreground': '#FFFFFF',
      '--color-border': '#D9DFE8',
      '--color-input': '#CBD3DF',
      '--color-ring': '#C4621A',
      '--color-green': '#2F7D4F',
      '--color-red': '#C8322F',
      '--color-orange': '#B4520F',
      '--color-purple': '#6B4FD8',
      '--color-info': '#1F5FE0',
      // The operator's plate: warm paper
      '--color-message-user': '#FFEBD6',
      '--color-message-assistant': '#F3F5F9',
      '--color-message-system': '#EAEEF4',
      '--color-scrollbar': '#CBD3DF',
      '--color-scrollbar-hover': '#A9B3C3',
      // World tokens: panes become printed ink swatches in daylight
      '--color-live': '#1F5FE0',
      '--color-live-text': '#1F5FE0',
      '--color-operator': '#FF9F55',
      '--color-operator-text': '#B4520F',
      '--color-pane-off': '#E4E9F1',
      '--color-pane-edge': '#B9C2D0',
      '--color-raised': '#EAEEF4',
      // Sidebar colors
      '--color-sidebar': '#FFFFFF',
      '--color-sidebar-foreground': '#131722',
      '--color-sidebar-primary': '#FF9F55',
      '--color-sidebar-primary-foreground': '#131722',
      '--color-sidebar-accent': '#E4E9F1',
      '--color-sidebar-accent-foreground': '#131722',
      '--color-sidebar-border': '#D9DFE8',
      '--color-sidebar-ring': '#C4621A',
      // Chart colors
      '--color-chart-1': '#1F5FE0',
      '--color-chart-2': '#E07A2E',
      '--color-chart-3': '#13857C',
      '--color-chart-4': '#6B4FD8',
      '--color-chart-5': '#C8322F',
    },
  },
  'workbench-night': {
    name: 'workbench-night',
    label: 'Workbench Night',
    scheme: 'dark',
    world: 'workbench',
    colors: {
      // Ruled Workbench, Night: a graphite drafting sheet. Canvas is the frame, panel-white the
      // room, and the translucent sheets of the source are flattened onto the panel as plates.
      '--color-background': '#111318',
      '--color-foreground': '#C3C8D1',
      '--color-card': '#171A20',
      '--color-plate': '#1F2228',
      '--color-card-foreground': '#C3C8D1',
      '--color-popover': '#1F2228',
      '--color-popover-foreground': '#C3C8D1',
      '--color-primary': '#FFA567',
      '--color-primary-foreground': '#111318',
      '--color-secondary': '#272A30',
      '--color-secondary-foreground': '#C3C8D1',
      '--color-muted': '#1F2228',
      '--color-muted-foreground': '#8F96A3',
      '--color-accent': '#272A30',
      '--color-accent-foreground': '#C3C8D1',
      '--color-destructive': '#FF5A5A',
      '--color-destructive-foreground': '#111318',
      // Rules are drawn structure in this world, not hairlines kept out of sight. Field edges are
      // lifted from the source's edge (#4A505C, 2.3:1) to reach 3:1 on every Workbench surface.
      '--color-border': '#2A2F38',
      '--color-input': '#6D7380',
      '--color-ring': '#FFA567',
      '--color-green': '#9FC9A8',
      '--color-red': '#FF5A5A',
      '--color-orange': '#FFA567',
      '--color-purple': '#B9A7FF',
      '--color-info': '#8EA9FF',
      // The operator's plate: the panel warmed by 16% cantaloupe
      '--color-message-user': '#3C302B',
      '--color-message-assistant': '#111318',
      '--color-message-system': '#171A20',
      '--color-scrollbar': '#2A2F38',
      '--color-scrollbar-hover': '#4A505C',
      // World tokens. Workbench's cobalt is the live light; the source's deep fill (#1D4FE3)
      // reads at 2.7:1 on the panel, so a lit pane takes its lifted cobalt (#3462F2, 3.5:1)
      // and live text its pale blue ink.
      '--color-live': '#3462F2',
      '--color-live-text': '#8EA9FF',
      '--color-operator': '#FFA567',
      '--color-operator-text': '#FFA567',
      // An off pane is a drafting node: node fill with the node edge as its frame
      '--color-pane-off': '#171A20',
      '--color-pane-edge': '#3A404B',
      '--color-raised': '#272A30',
      // Sidebar colors
      '--color-sidebar': '#171A20',
      '--color-sidebar-foreground': '#C3C8D1',
      '--color-sidebar-primary': '#FFA567',
      '--color-sidebar-primary-foreground': '#111318',
      '--color-sidebar-accent': '#272A30',
      '--color-sidebar-accent-foreground': '#C3C8D1',
      '--color-sidebar-border': '#2A2F38',
      '--color-sidebar-ring': '#FFA567',
      // Chart colors
      '--color-chart-1': '#8EA9FF',
      '--color-chart-2': '#FFA567',
      '--color-chart-3': '#9FC9A8',
      '--color-chart-4': '#B9A7FF',
      '--color-chart-5': '#FF5A5A',
    },
  },
  'workbench-paper': {
    name: 'workbench-paper',
    label: 'Workbench Paper',
    scheme: 'light',
    world: 'workbench',
    colors: {
      // Ruled Workbench, Paper: the source theme. Pale paper frame, near-white room.
      '--color-background': '#F4F4F2',
      '--color-foreground': '#393D45',
      '--color-card': '#FBFBFA',
      '--color-plate': '#F7F7F6',
      '--color-card-foreground': '#393D45',
      '--color-popover': '#FFFFFF',
      '--color-popover-foreground': '#393D45',
      '--color-primary': '#FF9F55',
      '--color-primary-foreground': '#1B1E24',
      '--color-secondary': '#E9EAEA',
      '--color-secondary-foreground': '#393D45',
      '--color-muted': '#E9EAEA',
      '--color-muted-foreground': '#5C636F',
      '--color-accent': '#E9EAEA',
      '--color-accent-foreground': '#393D45',
      '--color-destructive': '#BF3C27',
      '--color-destructive-foreground': '#FFFFFF',
      '--color-border': '#DADDE2',
      // Field edges darkened from the source's edge (#BDC1C9, 1.6:1) to reach 3:1 on paper and white
      '--color-input': '#808690',
      '--color-ring': '#C4621A',
      '--color-green': '#2F7D4F',
      '--color-red': '#BF3C27',
      '--color-orange': '#B4520F',
      '--color-purple': '#6B4FD8',
      '--color-info': '#1348DC',
      // The operator's plate: the panel warmed by 14% cantaloupe
      '--color-message-user': '#FCEEE3',
      '--color-message-assistant': '#F4F4F2',
      '--color-message-system': '#E9EAEA',
      '--color-scrollbar': '#CBCFD4',
      '--color-scrollbar-hover': '#A7ACB4',
      // World tokens: Workbench's cobalt is the live light and its own ink
      '--color-live': '#1348DC',
      '--color-live-text': '#1348DC',
      '--color-operator': '#FF9F55',
      '--color-operator-text': '#B4520F',
      // An off pane is a drafting node: white with the node edge as its frame
      '--color-pane-off': '#FFFFFF',
      '--color-pane-edge': '#CBCFD4',
      '--color-raised': '#E9EAEA',
      // Sidebar colors
      '--color-sidebar': '#FBFBFA',
      '--color-sidebar-foreground': '#393D45',
      '--color-sidebar-primary': '#FF9F55',
      '--color-sidebar-primary-foreground': '#1B1E24',
      '--color-sidebar-accent': '#E9EAEA',
      '--color-sidebar-accent-foreground': '#393D45',
      '--color-sidebar-border': '#DADDE2',
      '--color-sidebar-ring': '#C4621A',
      // Chart colors
      '--color-chart-1': '#1348DC',
      '--color-chart-2': '#E07A2E',
      '--color-chart-3': '#13857C',
      '--color-chart-4': '#6B4FD8',
      '--color-chart-5': '#BF3C27',
    },
  },
};

/** All available theme names as a typed array. */
export const themeNames = Object.keys(themes) as ThemeName[];

/**
 * Map any stored theme value to a current theme. Values from before the
 * redesign (the unprefixed community theme names) and from the retired Classic
 * skin (their classic- prefixed copies) land by scheme: the light themes map to
 * Daylight, and every dark, missing or unknown value takes the default.
 */
export function resolveThemeName(saved: string | null | undefined): ThemeName {
  if (saved && (themeNames as string[]).includes(saved)) return saved as ThemeName;
  if (saved === 'light' || saved === 'classic-light') return 'nerve-light';
  return DEFAULT_THEME;
}

/**
 * The theme to start with, read from storage and written back resolved.
 *
 * Every load used to write the resolved theme back, so a stored Night cannot
 * tell an operator's pick from the old default. When Workbench Night became the
 * default, a stored Night moves to it once; picking Night again afterwards
 * sticks. Storage that throws (private windows, blocked site data) falls back
 * to the default.
 */
export function loadStoredTheme(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): ThemeName {
  let saved: string | null = null;
  try {
    saved = storage.getItem(THEME_STORAGE_KEY);
  } catch {
    return DEFAULT_THEME;
  }
  let theme = resolveThemeName(saved);
  try {
    if (storage.getItem(THEME_DEFAULT_MIGRATION_KEY) !== THEME_DEFAULT_MIGRATION) {
      if (theme === 'nerve-dark') theme = DEFAULT_THEME;
      storage.setItem(THEME_DEFAULT_MIGRATION_KEY, THEME_DEFAULT_MIGRATION);
    }
    if (saved !== theme) storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage refused the write; the theme still applies for this visit
  }
  return theme;
}

/** Apply a theme by setting CSS custom properties on the document root and loading the matching highlight.js stylesheet. */
export function applyTheme(themeName: ThemeName): void {
  const theme = themes[themeName];
  if (!theme) return;

  const root = document.documentElement;
  Object.entries(theme.colors).forEach(([property, value]) => {
    // Set the --color-* property
    root.style.setProperty(property, value);

    // Also set the base property (without --color- prefix) for :root vars
    // e.g., --color-background -> --background
    if (property.startsWith('--color-')) {
      const baseProperty = '--' + property.slice(8); // Remove '--color-' prefix
      root.style.setProperty(baseProperty, value);
    }
  });
  root.dataset.theme = theme.scheme;
  root.dataset.world = theme.world;
  // Workbench's faces load only when a Workbench theme is in use
  if (theme.world === 'workbench') loadWorkbenchFonts();
  root.style.colorScheme = theme.scheme;

  // Apply highlight.js theme (vendored locally to avoid CDN dependency)
  const existingLink = document.getElementById('hljs-theme') as HTMLLinkElement | null;
  const hljsHref = `/hljs/${theme.name}.min.css`;

  if (existingLink) {
    if (existingLink.getAttribute('href') !== hljsHref) {
      existingLink.href = hljsHref;
    }
  } else {
    const link = document.createElement('link');
    link.id = 'hljs-theme';
    link.rel = 'stylesheet';
    link.href = hljsHref;
    document.head.appendChild(link);
  }
}
