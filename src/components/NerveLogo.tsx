import { useEffect, useRef, useState } from 'react';
import { isPerformanceModePreferenceEnabled } from '@/lib/performanceMode';

const TAU = Math.PI * 2;
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function easeOut(t: number) { return 1 - Math.pow(1 - t, 3); }
function ease(t: number) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3) / 2; }
function clamp(v: number, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, v)); }
function rgba(c: number[], a: number) { return `rgba(${c[0]},${c[1]},${c[2]},${Math.min(a, 1)})`; }

const P = [255, 140, 50];
const WH = [255, 220, 180];
const DM = [48, 28, 14];

interface Trail { x: number; y: number; life: number; size: number; }
interface Ripple { x: number; y: number; life: number; maxR: number; }

function glowDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: number[], alpha: number, blur: number) {
  ctx.save();
  ctx.shadowBlur = blur;
  ctx.shadowColor = rgba(color, alpha * 0.7);
  ctx.fillStyle = rgba(color, alpha);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(r, 0.5), 0, TAU);
  ctx.fill();
  ctx.restore();
}

function dimDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = rgba(DM, 0.5);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function dimLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number) {
  ctx.strokeStyle = rgba(DM, 0.4);
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function glowLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number, color: number[], alpha: number, blur: number) {
  ctx.save();
  ctx.shadowBlur = blur;
  ctx.shadowColor = rgba(color, alpha);
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/** Props for {@link NerveLogo}. */
interface NerveLogoProps {
  /** Logical size in CSS pixels (canvas is rendered at 2× for retina). @default 28 */
  size?: number;
  /** Render the non-animated logo variant without a canvas animation loop. */
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

function StaticNerveLogo({ size }: { size: number }) {
  const pad = 2;
  const boxSize = size * pad;
  const center = boxSize / 2;
  const radius = size * 0.31;
  const nodeRadius = Math.max(2.5, size * 0.13);
  const outerRadius = Math.max(2, size * 0.09);
  const negativeMargin = -size * (pad - 1) / 2;
  const outer = Array.from({ length: 6 }, (_, index) => {
    const angle = (index / 6) * TAU - Math.PI / 2;
    return {
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
    };
  });

  return (
    <span
      role="img"
      aria-label="Nerve logo"
      data-static-logo="true"
      className="relative block"
      style={{
        width: boxSize,
        height: boxSize,
        margin: negativeMargin,
      }}
    >
      {outer.map((node, index) => (
        <span
          key={`line-${index}`}
          aria-hidden="true"
          className="absolute block origin-left rounded-full bg-primary/35"
          style={{
            left: center,
            top: center,
            width: Math.hypot(node.x - center, node.y - center),
            height: 1,
            transform: `rotate(${Math.atan2(node.y - center, node.x - center)}rad)`,
          }}
        />
      ))}
      {outer.map((node, index) => (
        <span
          key={`node-${index}`}
          aria-hidden="true"
          className="absolute rounded-full border border-primary/45 bg-primary/25 shadow-[0_0_10px_rgba(255,140,50,0.25)]"
          style={{
            left: node.x - outerRadius,
            top: node.y - outerRadius,
            width: outerRadius * 2,
            height: outerRadius * 2,
          }}
        />
      ))}
      <span
        aria-hidden="true"
        className="absolute rounded-full border border-primary/70 bg-primary/35 shadow-[0_0_14px_rgba(255,140,50,0.32)]"
        style={{
          left: center - nodeRadius,
          top: center - nodeRadius,
          width: nodeRadius * 2,
          height: nodeRadius * 2,
        }}
      />
    </span>
  );
}

/**
 * Animated canvas logo for the Nerve brand.
 *
 * Renders a hexagonal node graph with glowing fire-pulse animations:
 * center ignition → outward propagation → return fire → ring chain.
 * The animation loops on a ~4.2 s cycle and includes ambient breathing.
 */
export default function NerveLogo({ size = 28, static: staticLogo = false }: NerveLogoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const shouldRenderStatic = staticLogo || prefersReducedMotion || isPerformanceModePreferenceEnabled();
  const stateRef = useRef<{
    trails: Trail[];
    ripples: Ripple[];
    center: { x: number; y: number; glow: number };
    outer: { x: number; y: number; glow: number }[];
    rafId: number;
  } | null>(null);

  useEffect(() => {
    if (shouldRenderStatic) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 2;
    const PAD = 2.0; // 2x padding so glow never clips at canvas edge
    const pxSize = size * dpr * PAD;
    canvas.width = pxSize;
    canvas.height = pxSize;
    canvas.style.width = `${size * PAD}px`;
    canvas.style.height = `${size * PAD}px`;
    canvas.style.margin = `${-size * (PAD - 1) / 2}px`; // negative margin to keep layout tight

    const W = pxSize;
    const S = W / (size * PAD);
    const cx = W / 2;
    const cy = W / 2;

    const R = size * 0.31 * S;
    const CYCLE = 4.2;

    const center = { x: cx, y: cy, glow: 0 };
    const outer: { x: number; y: number; glow: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU - Math.PI / 2;
      outer.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, glow: 0 });
    }

    const trails: Trail[] = [];
    const ripples: Ripple[] = [];

    stateRef.current = { trails, ripples, center, outer, rafId: 0 };

    const MAX_TRAILS = 200;
    const MAX_RIPPLES = 20;

    function animate(time: number) {
      if (!ctx) return;
      const t = (time / 1000) % CYCLE;
      ctx.clearRect(0, 0, W, W);

      // Static structure
      outer.forEach(n => dimLine(ctx, cx, cy, n.x, n.y, 1.5 * S));
      for (let i = 0; i < 6; i++) dimLine(ctx, outer[i].x, outer[i].y, outer[(i+1)%6].x, outer[(i+1)%6].y, 1 * S);
      dimDot(ctx, cx, cy, 7 * S);
      outer.forEach(n => dimDot(ctx, n.x, n.y, 4.5 * S));

      center.glow = Math.max(0, center.glow - 0.022);
      outer.forEach(n => n.glow = Math.max(0, n.glow - 0.022));

      // Phase 1: Center ignites
      if (t < 0.35) {
        const p = t / 0.35;
        center.glow = Math.max(center.glow, p < 0.3 ? p / 0.3 : 1 - easeOut((p - 0.3) / 0.7));
        if (t < 0.05 && ripples.length < 2) ripples.push({ x: cx, y: cy, life: 1, maxR: 35 * S });
      }

      // Phase 2: Outward fire
      outer.forEach((node, i) => {
        const start = 0.25 + i * 0.06;
        const dur = 0.55;
        const p = clamp((t - start) / dur);
        if (p > 0 && p < 1) {
          const ep = ease(p);
          const x = lerp(cx, node.x, ep), y = lerp(cy, node.y, ep);
          glowLine(ctx, cx, cy, x, y, 2.5 * S, P, 0.35 * (1 - p * 0.7), 12 * S);
          glowDot(ctx, x, y, 3.5 * S * (1 - p * 0.2), P, 1, 20 * S);
          glowDot(ctx, x, y, 1.75 * S, WH, 0.85, 5 * S);
          if (Math.random() < 0.6) trails.push({ x: x + (Math.random()-0.5)*3*S, y: y + (Math.random()-0.5)*3*S, life: 0.8, size: 1.5*S });
        }
        if (p >= 0.88) {
          node.glow = Math.max(node.glow, easeOut((p - 0.88) / 0.12));
          if (p > 0.95 && !ripples.some(r => Math.abs(r.x - node.x) < 1)) ripples.push({ x: node.x, y: node.y, life: 1, maxR: 14*S });
        }
      });

      // Phase 3: Return fire
      [1, 4].forEach((ni, idx) => {
        const node = outer[ni];
        const start = 1.5 + idx * 0.15;
        const p = clamp((t - start) / 0.6);
        if (p > 0 && p < 1) {
          const ep = ease(p);
          const x = lerp(node.x, cx, ep), y = lerp(node.y, cy, ep);
          glowLine(ctx, node.x, node.y, x, y, 2*S, P, 0.3*(1-p*0.5), 10*S);
          glowDot(ctx, x, y, 3*S, P, 0.9, 16*S);
          glowDot(ctx, x, y, 1.5*S, WH, 0.7, 4*S);
          if (Math.random() < 0.4) trails.push({ x, y, life: 0.6, size: 1.2*S });
        }
        if (p >= 0.9) center.glow = Math.max(center.glow, 0.6);
      });

      // Phase 4: Ring chain
      for (let i = 0; i < 6; i++) {
        const start = 2.5 + i * 0.12;
        const p = clamp((t - start) / 0.28);
        if (p > 0 && p < 1) {
          const next = (i+1) % 6;
          const ep = ease(p);
          const x = lerp(outer[i].x, outer[next].x, ep), y = lerp(outer[i].y, outer[next].y, ep);
          glowLine(ctx, outer[i].x, outer[i].y, x, y, 2*S, P, 0.5*(1-p*0.3), 8*S);
          glowDot(ctx, x, y, 2.5*S, P, 0.8, 12*S);
          if (Math.random() < 0.3) trails.push({ x, y, life: 0.5, size: 1*S });
        }
        if (t > (2.5+i*0.12+0.24) && t < (2.5+i*0.12+0.39)) {
          outer[(i+1)%6].glow = Math.max(outer[(i+1)%6].glow, 0.65);
        }
      }

      // Cap arrays to prevent unbounded growth on long-running tabs
      if (trails.length > MAX_TRAILS) trails.splice(0, trails.length - MAX_TRAILS);
      if (ripples.length > MAX_RIPPLES) ripples.splice(0, ripples.length - MAX_RIPPLES);

      // Ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.life -= 0.018;
        if (r.life <= 0) { ripples.splice(i, 1); continue; }
        ctx.save();
        ctx.strokeStyle = rgba(P, r.life * 0.25);
        ctx.lineWidth = Math.max(1, 1.5 * S * r.life);
        ctx.shadowBlur = 8 * S;
        ctx.shadowColor = rgba(P, r.life * 0.15);
        ctx.beginPath();
        ctx.arc(r.x, r.y, (1-r.life) * r.maxR, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }

      // Trails
      for (let i = trails.length - 1; i >= 0; i--) {
        const p = trails[i];
        p.life -= 0.045;
        if (p.life <= 0) { trails.splice(i, 1); continue; }
        glowDot(ctx, p.x, p.y, p.size * p.life, P, p.life * 0.45, 5*S);
      }

      // Glowing nodes
      if (center.glow > 0.01) {
        glowDot(ctx, cx, cy, 7*S*(1+center.glow*0.25), P, center.glow*0.75, 28*S);
        glowDot(ctx, cx, cy, 3.5*S, WH, center.glow*0.45, 8*S);
      }
      outer.forEach(n => {
        if (n.glow > 0.01) {
          glowDot(ctx, n.x, n.y, 4.5*S*(1+n.glow*0.25), P, n.glow*0.7, 18*S);
          glowDot(ctx, n.x, n.y, 2.2*S, WH, n.glow*0.35, 5*S);
        }
      });

      // Ambient breathe
      const breathe = 0.03 + 0.02 * Math.sin(time / 1000 * 1.2);
      glowDot(ctx, cx, cy, 4*S, P, breathe, 15*S);

      if (stateRef.current) stateRef.current.rafId = requestAnimationFrame(animate);
    }

    stateRef.current.rafId = requestAnimationFrame(animate);

    return () => {
      if (stateRef.current) cancelAnimationFrame(stateRef.current.rafId);
    };
  }, [shouldRenderStatic, size]);

  if (shouldRenderStatic) {
    return <StaticNerveLogo size={size} />;
  }

  return <canvas ref={canvasRef} role="img" aria-label="Nerve logo" style={{ display: 'block' }} />;
}
