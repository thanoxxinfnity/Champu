/**
 * Motion Studio: a layers-and-keyframes timeline for motion graphics, a virtual camera, a particle/VFX
 * engine and a stickman bone rig on top of it.
 *
 * This file is the pure part — the project shape, the interpolation math, and three code exporters (CSS,
 * GSAP, a standalone HTML page). It renders nothing itself: render.ts reads `valueAt()` (and the sibling
 * `*At()` functions in camera.ts/particles.ts/rig.ts) every frame to draw the canvas stage, live or for
 * GIF/video export, and the same functions are what the exporters are checked against.
 *
 * Earlier note, for the record: Chomugiri had removed HTML→video rendering once (v3.40 → v3.41, see
 * suites/web/motion.ts) in favour of motion *guidance* only. The GIF/MP4 export added for the VFX/rig
 * upgrade (exportMedia.ts) is a deliberate, explicit reversal of that, asked for directly — it renders
 * real pixel frames (particles, blend modes, camera shake) that cannot be expressed as portable CSS/GSAP,
 * so it is a different deliverable from the three code exporters below, not a replacement for them.
 */
import type { ZipEntry } from '../../zip.ts';
import type { CustomEase, Easing } from './easing.ts';
import { cubicBezierEase, easeFn } from './easing.ts';
import type { CameraKeyframe, ImpactFrame, ShakeEvent, SpeedRamp } from './camera.ts';
import { defaultCamera } from './camera.ts';
import type { ParticleConfig } from './particles.ts';
import { newParticleConfig } from './particles.ts';
import type { RigConfig } from './rig.ts';
import { newRig } from './rig.ts';
import type { AudioTrack } from './audio.ts';
import type { PaintLayerData } from './paint.ts';
import { newPaintLayerData } from './paint.ts';
import type { SpeedLineConfig } from './speedlines.ts';
import { newSpeedLineConfig } from './speedlines.ts';

export type { CustomEase, Easing } from './easing.ts';
export { EASINGS, cubicBezierEase, easeFn } from './easing.ts';
export type { CameraKeyframe, ImpactFrame, ShakeEvent, SpeedRamp } from './camera.ts';
export type { ParticleConfig, ParticlePreset } from './particles.ts';
export type { BoneDef, RigConfig } from './rig.ts';
export type { AudioTrack } from './audio.ts';
export type { PaintLayerData, PaintFrame, PaintStroke } from './paint.ts';
export type { SpeedLineConfig, SpeedLineKind } from './speedlines.ts';

export type LayerKind = 'text' | 'rect' | 'circle' | 'image' | 'particles' | 'rig' | 'paint' | 'speedlines';
export type BlendMode = 'normal' | 'add' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'color-dodge';
export const BLEND_MODES: BlendMode[] = ['normal', 'add', 'multiply', 'screen', 'overlay', 'soft-light', 'color-dodge'];

export interface MotionBlurConfig {
  enabled: boolean;
  /** How far the trail reaches per unit of speed. */
  strength: number;
  /** Number of fading ghost copies. */
  samples: number;
}

/** A dramatic whole-screen moment: chromatic aberration, a glitch, a screen invert, or a space-bend warp. */
export type PostEffectKind = 'chromatic' | 'glitch' | 'invert' | 'warp';
export interface PostEffect {
  id: string;
  t: number;
  duration: number;
  kind: PostEffectKind;
  /** Meaning depends on kind: pixel offset (chromatic), intensity 0-1 (glitch), ignored (invert), pull strength (warp). */
  strength: number;
}

/** A folder a layer can be filed under — collapsing/moving/dimming it moves every layer inside together. */
export interface LayerGroup {
  id: string;
  name: string;
  collapsed: boolean;
  opacity: number;
  visible: boolean;
}

export interface OnionSkinConfig {
  enabled: boolean;
  /** How many frames before/after to ghost, 0-5 each. */
  beforeCount: number;
  afterCount: number;
  beforeColor: string;
  afterColor: string;
  /** Base opacity of the nearest ghost frame; farther frames fade further. */
  opacity: number;
  /** Seconds between each onion-skin step. */
  frameStep: number;
}

