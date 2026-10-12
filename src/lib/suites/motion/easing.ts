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
