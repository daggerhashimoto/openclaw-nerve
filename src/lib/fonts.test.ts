import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_FONT, applyFont, fonts } from './fonts';

function stylesheetHrefs(): string[] {
  return Array.from(document.head.querySelectorAll('link[rel="stylesheet"]')).map((link) => link.getAttribute('href') ?? '');
}

describe('applyFont', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style');
  });

  it('labels the default option as the Nerve default and keeps its stored id', () => {
    expect(DEFAULT_FONT).toBe('atkinson-hyperlegible');
    expect(fonts[DEFAULT_FONT].label).toBe('Nerve default');
  });

  it('leaves the faces to CSS for the default', () => {
    const root = document.documentElement;
    root.style.setProperty('--font-sans', 'stale');
    root.style.setProperty('--font-mono', 'stale');

    applyFont('atkinson-hyperlegible');

    expect(root.style.getPropertyValue('--font-sans')).toBe('');
    expect(root.style.getPropertyValue('--font-mono')).toBe('');
  });

  it('sets an explicit pick inline and leaves monospace to CSS', () => {
    const root = document.documentElement;

    applyFont('space-grotesk');

    expect(root.style.getPropertyValue('--font-sans')).toBe(fonts['space-grotesk'].family);
    expect(root.style.getPropertyValue('--font-mono')).toBe('');
    expect(stylesheetHrefs().some((href) => href.includes('family=Space+Grotesk'))).toBe(true);
  });

  it('clears an explicit pick when switching back to the default', () => {
    const root = document.documentElement;

    applyFont('instrument-sans');
    applyFont('atkinson-hyperlegible');

    expect(root.style.getPropertyValue('--font-sans')).toBe('');
  });
});
