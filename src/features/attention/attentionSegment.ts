/**
 * Which half of the Attention view is showing: Now (the brief) or Today (the day digest).
 * Remembered per browser; every storage access is wrapped so a blocked storage falls back to
 * memory for this page load. The palette's "Go to Today" sets it from outside the view.
 */

import { useCallback, useSyncExternalStore } from 'react';

export type AttentionSegment = 'now' | 'today';

const SEGMENT_KEY = 'nerve:attention:segment';
const listeners = new Set<() => void>();
/** Used only while storage cannot be read. */
let fallback: AttentionSegment = 'now';

export function readAttentionSegment(): AttentionSegment {
  try {
    const raw = localStorage.getItem(SEGMENT_KEY);
    if (raw === 'today' || raw === 'now') return raw;
    return 'now';
  } catch {
    return fallback;
  }
}

export function setAttentionSegment(segment: AttentionSegment): void {
  fallback = segment;
  try {
    localStorage.setItem(SEGMENT_KEY, segment);
  } catch {
    // Not persisted: the choice holds for this page load.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useAttentionSegment(): [AttentionSegment, (segment: AttentionSegment) => void] {
  const segment = useSyncExternalStore(subscribe, readAttentionSegment, () => 'now' as const);
  const set = useCallback((next: AttentionSegment) => setAttentionSegment(next), []);
  return [segment, set];
}
