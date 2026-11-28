/**
 * public/theme-boot.js runs before the app to mark the stored theme's world and
 * ground. It keeps its own small copy of the theme list; these tests hold it to
 * themes.ts so the two never drift apart.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  THEME_DEFAULT_MIGRATION,
  THEME_DEFAULT_MIGRATION_KEY,
  THEME_STORAGE_KEY,
  themeNames,
  themes,
} from './themes';

const script = readFileSync(resolve(__dirname, '../../public/theme-boot.js'), 'utf8');

function boot() {
  // The file is a plain browser script; run it the way the page does, against jsdom's globals
  new Function(script)();
  const root = document.documentElement;
  return {
    theme: root.dataset.theme,
    world: root.dataset.world,
    ground: root.style.getPropertyValue('--color-background'),
  };
}

function expectTheme(result: ReturnType<typeof boot>, name: (typeof themeNames)[number]) {
  expect(result).toEqual({
    theme: themes[name].scheme,
    world: themes[name].world,
    ground: themes[name].colors['--color-background'],
  });
}

describe('theme boot script', () => {
  afterEach(() => {
    localStorage.clear();
    const root = document.documentElement;
    root.removeAttribute('style');
    delete root.dataset.theme;
    delete root.dataset.world;
  });

  it.each(themeNames)('marks the stored theme "%s" exactly as themes.ts defines it', (name) => {
    localStorage.setItem(THEME_STORAGE_KEY, name);
    localStorage.setItem(THEME_DEFAULT_MIGRATION_KEY, THEME_DEFAULT_MIGRATION);
    expectTheme(boot(), name);
  });

  it('marks the default, Workbench Night, when nothing is stored', () => {
    expectTheme(boot(), 'workbench-night');
  });

  it('follows the one-time move of a stored Night to Workbench Night', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'nerve-dark');
    expectTheme(boot(), 'workbench-night');
  });

  it('marks legacy light values as Daylight and unknown values as the default', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'classic-light');
    expectTheme(boot(), 'nerve-light');

    localStorage.setItem(THEME_STORAGE_KEY, 'dracula');
    expectTheme(boot(), 'workbench-night');
  });

  it("colors the browser and installed-app bar with the stored theme's ground", () => {
    // index.html places the theme-color tag before this script
    const bar = document.createElement('meta');
    bar.name = 'theme-color';
    bar.content = themes['workbench-night'].colors['--color-background'];
    document.head.appendChild(bar);
    localStorage.setItem(THEME_STORAGE_KEY, 'workbench-paper');

    boot();

    expect(bar.content).toBe(themes['workbench-paper'].colors['--color-background']);
    bar.remove();
  });
});

describe('installed app colors', () => {
  // The manifest and index.html carry their own copies of the default ground,
  // shown on the launch screen and the bar before any script runs
  const ground = themes[DEFAULT_THEME].colors['--color-background'];

  it("match the default theme's ground", () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../public/manifest.webmanifest'), 'utf8'));
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

    expect(manifest.background_color).toBe(ground);
    expect(manifest.theme_color).toBe(ground);
    expect(html.match(/<meta name="theme-color" content="([^"]+)"/)?.[1]).toBe(ground);
  });
});
