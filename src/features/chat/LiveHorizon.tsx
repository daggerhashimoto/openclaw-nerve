import { memo } from 'react';
import { isPerformanceModePreferenceEnabled } from '@/lib/performanceMode';

/** Columns sit on a 14px pitch from the centre outward; the room's overflow clips what does not fit. */
const COLUMNS = 96;
const PITCH = 14;
const TALL = ['nerve-horizon-a', 'nerve-horizon-b', 'nerve-horizon-c'];
const SHORT = ['nerve-horizon-d', 'nerve-horizon-e', 'nerve-horizon-f'];

type Column = { left: string; animationName: string; animationDuration: string; animationDelay: string; opacity: number };

/** Seeded so the horizon is the same every load (the landing page hero uses the same seed). */
const LAYOUT: Column[] = (() => {
  let s = 18789 >>> 0;
  const r = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const out: Column[] = [];
  for (let i = 0; i < COLUMNS; i++) {
    const k = i - COLUMNS / 2;
    // 0 at the centre, 1 at the outermost column: the edges run taller and brighter, like the hero
    const d = Math.abs(k + 0.5) / (COLUMNS / 2);
    const set = d > 0.3 || (d > 0.15 && r() < 0.5) ? TALL : SHORT;
    out.push({
      left: `calc(50% + ${k * PITCH}px)`,
      animationName: set[Math.floor(r() * 3)],
      animationDuration: `${(5.5 + r() * 3).toFixed(2)}s`,
      animationDelay: `${(-r() * 8).toFixed(2)}s`,
      opacity: Math.round((0.5 + Math.min(d, 0.5)) * 100) / 100,
    });
  }
  return out;
})();

/**
 * The live horizon: a faint segmented equalizer rising from the floor of the room behind the
 * composer while the open session works. It answers "is it still going?" from the corner of the
 * eye. CSS only (stepped scaleY, no timers), and not in the DOM at all when the session is idle,
 * in performance mode, or under reduced motion (see .nerve-horizon in index.css).
 */
export const LiveHorizon = memo(function LiveHorizon({ active }: { active: boolean }) {
  if (!active || isPerformanceModePreferenceEnabled()) return null;
  return (
    <div className="nerve-horizon" aria-hidden="true" data-testid="live-horizon">
      {LAYOUT.map((c, i) => (
        <span
          key={i}
          className="nerve-horizon-bar"
          style={{
            left: c.left,
            animationName: c.animationName,
            animationDuration: c.animationDuration,
            animationDelay: c.animationDelay,
            opacity: c.opacity,
          }}
        />
      ))}
    </div>
  );
});
