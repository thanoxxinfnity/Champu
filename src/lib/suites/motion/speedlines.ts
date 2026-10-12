/**
 * Anime speed lines: a burst of lines racing out from a focal point (radial — the classic "impact" frame
 * background) or all parallel in one direction (linear — a fast-pan/running feel). Deterministic in a
 * seed, like the particle pool, so the same configuration always draws the same lines.
 */
import { seededAt } from './rng.ts';

export type SpeedLineKind = 'radial' | 'linear';

export interface SpeedLineConfig {
  kind: SpeedLineKind;
  originX: number;
  originY: number;
  /** How many lines. */
  density: number;
  /** Line length in stage pixels. */
  length: number;
  /** Degrees — the direction for 'linear', ignored for 'radial'. */
  angleDeg: number;
  color: string;
  opacity: number;
  seed: number;
}

export interface SpeedLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  opacity: number;
}

export function newSpeedLineConfig(kind: SpeedLineKind, originX: number, originY: number, seed = 1): SpeedLineConfig {
  return { kind, originX, originY, density: kind === 'radial' ? 36 : 24, length: kind === 'radial' ? 220 : 400, angleDeg: 0, color: '#ffffff', opacity: 0.7, seed };
}

/** The lines themselves, given a stage half-extent (so radial lines reach past the frame edges, not just the origin's local area). */
export function generateSpeedLines(config: SpeedLineConfig, reachPx: number): SpeedLine[] {
  const out: SpeedLine[] = [];
  for (let i = 0; i < config.density; i++) {
    const rJitter = seededAt(config.seed, i)();
    const rWidth = seededAt(config.seed, i + 1000)();
    const rGapStart = seededAt(config.seed, i + 2000)();
    let angleRad: number;
    if (config.kind === 'radial') {
      angleRad = ((i / config.density) * 360 + (rJitter - 0.5) * (360 / config.density) * 0.6) * (Math.PI / 180);
    } else {
      angleRad = (config.angleDeg + (rJitter - 0.5) * 4) * (Math.PI / 180);
    }
    const len = config.length * (0.7 + rJitter * 0.6);
    const startDist = config.kind === 'radial' ? reachPx * 0.08 + rGapStart * reachPx * 0.1 : 0;
    const x1 = config.originX + Math.cos(angleRad) * startDist;
    const y1 = config.originY + Math.sin(angleRad) * startDist;
    const x2 = x1 + Math.cos(angleRad) * len;
    const y2 = y1 + Math.sin(angleRad) * len;
    out.push({ x1, y1, x2, y2, width: 1 + rWidth * 2.5, opacity: config.opacity * (0.6 + rWidth * 0.4) });
  }
  return out;
}
