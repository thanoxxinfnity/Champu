/**
 * The virtual camera: pan/zoom/rotate keyframes (same two-point hold/interpolate shape as a layer's
 * `valueAt()`), screen shake (a sum of decaying seeded impulses — deterministic in t, so it scrubs and
 * exports identically to live playback), impact-frame flashes, and a speed-ramp playback rate.
 */
import { seededAt } from './rng.ts';
import type { Easing } from './easing.ts';
import { easeFn } from './easing.ts';

export interface CameraKeyframe {
  id: string;
  t: number;
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  easing: Easing;
}

export interface CameraTransform {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
}

export function defaultCamera(): CameraKeyframe[] {
  return [{ id: 'cam_0', t: 0, x: 0, y: 0, zoom: 1, rotation: 0, easing: 'easeOut' }];
}

let cameraKeyCounter = 0;
function newCameraKeyId(): string {
  return `cam_${Date.now().toString(36)}${(cameraKeyCounter++).toString(36)}`;
}

/** Insert or replace (within 1/120s) a camera keyframe, keeping the array sorted — same rule as a layer's setKeyframe. */
export function setCameraKeyframe(keyframes: CameraKeyframe[], t: number, props: Partial<Omit<CameraKeyframe, 'id' | 't'>>): CameraKeyframe[] {
  const near = keyframes.find((k) => Math.abs(k.t - t) < 1 / 120);
  const base: CameraKeyframe = near ?? { ...cameraAt(keyframes, t), id: newCameraKeyId(), t, easing: 'easeOut' };
  const kf: CameraKeyframe = { ...base, ...props, t: Math.max(0, t) };
  const rest = keyframes.filter((k) => k !== near);
  return [...rest, kf].sort((a, b) => a.t - b.t);
}

export function removeCameraKeyframe(keyframes: CameraKeyframe[], id: string): CameraKeyframe[] {
  if (keyframes.length <= 1) return keyframes;
  return keyframes.filter((k) => k.id !== id);
}

const NUMERIC: Array<keyof CameraTransform> = ['x', 'y', 'zoom', 'rotation'];

/** Where the camera is at time `t`: held before the first keyframe, held after the last. */
export function cameraAt(keyframes: CameraKeyframe[], t: number): CameraTransform {
  if (keyframes.length === 0) return { x: 0, y: 0, zoom: 1, rotation: 0 };
  if (t <= keyframes[0]!.t) return pick(keyframes[0]!);
  if (t >= keyframes[keyframes.length - 1]!.t) return pick(keyframes[keyframes.length - 1]!);
  let i = 0;
  while (i < keyframes.length - 1 && keyframes[i + 1]!.t <= t) i++;
  const a = keyframes[i]!, b = keyframes[i + 1]!;
  const span = b.t - a.t;
  const raw = span <= 0 ? 1 : (t - a.t) / span;
  const p = easeFn(a.easing)(raw);
  const out: Partial<CameraTransform> = {};
  for (const k of NUMERIC) out[k] = a[k] + (b[k] - a[k]) * p;
  return out as CameraTransform;
}
function pick(k: CameraKeyframe): CameraTransform {
  return { x: k.x, y: k.y, zoom: k.zoom, rotation: k.rotation };
}

export interface ShakeEvent {
  id: string;
  /** When the shake starts, in seconds. */
  t: number;
  duration: number;
  /** Peak offset in stage pixels. */
  magnitude: number;
  seed: number;
}

/**
 * Combined offset from every shake active at `t`. Quantised to a 60th of a second so the jitter is a
 * genuine deterministic function of t (same value every time this instant is evaluated) rather than
 * smoothly continuous noise, which reads as a believable hit-shake rather than a vibration.
 */
export function shakeOffsetAt(shakes: ShakeEvent[], t: number): { x: number; y: number; rotation: number } {
  let x = 0, y = 0, rotation = 0;
  for (const s of shakes) {
    if (t < s.t || t > s.t + s.duration) continue;
    const age = t - s.t;
    const decay = s.duration > 0 ? 1 - age / s.duration : 0;
    const step = Math.floor(age * 60);
    const rng = seededAt(s.seed, step);
    x += (rng() * 2 - 1) * s.magnitude * decay;
    y += (rng() * 2 - 1) * s.magnitude * decay;
    rotation += (rng() * 2 - 1) * s.magnitude * decay * 0.15;
  }
  return { x, y, rotation };
}

export type ImpactStyle = 'flash' | 'bw';

export interface ImpactFrame {
  id: string;
  t: number;
  duration: number;
  style: ImpactStyle;
}

/** The impact frame covering `t`, or null — a timeline can have several, but only the first match fires. */
export function impactAt(impacts: ImpactFrame[], t: number): ImpactFrame | null {
  return impacts.find((i) => t >= i.t && t <= i.t + i.duration) ?? null;
}

export interface SpeedRamp {
  id: string;
  t0: number;
  t1: number;
  /** 1 = normal speed, 0.25 = quarter-speed slow-mo, 3 = triple-speed. */
  rate: number;
}

/** The playback-rate multiplier in effect at `t` — 1 outside every ramp region. */
export function effectiveRate(ramps: SpeedRamp[], t: number): number {
  const hit = ramps.find((r) => t >= r.t0 && t < r.t1);
  return hit ? hit.rate : 1;
}
