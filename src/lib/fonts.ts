// Font definitions for Nerve UI

export type FontName = 'atkinson-hyperlegible' | 'instrument-sans' | 'space-grotesk' | 'jetbrains-mono';

export interface Font {
  name: FontName;
  label: string;
  family: string;
  googleFontsUrl?: string; // URL for lazy-loading from Google Fonts
}

/**
 * The default face. Its id is kept so stored values keep working; index.css
 * sets Atkinson Hyperlegible Next as --font-sans when no explicit pick is set.
 */
export const DEFAULT_FONT: FontName = 'atkinson-hyperlegible';

export const fonts: Record<FontName, Font> = {
  'atkinson-hyperlegible': {
    name: 'atkinson-hyperlegible',
    label: 'Nerve default',
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

/** Nerve's monospace stack for code, timestamps, and measurements: the --font-mono default in index.css. */
export const monoFont = "'Atkinson Hyperlegible Mono', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace";

const MONO_FONT_URL = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Mono:wght@400;500;600&display=swap';

/**
 * Nerve's display face for the wordmark and agent names: Geist,
 * a clean variable grotesque that stays sleek at any size (--font-display in index.css).
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

/**
 * Apply a font choice to the document root.
 * The default clears the inline --font-sans so index.css decides; an explicit
 * pick sets it inline and lazy-loads the face. Monospace is never user-set, so
 * any inline --font-mono left over from older builds is cleared either way.
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
