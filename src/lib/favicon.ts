import type { PaneState } from './paneState';

/**
 * Live favicon: the brand mark is a midnight square with one lit pane, and the
 * pane follows the fleet. Blue while any agent works, cantaloupe when finished
 * work waits on the operator, red on failure, reading white when the house is
 * quiet (so the tab stays recognisable among many). Operators who keep Nerve in
 * a background tab see it light up without switching to it.
 */

const SIZE = 32;
const GROUND = '#06080E';
const PANE_FILL: Record<PaneState, string> = {
  live: '#3D7EFF',
  operator: '#FFA567',
  error: '#FF5A5A',
  off: '#ECE6DA',
};

let cache: Partial<Record<PaneState, string>> = {};

/** Rasterise the mark for a state; null when no canvas is available (tests, SSR). */
export function faviconDataUrl(state: PaneState): string | null {
  const cached = cache[state];
  if (cached) return cached;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Ground: a midnight square with 7px corners
  ctx.fillStyle = GROUND;
  ctx.beginPath();
  ctx.roundRect(0, 0, SIZE, SIZE, 7);
  ctx.fill();

  // One pane, 12x16, centred: the same 10x14 proportion the shell uses
  ctx.fillStyle = PANE_FILL[state];
  ctx.beginPath();
  ctx.roundRect(10, 8, 12, 16, 1.5);
  ctx.fill();

  let url: string;
  try {
    url = canvas.toDataURL('image/png');
  } catch {
    return null;
  }
  cache[state] = url;
  return url;
}

/** Point every icon link at the mark for this state; a no-op where canvas is missing. */
export function applyFavicon(state: PaneState): void {
  if (typeof document === 'undefined') return;
  const url = faviconDataUrl(state);
  if (!url) return;
  const links = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]');
  if (links.length === 0) {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = url;
    document.head.appendChild(link);
    return;
  }
  links.forEach((link) => {
    if (link.href !== url) {
      link.type = 'image/png';
      link.href = url;
    }
  });
}

/** Test hook: forget rendered marks. */
export function resetFaviconCache(): void {
  cache = {};
}
