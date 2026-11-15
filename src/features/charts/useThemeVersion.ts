import { useEffect, useState } from 'react';

/**
 * Counts theme changes. applyTheme writes the tokens onto the root element, so a
 * chart that sampled the CSS variables can resample with the new palette instead
 * of keeping the colours it saw at mount.
 */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => observer.disconnect();
  }, []);
  return version;
}
