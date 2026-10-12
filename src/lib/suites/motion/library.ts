/**
 * The asset library: reusable building blocks a project can pull in instead of building from scratch —
 * drag-drop prop shapes, background colour presets, pre-animated VFX "stickers" (particle bundles), and a
 * portable JSON form of any layer (so a hand-built character or prop can be saved once and reused across
 * projects, or shared as a file). Nothing here touches storage — that's the UI's job (localStorage/
 * IndexedDB); this module is pure data and pure transforms, so it's fully Node-testable.
 */
import { newId, newLayer, type MotionLayer, type MotionProject } from './project.ts';
import type { ParticlePreset } from './particles.ts';

// ── prop shapes ──────────────────────────────────────────────────────────────

export interface PropPreset {
  id: string;
  name: string;
  kind: 'rect' | 'circle' | 'text';
  w: number;
  h: number;
  color: string;
  text?: string;
}

export const PROP_PRESETS: PropPreset[] = [
  { id: 'rock', name: 'Rock', kind: 'circle', w: 70, h: 50, color: '#6b6457' },
  { id: 'cloud', name: 'Cloud', kind: 'circle', w: 120, h: 50, color: '#e8ecf4' },
  { id: 'sun', name: 'Sun', kind: 'circle', w: 90, h: 90, color: '#ffd23f' },
  { id: 'star', name: 'Star', kind: 'text', w: 60, h: 60, color: '#ffe066', text: '★' },
  { id: 'heart', name: 'Heart', kind: 'text', w: 60, h: 60, color: '#ff5c7a', text: '♥' },
  { id: 'sword', name: 'Sword', kind: 'rect', w: 14, h: 120, color: '#c9d3e0' },
  { id: 'plank', name: 'Wood plank', kind: 'rect', w: 160, h: 24, color: '#8a5a33' },
  { id: 'speech', name: 'Speech bubble', kind: 'text', w: 140, h: 70, color: '#ffffff', text: '...' },
];

/** A prop preset as a fresh layer, positioned at a stage point (its own centre lands on x,y). */
export function propToLayer(preset: PropPreset, project: MotionProject, x: number, y: number): MotionLayer {
  const base = newLayer(preset.kind, project, preset.name);
  return {
    ...base,
    w: preset.w,
    h: preset.h,
    color: preset.color,
    text: preset.text ?? base.text,
    keyframes: base.keyframes.map((k) => ({ ...k, x: x - preset.w / 2, y: y - preset.h / 2 })),
  };
}

// ── background presets ───────────────────────────────────────────────────────

export interface BackgroundPreset {
  id: string;
  name: string;
  color: string;
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { id: 'void', name: 'Void', color: '#111318' },
  { id: 'night-sky', name: 'Night Sky', color: '#0b1130' },
  { id: 'sunset', name: 'Sunset', color: '#3a1a2b' },
  { id: 'forest', name: 'Forest', color: '#13241a' },
  { id: 'paper', name: 'Paper', color: '#f4ecd8' },
  { id: 'storm', name: 'Storm', color: '#232833' },
  { id: 'cursed', name: 'Cursed', color: '#140a1f' },
  { id: 'white', name: 'White', color: '#ffffff' },
];

// ── VFX stickers (pre-animated particle bundles) ────────────────────────────

export interface VfxSticker {
  id: string;
  name: string;
  preset: ParticlePreset;
}

export const VFX_STICKERS: VfxSticker[] = [
  { id: 'sticker-aura', name: 'Energy Aura', preset: 'aura' },
  { id: 'sticker-fire', name: 'Fireball', preset: 'fire' },
  { id: 'sticker-electric', name: 'Static Shock', preset: 'electric' },
  { id: 'sticker-explosion', name: 'Boom', preset: 'explosion' },
  { id: 'sticker-cursed', name: 'Cursed Burst', preset: 'cursed' },
];

// ── portable layer JSON (save/reuse a character or prop, export/import) ────────

/** A layer, stripped of anything that only makes sense inside its original project (its id, its folder). Everything else — including a full rig/paint/particles payload — travels as-is, since none of it references other layers. */
export type PortableLayer = Omit<MotionLayer, 'id' | 'groupId'>;

export function serializeLayer(layer: MotionLayer): PortableLayer {
  const { id, groupId, ...rest } = structuredCloneLike(layer);
  return rest;
}

/** Re-materialise a portable layer into a brand new layer — a fresh id, fresh keyframe ids, fresh paint-stroke ids (so two instances of the same saved character never share identity), landing at (x,y) if given. */
export function instantiateLayer(portable: PortableLayer, x?: number, y?: number): MotionLayer {
  const clone = structuredCloneLike(portable) as Omit<MotionLayer, 'id' | 'groupId'>;
  const dx = x !== undefined ? x - (clone.keyframes[0]?.x ?? 0) : 0;
  const dy = y !== undefined ? y - (clone.keyframes[0]?.y ?? 0) : 0;
  const layer: MotionLayer = {
    ...clone,
    id: newId('layer'),
    groupId: null,
    keyframes: clone.keyframes.map((k) => ({ ...k, id: newId('kf'), x: k.x + dx, y: k.y + dy })),
  };
  if (layer.paint) {
    layer.paint = {
      ...layer.paint,
      frames: layer.paint.frames.map((f) => ({
        strokes: f.strokes.map((s) => ({ ...s, id: newId('stroke') })),
      })),
    };
  }
  return layer;
}

export function layerToJson(layer: MotionLayer): string {
  return JSON.stringify(serializeLayer(layer), null, 2);
}

/** Parses JSON saved by `layerToJson` back into a portable layer — returns null on anything that isn't a plausible layer object, rather than throwing, since this is meant to read untrusted pasted/uploaded text. */
export function layerFromJson(json: string): PortableLayer | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.kind !== 'string' || !Array.isArray(d.keyframes)) return null;
  return d as unknown as PortableLayer;
}

function structuredCloneLike<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
