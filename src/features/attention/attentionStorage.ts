/**
 * Browser-only state for the Attention view: when the operator last looked,
 * which items they marked seen, and a one-time intro flag. Every accessor is
 * wrapped so a blocked or full storage behaves as empty and never throws.
 */

const LAST_LOOK_KEY = 'nerve:attention:lastLook';
const SEEN_KEY = 'nerve:attention:seen';
const INTRO_KEY = 'nerve:attention:introduced';

/** Most seen keys kept; the newest win when the cap is hit. */
const SEEN_CAP = 500;

export function readLastLook(): number | null {
  try {
    const raw = localStorage.getItem(LAST_LOOK_KEY);
    if (raw === null) return null;
    const ts = Number(raw);
    return Number.isFinite(ts) && ts > 0 ? ts : null;
  } catch {
    return null;
  }
}

export function writeLastLook(ts: number): void {
  try {
    localStorage.setItem(LAST_LOOK_KEY, String(ts));
  } catch {
    // Storage unavailable: the next open falls back to the 24 hour window.
  }
}

/** Seen keys oldest first, as stored. */
function readSeenList(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((key): key is string => typeof key === 'string');
  } catch {
    return [];
  }
}

export function readSeen(): Set<string> {
  return new Set(readSeenList());
}

/** Adds keys as the newest entries, trims to the cap, and returns the result. */
export function addSeen(keys: string[]): Set<string> {
  const incoming = new Set(keys);
  const kept = readSeenList().filter((key) => !incoming.has(key));
  const next = [...kept, ...incoming].slice(-SEEN_CAP);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    // Not persisted: the keys still count as seen for this page load.
  }
  return new Set(next);
}

/** True the first time it is called on this device, false after. */
export function consumeIntroFlag(): boolean {
  try {
    if (localStorage.getItem(INTRO_KEY) !== null) return false;
    localStorage.setItem(INTRO_KEY, '1');
    return true;
  } catch {
    // Without storage the flag cannot be remembered, so never claim it fresh.
    return false;
  }
}
