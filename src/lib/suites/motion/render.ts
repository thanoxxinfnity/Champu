/**
 * The one frame-drawing function behind everything Motion Studio shows: the live stage, onion-skin
 * ghosts, and every GIF/video frame sampled for export. Drawing from a single function here is what
 * guarantees export looks exactly like the preview — there is no separate "render for export" path to
 * drift out of sync with it.
 *
 * It needs a real `CanvasRenderingContext2D` (2D canvas, not WebGL), so it only runs in the browser —
 * nothing in this file is covered by the Node test suite the way project.ts/particles.ts/rig.ts/camera.ts
 * are; it is instead exercised live, through Playwright, the way any other canvas drawing code here is.
 */
import { valueAt, type MotionLayer, type MotionProject, type BlendMode } from './project.ts';
import { cameraAt, impactAt, shakeOffsetAt } from './camera.ts';
import { particlesAt } from './particles.ts';
import { computeRigPose, poseAt, type BonePose } from './rig.ts';
import { easeFn } from './easing.ts';
import { strokeToDabs, type BrushSettings, type Dab, type StrokePoint } from './brush.ts';
import { bezierNodesToPolyline } from './vectorStroke.ts';
import { paintFrameAt } from './paint.ts';

const COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over', add: 'lighter', multiply: 'multiply', screen: 'screen',
  overlay: 'overlay', 'soft-light': 'soft-light', 'color-dodge': 'color-dodge',
};

export interface RenderOptions {
  /** HTMLImageElement cache keyed by a layer's `src` — the caller owns loading/decoding images. */
  images?: Map<string, HTMLImageElement>;
  /** Draw a thin selection outline around this layer (skipped for export frames). */
  selectedLayerId?: string | null;
  /** Force onion-skin on/off instead of reading project.onionSkin.enabled (used by the toggle itself). */
  onionSkin?: boolean;
  /** Live secondary-motion pose per rig layer id (from the physics step loop), overriding keyframed pose. */
  physicsPose?: Map<string, Record<string, number>>;
  /**
   * Skip the camera pan/zoom/rotate/shake transform — used while editing (paused) so dragging a layer is
   * plain stage-pixel math, not an inverse of the camera matrix. Always applied for Play and for export.
   */
  applyCamera?: boolean;
}

export function groupOpacityOf(project: MotionProject, layer: MotionLayer): number {
  if (!layer.groupId) return 1;
  const g = project.groups.find((x) => x.id === layer.groupId);
  if (!g) return 1;
  return g.visible ? g.opacity : 0;
}

export function drawFrame(ctx: CanvasRenderingContext2D, project: MotionProject, t: number, opts: RenderOptions = {}): void {
  const { width, height, background } = project;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const impact = impactAt(project.impacts, t);
  const applyCamera = opts.applyCamera ?? true;
  const cam = applyCamera ? cameraAt(project.camera, t) : { x: 0, y: 0, zoom: 1, rotation: 0 };
  const shake = applyCamera ? shakeOffsetAt(project.shakes, t) : { x: 0, y: 0, rotation: 0 };

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(((cam.rotation + shake.rotation) * Math.PI) / 180);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-width / 2 - cam.x - shake.x, -height / 2 - cam.y - shake.y);

  if (impact?.style === 'bw') ctx.filter = 'grayscale(1) contrast(1.6) brightness(1.15)';

  const onion = project.onionSkin;
  const onionOn = opts.onionSkin ?? onion.enabled;
  if (onionOn) {
    for (let i = 1; i <= onion.beforeCount; i++) {
      drawGhost(ctx, project, t - onion.frameStep * i, onion.opacity / i, onion.beforeColor, opts);
    }
    for (let i = 1; i <= onion.afterCount; i++) {
      drawGhost(ctx, project, t + onion.frameStep * i, onion.opacity / i, onion.afterColor, opts);
    }
  }

  const layers = project.layers;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (!layer.visible) continue;
    const gOpacity = groupOpacityOf(project, layer);
    if (gOpacity <= 0) continue;
    const below = i > 0 ? layers[i - 1]! : null;
    if (layer.clipToBelow && below) drawLayerClipped(ctx, layer, below, t, opts, gOpacity);
    else drawLayer(ctx, layer, t, opts, gOpacity);
    if (layer.id === opts.selectedLayerId) drawSelectionOutline(ctx, layer, t);
  }

  ctx.filter = 'none';
  ctx.restore(); // camera transform

  if (impact?.style === 'flash') {
    const age = t - impact.t;
    const p = impact.duration > 0 ? 1 - age / impact.duration : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p)) * 0.92;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  ctx.restore();
}

