/**
 * A paint layer: a traditional cel-animation flipbook, one array of vector strokes per drawn frame,
 * running at its own fps independent of the project's keyframe timeline (a drawn cartoon is usually on
 * 2s or 3s — every frame held for 2-3 ticks — not keyframed at arbitrary times the way a moving shape is).
 * Each stroke keeps its bezier nodes (vectorStroke.ts), so "drawn" strokes stay reshapeable after the
 * fact, the same as the brush/vector tools in a real paint program.
 */
import type { BrushSettings } from './brush.ts';
import type { BezierNode } from './vectorStroke.ts';

export interface PaintStroke {
  id: string;
  brush: BrushSettings;
  nodes: BezierNode[];
  /** 'draw' lays colour down; 'erase' cuts a hole in strokes beneath it on the same frame (object eraser). */
  mode: 'draw' | 'erase';
  /**
   * A flood-fill or gradient result instead of a brush stroke — a rasterised region (`nodes` is then
   * empty), positioned at (x,y) in the layer's own local space. Built once, drawn as a plain image after.
   */
  fill?: { dataUrl: string; x: number; y: number; w: number; h: number };
}

export interface PaintFrame {
  strokes: PaintStroke[];
}

export interface PaintLayerData {
  /** Frames per second this cel layer advances at — independent of the project's own frame rate. */
  fps: number;
  /** frames[i] is shown for t in [i/fps, (i+1)/fps); the last frame holds once t runs past the end. */
  frames: PaintFrame[];
  /** New strokes are masked to only paint over this layer's own already-opaque pixels. */
  alphaLock: boolean;
}

export function newPaintLayerData(fps = 12): PaintLayerData {
  return { fps, frames: [{ strokes: [] }], alphaLock: false };
}

/** Which frame index is showing at time `t` — held past the end, the same convention `valueAt` uses. */
export function paintFrameIndexAt(paint: PaintLayerData, t: number): number {
  if (paint.frames.length === 0) return 0;
  const i = Math.floor(Math.max(0, t) * paint.fps);
  return Math.max(0, Math.min(paint.frames.length - 1, i));
}

export function paintFrameAt(paint: PaintLayerData, t: number): PaintFrame {
  return paint.frames[paintFrameIndexAt(paint, t)] ?? { strokes: [] };
}

export function addStroke(paint: PaintLayerData, frameIndex: number, stroke: PaintStroke): PaintLayerData {
  const frames = paint.frames.map((f, i) => (i === frameIndex ? { strokes: [...f.strokes, stroke] } : f));
  return { ...paint, frames };
}

export function removeStroke(paint: PaintLayerData, frameIndex: number, strokeId: string): PaintLayerData {
  const frames = paint.frames.map((f, i) => (i === frameIndex ? { strokes: f.strokes.filter((s) => s.id !== strokeId) } : f));
  return { ...paint, frames };
}

export function updateStroke(paint: PaintLayerData, frameIndex: number, strokeId: string, patch: Partial<PaintStroke>): PaintLayerData {
  const frames = paint.frames.map((f, i) =>
    i === frameIndex ? { strokes: f.strokes.map((s) => (s.id === strokeId ? { ...s, ...patch } : s)) } : f,
  );
  return { ...paint, frames };
}

/** Insert a blank frame after `afterIndex` (or append if omitted) — "add a drawing frame". */
export function insertFrame(paint: PaintLayerData, afterIndex?: number): PaintLayerData {
  const at = afterIndex === undefined ? paint.frames.length : Math.min(paint.frames.length, afterIndex + 1);
  const frames = [...paint.frames];
  frames.splice(at, 0, { strokes: [] });
  return { ...paint, frames };
}

/** Duplicate a frame (the classic "draw on twos" workflow: copy the last pose, tweak it). */
export function duplicateFrame(paint: PaintLayerData, index: number): PaintLayerData {
  if (index < 0 || index >= paint.frames.length) return paint;
  const frames = [...paint.frames];
  frames.splice(index + 1, 0, { strokes: paint.frames[index]!.strokes.map((s) => ({ ...s, id: `${s.id}_copy_${Date.now().toString(36)}` })) });
  return { ...paint, frames };
}

export function deleteFrame(paint: PaintLayerData, index: number): PaintLayerData {
  if (paint.frames.length <= 1) return paint; // a paint layer always has somewhere to draw
  return { ...paint, frames: paint.frames.filter((_, i) => i !== index) };
}

/** Repeat a frame `times` extra times in place — "hold" a drawing longer without changing the layer's fps. */
export function holdFrame(paint: PaintLayerData, index: number, times: number): PaintLayerData {
  if (index < 0 || index >= paint.frames.length || times <= 0) return paint;
  const frames = [...paint.frames];
  const copies = Array.from({ length: times }, () => ({ strokes: paint.frames[index]!.strokes.map((s) => ({ ...s, id: `${s.id}_hold_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` })) }));
  frames.splice(index + 1, 0, ...copies);
  return { ...paint, frames };
}

/** Play the frames back to front — a quick way to get a return trip (an in-breath after an out-breath) without redrawing anything. */
export function reverseFrames(paint: PaintLayerData): PaintLayerData {
  return { ...paint, frames: [...paint.frames].reverse() };
}

/** Forward then backward (excluding the two end frames from being doubled) — a seamless back-and-forth loop, e.g. a blink or an idle sway. */
export function pingPongFrames(paint: PaintLayerData): PaintLayerData {
  if (paint.frames.length <= 2) return { ...paint, frames: [...paint.frames, ...[...paint.frames].reverse()] };
  const backward = [...paint.frames].slice(0, -1).reverse().slice(0, -1);
  return { ...paint, frames: [...paint.frames, ...backward] };
}

/**
 * Resample the frame sequence to exactly `newCount` frames (repeating or dropping frames as evenly as
 * possible, nearest-neighbour) — stretching a 6-frame cycle out to 12 for a slower take, or squashing it
 * down for a faster one, without having to redraw anything or touch the layer's fps.
 */
export function stretchFrames(paint: PaintLayerData, newCount: number): PaintLayerData {
  const n = Math.max(1, Math.round(newCount));
  if (paint.frames.length === 0) return paint;
  const frames: PaintFrame[] = [];
  for (let i = 0; i < n; i++) {
    const srcIndex = Math.min(paint.frames.length - 1, Math.floor((i * paint.frames.length) / n));
    frames.push({ strokes: paint.frames[srcIndex]!.strokes.map((s) => ({ ...s, id: `${s.id}_str_${Date.now().toString(36)}_${i}` })) });
  }
  return { ...paint, frames };
}
