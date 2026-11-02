// Theme definitions for Nerve UI
//
// Nerve ships one identity in two lights. Colour carries meaning, never decoration:
//   live      electric blue: agent work in progress (running, streaming, tool calls)
//   operator  cantaloupe: the operator and anything waiting on the operator
//   red       errors only
// Everything finished or idle goes dark (pane-off).
//
// The 14 community themes, and the Classic skin that carried them after the
// redesign, were retired on 2026-11-02. Stored values from either era map onto
// Night or Daylight by scheme in resolveThemeName().

export type ThemeName = 'nerve-dark' | 'nerve-light';

export interface Theme {
  name: ThemeName;
  label: string;
  /** Value for the root color-scheme and data-theme attribute. */
  scheme: 'dark' | 'light';
  colors: Record<string, string>;
}

export const DEFAULT_THEME: ThemeName = 'nerve-dark';

export const themes: Record<ThemeName, Theme> = {
  'nerve-dark': {
    name: 'nerve-dark',
    label: 'Night',
    scheme: 'dark',
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
};

/** All available theme names as a typed array. */
export const themeNames = Object.keys(themes) as ThemeName[];

/**
 * Map any stored theme value to a current theme. Values from before the
 * redesign (the unprefixed community theme names) and from the retired Classic
 * skin (their classic- prefixed copies) land on the Nerve identity: the light
 * themes map to Daylight and every dark theme maps to Night.
 */
export function resolveThemeName(saved: string | null | undefined): ThemeName {
  if (saved && (themeNames as string[]).includes(saved)) return saved as ThemeName;
  if (saved === 'light' || saved === 'classic-light') return 'nerve-light';
  return DEFAULT_THEME;
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