export interface Keyframe {
  id: string;
  /** Seconds from the start of the project. */
  t: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  /** Eases the segment that leaves this keyframe, toward the next one — ignored in favour of `customEase` when that's set. */
  easing: Easing;
  /** A hand-shaped timing curve for the segment leaving this keyframe (the graph editor), overriding `easing` when present. */
  customEase?: CustomEase;
  /** A motion-path handle: offset (in stage px) from this keyframe's own x/y, curving the path leaving it toward the next keyframe — a straight line when absent. */
  pathOut?: { dx: number; dy: number };
  /** A motion-path handle: offset from this keyframe's own x/y, curving the path arriving into it from the previous keyframe — a straight line when absent. */
  pathIn?: { dx: number; dy: number };
  /** Only meaningful on a 'rig' layer: boneId → angle in degrees at this instant (see rig.ts). */
  pose?: Record<string, number>;
}

export interface MotionLayer {
  id: string;
  name: string;
  kind: LayerKind;
  /** 'text' content, or ignored. */
  text: string;
  /** Fill/text colour. */
  color: string;
  /** Base size in stage pixels, before a keyframe's `scale`. */
  w: number;
  h: number;
  /** 'image' source — a data: URL, so a project is one portable JSON blob. */
  src?: string;
  /** How this layer composites onto the ones under it. */
  blendMode: BlendMode;
  /** Only present when kind === 'particles'. */
  particles?: ParticleConfig;
  /** Only present when kind === 'rig'. */
  rig?: RigConfig;
  /** Only present when kind === 'paint'. */
  paint?: PaintLayerData;
  /** Only present when kind === 'speedlines'. */
  speedlines?: SpeedLineConfig;
  /** A trailing-ghost blur derived from this layer's own keyframed motion. */
  motionBlur: MotionBlurConfig;
  /** Sorted by `t`; never empty — a new layer gets one keyframe at t=0. */
  keyframes: Keyframe[];
  /** Hidden layers are skipped entirely at render/export time. */
  visible: boolean;
  /** Which folder (see LayerGroup) this layer is filed under, if any. */
  groupId: string | null;
  /** Clipped to the alpha of the layer directly below it in the same group/top level. */
  clipToBelow: boolean;
  /** How much of the camera's pan this layer follows: 1 = moves fully with the camera (normal), <1 = a background that pans less (further away), >1 = a foreground that pans more (closer) — zoom/rotation/shake stay shared across every layer regardless. */
  parallax: number;
}

export interface MotionProject {
  title: string;
  width: number;
  height: number;
  duration: number;
  background: string;
  layers: MotionLayer[];
  groups: LayerGroup[];
  /** Pan/zoom/rotate, keyframed the same way a layer is. Sorted by t; never empty. */
  camera: CameraKeyframe[];
  shakes: ShakeEvent[];
  impacts: ImpactFrame[];
  speedRamps: SpeedRamp[];
  onionSkin: OnionSkinConfig;
  audio?: AudioTrack;
  /** Saved HSV swatches, most-recently-used first. */
  palette: string[];
  /** Whole-screen chromatic-aberration/glitch/invert/warp bursts, timed like impact frames. */
  postEffects: PostEffect[];
  /** Named, coloured points on the timeline for navigation — purely organisational, never affects rendering. */
  markers: TimelineMarker[];
}

export interface TimelineMarker {
  id: string;
  t: number;
  label: string;
  color: string;
}

export function addMarker(project: MotionProject, t: number, label = 'Marker'): MotionProject {
  const marker: TimelineMarker = { id: newId('marker'), t: Math.max(0, t), label, color: '#ffd23f' };
  return { ...project, markers: [...project.markers, marker].sort((a, b) => a.t - b.t) };
}
export function updateMarker(project: MotionProject, id: string, patch: Partial<Omit<TimelineMarker, 'id'>>): MotionProject {
  return { ...project, markers: project.markers.map((m) => (m.id === id ? { ...m, ...patch } : m)).sort((a, b) => a.t - b.t) };
}
export function removeMarker(project: MotionProject, id: string): MotionProject {
  return { ...project, markers: project.markers.filter((m) => m.id !== id) };
}

export const STAGE_PRESETS: Array<{ label: string; w: number; h: number }> = [
  { label: '16:9', w: 960, h: 540 },
  { label: '1:1', w: 640, h: 640 },
  { label: '9:16', w: 405, h: 720 },
];

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultOnionSkin(): OnionSkinConfig {
  return { enabled: false, beforeCount: 1, afterCount: 1, beforeColor: '#2ad4ff', afterColor: '#ff5c8a', opacity: 0.35, frameStep: 1 / 12 };
}
export const DEFAULT_PALETTE: string[] = ['#f4f5f7', '#1a1a1a', '#ff5c5c', '#ffb14e', '#ffe14e', '#5cffb0', '#5c8cff', '#8a5cff'];

