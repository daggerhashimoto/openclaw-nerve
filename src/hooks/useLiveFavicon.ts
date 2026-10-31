import { useEffect } from 'react';
import { applyFavicon } from '@/lib/favicon';
import type { PaneState } from '@/lib/paneState';

/** Keep the browser tab's icon in step with the fleet: see src/lib/favicon.ts. */
export function useLiveFavicon(state: PaneState): void {
  useEffect(() => {
    applyFavicon(state);
  }, [state]);
}
