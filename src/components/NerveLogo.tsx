import { useEffect, useId, useState } from 'react';
import { isPerformanceModePreferenceEnabled } from '@/lib/performanceMode';

/** Brand colours of the mark. Fixed on purpose: the logo stays orange in every theme. */
const SIGNAL = '#FF8C32';
const CORE = '#FFDCB4';
const SPARK = '#FFF1E2';

/** Six outer nodes, pointy-top hexagon, clockwise from the top. */
const ANGLES = [-90, -30, 30, 90, 150, 210].map((deg) => (deg * Math.PI) / 180);
const C = 32; // centre of the 64-unit grid

/** Detailed mark, 33px and up: synapse gaps, hexagon ring, lit cores. */
const FULL = { r: 20, node: 4.6, hub: 7, gap: 2.1, spoke: 2.4, ring: 1.3, viewBox: '5.5 5.5 53 53' };
/** Bold cut, 32px and below: solid spokes, no ring, no cores. */
const SMALL = { r: 17.5, node: 5.8, hub: 8, spoke: 3.6, viewBox: '8.5 8.5 47 47' };

/** Animation cycle in seconds; one spoke fires every CYCLE / 6. */
const CYCLE = 2.4;
const STEP = CYCLE / 6;

const round = (v: number) => Math.round(v * 100) / 100;
const at = (radius: number, angle: number) => ({
  x: round(C + Math.cos(angle) * radius),
  y: round(C + Math.sin(angle) * radius),
});

/** Props for {@link NerveLogo}. */
interface NerveLogoProps {
  /** Rendered size in CSS pixels. 32 and below uses the bold small-size cut. @default 28 */
  size?: number;
  /** Render the non-animated logo. */
  static?: boolean;
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(media.matches);
    updatePreference();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', updatePreference);
      return () => media.removeEventListener('change', updatePreference);
    }

    media.addListener(updatePreference);
    return () => media.removeListener(updatePreference);
  }, []);

  return prefersReducedMotion;
}

function FullMark({ animated, ns }: { animated: boolean; ns: string }) {
  const { r, node, hub, gap, spoke, ring } = FULL;
  const nodes = ANGLES.map((a) => at(r, a));
  const spokes = ANGLES.map((a) => ({ from: at(hub + gap, a), to: at(r - node - gap, a) }));
  const rings = nodes.map((p1, i) => {
    const p2 = nodes[(i + 1) % 6];
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const ux = (p2.x - p1.x) / len;
    const uy = (p2.y - p1.y) / len;
    const d = node + gap;
    return {
      from: { x: round(p1.x + ux * d), y: round(p1.y + uy * d) },
      to: { x: round(p2.x - ux * d), y: round(p2.y - uy * d) },
    };
  });

  return (
    <>
      {spokes.map((s, i) => (
        <line key={`spoke-${i}`} x1={s.from.x} y1={s.from.y} x2={s.to.x} y2={s.to.y} stroke={SIGNAL} strokeWidth={spoke} strokeLinecap="round" />
      ))}
      {rings.map((s, i) => (
        <line key={`ring-${i}`} x1={s.from.x} y1={s.from.y} x2={s.to.x} y2={s.to.y} stroke={SIGNAL} strokeWidth={ring} strokeLinecap="round" />
      ))}
      {nodes.map((n, i) => (
        <g key={`node-${i}`}>
          <circle cx={n.x} cy={n.y} r={node} fill={SIGNAL} />
          <circle cx={n.x} cy={n.y} r={round(node * 0.45)} fill={CORE} />
        </g>
      ))}
      <circle cx={C} cy={C} r={hub} fill={SIGNAL} />
      <circle cx={C} cy={C} r={round(hub * 0.46)} fill={CORE} />
      {animated && spokes.map((s, i) => (
        <g key={`signal-${i}`}>
          <line className={`${ns}-sig`} style={{ animationDelay: `${round(i * STEP)}s` }} x1={s.from.x} y1={s.from.y} x2={s.to.x} y2={s.to.y} stroke={SPARK} strokeWidth={spoke} strokeLinecap="round" />
          <circle className={`${ns}-fire`} style={{ animationDelay: `${round(i * STEP + 0.18)}s` }} cx={nodes[i].x} cy={nodes[i].y} r={round(node * 0.62)} fill={SPARK} />
        </g>
      ))}
      {animated && <circle className={`${ns}-hub`} cx={C} cy={C} r={round(hub * 0.46)} fill={SPARK} />}
    </>
  );
}

function SmallMark({ animated, ns }: { animated: boolean; ns: string }) {
  const { r, node, hub, spoke } = SMALL;
  const nodes = ANGLES.map((a) => at(r, a));
  return (
    <>
      {nodes.map((n, i) => (
        <line key={`spoke-${i}`} x1={C} y1={C} x2={n.x} y2={n.y} stroke={SIGNAL} strokeWidth={spoke} strokeLinecap="round" />
      ))}
      {nodes.map((n, i) => (
        <circle key={`node-${i}`} cx={n.x} cy={n.y} r={node} fill={SIGNAL} />
      ))}
      <circle cx={C} cy={C} r={hub} fill={SIGNAL} />
      {animated && nodes.map((n, i) => (
        <circle key={`fire-${i}`} className={`${ns}-fire`} style={{ animationDelay: `${round(i * STEP)}s` }} cx={n.x} cy={n.y} r={round(node * 0.55)} fill={SPARK} />
      ))}
    </>
  );
}

/**
 * The Nerve mark: a hub and six connected nodes, with synapse gaps between
 * spokes and nodes. Animated, a signal runs out along each spoke in turn and
 * the node it reaches fires (pure CSS, no animation loop). Sizes of 32px and
 * below use a bolder cut so the mark still reads as a network in a 16px tab.
 */
export default function NerveLogo({ size = 28, static: staticLogo = false }: NerveLogoProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const animated = !(staticLogo || prefersReducedMotion || isPerformanceModePreferenceEnabled());
  const small = size <= 32;
  const ns = `nl${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <svg
      role="img"
      aria-label="Nerve logo"
      data-static-logo={animated ? undefined : 'true'}
      width={size}
      height={size}
      viewBox={small ? SMALL.viewBox : FULL.viewBox}
      style={{ display: 'block', flex: 'none' }}
    >
      {animated && (
        <style>{`
          .${ns}-sig,.${ns}-fire{opacity:0;animation:${CYCLE}s ease-in-out infinite}
          .${ns}-sig{animation-name:${ns}-sig}.${ns}-fire{animation-name:${ns}-fire}
          .${ns}-hub{animation:${ns}-hub ${CYCLE}s ease-in-out infinite}
          @keyframes ${ns}-sig{0%,100%{opacity:0}12%{opacity:.85}30%{opacity:0}}
          @keyframes ${ns}-fire{0%,100%{opacity:0}14%{opacity:.9}36%{opacity:0}}
          @keyframes ${ns}-hub{0%,100%{opacity:.75}50%{opacity:1}}
          @media (prefers-reduced-motion: reduce){.${ns}-sig,.${ns}-fire,.${ns}-hub{animation:none;opacity:0}}
        `}</style>
      )}
      {small ? <SmallMark animated={animated} ns={ns} /> : <FullMark animated={animated} ns={ns} />}
    </svg>
  );
}