export function defaultMotionBlur(): MotionBlurConfig {
  return { enabled: false, strength: 0.08, samples: 5 };
}

export function emptyProject(): MotionProject {
  return {
    title: 'My motion', width: 960, height: 540, duration: 4, background: '#111318', layers: [], groups: [],
    camera: defaultCamera(), shakes: [], impacts: [], speedRamps: [],
    onionSkin: defaultOnionSkin(), palette: [...DEFAULT_PALETTE], postEffects: [], markers: [],
  };
}

/**
 * Fill in anything missing from a project saved before this field existed — every field above `layers`
 * is newer than the first shipped version, so JSON loaded from storage may be missing any of them (the
 * input is `unknown`, not `Partial<MotionProject>`, because this is exactly the system boundary where
 * trusting the compile-time type would be wrong: the data came from IndexedDB, not from this module).
 */
export function normalizeProject(raw: unknown): MotionProject {
  const p = (raw ?? {}) as Record<string, unknown>;
  const rawLayers = Array.isArray(p.layers) ? (p.layers as Array<Record<string, unknown>>) : [];
  const camera = Array.isArray(p.camera) ? (p.camera as CameraKeyframe[]) : [];
  const rawOnion = p.onionSkin as Partial<OnionSkinConfig> | undefined;
  const fallbackOnion = defaultOnionSkin();
  return {
    title: typeof p.title === 'string' ? p.title : 'My motion',
    width: typeof p.width === 'number' ? p.width : 960,
    height: typeof p.height === 'number' ? p.height : 540,
    duration: typeof p.duration === 'number' ? p.duration : 4,
    background: typeof p.background === 'string' ? p.background : '#111318',
    layers: rawLayers.map((l) => ({
      blendMode: 'normal' as BlendMode, visible: true, groupId: null, clipToBelow: false, motionBlur: defaultMotionBlur(), parallax: 1, ...l,
    }) as MotionLayer),
    groups: Array.isArray(p.groups) ? (p.groups as LayerGroup[]) : [],
    camera: camera.length > 0 ? camera : defaultCamera(),
    shakes: Array.isArray(p.shakes) ? (p.shakes as ShakeEvent[]) : [],
    impacts: Array.isArray(p.impacts) ? (p.impacts as ImpactFrame[]) : [],
    speedRamps: Array.isArray(p.speedRamps) ? (p.speedRamps as SpeedRamp[]) : [],
    onionSkin: rawOnion ? { ...fallbackOnion, ...rawOnion } : fallbackOnion,
    audio: p.audio as AudioTrack | undefined,
    palette: Array.isArray(p.palette) && p.palette.length > 0 ? (p.palette as string[]) : [...DEFAULT_PALETTE],
    postEffects: Array.isArray(p.postEffects) ? (p.postEffects as PostEffect[]) : [],
    markers: Array.isArray(p.markers) ? (p.markers as TimelineMarker[]) : [],
  };
}

const BASE_KEYFRAME: Omit<Keyframe, 'id' | 't'> = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, easing: 'easeOut' };

const KIND_DEFAULT: Record<Exclude<LayerKind, 'paint'>, { w: number; h: number; color: string; text: string }> = {
  text: { w: 320, h: 60, color: '#f4f5f7', text: 'Headline' },
  rect: { w: 140, h: 90, color: '#5b8cff', text: '' },
  circle: { w: 110, h: 110, color: '#ff8a5c', text: '' },
  image: { w: 200, h: 200, color: '#ffffff', text: '' },
  particles: { w: 160, h: 160, color: '#8a5cff', text: '' },
  rig: { w: 120, h: 180, color: '#f4f5f7', text: '' },
  speedlines: { w: 1, h: 1, color: '#ffffff', text: '' },
};

