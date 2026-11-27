import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCoarsePointer } from './useCoarsePointer';
import { COARSE_POINTER_QUERY } from './coarsePointer';

describe('useCoarsePointer', () => {
  const originalMatchMedia = window.matchMedia;

  function mockPointer(matches: boolean) {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    window.matchMedia = vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      dispatchEvent: vi.fn(() => true),
    } as unknown as MediaQueryList)) as unknown as typeof window.matchMedia;
    return listeners;
  }

  beforeEach(() => {
    mockPointer(false);
  });

  afterEach(() => {
    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia;
    } else {
      delete (window as unknown as { matchMedia?: typeof window.matchMedia }).matchMedia;
    }
  });

  it('returns true on coarse-pointer layouts', () => {
    mockPointer(true);
    const { result } = renderHook(() => useCoarsePointer());
    expect(window.matchMedia).toHaveBeenCalledWith(COARSE_POINTER_QUERY);
    expect(result.current).toBe(true);
  });

  it('returns false on fine-pointer layouts', () => {
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(false);
  });

  it('updates when the pointer media query changes', () => {
    const listeners = mockPointer(false);
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(false);

    act(() => {
      listeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));
    });

    expect(result.current).toBe(true);
  });
});