function drawGhost(ctx: CanvasRenderingContext2D, project: MotionProject, t: number, opacity: number, tint: string, opts: RenderOptions): void {
  if (opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = 'source-over';
  for (const layer of project.layers) {
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = opacity * valueAt(layer, t).opacity;
    drawLayerShape(ctx, layer, t, opts, tint);
    ctx.restore();
  }
  ctx.restore();
}

function drawLayer(ctx: CanvasRenderingContext2D, layer: MotionLayer, t: number, opts: RenderOptions, groupOpacity = 1): void {
  const v = valueAt(layer, t);
  if (v.opacity <= 0 || groupOpacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = v.opacity * groupOpacity;
  ctx.globalCompositeOperation = COMPOSITE[layer.blendMode];
  drawLayerShape(ctx, layer, t, opts);
  ctx.restore();
}

// Two reusable offscreen canvases for clipping-mask compositing — module-level because drawFrame always
// runs to completion synchronously (nothing here ever awaits mid-frame), so there is no reentrant use to
// race against; two, not one, because a clip needs a separate surface for its content and its mask.
let scratchContent: HTMLCanvasElement | null = null;
let scratchMask: HTMLCanvasElement | null = null;
function getScratch(which: 'content' | 'mask', w: number, h: number): CanvasRenderingContext2D {
  let canvas = which === 'content' ? scratchContent : scratchMask;
  if (!canvas) { canvas = document.createElement('canvas'); if (which === 'content') scratchContent = canvas; else scratchMask = canvas; }
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const sctx = canvas.getContext('2d')!;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, w, h);
  return sctx;
}

/** Draw `layer`, masked to only show where `below` has coverage — a classic "clip to layer beneath" (Photoshop-style). */
function drawLayerClipped(ctx: CanvasRenderingContext2D, layer: MotionLayer, below: MotionLayer, t: number, opts: RenderOptions, groupOpacity: number): void {
  const v = valueAt(layer, t);
  if (v.opacity <= 0 || groupOpacity <= 0) return;
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const contentCtx = getScratch('content', w, h);
  contentCtx.globalCompositeOperation = 'source-over';
  drawLayerShape(contentCtx, layer, t, opts);

  const maskCtx = getScratch('mask', w, h);
  drawLayerShape(maskCtx, below, t, opts);

  contentCtx.globalCompositeOperation = 'destination-in';
  contentCtx.drawImage(maskCtx.canvas, 0, 0);

  ctx.save();
  ctx.globalAlpha = v.opacity * groupOpacity;
  ctx.globalCompositeOperation = COMPOSITE[layer.blendMode];
  ctx.drawImage(contentCtx.canvas, 0, 0);
  ctx.restore();
}

/** The shape only — caller sets alpha/blend mode (shared by the real draw and the onion-skin ghost). */
function drawLayerShape(ctx: CanvasRenderingContext2D, layer: MotionLayer, t: number, opts: RenderOptions, tintOverride?: string): void {
  const v = valueAt(layer, t);
  ctx.save();
  ctx.translate(v.x + layer.w / 2, v.y + layer.h / 2);
  ctx.rotate((v.rotation * Math.PI) / 180);
  ctx.scale(v.scale, v.scale);

  switch (layer.kind) {
    case 'rect':
      ctx.fillStyle = tintOverride ?? layer.color;
      ctx.fillRect(-layer.w / 2, -layer.h / 2, layer.w, layer.h);
      break;
    case 'circle':
      ctx.fillStyle = tintOverride ?? layer.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, layer.w / 2, layer.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'text':
      ctx.fillStyle = tintOverride ?? layer.color;
      ctx.font = `700 ${Math.round(layer.h * 0.6)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(layer.text, 0, 0);
      break;
    case 'image': {
      const img = layer.src ? opts.images?.get(layer.src) : undefined;
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, -layer.w / 2, -layer.h / 2, layer.w, layer.h);
      } else {
        ctx.strokeStyle = tintOverride ?? '#666a74';
        ctx.strokeRect(-layer.w / 2, -layer.h / 2, layer.w, layer.h);
      }
      break;
    }
    case 'particles':
      if (layer.particles) drawParticles(ctx, layer.particles, t, tintOverride);
      break;
    case 'rig':
      if (layer.rig) drawRig(ctx, layer, t, opts, tintOverride);
      break;
    case 'paint':
      if (layer.paint) drawPaint(ctx, layer.paint, t, tintOverride, opts.images);
      break;
  }
  ctx.restore();
}

function drawDab(ctx: CanvasRenderingContext2D, d: Dab, kind: string, color: string): void {
  const cx = d.x + d.jitter, cy = d.y - d.jitter;
  ctx.globalAlpha = d.opacity;
  if (kind === 'airbrush' || kind === 'watercolor' || kind === 'neon') {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, d.radius);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = color;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, d.radius, 0, Math.PI * 2);
  ctx.fill();
}

/** Draws a paint layer's current frame: every stroke's bezier nodes → dabs → stamped circles (or a rasterised fill/gradient image), erase strokes cutting into what came before them on the same frame. */
function drawPaint(ctx: CanvasRenderingContext2D, paint: NonNullable<MotionLayer['paint']>, t: number, tintOverride?: string, images?: Map<string, HTMLImageElement>): void {
  const frame = paintFrameAt(paint, t);
  for (const stroke of frame.strokes) {
    if (stroke.fill) {
      const img = images?.get(stroke.fill.dataUrl);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.save();
        if (stroke.mode === 'erase') ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(img, stroke.fill.x, stroke.fill.y, stroke.fill.w, stroke.fill.h);
        ctx.restore();
      }
      continue;
    }
    const points = bezierNodesToPolyline(stroke.nodes, 10);
    const dabs = strokeToDabs(points, stroke.brush, 1);
    ctx.save();
    if (stroke.mode === 'erase') ctx.globalCompositeOperation = 'destination-out';
    else if (stroke.brush.kind === 'neon') ctx.globalCompositeOperation = 'lighter';
    for (const d of dabs) drawDab(ctx, d, stroke.brush.kind, tintOverride ?? stroke.brush.color);
    ctx.restore();
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, config: NonNullable<MotionLayer['particles']>, t: number, tintOverride?: string): void {
  const pool = particlesAt(config, t);
  for (const p of pool) {
    if (p.opacity <= 0 || p.size <= 0) continue;
    ctx.save();
    ctx.globalAlpha = p.opacity;
    ctx.fillStyle = tintOverride ?? p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawRig(ctx: CanvasRenderingContext2D, layer: MotionLayer, t: number, opts: RenderOptions, tintOverride?: string): void {
  const rig = layer.rig!;
  const physics = opts.physicsPose?.get(layer.id);
  const angles = physics ?? poseAt(rig, layer.keyframes, t, easeFn(layer.keyframes[0]?.easing ?? 'linear'));
  const pose: BonePose[] = computeRigPose(rig, angles);
  // drawLayerShape has already translated/rotated/scaled to the layer's own centre — the rig's root
  // bones start at an offset from that centre, same as any other shape drawn inside this local space.
  ctx.save();
  ctx.translate(rig.originX, rig.originY);
  ctx.strokeStyle = tintOverride ?? layer.color;
  ctx.fillStyle = tintOverride ?? layer.color;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  for (const bone of pose) {
    ctx.beginPath();
    ctx.moveTo(bone.x, bone.y);
    ctx.lineTo(bone.endX, bone.endY);
    ctx.stroke();
  }
  for (const bone of pose) {
    ctx.beginPath();
    ctx.arc(bone.x, bone.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** The stroke currently being dragged out, not yet committed to the layer — drawn on top of a normal frame so the artist sees it live. Same local transform as any other layer content. */
export function drawStrokePreview(ctx: CanvasRenderingContext2D, layer: MotionLayer, t: number, points: StrokePoint[], brush: BrushSettings, mode: 'draw' | 'erase'): void {
  const v = valueAt(layer, t);
  ctx.save();
  ctx.translate(v.x + layer.w / 2, v.y + layer.h / 2);
  ctx.rotate((v.rotation * Math.PI) / 180);
  ctx.scale(v.scale, v.scale);
  if (mode === 'erase') ctx.globalCompositeOperation = 'destination-out';
  else if (brush.kind === 'neon') ctx.globalCompositeOperation = 'lighter';
  const dabs = strokeToDabs(points, brush, 1);
  for (const d of dabs) drawDab(ctx, d, brush.kind, brush.color);
  ctx.restore();
}

function drawSelectionOutline(ctx: CanvasRenderingContext2D, layer: MotionLayer, t: number): void {
  const v = valueAt(layer, t);
  ctx.save();
  ctx.translate(v.x + layer.w / 2, v.y + layer.h / 2);
  ctx.rotate((v.rotation * Math.PI) / 180);
  ctx.scale(v.scale, v.scale);
  ctx.strokeStyle = '#2ad4ff';
  ctx.lineWidth = 2 / Math.max(0.01, v.scale);
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(-layer.w / 2 - 4, -layer.h / 2 - 4, layer.w + 8, layer.h + 8);
  ctx.restore();
}
