import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, resolveThemeName, themeNames, themes } from './themes';

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

function resetRoot() {
  const root = document.documentElement;
  root.removeAttribute('style');
  delete root.dataset.theme;
  document.getElementById('hljs-theme')?.remove();
}

describe('resolveThemeName', () => {
  it.each(LEGACY_DARK_NAMES)('maps the stored legacy theme "%s" to Night', (saved) => {
    expect(resolveThemeName(saved)).toBe('nerve-dark');
  });

  it.each(LEGACY_DARK_NAMES.map((name) => `classic-${name}`))('maps the retired Classic theme "%s" to Night', (saved) => {
    expect(resolveThemeName(saved)).toBe('nerve-dark');
  });

  it('maps the stored light themes, legacy and Classic, to Daylight', () => {
    expect(resolveThemeName('light')).toBe('nerve-light');
    expect(resolveThemeName('classic-light')).toBe('nerve-light');
  });

  it('falls back to Night for missing or unknown values', () => {
    expect(resolveThemeName(null)).toBe('nerve-dark');
    expect(resolveThemeName(undefined)).toBe('nerve-dark');
    expect(resolveThemeName('not-a-theme')).toBe('nerve-dark');
  });

  it('keeps the two current theme names', () => {
    expect(resolveThemeName('nerve-dark')).toBe('nerve-dark');
    expect(resolveThemeName('nerve-light')).toBe('nerve-light');
  });
});

describe('themes', () => {
  it('ships Night and Daylight and nothing else', () => {
    expect(themeNames).toEqual(['nerve-dark', 'nerve-light']);
    expect(themes['nerve-dark']).toMatchObject({ label: 'Night', scheme: 'dark' });
    expect(themes['nerve-light']).toMatchObject({ label: 'Daylight', scheme: 'light' });
  });

  it('gives both themes the same token set, so switching never leaves stale inline tokens', () => {
    const dark = Object.keys(themes['nerve-dark'].colors).sort();
    const light = Object.keys(themes['nerve-light'].colors).sort();
    expect(light).toEqual(dark);
  });
});

describe('applyTheme', () => {
  afterEach(resetRoot);

  it('writes the tokens, the scheme and the code palette for Night', () => {
    applyTheme('nerve-dark');

    const root = document.documentElement;
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
    expect(root.style.getPropertyValue('--color-live')).toBe(themes['nerve-dark'].colors['--color-live']);
    expect(root.style.getPropertyValue('--live')).toBe(themes['nerve-dark'].colors['--color-live']);
    expect(document.getElementById('hljs-theme')?.getAttribute('href')).toBe('/hljs/nerve-dark.min.css');
  });

  it('switches to Daylight with a light scheme and the light code palette', () => {
    applyTheme('nerve-dark');
    applyTheme('nerve-light');

    const root = document.documentElement;
    expect(root.dataset.theme).toBe('light');
    expect(root.style.colorScheme).toBe('light');
    expect(root.style.getPropertyValue('--color-background')).toBe(themes['nerve-light'].colors['--color-background']);
    expect(document.getElementById('hljs-theme')?.getAttribute('href')).toBe('/hljs/nerve-light.min.css');
  });

  it('never marks the root with a style attribute', () => {
    applyTheme('nerve-dark');

    expect(document.documentElement.dataset.style).toBeUndefined();
  });
});
