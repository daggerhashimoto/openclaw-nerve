/** Tests for the live favicon: the mark is drawn in the current world's colours. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyFavicon, faviconDataUrl, refreshFavicon, resetFaviconCache } from './favicon';

describe('favicon', () => {
  let fills: string[] = [];

  beforeEach(() => {
    fills = [];
    // jsdom has no canvas: record the fills and return them as the data URL
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
      const ctx = {
        fillStyle: '',
        beginPath() {},
        roundRect() {},
        fill() { fills.push(ctx.fillStyle); },
      };
      return ctx as unknown as CanvasRenderingContext2D;
    } as unknown as HTMLCanvasElement['getContext']);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => {
      const url = `data:test,${fills.join('|')}`;
      fills = [];
      return url;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetFaviconCache();
    delete document.documentElement.dataset.world;
    document.head.querySelectorAll('link[rel="icon"]').forEach((link) => link.remove());
  });

  it('draws the night light mark on midnight with electric blue', () => {
    document.documentElement.dataset.world = 'night-light';
    expect(faviconDataUrl('live')).toBe('data:test,#06080E|#3D7EFF');
  });

  it("draws the Workbench mark on its graphite sheet with Workbench's cobalt", () => {
    document.documentElement.dataset.world = 'workbench';
    expect(faviconDataUrl('live')).toBe('data:test,#111318|#3462F2');
    expect(faviconDataUrl('operator')).toBe('data:test,#111318|#FFA567');
  });

  it('redraws the last mark in the new world when the theme switches', () => {
    document.documentElement.dataset.world = 'night-light';
    applyFavicon('operator');
    const icon = () => document.querySelector('link[rel="icon"]')?.getAttribute('href');
    expect(icon()).toBe('data:test,#06080E|#FFA567');

    document.documentElement.dataset.world = 'workbench';
    refreshFavicon();
    expect(icon()).toBe('data:test,#111318|#FFA567');
  });

  it('does nothing on a theme switch before any mark was drawn', () => {
    refreshFavicon();
    expect(document.querySelector('link[rel="icon"]')).toBeNull();
  });
});
