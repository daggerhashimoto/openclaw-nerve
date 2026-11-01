// Font definitions for Nerve UI

export type FontName = 'atkinson-hyperlegible' | 'instrument-sans' | 'space-grotesk' | 'jetbrains-mono';

export interface Font {
  name: FontName;
  label: string;
  family: string;
  googleFontsUrl?: string; // URL for lazy-loading from Google Fonts
}

/**
 * The style default. Its id predates the Classic style and is kept so stored
 * values keep working; CSS picks the face per style (Atkinson Hyperlegible
 * Next for Nerve in index.css, Instrument Sans for Classic in classic.css).
 */
export const DEFAULT_FONT: FontName = 'atkinson-hyperlegible';

export const fonts: Record<FontName, Font> = {
  'atkinson-hyperlegible': {
    name: 'atkinson-hyperlegible',
    label: 'Style default',
    family: "'Atkinson Hyperlegible Next', 'Helvetica Neue', Arial, sans-serif",
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap',
  },
  'instrument-sans': {
    name: 'instrument-sans',
    label: 'Instrument Sans',
    family: "'Instrument Sans', 'Helvetica Neue', Arial, sans-serif",
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap',
  },
  'space-grotesk': {
    name: 'space-grotesk',
    label: 'Space Grotesk',
    family: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif",
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap',
  },
  'jetbrains-mono': {
    name: 'jetbrains-mono',
    label: 'JetBrains Mono',
    family: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap',
  },
};

/** All available font names as a typed array. */
export const fontNames = Object.keys(fonts) as FontName[];

/**
 * Nerve's monospace stack for code, timestamps, and measurements. It is the
 * --font-mono default in index.css; the Classic style swaps in JetBrains Mono.
 */
export const monoFont = "'Atkinson Hyperlegible Mono', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace";

const MONO_FONT_URL = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Mono:wght@400;500;600&display=swap';

/**
 * Nerve's display face for the wordmark and agent names: Geist,
 * a clean variable grotesque that stays sleek at any size. It is --font-display
 * in index.css; the Classic style maps it back to its own sans.
 */
export const displayFont = "'Geist', 'Atkinson Hyperlegible Next', 'Helvetica Neue', Arial, sans-serif";

const DISPLAY_FONT_URL = 'https://fonts.googleapis.com/css2?family=Geist:wght@400..800&display=swap';

// Track which fonts have been loaded
const loadedFonts = new Set<string>();

// Lazy-load a font from Google Fonts
function loadGoogleFont(url: string): void {
  if (loadedFonts.has(url)) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
  loadedFonts.add(url);
}

/** Load the Classic style's default faces (Instrument Sans and JetBrains Mono). */
export function loadClassicFonts(): void {
  loadGoogleFont(fonts['instrument-sans'].googleFontsUrl!);
  loadGoogleFont(fonts['jetbrains-mono'].googleFontsUrl!);
}

/**
 * Apply a font choice to the document root.
 * The style default clears the inline --font-sans so the active style's CSS
 * decides; an explicit pick sets it inline and lazy-loads the face. Monospace
 * always follows the style, so any inline --font-mono is cleared either way.
 */
export function applyFont(fontName: FontName): void {
  const font = fonts[fontName];
  if (!font) return;

  const root = document.documentElement;
  root.style.removeProperty('--font-mono');

  if (fontName === DEFAULT_FONT) {
    root.style.removeProperty('--font-sans');
    return;
  }

  // Lazy-load the font if it has a Google Fonts URL
  if (font.googleFontsUrl) {
    loadGoogleFont(font.googleFontsUrl);
  }

  // Set the UI font (--font-sans variable)
  root.style.setProperty('--font-sans', font.family);
}

// Initialize fonts used in the default shell before settings hydrate
loadGoogleFont(fonts[DEFAULT_FONT].googleFontsUrl!);
loadGoogleFont(MONO_FONT_URL);
loadGoogleFont(DISPLAY_FONT_URL);
