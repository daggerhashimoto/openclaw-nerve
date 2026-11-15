import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_DEFAULT_MIGRATION,
  THEME_DEFAULT_MIGRATION_KEY,
  THEME_STORAGE_KEY,
  applyTheme,
  loadStoredTheme,
  resolveThemeName,
  themeNames,
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

function resetRoot() {
  const root = document.documentElement;
  root.removeAttribute('style');
  delete root.dataset.theme;
  delete root.dataset.world;
  document.getElementById('hljs-theme')?.remove();
  document.querySelectorAll('link[href*="IBM+Plex"]').forEach((link) => link.remove());
}

describe('resolveThemeName', () => {
  it.each(LEGACY_DARK_NAMES)('maps the stored legacy theme "%s" to the default, Workbench Night', (saved) => {
    expect(resolveThemeName(saved)).toBe('workbench-night');
  });

  it.each(LEGACY_DARK_NAMES.map((name) => `classic-${name}`))('maps the retired Classic theme "%s" to the default, Workbench Night', (saved) => {
    expect(resolveThemeName(saved)).toBe('workbench-night');
  });

  it('maps the stored light themes, legacy and Classic, to Daylight', () => {
    expect(resolveThemeName('light')).toBe('nerve-light');
    expect(resolveThemeName('classic-light')).toBe('nerve-light');
  });

  it('falls back to the default, Workbench Night, for missing or unknown values', () => {
    expect(resolveThemeName(null)).toBe('workbench-night');
    expect(resolveThemeName(undefined)).toBe('workbench-night');
    expect(resolveThemeName('not-a-theme')).toBe('workbench-night');
  });

  it('keeps the current theme names', () => {
    expect(resolveThemeName('nerve-dark')).toBe('nerve-dark');
    expect(resolveThemeName('nerve-light')).toBe('nerve-light');
    expect(resolveThemeName('workbench-night')).toBe('workbench-night');
    expect(resolveThemeName('workbench-paper')).toBe('workbench-paper');
  });
});

describe('loadStoredTheme', () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
    };
  }

  it('starts a fresh install on Workbench Night and records it', () => {
    const storage = memoryStorage();
    expect(loadStoredTheme(storage)).toBe('workbench-night');
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe('workbench-night');
    expect(storage.data.get(THEME_DEFAULT_MIGRATION_KEY)).toBe(THEME_DEFAULT_MIGRATION);
  });

  it('moves a stored Night to Workbench Night once', () => {
    const storage = memoryStorage({ [THEME_STORAGE_KEY]: 'nerve-dark' });
    expect(loadStoredTheme(storage)).toBe('workbench-night');
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe('workbench-night');
  });

  it('keeps Night when the operator picks it after the move', () => {
    const storage = memoryStorage({
      [THEME_STORAGE_KEY]: 'nerve-dark',
      [THEME_DEFAULT_MIGRATION_KEY]: THEME_DEFAULT_MIGRATION,
    });
    expect(loadStoredTheme(storage)).toBe('nerve-dark');
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe('nerve-dark');
  });

  it.each(['nerve-light', 'workbench-paper', 'workbench-night'])('keeps a stored "%s"', (saved) => {
    const storage = memoryStorage({ [THEME_STORAGE_KEY]: saved });
    expect(loadStoredTheme(storage)).toBe(saved);
  });

  it('falls back to the default when storage cannot be read', () => {
    const storage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(loadStoredTheme(storage)).toBe('workbench-night');
  });
});

describe('themes', () => {
  it('ships the night light world (Night, Daylight) and the Workbench world (Workbench Night, Workbench Paper)', () => {
    expect(themeNames).toEqual(['nerve-dark', 'nerve-light', 'workbench-night', 'workbench-paper']);
    expect(themes['nerve-dark']).toMatchObject({ label: 'Night', scheme: 'dark', world: 'night-light' });
    expect(themes['nerve-light']).toMatchObject({ label: 'Daylight', scheme: 'light', world: 'night-light' });
    expect(themes['workbench-night']).toMatchObject({ label: 'Workbench Night', scheme: 'dark', world: 'workbench' });
    expect(themes['workbench-paper']).toMatchObject({ label: 'Workbench Paper', scheme: 'light', world: 'workbench' });
  });

  it('gives every theme the same token set, so switching never leaves stale inline tokens', () => {
    const tokens = Object.keys(themes['nerve-dark'].colors).sort();
    for (const name of themeNames) {
      expect(Object.keys(themes[name].colors).sort()).toEqual(tokens);
    }
  });

  it('keeps the meanings in the Workbench world: cobalt works, cantaloupe is the operator', () => {
    expect(themes['workbench-night'].colors['--color-live']).toBe('#3462F2');
    expect(themes['workbench-paper'].colors['--color-live']).toBe('#1348DC');
    expect(themes['workbench-night'].colors['--color-operator']).toBe(themes['nerve-dark'].colors['--color-operator']);
    expect(themes['workbench-paper'].colors['--color-operator']).toBe(themes['nerve-light'].colors['--color-operator']);
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

  it('marks the root with the theme world', () => {
    applyTheme('nerve-dark');
    expect(document.documentElement.dataset.world).toBe('night-light');

    applyTheme('workbench-night');
    expect(document.documentElement.dataset.world).toBe('workbench');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.getElementById('hljs-theme')?.getAttribute('href')).toBe('/hljs/workbench-night.min.css');

    applyTheme('workbench-paper');
    expect(document.documentElement.dataset.world).toBe('workbench');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.getElementById('hljs-theme')?.getAttribute('href')).toBe('/hljs/workbench-paper.min.css');
  });

  it("loads Workbench's Google faces only for a Workbench theme, and once", async () => {
    // The font loader remembers what it loaded for the module's lifetime; start from a fresh one
    vi.resetModules();
    const fresh = await import('./themes');
    const plexLinks = () => document.querySelectorAll('link[href*="IBM+Plex"]').length;
    fresh.applyTheme('nerve-dark');
    fresh.applyTheme('nerve-light');
    expect(plexLinks()).toBe(0);

    fresh.applyTheme('workbench-night');
    fresh.applyTheme('workbench-paper');
    expect(plexLinks()).toBe(1);
  });

  it('never marks the root with a style attribute', () => {
    applyTheme('nerve-dark');

    expect(document.documentElement.dataset.style).toBeUndefined();
  });
});
