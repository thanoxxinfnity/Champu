/**
 * Directional motion blur: a handful of fading "ghost" copies trailing behind a layer along its own
 * direction of travel, derived from how far it moved in the instant before `t` — real motion, not a
 * generic blur filter smeared in a fixed direction.
 */
import { valueAt, type MotionLayer } from './project.ts';

export interface MotionBlurGhost {
  dx: number;
  dy: number;
  opacity: number;
}

/** A layer's instantaneous velocity (px/s) at `t`, from a small backward finite difference. */
export function velocityAt(layer: MotionLayer, t: number, dt = 1 / 60): { vx: number; vy: number } {
  const a = valueAt(layer, Math.max(0, t - dt));
  const b = valueAt(layer, t);
  return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
}

/**
 * Trailing ghost offsets along the velocity direction, fading out — drawn behind the layer's real
 * position. `strength` scales how far the trail reaches per unit speed; near-zero velocity gives no
 * ghosts at all (a still layer is never blurred).
 */
export function motionBlurGhosts(vx: number, vy: number, strength: number, samples: number): MotionBlurGhost[] {
  const speed = Math.hypot(vx, vy);
  if (speed < 1 || samples <= 0 || strength <= 0) return [];
  const dirX = vx / speed, dirY = vy / speed;
  const reach = speed * strength;
  const out: MotionBlurGhost[] = [];
  for (let i = 1; i <= samples; i++) {
    const p = i / samples;
    out.push({ dx: -dirX * reach * p, dy: -dirY * reach * p, opacity: (1 - p) * 0.5 });
  }
  return out;
}
