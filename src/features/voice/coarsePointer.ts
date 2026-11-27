/**
 * Coarse-pointer (phone/tablet) detection.
 *
 * `pointer: coarse` covers touch-first devices. `hover: none` catches tablets
 * whose primary pointer reports as fine when a trackpad is attached, and
 * `any-pointer: coarse` still detects the touchscreen on hybrid devices.
 */
export const COARSE_POINTER_QUERY = '(pointer: coarse), (hover: none), (any-pointer: coarse)';

export function matchesCoarsePointer(
  target: Window | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  if (!target || typeof target.matchMedia !== 'function') return false;
  try {
    return target.matchMedia(COARSE_POINTER_QUERY).matches;
  } catch {
    return false;
  }
}
