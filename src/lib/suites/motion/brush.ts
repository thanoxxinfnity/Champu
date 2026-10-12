/**
 * The brush engine: input smoothing, pressure response, and turning a drawn stroke into "dabs" — the
 * stamped circles every brush kind is built from. This is the pure half (deterministic given a stroke and
 * a brush); render.ts turns dabs into actual canvas pixels (texture, blend mode, jitter are a drawing
 * concern, not a data concern).
 */
import { seededAt } from './rng.ts';

export type BrushKind = 'pencil' | 'ink' | 'airbrush' | 'watercolor' | 'charcoal' | 'neon';
export const BRUSH_KINDS: BrushKind[] = ['pencil', 'ink', 'airbrush', 'watercolor', 'charcoal', 'neon'];

export interface BrushSettings {
  kind: BrushKind;
  /** Base diameter in stage pixels, before pressure. */
  size: number;
  opacity: number;
  color: string;
  /** 0 = raw input, 1 = heavily smoothed — a shaky hand still draws a clean line. */
  stabilizer: number;
  /** How much stylus/touch pressure affects width, 0..1. */
  pressureSizeMix: number;
  pressureOpacityMix: number;
}

const BRUSH_DEFAULTS: Record<BrushKind, Omit<BrushSettings, 'color'>> = {
  pencil: { kind: 'pencil', size: 4, opacity: 0.9, stabilizer: 0.15, pressureSizeMix: 0.5, pressureOpacityMix: 0.3 },
  ink: { kind: 'ink', size: 6, opacity: 1, stabilizer: 0.35, pressureSizeMix: 0.65, pressureOpacityMix: 0.1 },
  airbrush: { kind: 'airbrush', size: 36, opacity: 0.35, stabilizer: 0.1, pressureSizeMix: 0.3, pressureOpacityMix: 0.7 },
  watercolor: { kind: 'watercolor', size: 28, opacity: 0.4, stabilizer: 0.2, pressureSizeMix: 0.4, pressureOpacityMix: 0.6 },
  charcoal: { kind: 'charcoal', size: 10, opacity: 0.75, stabilizer: 0.1, pressureSizeMix: 0.6, pressureOpacityMix: 0.4 },
  neon: { kind: 'neon', size: 8, opacity: 1, stabilizer: 0.25, pressureSizeMix: 0.3, pressureOpacityMix: 0.2 },
};

export function newBrush(kind: BrushKind, color = '#1a1a1a'): BrushSettings {
  return { ...BRUSH_DEFAULTS[kind], color };
}

export interface StrokePoint {
  x: number;
  y: number;
  /** 0..1 — 0.5 for a mouse/finger with no real pressure signal. */
  pressure: number;
}

/**
 * One smoothing step: the drawn point lags behind the raw input, proportionally to `stabilizer`. Called
 * once per raw input sample with the previously-smoothed point; the very first point of a stroke has
 * nothing to lag behind, so it is returned unchanged.
 */
export function stabilizePoint(prev: StrokePoint | null, raw: StrokePoint, stabilizer: number): StrokePoint {
  if (!prev) return raw;
  const k = Math.max(0, Math.min(0.95, stabilizer));
  return {
    x: prev.x + (raw.x - prev.x) * (1 - k),
    y: prev.y + (raw.y - prev.y) * (1 - k),
    pressure: prev.pressure + (raw.pressure - prev.pressure) * (1 - k),
  };
}

export interface Dab {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  /** A per-dab random offset for textured brushes (charcoal grain, watercolor bleed) — 0 for clean brushes. */
  jitter: number;
}

const SPACING_FACTOR: Record<BrushKind, number> = {
  pencil: 0.35, ink: 0.3, airbrush: 0.22, watercolor: 0.3, charcoal: 0.28, neon: 0.25,
};

function widthAt(brush: BrushSettings, pressure: number): number {
  const mix = brush.pressureSizeMix;
  return brush.size * (1 - mix + mix * pressure);
}
function opacityAt(brush: BrushSettings, pressure: number): number {
  const mix = brush.pressureOpacityMix;
  return brush.opacity * (1 - mix + mix * pressure);
}

/**
 * Resample a stroke's points into evenly-spaced dabs — the stamped circles a brush is actually drawn
 * from. Spacing is a fraction of the live width (so a thick, light-pressure pass still looks continuous,
 * and a thin pass doesn't waste dabs). Deterministic given the same stroke, brush and seed.
 */
export function strokeToDabs(points: StrokePoint[], brush: BrushSettings, seed = 1): Dab[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    const p = points[0]!;
    return [{ x: p.x, y: p.y, radius: widthAt(brush, p.pressure) / 2, opacity: opacityAt(brush, p.pressure), jitter: 0 }];
  }
  const dabs: Dab[] = [];
  let carry = 0;
  let dabIndex = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen === 0) continue;
    let dist = carry;
    while (dist < segLen) {
      const p = dist / segLen;
      const x = a.x + (b.x - a.x) * p;
      const y = a.y + (b.y - a.y) * p;
      const pressure = a.pressure + (b.pressure - a.pressure) * p;
      const radius = widthAt(brush, pressure) / 2;
      const jitterRng = seededAt(seed, dabIndex);
      const jitterAmount = brush.kind === 'charcoal' || brush.kind === 'watercolor' ? (jitterRng() - 0.5) * radius * 0.6 : 0;
      dabs.push({ x, y, radius: Math.max(0.3, radius), opacity: opacityAt(brush, pressure), jitter: jitterAmount });
      dabIndex++;
      const spacing = Math.max(1, radius * 2 * SPACING_FACTOR[brush.kind]);
      dist += spacing;
    }
    carry = dist - segLen;
  }
  return dabs;
}

/** The bounding box of a stroke's dabs, padded by their radius — used for dirty-rect redraws and hit-testing. */
export function dabsBounds(dabs: Dab[]): { x: number; y: number; w: number; h: number } | null {
  if (dabs.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of dabs) {
    minX = Math.min(minX, d.x - d.radius);
    minY = Math.min(minY, d.y - d.radius);
    maxX = Math.max(maxX, d.x + d.radius);
    maxY = Math.max(maxY, d.y + d.radius);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