export function newLayer(kind: LayerKind, project: MotionProject, name?: string): MotionLayer {
  // A paint layer is a cel covering the whole stage, not a small positioned shape.
  const d = kind === 'paint' ? { w: project.width, h: project.height, color: '#1a1a1a', text: '' } : KIND_DEFAULT[kind];
  const cx = kind === 'paint' ? 0 : Math.round(project.width / 2 - d.w / 2);
  const cy = kind === 'paint' ? 0 : Math.round(project.height / 2 - d.h / 2);
  return {
    id: newId('layer'),
    name: name ?? `${kind[0]!.toUpperCase()}${kind.slice(1)} ${project.layers.length + 1}`,
    kind,
    text: d.text,
    color: d.color,
    w: d.w,
    h: d.h,
    blendMode: 'normal',
    visible: true,
    groupId: null,
    clipToBelow: false,
    parallax: 1,
    motionBlur: defaultMotionBlur(),
    ...(kind === 'particles' ? { particles: newParticleConfig('aura', Math.floor(Math.random() * 1e6)) } : {}),
    ...(kind === 'rig' ? { rig: newRig() } : {}),
    ...(kind === 'paint' ? { paint: newPaintLayerData(12) } : {}),
    ...(kind === 'speedlines' ? { speedlines: newSpeedLineConfig('radial', 0, 0, Math.floor(Math.random() * 1e6)) } : {}),
    keyframes: [{ ...BASE_KEYFRAME, id: newId('kf'), t: 0, x: cx, y: cy, easing: 'easeOut' }],
  };
}

export function addLayer(project: MotionProject, kind: LayerKind): MotionProject {
  return { ...project, layers: [...project.layers, newLayer(kind, project)] };
}

export function removeLayer(project: MotionProject, layerId: string): MotionProject {
  return { ...project, layers: project.layers.filter((l) => l.id !== layerId) };
}

export function updateLayer(project: MotionProject, layerId: string, patch: Partial<MotionLayer>): MotionProject {
  return { ...project, layers: project.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)) };
}

// ── layer groups (folders) ──────────────────────────────────────────────────

export function newGroup(project: MotionProject, name = 'Group'): MotionProject {
  const group: LayerGroup = { id: newId('group'), name, collapsed: false, opacity: 1, visible: true };
  return { ...project, groups: [...project.groups, group] };
}
export function removeGroup(project: MotionProject, groupId: string): MotionProject {
  return {
    ...project,
    groups: project.groups.filter((g) => g.id !== groupId),
    layers: project.layers.map((l) => (l.groupId === groupId ? { ...l, groupId: null } : l)),
  };
}
export function updateGroup(project: MotionProject, groupId: string, patch: Partial<LayerGroup>): MotionProject {
  return { ...project, groups: project.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)) };
}
export function setLayerGroup(project: MotionProject, layerId: string, groupId: string | null): MotionProject {
  return updateLayer(project, layerId, { groupId });
}

/** Insert or replace (within 1/120s — "the same instant") a keyframe, keeping the array sorted by `t`. */
export function setKeyframe(layer: MotionLayer, t: number, props: Partial<Omit<Keyframe, 'id' | 't'>>): MotionLayer {
  const near = layer.keyframes.find((k) => Math.abs(k.t - t) < 1 / 120);
  const base: Keyframe = near ?? { ...valueAt(layer, t), id: newId('kf'), t, easing: 'easeOut' };
  const kf: Keyframe = { ...base, ...props, t: Math.max(0, t) };
  const rest = layer.keyframes.filter((k) => k !== near);
  const keyframes = [...rest, kf].sort((a, b) => a.t - b.t);
  return { ...layer, keyframes };
}

export function removeKeyframe(layer: MotionLayer, keyframeId: string): MotionLayer {
  if (layer.keyframes.length <= 1) return layer; // a layer always has somewhere to be
  return { ...layer, keyframes: layer.keyframes.filter((k) => k.id !== keyframeId) };
}

export function moveKeyframe(layer: MotionLayer, keyframeId: string, t: number): MotionLayer {
  const kf = layer.keyframes.find((k) => k.id === keyframeId);
  if (!kf) return layer;
  const keyframes = layer.keyframes.filter((k) => k.id !== keyframeId).concat({ ...kf, t: Math.max(0, t) }).sort((a, b) => a.t - b.t);
  return { ...layer, keyframes };
}

const NUMERIC_KEYS = ['x', 'y', 'scale', 'rotation', 'opacity'] as const;
export type Transform = { x: number; y: number; scale: number; rotation: number; opacity: number };

