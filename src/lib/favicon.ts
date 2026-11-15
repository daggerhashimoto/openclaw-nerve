import type { PaneState } from './paneState';

/**
 * Live favicon: the brand mark is a dark square with one lit pane, and the
 * pane follows the fleet. Blue while any agent works, cantaloupe when finished
 * work waits on the operator, red on failure, reading white when the house is
 * quiet (so the tab stays recognisable among many). Operators who keep Nerve in
 * a background tab see it light up without switching to it.
 */

const SIZE = 32;

type World = 'night-light' | 'workbench';

/**
 * The mark's colours per world. The ground stays dark in both lights so the tab
 * reads among others; Workbench draws it on its graphite sheet with its cobalt.
 */
const PALETTE: Record<World, { ground: string; pane: Record<PaneState, string> }> = {
  'night-light': {
    ground: '#06080E',
    pane: { live: '#3D7EFF', operator: '#FFA567', error: '#FF5A5A', off: '#ECE6DA' },
  },
  workbench: {
    ground: '#111318',
    pane: { live: '#3462F2', operator: '#FFA567', error: '#FF5A5A', off: '#C3C8D1' },
  },
};

let cache: Record<string, string> = {};
let lastState: PaneState | null = null;

function currentWorld(): World {
  if (typeof document === 'undefined') return 'night-light';
  return document.documentElement.dataset.world === 'workbench' ? 'workbench' : 'night-light';
}

/** Rasterise the mark for a state in the current world; null when no canvas is available (tests, SSR). */
export function faviconDataUrl(state: PaneState): string | null {
  const world = currentWorld();
  const key = `${world}:${state}`;
  const cached = cache[key];
  if (cached) return cached;
  if (typeof document === 'undefined') return null;
  const palette = PALETTE[world];
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Ground: a dark square with 7px corners
  ctx.fillStyle = palette.ground;
  ctx.beginPath();
  ctx.roundRect(0, 0, SIZE, SIZE, 7);
  ctx.fill();

  // One pane, 12x16, centred: the same 10x14 proportion the shell uses
  ctx.fillStyle = palette.pane[state];
  ctx.beginPath();
  ctx.roundRect(10, 8, 12, 16, 1.5);
  ctx.fill();

  let url: string;
  try {
    url = canvas.toDataURL('image/png');
  } catch {
    return null;
  }
  cache[key] = url;
  return url;
}

/** Point every icon link at the mark for this state; a no-op where canvas is missing. */
export function applyFavicon(state: PaneState): void {
  if (typeof document === 'undefined') return;
  lastState = state;
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

/** Redraw the last mark, for a theme switch that moved the tab icon into another world. */
export function refreshFavicon(): void {
  if (lastState) applyFavicon(lastState);
}

/** Test hook: forget rendered marks and the last state. */
export function resetFaviconCache(): void {
  cache = {};
  lastState = null;
}
