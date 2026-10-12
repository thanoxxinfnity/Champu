/**
 * Shared easing curves — used by layer keyframes, the camera track, and both exporters. Its own module
 * (rather than living in project.ts) so camera.ts and rig.ts can use it without project.ts having to
 * import back from them, which would be a cycle: project.ts composes everything else.
 */
export type Easing = 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'easeInOut' | 'back' | 'bounce';
export const EASINGS: Easing[] = ['linear', 'ease', 'easeIn', 'easeOut', 'easeInOut', 'back', 'bounce'];

/** 0..1 in, 0..1 out. The same curve names the CSS and GSAP exporters map to their own syntax. */
export function easeFn(name: Easing): (p: number) => number {
  switch (name) {
    case 'linear': return (p) => p;
    case 'easeIn': return (p) => p * p * p;
    case 'easeOut': return (p) => 1 - (1 - p) ** 3;
    case 'easeInOut': return (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
    case 'back': return (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2; };
    case 'bounce': return bounceOut;
    case 'ease':
    default: return (p) => p * p * (3 - 2 * p); // smoothstep: a reasonable stand-in for CSS's default "ease"
  }
}
function bounceOut(p: number): number {
  const n1 = 7.5625, d1 = 2.75;
  if (p < 1 / d1) return n1 * p * p;
  if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
  if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;
  return n1 * (p -= 2.625 / d1) * p + 0.984375;
}

/** A keyframe segment's custom timing-function control points — the same shape as a CSS cubic-bezier(), anchored at (0,0) and (1,1). */
export interface CustomEase {
  x1: number; y1: number; x2: number; y2: number;
}

function bezierComponent(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}
function bezierComponentDerivative(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/**
 * The standard CSS cubic-bezier timing function: given x1/y1/x2/y2 (the two interior control points of a
 * curve from (0,0) to (1,1)), returns a function from an input fraction (time progress, 0..1 — the curve's
 * x axis) to an eased output (0..1, possibly overshooting — the curve's y axis). Solved with Newton-Raphson
 * (falling back to bisection if it doesn't converge), the same approach browsers use for CSS's own
 * cubic-bezier() easing.
 */
export function cubicBezierEase(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const dx = bezierComponent(t, x1, x2) - x;
      if (Math.abs(dx) < 1e-6) return bezierComponent(t, y1, y2);
      const d = bezierComponentDerivative(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      t -= dx / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 20; i++) {
      const cx = bezierComponent(t, x1, x2);
      if (Math.abs(cx - x) < 1e-6) break;
      if (cx < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return bezierComponent(t, y1, y2);
  };
}
