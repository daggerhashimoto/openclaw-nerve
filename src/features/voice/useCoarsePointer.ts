import { useEffect, useState } from 'react';
import { COARSE_POINTER_QUERY, matchesCoarsePointer } from './coarsePointer';

/** Track whether the current layout is a coarse-pointer (phone/tablet) device. */
export function useCoarsePointer(): boolean {
  const [coarsePointer, setCoarsePointer] = useState(matchesCoarsePointer);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    let query: MediaQueryList;
    try {
      query = window.matchMedia(COARSE_POINTER_QUERY);
    } catch {
      return;
    }

    const update = (event: MediaQueryListEvent) => setCoarsePointer(event.matches);

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }

    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return coarsePointer;
}
