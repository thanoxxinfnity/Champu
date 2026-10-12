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

const COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over', add: 'lighter', multiply: 'multiply', screen: 'screen',
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

const ONION_DT = 1 / 12;

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

  const onionOn = opts.onionSkin ?? project.onionSkin.enabled;
  if (onionOn) {
    drawGhost(ctx, project, t - ONION_DT, project.onionSkin.opacity, '#2ad4ff', opts);
    drawGhost(ctx, project, t + ONION_DT, project.onionSkin.opacity, '#ff5c8a', opts);
  }

  for (const layer of project.layers) {
    drawLayer(ctx, layer, t, opts);
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
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = 'source-over';
  for (const layer of project.layers) {
    ctx.save();
    ctx.globalAlpha = opacity * valueAt(layer, t).opacity;
    drawLayerShape(ctx, layer, t, opts, tint);
    ctx.restore();
  }
  ctx.restore();
}

function drawLayer(ctx: CanvasRenderingContext2D, layer: MotionLayer, t: number, opts: RenderOptions): void {
  const v = valueAt(layer, t);
  if (v.opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = v.opacity;
  ctx.globalCompositeOperation = COMPOSITE[layer.blendMode];
  drawLayerShape(ctx, layer, t, opts);
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
  }
  ctx.restore();
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
