/**
 * The particle/VFX engine: energy aura, fire, electric sparks, explosions, cursed-energy wisps.
 *
 * `particlesAt(config, t)` is a pure function of time, like `valueAt()` in project.ts — every particle's
 * position, size, colour and opacity at instant `t` are derived analytically from its spawn phase, not
 * stepped forward from a previous frame. That is what lets the timeline be scrubbed to any instant and
 * sampled frame-by-frame for GIF/video export and still look identical to live playback.
 *
 * A config describes a *pool* of particles that each respawn on their own cycle of length `lifespan`,
 * spread across that cycle by a seeded phase so they do not all pop at once.
 */
import { seededAt } from './rng.ts';

export type ParticlePreset = 'aura' | 'fire' | 'electric' | 'explosion' | 'cursed';
export const PARTICLE_PRESETS: ParticlePreset[] = ['aura', 'fire', 'electric', 'explosion', 'cursed'];

export interface ParticleConfig {
  preset: ParticlePreset;
  /** Particles alive per second of `lifespan` — the pool size is round(spawnRate * lifespan). */
  spawnRate: number;
  /** Seconds a single particle lives before its slot respawns. */
  lifespan: number;
  /** Base outward speed in stage pixels/second. */
  speed: number;
  /** Base particle size in stage pixels. */
  size: number;
  colorStart: string;
  colorEnd: string;
  /** Deterministic — same seed, same pool, forever. */
  seed: number;
}

export interface Particle {
  x: number;
  y: number;
  size: number;
  opacity: number;
  color: string;
}

const PRESET_DEFAULTS: Record<ParticlePreset, Omit<ParticleConfig, 'seed'>> = {
  aura: { preset: 'aura', spawnRate: 18, lifespan: 1.1, speed: 55, size: 7, colorStart: '#8a5cff', colorEnd: '#2a0a4a' },
  fire: { preset: 'fire', spawnRate: 26, lifespan: 0.75, speed: 90, size: 9, colorStart: '#fff3b0', colorEnd: '#ff3d00' },
  electric: { preset: 'electric', spawnRate: 40, lifespan: 0.35, speed: 220, size: 3, colorStart: '#eaffff', colorEnd: '#2ad4ff' },
  explosion: { preset: 'explosion', spawnRate: 60, lifespan: 0.6, speed: 260, size: 10, colorStart: '#ffffff', colorEnd: '#ff7a00' },
  cursed: { preset: 'cursed', spawnRate: 14, lifespan: 1.6, speed: 35, size: 11, colorStart: '#5cffb0', colorEnd: '#0a1a14' },
};

export function newParticleConfig(preset: ParticlePreset, seed = 1): ParticleConfig {
  return { ...PRESET_DEFAULTS[preset], seed };
}

function hex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}
function parseHex(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  if (!m) return [255, 255, 255];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}
/** Linear RGB blend — good enough for a particle fading from one colour to another over its short life. */
export function lerpColor(a: string, b: string, p: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return `#${hex(ar + (br - ar) * p)}${hex(ag + (bg - ag) * p)}${hex(ab + (bb - ab) * p)}`;
}

/** Each preset's outward direction bias, in degrees (0 = +x/right, 90 = +y/down in screen space). */
function presetAngleDeg(preset: ParticlePreset, u: number): number {
  switch (preset) {
    case 'fire': return -90 + (u - 0.5) * 70; // mostly straight up, a flame-width cone
    case 'electric': return u * 360; // omnidirectional sparks
    case 'explosion': return u * 360; // omnidirectional burst
    case 'cursed': return u * 360; // omnidirectional, slow drifting wisp
    case 'aura':
    default: return u * 360;
  }
}

/** Radial distance travelled by age `a` (seconds) — most presets are linear; explosion decelerates. */
function presetDistance(preset: ParticlePreset, speed: number, age: number, lifespan: number): number {
  if (preset === 'explosion') {
    const p = Math.min(1, age / lifespan);
    return speed * lifespan * (1 - (1 - p) ** 2); // fast out, slowing — a believable burst
  }
  return speed * age;
}

/**
 * All particles in the pool at instant `t`, in local (layer-centred) stage pixels. `t` can be any real
 * number — the pool loops forever on `config.lifespan`, independent of the project's own duration, the
 * way a looping VFX layer should.
 */
export function particlesAt(config: ParticleConfig, t: number): Particle[] {
  const poolSize = Math.max(0, Math.round(config.spawnRate * config.lifespan));
  const out: Particle[] = [];
  for (let i = 0; i < poolSize; i++) {
    const rPhase = seededAt(config.seed, i * 3 + 1)();
    const rAngle = seededAt(config.seed, i * 3 + 2)();
    const rJitter = seededAt(config.seed, i * 3 + 3)();
    const phase = rPhase * config.lifespan;
    const age = (((t - phase) % config.lifespan) + config.lifespan) % config.lifespan;
    const life = config.lifespan > 0 ? age / config.lifespan : 0;
    const angle = (presetAngleDeg(config.preset, rAngle) * Math.PI) / 180;
    const speed = config.speed * (0.65 + rJitter * 0.7);
    const dist = presetDistance(config.preset, speed, age, config.lifespan);
    const drift = config.preset === 'cursed' ? Math.sin(age * 2 + rJitter * 10) * 6 : 0;
    const x = Math.cos(angle) * dist + drift;
    const y = Math.sin(angle) * dist;
    const fadeIn = config.preset === 'explosion' ? Math.min(1, life / 0.12) : 1;
    const opacity = Math.max(0, (1 - life) * fadeIn);
    const size = config.size * (0.5 + rJitter * 0.6) * (1 - life * 0.35);
    out.push({ x, y, size, opacity, color: lerpColor(config.colorStart, config.colorEnd, life) });
  }
  return out;
}
