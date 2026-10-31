// Theme definitions for Nerve UI
//
// Nerve ships one identity in two lights. Colour carries meaning, never decoration:
//   live      electric blue: agent work in progress (running, streaming, tool calls)
//   operator  cantaloupe: the operator and anything waiting on the operator
//   red       errors only
// Everything finished or idle goes dark (pane-off).
//
// The previous look survives as the opt-in Classic style: its 14 community
// themes, skinned over the same layout by src/styles/classic.css. Classic theme
// names carry a prefix so values stored before the redesign never select them.

import { loadClassicFonts } from './fonts';

/** Visual style: the Nerve identity (default) or the opt-in Classic skin. */
export type ThemeStyle = 'nerve' | 'classic';

export type NerveThemeName = 'nerve-dark' | 'nerve-light';

export type ClassicThemeName =
  | 'classic-midnight'
  | 'classic-light'
  | 'classic-phosphor'
  | 'classic-dracula'
  | 'classic-nord'
  | 'classic-solarized-dark'
  | 'classic-catppuccin-mocha'
  | 'classic-tokyo-night'
  | 'classic-gruvbox-dark'
  | 'classic-one-dark'
  | 'classic-monokai'
  | 'classic-ayu-dark'
  | 'classic-rose-pine'
  | 'classic-monochrome';

export type ThemeName = NerveThemeName | ClassicThemeName;

export interface Theme {
  name: ThemeName;
  label: string;
  /** Value for the root color-scheme and data-theme attribute. */
  scheme: 'dark' | 'light';
  /** Value for the root data-style attribute; selects the CSS skin. */
  style: ThemeStyle;
  colors: Record<string, string>;
}

export const DEFAULT_THEME: ThemeName = 'nerve-dark';

/** Theme picked when the operator switches to a style the current theme does not belong to. */
export const DEFAULT_THEME_BY_STYLE: Record<ThemeStyle, ThemeName> = {
  nerve: 'nerve-dark',
  classic: 'classic-ayu-dark',
};

/** Styles in display order. */
export const themeStyles: ThemeStyle[] = ['nerve', 'classic'];

export const themeStyleLabels: Record<ThemeStyle, string> = {
  nerve: 'Nerve',
  classic: 'Classic',
};

