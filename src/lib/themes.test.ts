import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_BY_STYLE,
  applyTheme,
  getThemeStyle,
  resolveThemeColors,
  resolveThemeName,
  themeForStyle,
  themeNames,
  themeNamesForStyle,
  themes,
} from './themes';

const LEGACY_DARK_NAMES = [
  'midnight',
  'phosphor',
  'dracula',
  'nord',
  'solarized-dark',
  'catppuccin-mocha',
  'tokyo-night',
  'gruvbox-dark',
  'one-dark',
  'monokai',
  'ayu-dark',
  'rose-pine',
  'monochrome',
];

const CLASSIC_LABELS = [
  'Midnight',
  'Light',
  'Phosphor',
  'Dracula',
  'Nord',
  'Solarized Dark',
  'Catppuccin Mocha',
  'Tokyo Night',
  'Gruvbox Dark',
  'One Dark',
  'Monokai',
  'Ayu Dark',
  'Rosé Pine',
  'Monochrome',
];

function resetRoot() {
  const root = document.documentElement;
  root.removeAttribute('style');
  delete root.dataset.theme;
  delete root.dataset.style;
  document.getElementById('hljs-theme')?.remove();
}

describe('resolveThemeName', () => {
  it.each(LEGACY_DARK_NAMES)('maps the stored legacy theme "%s" to Night, not to its Classic copy', (saved) => {
    expect(resolveThemeName(saved)).toBe('nerve-dark');
  });

  it('maps the stored legacy light theme to Daylight', () => {
    expect(resolveThemeName('light')).toBe('nerve-light');
  });

  it('falls back to Night for missing or unknown values', () => {
    expect(resolveThemeName(null)).toBe('nerve-dark');
    expect(resolveThemeName(undefined)).toBe('nerve-dark');
    expect(resolveThemeName('not-a-theme')).toBe('nerve-dark');
  });

  it('keeps current theme names, Nerve and Classic', () => {
    expect(resolveThemeName('nerve-light')).toBe('nerve-light');
    expect(resolveThemeName('classic-ayu-dark')).toBe('classic-ayu-dark');
    expect(resolveThemeName('classic-light')).toBe('classic-light');
  });
});

describe('theme styles', () => {
  it('ships Night and Daylight as Nerve and the 14 legacy themes as Classic', () => {
    expect(themeNamesForStyle('nerve').map((name) => themes[name].label)).toEqual(['Night', 'Daylight']);
    expect(themeNamesForStyle('classic').map((name) => themes[name].label)).toEqual(CLASSIC_LABELS);
    expect(themeNames).toHaveLength(16);
  });

  it('prefixes every Classic theme name and marks only classic-light as a light scheme', () => {
    for (const name of themeNamesForStyle('classic')) {
      expect(name.startsWith('classic-')).toBe(true);
      expect(themes[name].scheme).toBe(name === 'classic-light' ? 'light' : 'dark');
    }
  });

  it('keeps the current theme when it already belongs to the requested style', () => {
    expect(themeForStyle('classic-nord', 'classic')).toBe('classic-nord');
    expect(themeForStyle('nerve-light', 'nerve')).toBe('nerve-light');
  });

  it("switches to the requested style's default theme otherwise", () => {
    expect(DEFAULT_THEME_BY_STYLE).toEqual({ nerve: 'nerve-dark', classic: 'classic-ayu-dark' });
    expect(themeForStyle('nerve-dark', 'classic')).toBe('classic-ayu-dark');
    expect(themeForStyle('classic-light', 'nerve')).toBe('nerve-dark');
    expect(getThemeStyle('classic-monokai')).toBe('classic');
  });
});

describe('resolveThemeColors', () => {
  const nerveKeys = Object.keys(themes['nerve-dark'].colors).sort();

  it('leaves Nerve themes untouched', () => {
    expect(resolveThemeColors(themes['nerve-dark'])).toEqual(themes['nerve-dark'].colors);
    expect(resolveThemeColors(themes['nerve-light'])).toEqual(themes['nerve-light'].colors);
  });

  it('gives every theme the full token set, so switching never leaves stale inline tokens', () => {
    for (const name of themeNames) {
      expect(Object.keys(resolveThemeColors(themes[name])).sort()).toEqual(nerveKeys);
    }
  });

  it('derives Classic world tokens from the legacy palette', () => {
    const nord = themes['classic-nord'].colors;
    const resolved = resolveThemeColors(themes['classic-nord']);
    expect(resolved['--color-live']).toBe(nord['--color-info']);
    expect(resolved['--color-live-text']).toBe(nord['--color-info']);
    expect(resolved['--color-operator']).toBe(nord['--color-primary']);
    expect(resolved['--color-operator-text']).toBe(nord['--color-primary']);
    expect(resolved['--color-pane-off']).toBe(nord['--color-border']);
    expect(resolved['--color-pane-edge']).toBe(nord['--color-border']);
    expect(resolved['--color-raised']).toBe(nord['--color-secondary']);
  });
});

describe('applyTheme', () => {
  afterEach(resetRoot);

  it('applies a Classic theme with data-style="classic" and derived world tokens', () => {
    applyTheme('classic-ayu-dark');

    const root = document.documentElement;
    const ayu = themes['classic-ayu-dark'].colors;
    expect(root.dataset.style).toBe('classic');
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.getPropertyValue('--color-primary')).toBe(ayu['--color-primary']);
    expect(root.style.getPropertyValue('--color-live')).toBe(ayu['--color-info']);
    expect(root.style.getPropertyValue('--live')).toBe(ayu['--color-info']);
    expect(root.style.getPropertyValue('--color-operator')).toBe(ayu['--color-primary']);
    expect(root.style.getPropertyValue('--color-raised')).toBe(ayu['--color-secondary']);
    expect(document.getElementById('hljs-theme')?.getAttribute('href')).toBe('/hljs/github-dark-dimmed.min.css');
  });

  it('loads the Classic faces when a Classic theme is applied', () => {
    applyTheme('classic-nord');

    const hrefs = Array.from(document.head.querySelectorAll('link[rel="stylesheet"]')).map((link) => link.getAttribute('href') ?? '');
    expect(hrefs.some((href) => href.includes('family=Instrument+Sans'))).toBe(true);
    expect(hrefs.some((href) => href.includes('family=JetBrains+Mono'))).toBe(true);
  });

  it('applies the Classic light theme with a light scheme and the light code palette', () => {
    applyTheme('classic-light');

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.style).toBe('classic');
    expect(document.getElementById('hljs-theme')?.getAttribute('href')).toBe('/hljs/github.min.css');
  });

  it('returns to data-style="nerve" and the Nerve tokens when a Nerve theme is applied', () => {
    applyTheme('classic-dracula');
    applyTheme('nerve-dark');

    const root = document.documentElement;
    expect(root.dataset.style).toBe('nerve');
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.getPropertyValue('--color-live')).toBe(themes['nerve-dark'].colors['--color-live']);
    expect(document.getElementById('hljs-theme')?.getAttribute('href')).toBe('/hljs/nerve-dark.min.css');
  });
});