/** Where a layer is at time `t`: held at the first keyframe before it starts, held at the last after it ends. */
export function valueAt(layer: MotionLayer, t: number): Transform {
  const kfs = layer.keyframes;
  if (kfs.length === 0) return { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
  if (t <= kfs[0]!.t) return pick(kfs[0]!);
  if (t >= kfs[kfs.length - 1]!.t) return pick(kfs[kfs.length - 1]!);
  let i = 0;
  while (i < kfs.length - 1 && kfs[i + 1]!.t <= t) i++;
  const a = kfs[i]!, b = kfs[i + 1]!;
  const span = b.t - a.t;
  const raw = span <= 0 ? 1 : (t - a.t) / span;
  const p = a.customEase ? cubicBezierEase(a.customEase.x1, a.customEase.y1, a.customEase.x2, a.customEase.y2)(raw) : easeFn(a.easing)(raw);
  const out: Partial<Transform> = {};
  for (const k of NUMERIC_KEYS) out[k] = a[k] + (b[k] - a[k]) * p;
  if (a.pathOut || b.pathIn) {
    const pt = motionPathPoint(a.x, a.y, a.pathOut, b.x, b.y, b.pathIn, p);
    out.x = pt.x;
    out.y = pt.y;
  }
  return out as Transform;
}
function pick(k: Keyframe): Transform {
  return { x: k.x, y: k.y, scale: k.scale, rotation: k.rotation, opacity: k.opacity };
}

/**
 * A cubic-bezier motion path between two keyframes' x/y: `pathOut` is the handle leaving `(ax,ay)`,
 * `pathIn` the handle arriving at `(bx,by)` — either defaulting to zero offset (a straight line from that
 * end), so a layer with only one handle set still curves smoothly rather than snapping. `p` is the already
 * -eased 0..1 progress (the same curve timing a straight-line move would use — only the spatial path
 * changes, not the speed along it).
 */
export function motionPathPoint(
  ax: number, ay: number, pathOut: { dx: number; dy: number } | undefined,
  bx: number, by: number, pathIn: { dx: number; dy: number } | undefined, p: number,
): { x: number; y: number } {
  // with no handles at all there's nothing to curve — a plain straight-line lerp, not a degenerate cubic
  // bezier (control points sitting exactly on the endpoints stay geometrically on the line, but distort
  // the speed along it into an unwanted ease, which a caller with no handles never asked for).
  if (!pathOut && !pathIn) return { x: ax + (bx - ax) * p, y: ay + (by - ay) * p };
  const c1x = ax + (pathOut?.dx ?? 0), c1y = ay + (pathOut?.dy ?? 0);
  const c2x = bx + (pathIn?.dx ?? 0), c2y = by + (pathIn?.dy ?? 0);
  const u = 1 - p;
  const x = u * u * u * ax + 3 * u * u * p * c1x + 3 * u * p * p * c2x + p * p * p * bx;
  const y = u * u * u * ay + 3 * u * u * p * c1y + 3 * u * p * p * c2y + p * p * p * by;
  return { x, y };
}

// ── export ───────────────────────────────────────────────────────────────────

const slug = (s: string, taken: Set<string> = new Set()): string => {
  const base = (s || 'layer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'layer';
  let out = base;
  for (let i = 2; taken.has(out); i++) out = `${base}-${i}`;
  taken.add(out);
  return out;
};

const CSS_EASE: Record<Easing, string> = {
  linear: 'linear', ease: 'ease', easeIn: 'cubic-bezier(.32,0,.67,0)', easeOut: 'cubic-bezier(.33,1,.68,1)',
  easeInOut: 'cubic-bezier(.65,0,.35,1)', back: 'cubic-bezier(.34,1.56,.64,1)', bounce: 'cubic-bezier(.22,1.6,.36,1)',
};
const GSAP_EASE: Record<Easing, string> = {
  linear: 'none', ease: 'power1.inOut', easeIn: 'power3.in', easeOut: 'power3.out', easeInOut: 'power3.inOut', back: 'back.out(1.7)', bounce: 'bounce.out',
};

function layerBaseCss(layer: MotionLayer, className: string): string {
  const shape = layer.kind === 'circle' ? 'border-radius:50%;' : '';
  const fill = layer.kind === 'image' ? '' : `background:${layer.kind === 'text' ? 'transparent' : layer.color};`;
  const font = layer.kind === 'text' ? `color:${layer.color};font:700 ${Math.round(layer.h * 0.6)}px/${layer.h}px system-ui,sans-serif;white-space:nowrap;` : '';
  return `.${className}{position:absolute;left:0;top:0;width:${layer.w}px;height:${layer.h}px;${fill}${shape}${font}transform-origin:center;will-change:transform,opacity;}`;
}

/** Layers the CSS/GSAP/HTML code exporters can represent — a canvas-only particle pool or bone rig has no portable DOM equivalent. */
function portableLayers(project: MotionProject): MotionLayer[] {
  return project.layers.filter((l) => l.kind !== 'particles' && l.kind !== 'rig' && l.kind !== 'paint' && l.kind !== 'speedlines');
}

/** One @keyframes block per layer, with a timing-function set per stop so each segment keeps its own ease. */
export function exportCss(project: MotionProject): string {
  const taken = new Set<string>();
  const parts: string[] = [`.motion-stage{position:relative;width:${project.width}px;height:${project.height}px;background:${project.background};overflow:hidden;}`];
  for (const layer of portableLayers(project)) {
    const cls = slug(layer.name, taken);
    parts.push(layerBaseCss(layer, cls));
    const stops = layer.keyframes.map((k) => {
      const pct = project.duration > 0 ? (k.t / project.duration) * 100 : 0;
      return `  ${pct.toFixed(2)}%{transform:translate(${k.x}px,${k.y}px) rotate(${k.rotation}deg) scale(${k.scale});opacity:${k.opacity};animation-timing-function:${CSS_EASE[k.easing]};}`;
    });
    parts.push(`@keyframes ${cls}-move{\n${stops.join('\n')}\n}`);
    parts.push(`.${cls}{animation:${cls}-move ${project.duration}s infinite;}`);
  }
  return parts.join('\n\n');
}

function escHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** The elements the CSS/standalone exports both need: one tagged div per layer. */
function layerElements(project: MotionProject, classesOf: (l: MotionLayer) => string): string {
  return portableLayers(project)
    .map((l) => {
      const cls = classesOf(l);
      if (l.kind === 'text') return `  <div class="${cls}">${escHtml(l.text)}</div>`;
      if (l.kind === 'image' && l.src) return `  <img class="${cls}" src="${escHtml(l.src)}" alt="">`;
      return `  <div class="${cls}"></div>`;
    })
    .join('\n');
}

/** A GSAP timeline: one `.fromTo`/`.to` chain per layer, each segment placed at its own absolute time. */
export function exportGsap(project: MotionProject): string {
  const taken = new Set<string>();
  const selectors = new Map<string, string>();
  for (const l of project.layers) selectors.set(l.id, `#${slug(l.name, taken)}`);
  const lines: string[] = [`const tl = gsap.timeline({ repeat: -1 });`];
  for (const layer of portableLayers(project)) {
    const sel = selectors.get(layer.id)!;
    const kfs = layer.keyframes;
    if (kfs.length === 0) continue;
    const k0 = kfs[0]!;
    lines.push(`tl.set("${sel}", { x: ${k0.x}, y: ${k0.y}, scale: ${k0.scale}, rotation: ${k0.rotation}, opacity: ${k0.opacity} }, 0);`);
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i]!, b = kfs[i + 1]!;
      const dur = Math.max(0, b.t - a.t);
      lines.push(`tl.to("${sel}", { x: ${b.x}, y: ${b.y}, scale: ${b.scale}, rotation: ${b.rotation}, opacity: ${b.opacity}, duration: ${dur}, ease: "${GSAP_EASE[a.easing]}" }, ${a.t});`);
    }
  }
  return lines.join('\n');
}

/** A single self-contained HTML page that plays itself on load and loops — open it, or send the link. */
export function exportHtml(project: MotionProject): string {
  const taken = new Set<string>();
  const classOf = new Map<string, string>();
  for (const l of project.layers) classOf.set(l.id, slug(l.name, taken));
  const css = exportCss({ ...project, layers: project.layers.map((l) => ({ ...l, id: l.id })) });
  const els = layerElements(project, (l) => classOf.get(l.id)!);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escHtml(project.title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;min-height:100%;display:flex;align-items:center;justify-content:center;background:#0b0c10;}${css}</style>
</head><body>
<div class="motion-stage">
${els}
</div>
</body></html>`;
}

export function exportZip(project: MotionProject): ZipEntry[] {
  const base = slug(project.title);
  return [
    { path: `${base}.html`, content: exportHtml(project) },
    { path: `${base}.css`, content: exportCss(project) },
    { path: `${base}.gsap.js`, content: exportGsap(project) },
    { path: `${base}.json`, content: `${JSON.stringify(project, null, 2)}\n` },
  ];
}