export const themes: Record<ThemeName, Theme> = {
  'nerve-dark': {
    name: 'nerve-dark',
    label: 'Night',
    scheme: 'dark',
    style: 'nerve',
    colors: {
      // Deeper midnight: the centre column is the night, the wings are lifted a step,
      // and rules sit low so plates read by value and edge light, not by drawn lines.
      '--color-background': '#06080E',
      '--color-foreground': '#ECE6DA',
      '--color-card': '#0B0F17',
      '--color-card-foreground': '#ECE6DA',
      '--color-popover': '#121826',
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
      // The operator's plate: card warmed by 5% cantaloupe
      '--color-message-user': '#17161B',
      '--color-message-assistant': '#06080E',
      '--color-message-system': '#0B0F17',
      '--color-scrollbar': '#1D2433',
      '--color-scrollbar-hover': '#2B3449',
      // World tokens
      '--color-live': '#3D7EFF',
      '--color-live-text': '#4F8BFF',
      '--color-operator': '#FFA567',
      '--color-operator-text': '#FFA567',
      '--color-pane-off': '#161D2C',
      '--color-pane-edge': '#263044',
      '--color-raised': '#151C2A',
      // Sidebar colors
      '--color-sidebar': '#0B0F17',
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
    style: 'nerve',
    colors: {
      '--color-background': '#F3F5F9',
      '--color-foreground': '#131722',
      '--color-card': '#FFFFFF',
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
      '--color-message-user': '#FFF7EF',
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
  // Classic style: the legacy community palettes, copied verbatim. World tokens
  // (live, operator, panes, raised) are derived in resolveThemeColors().
  'classic-midnight': {
    name: 'classic-midnight',
    label: 'Midnight',
    scheme: 'dark',
    style: 'classic',
    colors: {
      '--color-background': '#0a0e14',
      '--color-foreground': '#B3B1AD',
      '--color-card': '#0d1117',
      '--color-card-foreground': '#B3B1AD',
      '--color-popover': '#0d1117',
      '--color-popover-foreground': '#B3B1AD',
      '--color-primary': '#39BAE6',
      '--color-primary-foreground': '#0a0e14',
      '--color-secondary': '#151b23',
      '--color-secondary-foreground': '#B3B1AD',
      '--color-muted': '#151b23',
      '--color-muted-foreground': '#6c7380',
      '--color-accent': '#151b23',
      '--color-accent-foreground': '#B3B1AD',
      '--color-destructive': '#FF3333',
      '--color-destructive-foreground': '#B3B1AD',
      '--color-border': '#1e2530',
      '--color-input': '#1e2530',
      '--color-ring': '#39BAE6',
      '--color-green': '#7FD962',
      '--color-red': '#FF3333',
      '--color-orange': '#FF8F40',
      '--color-purple': '#D2A6FF',
      '--color-info': '#39BAE6',
      '--color-message-user': '#0d1020',
      '--color-message-assistant': '#0d1410',
      '--color-message-system': '#0d0e1a',
      '--color-scrollbar': '#1e2530',
      '--color-scrollbar-hover': '#2d3848',
      // Sidebar colors
      '--color-sidebar': '#0d1117',
      '--color-sidebar-foreground': '#B3B1AD',
      '--color-sidebar-primary': '#39BAE6',
      '--color-sidebar-primary-foreground': '#0a0e14',
      '--color-sidebar-accent': '#151b23',
      '--color-sidebar-accent-foreground': '#B3B1AD',
      '--color-sidebar-border': '#1e2530',
      '--color-sidebar-ring': '#39BAE6',
      // Chart colors
      '--color-chart-1': '#39BAE6',
      '--color-chart-2': '#7FD962',
      '--color-chart-3': '#D2A6FF',
      '--color-chart-4': '#FF3333',
      '--color-chart-5': '#FF8F40',
    },
  },
  'classic-light': {
    name: 'classic-light',
    label: 'Light',
    scheme: 'light',
    style: 'classic',
    colors: {
      '--color-background': '#FAFAFA',
      '--color-foreground': '#1a1a1a',
      '--color-card': '#FFFFFF',
      '--color-card-foreground': '#1a1a1a',
      '--color-popover': '#FFFFFF',
      '--color-popover-foreground': '#1a1a1a',
      '--color-primary': '#D97706',
      '--color-primary-foreground': '#FFFFFF',
      '--color-secondary': '#F3F4F6',
      '--color-secondary-foreground': '#1a1a1a',
      '--color-muted': '#F3F4F6',
      '--color-muted-foreground': '#6B7280',
      '--color-accent': '#F3F4F6',
      '--color-accent-foreground': '#1a1a1a',
      '--color-destructive': '#DC2626',
      '--color-destructive-foreground': '#FFFFFF',
      '--color-border': '#E5E7EB',
      '--color-input': '#E5E7EB',
      '--color-ring': '#D97706',
      '--color-green': '#16A34A',
      '--color-red': '#DC2626',
      '--color-orange': '#D97706',
      '--color-purple': '#7C3AED',
      '--color-info': '#2563EB',
      '--color-message-user': '#FEF3E2',
      '--color-message-assistant': '#F0FDF4',
      '--color-message-system': '#EEF2FF',
      '--color-scrollbar': '#D1D5DB',
      '--color-scrollbar-hover': '#9CA3AF',
      // Sidebar colors for light mode
      '--color-sidebar': '#FFFFFF',
      '--color-sidebar-foreground': '#1a1a1a',
      '--color-sidebar-primary': '#D97706',
      '--color-sidebar-primary-foreground': '#FFFFFF',
      '--color-sidebar-accent': '#F3F4F6',
      '--color-sidebar-accent-foreground': '#1a1a1a',
      '--color-sidebar-border': '#E5E7EB',
      '--color-sidebar-ring': '#D97706',
      // Chart colors
      '--color-chart-1': '#D97706',
      '--color-chart-2': '#16A34A',
      '--color-chart-3': '#7C3AED',
      '--color-chart-4': '#DC2626',
      '--color-chart-5': '#2563EB',
    },
  },
  'classic-phosphor': {
    name: 'classic-phosphor',
    label: 'Phosphor',
    scheme: 'dark',
    style: 'classic',
    colors: {
      '--color-background': '#080808',
      '--color-foreground': '#88CC88',
      '--color-card': '#0d120d',
      '--color-card-foreground': '#88CC88',
      '--color-popover': '#0d120d',
      '--color-popover-foreground': '#88CC88',
      '--color-primary': '#00FF41',
      '--color-primary-foreground': '#080808',
      '--color-secondary': '#0f160f',
      '--color-secondary-foreground': '#88CC88',
      '--color-muted': '#0f160f',
      '--color-muted-foreground': '#7a9a7a',
      '--color-accent': '#0f160f',
      '--color-accent-foreground': '#88CC88',
      '--color-destructive': '#FF3333',
      '--color-destructive-foreground': '#88CC88',
      '--color-border': '#1a2e1a',
      '--color-input': '#1a2e1a',
      '--color-ring': '#00FF41',
      '--color-green': '#00FF41',
      '--color-red': '#FF3333',
      '--color-orange': '#CCAA33',
      '--color-purple': '#6B8E6B',
      '--color-info': '#00CED1',
      '--color-message-user': '#0a140a',
      '--color-message-assistant': '#0d100d',
      '--color-message-system': '#0a120e',
      '--color-scrollbar': '#1a2e1a',
      '--color-scrollbar-hover': '#2a4a2a',
      // Sidebar colors
      '--color-sidebar': '#0a0e0a',
      '--color-sidebar-foreground': '#88CC88',
      '--color-sidebar-primary': '#00FF41',
      '--color-sidebar-primary-foreground': '#080808',
      '--color-sidebar-accent': '#0f160f',
      '--color-sidebar-accent-foreground': '#88CC88',
      '--color-sidebar-border': '#1a2e1a',
      '--color-sidebar-ring': '#00FF41',
      // Chart colors
      '--color-chart-1': '#00FF41',
      '--color-chart-2': '#00CED1',
      '--color-chart-3': '#6B8E6B',
      '--color-chart-4': '#FF3333',
      '--color-chart-5': '#CCAA33',
    },
  },
  'classic-dracula': {
    name: 'classic-dracula',
    label: 'Dracula',
    scheme: 'dark',
    style: 'classic',
    colors: {
      '--color-background': '#282A36',
      '--color-foreground': '#F8F8F2',
      '--color-card': '#21222C',
      '--color-card-foreground': '#F8F8F2',
      '--color-popover': '#21222C',
      '--color-popover-foreground': '#F8F8F2',
      '--color-primary': '#BD93F9',
      '--color-primary-foreground': '#282A36',
      '--color-secondary': '#343746',
      '--color-secondary-foreground': '#F8F8F2',
      '--color-muted': '#343746',
      '--color-muted-foreground': '#6272A4',
      '--color-accent': '#343746',
      '--color-accent-foreground': '#F8F8F2',
      '--color-destructive': '#FF5555',
      '--color-destructive-foreground': '#F8F8F2',
      '--color-border': '#44475A',
      '--color-input': '#44475A',
      '--color-ring': '#BD93F9',
      '--color-green': '#50FA7B',
      '--color-red': '#FF5555',
      '--color-orange': '#FFB86C',
      '--color-purple': '#BD93F9',
      '--color-info': '#8BE9FD',
      '--color-message-user': '#2a2840',
      '--color-message-assistant': '#263028',
      '--color-message-system': '#282838',
      '--color-scrollbar': '#44475A',
      '--color-scrollbar-hover': '#6272A4',
      // Sidebar colors
      '--color-sidebar': '#21222C',
      '--color-sidebar-foreground': '#F8F8F2',
      '--color-sidebar-primary': '#BD93F9',
      '--color-sidebar-primary-foreground': '#282A36',
      '--color-sidebar-accent': '#343746',
      '--color-sidebar-accent-foreground': '#F8F8F2',
      '--color-sidebar-border': '#44475A',
      '--color-sidebar-ring': '#BD93F9',
      // Chart colors
      '--color-chart-1': '#BD93F9',
      '--color-chart-2': '#50FA7B',
      '--color-chart-3': '#FF79C6',
      '--color-chart-4': '#FF5555',
      '--color-chart-5': '#8BE9FD',
    },
  },
  'classic-nord': {
    name: 'classic-nord',
    label: 'Nord',
    scheme: 'dark',
    style: 'classic',
    colors: {
      '--color-background': '#2E3440',
      '--color-foreground': '#D8DEE9',
      '--color-card': '#3B4252',
      '--color-card-foreground': '#D8DEE9',
      '--color-popover': '#3B4252',
      '--color-popover-foreground': '#D8DEE9',
      '--color-primary': '#88C0D0',
      '--color-primary-foreground': '#2E3440',
      '--color-secondary': '#434C5E',
      '--color-secondary-foreground': '#D8DEE9',
      '--color-muted': '#434C5E',
      '--color-muted-foreground': '#7B88A1',
      '--color-accent': '#434C5E',
      '--color-accent-foreground': '#D8DEE9',
      '--color-destructive': '#BF616A',
      '--color-destructive-foreground': '#D8DEE9',
      '--color-border': '#4C566A',
      '--color-input': '#4C566A',
      '--color-ring': '#88C0D0',
      '--color-green': '#A3BE8C',
      '--color-red': '#BF616A',
      '--color-orange': '#D08770',
      '--color-purple': '#B48EAD',
      '--color-info': '#81A1C1',
      '--color-message-user': '#313846',
      '--color-message-assistant': '#323C3E',
      '--color-message-system': '#303644',
      '--color-scrollbar': '#4C566A',
      '--color-scrollbar-hover': '#5E6779',
      // Sidebar colors
      '--color-sidebar': '#3B4252',
      '--color-sidebar-foreground': '#D8DEE9',
      '--color-sidebar-primary': '#88C0D0',
      '--color-sidebar-primary-foreground': '#2E3440',
      '--color-sidebar-accent': '#434C5E',
      '--color-sidebar-accent-foreground': '#D8DEE9',
      '--color-sidebar-border': '#4C566A',
      '--color-sidebar-ring': '#88C0D0',
      // Chart colors
      '--color-chart-1': '#88C0D0',
      '--color-chart-2': '#A3BE8C',
      '--color-chart-3': '#B48EAD',
      '--color-chart-4': '#BF616A',
      '--color-chart-5': '#D08770',
    },
  },
  'classic-solarized-dark': {
    name: 'classic-solarized-dark',
    label: 'Solarized Dark',
    scheme: 'dark',
    style: 'classic',
    colors: {
      '--color-background': '#002B36',
      '--color-foreground': '#839496',
      '--color-card': '#073642',
      '--color-card-foreground': '#839496',
      '--color-popover': '#073642',
      '--color-popover-foreground': '#839496',
      '--color-primary': '#268BD2',
      '--color-primary-foreground': '#FDF6E3',
      '--color-secondary': '#0A3E4A',
      '--color-secondary-foreground': '#839496',
      '--color-muted': '#0A3E4A',
      '--color-muted-foreground': '#586E75',
      '--color-accent': '#0A3E4A',
      '--color-accent-foreground': '#93A1A1',
      '--color-destructive': '#DC322F',
      '--color-destructive-foreground': '#FDF6E3',
      '--color-border': '#0E4F5C',
      '--color-input': '#0E4F5C',
      '--color-ring': '#268BD2',
      '--color-green': '#859900',
      '--color-red': '#DC322F',
      '--color-orange': '#CB4B16',
      '--color-purple': '#6C71C4',
      '--color-info': '#2AA198',
      '--color-message-user': '#03303C',
      '--color-message-assistant': '#042E38',
      '--color-message-system': '#032C3A',
      '--color-scrollbar': '#0E4F5C',
      '--color-scrollbar-hover': '#1A6070',
      // Sidebar colors
      '--color-sidebar': '#073642',
      '--color-sidebar-foreground': '#839496',
      '--color-sidebar-primary': '#268BD2',
      '--color-sidebar-primary-foreground': '#FDF6E3',
      '--color-sidebar-accent': '#0A3E4A',
      '--color-sidebar-accent-foreground': '#839496',
      '--color-sidebar-border': '#0E4F5C',
      '--color-sidebar-ring': '#268BD2',
      // Chart colors
      '--color-chart-1': '#268BD2',
      '--color-chart-2': '#859900',
      '--color-chart-3': '#6C71C4',
      '--color-chart-4': '#DC322F',
      '--color-chart-5': '#2AA198',
    },
  },
  'classic-catppuccin-mocha': {
    name: 'classic-catppuccin-mocha',
    label: 'Catppuccin Mocha',
    scheme: 'dark',
    style: 'classic',
    colors: {
      '--color-background': '#1E1E2E',
      '--color-foreground': '#CDD6F4',
      '--color-card': '#181825',
      '--color-card-foreground': '#CDD6F4',
      '--color-popover': '#181825',
      '--color-popover-foreground': '#CDD6F4',
      '--color-primary': '#CBA6F7',
      '--color-primary-foreground': '#1E1E2E',
      '--color-secondary': '#313244',
      '--color-secondary-foreground': '#CDD6F4',
      '--color-muted': '#313244',
      '--color-muted-foreground': '#6C7086',
      '--color-accent': '#313244',
      '--color-accent-foreground': '#CDD6F4',
      '--color-destructive': '#F38BA8',
      '--color-destructive-foreground': '#1E1E2E',
      '--color-border': '#45475A',
      '--color-input': '#45475A',
      '--color-ring': '#CBA6F7',
      '--color-green': '#A6E3A1',
      '--color-red': '#F38BA8',
      '--color-orange': '#FAB387',
      '--color-purple': '#CBA6F7',
      '--color-info': '#89DCEB',
      '--color-message-user': '#1E1E34',
      '--color-message-assistant': '#1E2E26',
      '--color-message-system': '#1E2030',
      '--color-scrollbar': '#45475A',
      '--color-scrollbar-hover': '#585B70',
      // Sidebar colors
      '--color-sidebar': '#181825',
      '--color-sidebar-foreground': '#CDD6F4',
      '--color-sidebar-primary': '#CBA6F7',
      '--color-sidebar-primary-foreground': '#1E1E2E',
      '--color-sidebar-accent': '#313244',
      '--color-sidebar-accent-foreground': '#CDD6F4',
      '--color-sidebar-border': '#45475A',
      '--color-sidebar-ring': '#CBA6F7',
      // Chart colors
      '--color-chart-1': '#CBA6F7',
      '--color-chart-2': '#A6E3A1',
      '--color-chart-3': '#F5C2E7',
      '--color-chart-4': '#F38BA8',
      '--color-chart-5': '#89DCEB',
    },
  },
  'classic-tokyo-night': {
    name: 'classic-tokyo-night',
    label: 'Tokyo Night',
    scheme: 'dark',
    style: 'classic',
    colors: {
      '--color-background': '#1A1B26',
      '--color-foreground': '#A9B1D6',
      '--color-card': '#16161E',
      '--color-card-foreground': '#A9B1D6',
      '--color-popover': '#16161E',
      '--color-popover-foreground': '#A9B1D6',
      '--color-primary': '#7AA2F7',
      '--color-primary-foreground': '#1A1B26',
      '--color-secondary': '#24283B',
      '--color-secondary-foreground': '#A9B1D6',
      '--color-muted': '#24283B',
      '--color-muted-foreground': '#565F89',
      '--color-accent': '#24283B',
      '--color-accent-foreground': '#A9B1D6',
      '--color-destructive': '#F7768E',
      '--color-destructive-foreground': '#1A1B26',
      '--color-border': '#2F3549',
      '--color-input': '#2F3549',
      '--color-ring': '#7AA2F7',
      '--color-green': '#9ECE6A',
      '--color-red': '#F7768E',
      '--color-orange': '#FF9E64',
      '--color-purple': '#BB9AF7',
      '--color-info': '#7DCFFF',
      '--color-message-user': '#1A1B30',
      '--color-message-assistant': '#1C2420',
      '--color-message-system': '#1A1D2E',
      '--color-scrollbar': '#2F3549',
      '--color-scrollbar-hover': '#414868',
      // Sidebar colors
      '--color-sidebar': '#16161E',
      '--color-sidebar-foreground': '#A9B1D6',
      '--color-sidebar-primary': '#7AA2F7',
      '--color-sidebar-primary-foreground': '#1A1B26',
      '--color-sidebar-accent': '#24283B',
      '--color-sidebar-accent-foreground': '#A9B1D6',
      '--color-sidebar-border': '#2F3549',
      '--color-sidebar-ring': '#7AA2F7',
      // Chart colors
      '--color-chart-1': '#7AA2F7',
      '--color-chart-2': '#9ECE6A',
      '--color-chart-3': '#BB9AF7',
      '--color-chart-4': '#F7768E',
      '--color-chart-5': '#7DCFFF',
    },
  },
  'classic-gruvbox-dark': {
    name: 'classic-gruvbox-dark',
    label: 'Gruvbox Dark',
    scheme: 'dark',
    style: 'classic',
    colors: {
      '--color-background': '#282828',
      '--color-foreground': '#EBDBB2',
      '--color-card': '#1D2021',
      '--color-card-foreground': '#EBDBB2',
      '--color-popover': '#1D2021',
      '--color-popover-foreground': '#EBDBB2',
      '--color-primary': '#FABD2F',
      '--color-primary-foreground': '#282828',
      '--color-secondary': '#3C3836',
      '--color-secondary-foreground': '#EBDBB2',
      '--color-muted': '#3C3836',
      '--color-muted-foreground': '#928374',
      '--color-accent': '#3C3836',
      '--color-accent-foreground': '#EBDBB2',
      '--color-destructive': '#FB4934',
      '--color-destructive-foreground': '#EBDBB2',
      '--color-border': '#504945',
      '--color-input': '#504945',
      '--color-ring': '#FABD2F',
      '--color-green': '#B8BB26',
      '--color-red': '#FB4934',
      '--color-orange': '#FE8019',
      '--color-purple': '#D3869B',
      '--color-info': '#83A598',
      '--color-message-user': '#2C2A22',
      '--color-message-assistant': '#272E24',
      '--color-message-system': '#28282E',
      '--color-scrollbar': '#504945',
      '--color-scrollbar-hover': '#665C54',
      // Sidebar colors
      '--color-sidebar': '#1D2021',
      '--color-sidebar-foreground': '#EBDBB2',
      '--color-sidebar-primary': '#FABD2F',
      '--color-sidebar-primary-foreground': '#282828',
      '--color-sidebar-accent': '#3C3836',
      '--color-sidebar-accent-foreground': '#EBDBB2',
      '--color-sidebar-border': '#504945',
      '--color-sidebar-ring': '#FABD2F',
      // Chart colors
      '--color-chart-1': '#FABD2F',
      '--color-chart-2': '#B8BB26',
      '--color-chart-3': '#D3869B',
      '--color-chart-4': '#FB4934',
      '--color-chart-5': '#83A598',
    },
  },
  'classic-one-dark': {
    name: 'classic-one-dark',
    label: 'One Dark',
    scheme: 'dark',
    style: 'classic',
    colors: {
      '--color-background': '#282C34',
      '--color-foreground': '#ABB2BF',
      '--color-card': '#21252B',
      '--color-card-foreground': '#ABB2BF',
      '--color-popover': '#21252B',
      '--color-popover-foreground': '#ABB2BF',
      '--color-primary': '#61AFEF',
      '--color-primary-foreground': '#282C34',
      '--color-secondary': '#2C313A',
      '--color-secondary-foreground': '#ABB2BF',
      '--color-muted': '#2C313A',
      '--color-muted-foreground': '#5C6370',
      '--color-accent': '#2C313A',
      '--color-accent-foreground': '#ABB2BF',
      '--color-destructive': '#E06C75',
      '--color-destructive-foreground': '#ABB2BF',
      '--color-border': '#3E4451',
      '--color-input': '#3E4451',
      '--color-ring': '#61AFEF',
      '--color-green': '#98C379',
      '--color-red': '#E06C75',
      '--color-orange': '#D19A66',
      '--color-purple': '#C678DD',
      '--color-info': '#56B6C2',
      '--color-message-user': '#282C3A',
      '--color-message-assistant': '#283028',
      '--color-message-system': '#2A2C38',
      '--color-scrollbar': '#3E4451',
      '--color-scrollbar-hover': '#4B5263',
      // Sidebar colors
      '--color-sidebar': '#21252B',
      '--color-sidebar-foreground': '#ABB2BF',
      '--color-sidebar-primary': '#61AFEF',
      '--color-sidebar-primary-foreground': '#282C34',
      '--color-sidebar-accent': '#2C313A',
      '--color-sidebar-accent-foreground': '#ABB2BF',
      '--color-sidebar-border': '#3E4451',
      '--color-sidebar-ring': '#61AFEF',
      // Chart colors
      '--color-chart-1': '#61AFEF',
      '--color-chart-2': '#98C379',
      '--color-chart-3': '#C678DD',
      '--color-chart-4': '#E06C75',
      '--color-chart-5': '#56B6C2',
    },
  },
  'classic-monokai': {
    name: 'classic-monokai',
    label: 'Monokai',
    scheme: 'dark',
    style: 'classic',
    colors: {
      '--color-background': '#272822',
      '--color-foreground': '#F8F8F2',
      '--color-card': '#1E1F1A',
      '--color-card-foreground': '#F8F8F2',
      '--color-popover': '#1E1F1A',
      '--color-popover-foreground': '#F8F8F2',
      '--color-primary': '#F92672',
      '--color-primary-foreground': '#F8F8F2',
      '--color-secondary': '#3E3D32',
      '--color-secondary-foreground': '#F8F8F2',
      '--color-muted': '#3E3D32',
      '--color-muted-foreground': '#75715E',
      '--color-accent': '#3E3D32',
      '--color-accent-foreground': '#F8F8F2',
      '--color-destructive': '#F92672',
      '--color-destructive-foreground': '#F8F8F2',
      '--color-border': '#49483E',
      '--color-input': '#49483E',
      '--color-ring': '#F92672',
      '--color-green': '#A6E22E',
      '--color-red': '#F92672',
      '--color-orange': '#FD971F',
      '--color-purple': '#AE81FF',
      '--color-info': '#66D9EF',
      '--color-message-user': '#2A2426',
      '--color-message-assistant': '#262A20',
      '--color-message-system': '#26242C',
      '--color-scrollbar': '#49483E',
      '--color-scrollbar-hover': '#5B5A50',
      // Sidebar colors
      '--color-sidebar': '#1E1F1A',
      '--color-sidebar-foreground': '#F8F8F2',
      '--color-sidebar-primary': '#F92672',
      '--color-sidebar-primary-foreground': '#F8F8F2',
      '--color-sidebar-accent': '#3E3D32',
      '--color-sidebar-accent-foreground': '#F8F8F2',
      '--color-sidebar-border': '#49483E',
      '--color-sidebar-ring': '#F92672',
      // Chart colors
      '--color-chart-1': '#F92672',
      '--color-chart-2': '#A6E22E',
      '--color-chart-3': '#AE81FF',
      '--color-chart-4': '#FD971F',
      '--color-chart-5': '#66D9EF',
    },
  },
  'classic-ayu-dark': {
    name: 'classic-ayu-dark',
    label: 'Ayu Dark',
    scheme: 'dark',
    style: 'classic',
    colors: {
      '--color-background': '#0C1016',
      '--color-foreground': '#D0C8BC',
      '--color-card': '#10151D',
      '--color-card-foreground': '#D0C8BC',
      '--color-popover': '#10151D',
      '--color-popover-foreground': '#D0C8BC',
      '--color-primary': '#F0B35D',
      '--color-primary-foreground': '#0C1016',
      '--color-secondary': '#161C25',
      '--color-secondary-foreground': '#D0C8BC',
      '--color-muted': '#161C25',
      '--color-muted-foreground': '#7E8794',
      '--color-accent': '#161C25',
      '--color-accent-foreground': '#D0C8BC',
      '--color-destructive': '#E06C66',
      '--color-destructive-foreground': '#D0C8BC',
      '--color-border': '#27303C',
      '--color-input': '#27303C',
      '--color-ring': '#F0B35D',
      '--color-green': '#7FC782',
      '--color-red': '#E06C66',
      '--color-orange': '#E79A59',
      '--color-purple': '#B9ACDA',
      '--color-info': '#7EA6C8',
      '--color-message-user': '#141821',
      '--color-message-assistant': '#121918',
      '--color-message-system': '#131824',
      '--color-scrollbar': '#27303C',
      '--color-scrollbar-hover': '#36414F',
      // Sidebar colors
      '--color-sidebar': '#10151D',
      '--color-sidebar-foreground': '#D0C8BC',
      '--color-sidebar-primary': '#F0B35D',
      '--color-sidebar-primary-foreground': '#0C1016',
      '--color-sidebar-accent': '#161C25',
      '--color-sidebar-accent-foreground': '#D0C8BC',
      '--color-sidebar-border': '#27303C',
      '--color-sidebar-ring': '#F0B35D',
      // Chart colors
      '--color-chart-1': '#F0B35D',
      '--color-chart-2': '#7FC782',
      '--color-chart-3': '#B9ACDA',
      '--color-chart-4': '#E06C66',
      '--color-chart-5': '#7EA6C8',
    },
  },
  'classic-rose-pine': {
    name: 'classic-rose-pine',
    label: 'Rosé Pine',
    scheme: 'dark',
    style: 'classic',
    colors: {
      '--color-background': '#191724',
      '--color-foreground': '#E0DEF4',
      '--color-card': '#1F1D2E',
      '--color-card-foreground': '#E0DEF4',
      '--color-popover': '#1F1D2E',
      '--color-popover-foreground': '#E0DEF4',
      '--color-primary': '#EBBCBA',
      '--color-primary-foreground': '#191724',
      '--color-secondary': '#26233A',
      '--color-secondary-foreground': '#E0DEF4',
      '--color-muted': '#26233A',
      '--color-muted-foreground': '#6E6A86',
      '--color-accent': '#26233A',
      '--color-accent-foreground': '#E0DEF4',
      '--color-destructive': '#EB6F92',
      '--color-destructive-foreground': '#191724',
      '--color-border': '#2A2740',
      '--color-input': '#2A2740',
      '--color-ring': '#EBBCBA',
      '--color-green': '#31748F',
      '--color-red': '#EB6F92',
      '--color-orange': '#F6C177',
      '--color-purple': '#C4A7E7',
      '--color-info': '#9CCFD8',
      '--color-message-user': '#1C1828',
      '--color-message-assistant': '#1A1E26',
      '--color-message-system': '#1C1A2A',
      '--color-scrollbar': '#2A2740',
      '--color-scrollbar-hover': '#3A3654',
      // Sidebar colors
      '--color-sidebar': '#1F1D2E',
      '--color-sidebar-foreground': '#E0DEF4',
      '--color-sidebar-primary': '#EBBCBA',
      '--color-sidebar-primary-foreground': '#191724',
      '--color-sidebar-accent': '#26233A',
      '--color-sidebar-accent-foreground': '#E0DEF4',
      '--color-sidebar-border': '#2A2740',
      '--color-sidebar-ring': '#EBBCBA',
      // Chart colors
      '--color-chart-1': '#EBBCBA',
      '--color-chart-2': '#31748F',
      '--color-chart-3': '#C4A7E7',
      '--color-chart-4': '#EB6F92',
      '--color-chart-5': '#9CCFD8',
    },
  },
  'classic-monochrome': {
    name: 'classic-monochrome',
    label: 'Monochrome',
    scheme: 'dark',
    style: 'classic',
    colors: {
      '--color-background': '#0A0A0A',
      '--color-foreground': '#C0C0C0',
      '--color-card': '#111111',
      '--color-card-foreground': '#C0C0C0',
      '--color-popover': '#111111',
      '--color-popover-foreground': '#C0C0C0',
      '--color-primary': '#E0E0E0',
      '--color-primary-foreground': '#0A0A0A',
      '--color-secondary': '#181818',
      '--color-secondary-foreground': '#C0C0C0',
      '--color-muted': '#181818',
      '--color-muted-foreground': '#666666',
      '--color-accent': '#181818',
      '--color-accent-foreground': '#C0C0C0',
      '--color-destructive': '#B05050',
      '--color-destructive-foreground': '#C0C0C0',
      '--color-border': '#222222',
      '--color-input': '#222222',
      '--color-ring': '#E0E0E0',
      '--color-green': '#6B9B6B',
      '--color-red': '#B05050',
      '--color-orange': '#B09060',
      '--color-purple': '#8A8A9A',
      '--color-info': '#7090A0',
      '--color-message-user': '#0E0E0E',
      '--color-message-assistant': '#0C0C0C',
      '--color-message-system': '#101010',
      '--color-scrollbar': '#222222',
      '--color-scrollbar-hover': '#3A3A3A',
      // Sidebar colors
      '--color-sidebar': '#0E0E0E',
      '--color-sidebar-foreground': '#C0C0C0',
      '--color-sidebar-primary': '#E0E0E0',
      '--color-sidebar-primary-foreground': '#0A0A0A',
      '--color-sidebar-accent': '#181818',
      '--color-sidebar-accent-foreground': '#C0C0C0',
      '--color-sidebar-border': '#222222',
      '--color-sidebar-ring': '#E0E0E0',
      // Chart colors
      '--color-chart-1': '#E0E0E0',
      '--color-chart-2': '#999999',
      '--color-chart-3': '#666666',
      '--color-chart-4': '#B05050',
      '--color-chart-5': '#7090A0',
    },
  },
};

/** All available theme names as a typed array. */
export const themeNames = Object.keys(themes) as ThemeName[];

/** The style a theme belongs to; unknown names count as Nerve. */
export function getThemeStyle(themeName: ThemeName): ThemeStyle {
  return themes[themeName]?.style ?? 'nerve';
}

/** Theme names of one style, in display order. */
export function themeNamesForStyle(style: ThemeStyle): ThemeName[] {
  return themeNames.filter((name) => themes[name].style === style);
}

/** Keep the current theme when it already belongs to `style`, otherwise use that style's default. */
export function themeForStyle(current: ThemeName, style: ThemeStyle): ThemeName {
  return getThemeStyle(current) === style ? current : DEFAULT_THEME_BY_STYLE[style];
}

/**
 * Map any stored theme value to a current theme.
 * Values stored before the redesign (the unprefixed community theme names)
 * land on the Nerve identity: the old light theme maps to daylight and every
 * dark theme maps to night. Classic themes are only ever chosen explicitly.
 */
export function resolveThemeName(saved: string | null | undefined): ThemeName {
  if (saved && (themeNames as string[]).includes(saved)) return saved as ThemeName;
  if (saved === 'light') return 'nerve-light';
  return DEFAULT_THEME;
}

/**
 * World tokens the Nerve components rely on. Classic palettes predate them,
 * so each falls back to the legacy colour that played the same part.
 */
const WORLD_TOKEN_FALLBACKS: ReadonlyArray<readonly [token: string, source: string]> = [
  ['--color-live', '--color-info'],
  ['--color-live-text', '--color-info'],
  ['--color-operator', '--color-primary'],
  ['--color-operator-text', '--color-primary'],
  ['--color-pane-off', '--color-border'],
  ['--color-pane-edge', '--color-border'],
  ['--color-raised', '--color-secondary'],
];

/** A theme's colours with any missing world tokens derived from its legacy palette. */
export function resolveThemeColors(theme: Theme): Record<string, string> {
  const colors = { ...theme.colors };
  for (const [token, source] of WORLD_TOKEN_FALLBACKS) {
    if (colors[token] === undefined && colors[source] !== undefined) {
      colors[token] = colors[source];
    }
  }
  return colors;
}

/** Highlight.js stylesheet (vendored locally in public/hljs) for a theme. */
function hljsThemeFor(theme: Theme): string {
  if (theme.style === 'nerve') return theme.name;
  return theme.scheme === 'light' ? 'github' : 'github-dark-dimmed';
}

/** Apply a theme by setting CSS custom properties on the document root and loading the matching highlight.js stylesheet. */
export function applyTheme(themeName: ThemeName): void {
  const theme = themes[themeName];
  if (!theme) return;

  const root = document.documentElement;
  Object.entries(resolveThemeColors(theme)).forEach(([property, value]) => {
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
  root.dataset.style = theme.style;
  root.style.colorScheme = theme.scheme;

  // Classic's default faces (Instrument Sans, JetBrains Mono) load only when needed
  if (theme.style === 'classic') {
    loadClassicFonts();
  }

  // Apply highlight.js theme (vendored locally to avoid CDN dependency)
  const hljsTheme = hljsThemeFor(theme);
  const existingLink = document.getElementById('hljs-theme') as HTMLLinkElement | null;
  const hljsHref = `/hljs/${hljsTheme}.min.css`;

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
