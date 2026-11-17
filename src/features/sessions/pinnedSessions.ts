import { useMemo, useSyncExternalStore } from 'react';

/**
 * Sessions the operator pinned to the top of the agents column.
 *
 * Pins are kept per browser in localStorage as a JSON array of session keys. A pin
 * stays while its session is missing from the list (a refresh that dropped it, a
 * gateway restart), so it applies again when the session comes back; only a delete
 * made through Nerve removes it. Every storage access is guarded: blocked, full or
 * malformed storage reads as no pins and never throws into the sidebar.
 */
export const PINNED_SESSIONS_STORAGE_KEY = 'nerve:pinnedSessions';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

/** The browser's localStorage, or undefined where it is missing or reading it throws. */
function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Parse a stored value into session keys; anything other than an array of strings is no pins. */
export function parsePinnedSessions(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const keys: string[] = [];
  for (const value of parsed) {
    if (typeof value === 'string' && value && !keys.includes(value)) keys.push(value);
  }
  return keys;
}

/** Read the pinned session keys; a storage that throws or holds malformed data reads as no pins. */
export function loadPinnedSessions(storage: ReadableStorage | undefined = browserStorage()): string[] {
  if (!storage) return [];
  try {
    return parsePinnedSessions(storage.getItem(PINNED_SESSIONS_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Write the pinned session keys; a storage that is full or disabled is ignored. */
export function savePinnedSessions(keys: readonly string[], storage: WritableStorage | undefined = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(PINNED_SESSIONS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Storage may be full or disabled; the pins still hold in memory for this page.
  }
}

/** Pin a session that is not pinned, unpin one that is. */
export function togglePinnedSession(keys: readonly string[], sessionKey: string): string[] {
  return keys.includes(sessionKey)
    ? keys.filter((key) => key !== sessionKey)
    : [...keys, sessionKey];
}

/** Drop the pins of these sessions; the same array comes back when none of them was pinned. */
export function removePinnedSessions(keys: readonly string[], sessionKeys: readonly string[]): readonly string[] {
  if (!sessionKeys.some((key) => keys.includes(key))) return keys;
  return keys.filter((key) => !sessionKeys.includes(key));
}

/** Stable partition: pinned items first, then the rest, each group in the order it came in. */
export function pinnedFirst<T>(items: readonly T[], isPinned: (item: T) => boolean): T[] {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const item of items) (isPinned(item) ? pinned : rest).push(item);
  return [...pinned, ...rest];
}

// One store for the page, so both agents columns and the delete path share it.
// Storage is read on first use rather than at import, since the tree builder imports this module.
let pins: readonly string[] | null = null;
let followingOtherTabs = false;
const listeners = new Set<() => void>();

function getPins(): readonly string[] {
  if (pins === null) {
    pins = loadPinnedSessions();
    // Follow other tabs from the first read on, also while no column is mounted (the compact
    // one unmounts when closed), so a later toggle here never writes over another tab's pins.
    if (!followingOtherTabs && typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorage);
      followingOtherTabs = true;
    }
  }
  return pins;
}

function commit(next: readonly string[]): void {
  pins = next;
  savePinnedSessions(next);
  listeners.forEach((listener) => listener());
}

// Another tab changed the pins: take its copy, so both tabs order the column the same way.
function handleStorage(event: StorageEvent): void {
  if (event.key !== PINNED_SESSIONS_STORAGE_KEY && event.key !== null) return;
  pins = loadPinnedSessions();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Pin or unpin one session. */
export function togglePinnedSessionKey(sessionKey: string): void {
  commit(togglePinnedSession(getPins(), sessionKey));
}

/** Forget the pins of sessions Nerve deleted. Keys that were not pinned change nothing. */
export function unpinSessions(sessionKeys: readonly string[]): void {
  const current = getPins();
  const next = removePinnedSessions(current, sessionKeys);
  if (next !== current) commit(next);
}

/** Test hook: drop the in-memory copy, so the next read comes from storage as on a page load. */
export function resetPinnedSessionsCache(): void {
  pins = null;
}

/** The pinned session keys, kept in step with storage, and the toggle the row action calls. */
export function usePinnedSessions(): { pinnedKeys: ReadonlySet<string>; togglePin: (sessionKey: string) => void } {
  const snapshot = useSyncExternalStore(subscribe, getPins, getPins);
  const pinnedKeys = useMemo(() => new Set(snapshot), [snapshot]);
  return { pinnedKeys, togglePin: togglePinnedSessionKey };
}
