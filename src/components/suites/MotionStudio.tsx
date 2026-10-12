'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSetting, setSetting } from '@/lib/db/history';
import { downloadBlob, downloadText, downloadZip } from '@/lib/zip';
import { SkillIcon } from '@/components/SkillIcon';
import {
  BLEND_MODES,
  DEFAULT_PALETTE,
  EASINGS,
  STAGE_PRESETS,
  addLayer,
  emptyProject,
  exportCss,
  exportGsap,
  exportHtml,
  exportZip,
  moveKeyframe,
  newGroup,
  newId,
  normalizeProject,
  removeGroup,
  removeKeyframe,
  removeLayer,
  removeMarker,
  setKeyframe,
  updateGroup,
  updateLayer,
  updateMarker,
  valueAt,
  type BlendMode,
  type Easing,
  type Keyframe,
  type LayerGroup,
  type LayerKind,
  type MotionBlurConfig,
  type MotionLayer,
  type MotionProject,
  type PostEffect,
  type PostEffectKind,
  type TimelineMarker,
} from '@/lib/suites/motion/project';
import { cubicBezierEase, type CustomEase } from '@/lib/suites/motion/easing';
import { easeFn } from '@/lib/suites/motion/easing';
import {
  cameraAt,
  effectiveRate,
  removeCameraKeyframe,
  setCameraKeyframe,
  type CameraTransform,
  type ImpactFrame,
  type ImpactStyle,
  type ShakeEvent,
  type SpeedRamp,
} from '@/lib/suites/motion/camera';
import { PARTICLE_PRESETS, newParticleConfig, type ParticlePreset } from '@/lib/suites/motion/particles';
import { computeRigPose, newRig, poseAt, stepPhysicsBone, stepRagdollAll, type DetachEvent, type PhysicsState } from '@/lib/suites/motion/rig';
import { generateWalkCycle, newGaitConfig, type GaitMode } from '@/lib/suites/motion/walkcycle';
import { drawFrame, drawStrokePreview, groupOpacityOf } from '@/lib/suites/motion/render';
import { pickVideoCodec, renderGif, renderVideo } from '@/lib/suites/motion/exportMedia';
import { peaksFromSamples, mixChannelsDown, type WaveformBucket } from '@/lib/suites/motion/audio';
import { jjkShowcaseProject } from '@/lib/suites/motion/presets';
import { newBrush, stabilizePoint, strokeToDabs, type BrushSettings, type StrokePoint } from '@/lib/suites/motion/brush';
import { bezierNodesToPolyline, vectorizeStroke } from '@/lib/suites/motion/vectorStroke';
import {
  addStroke, deleteFrame, duplicateFrame, holdFrame, insertFrame, newPaintLayerData, paintFrameAt, paintFrameIndexAt,
  pingPongFrames, removeStroke, reverseFrames, stretchFrames,
  type PaintStroke,
} from '@/lib/suites/motion/paint';
import { autoFlatColor, floodFillWithGapClosing } from '@/lib/suites/motion/fill';
import { autoCelShadow } from '@/lib/suites/motion/shading';
import { hexToRgb } from '@/lib/suites/motion/color';
import { sampleMeshGradient } from '@/lib/suites/motion/gradient';
import { PaintToolbar, type PaintTool } from './motion/PaintToolbar';

function hexToRgbLocal(hex: string): [number, number, number] { return hexToRgb(hex); }
function sameColor(a: string, b: string, tolerance = 24): boolean {
  const [ar, ag, ab] = hexToRgb(a), [br, bg, bb] = hexToRgb(b);
  return Math.hypot(ar - br, ag - bg, ab - bb) <= tolerance;
}
function sampleMeshLocal(points: Array<{ x: number; y: number; color: string }>, x: number, y: number): string {
  return sampleMeshGradient({ kind: 'mesh', points }, x, y);
}
function strokeToDabsLocal(stroke: PaintStroke) {
  return strokeToDabs(bezierNodesToPolyline(stroke.nodes, 10), stroke.brush, 1);
}

const KEY = 'motion.project.v1';
const TRACK_H = 30;
const RULER_H = 20;
const WAVE_H = 28;

const BASIC_KINDS: Array<{ kind: LayerKind; icon: string; label: string }> = [
  { kind: 'text', icon: 'doc', label: 'Text' },
  { kind: 'rect', icon: 'blocks', label: 'Rectangle' },
  { kind: 'circle', icon: 'spark', label: 'Circle' },
  { kind: 'image', icon: 'image', label: 'Image' },
  { kind: 'paint', icon: 'pen', label: 'Paint / draw' },
  { kind: 'speedlines', icon: 'trend', label: 'Speed Lines' },
];
const POST_EFFECT_KINDS: Array<{ kind: PostEffectKind; icon: string; label: string; defaultStrength: number; defaultDuration: number }> = [
  { kind: 'chromatic', icon: 'spark', label: 'Chromatic', defaultStrength: 6, defaultDuration: 0.4 },
  { kind: 'glitch', icon: 'bug', label: 'Glitch', defaultStrength: 0.8, defaultDuration: 0.25 },
  { kind: 'invert', icon: 'globe', label: 'Invert', defaultStrength: 1, defaultDuration: 0.1 },
  { kind: 'warp', icon: 'wand', label: 'Warp (domain)', defaultStrength: 220, defaultDuration: 0.5 },
];
const VFX_KINDS: Array<{ preset: ParticlePreset; icon: string; label: string }> = [
  { preset: 'aura', icon: 'wand', label: 'Energy Aura' },
  { preset: 'fire', icon: 'flask', label: 'Fire' },
  { preset: 'electric', icon: 'bulb', label: 'Electric' },
  { preset: 'explosion', icon: 'rocket', label: 'Explosion' },
  { preset: 'cursed', icon: 'brain', label: 'Cursed Energy' },
];

const inputCls = 'mono rounded border bg-transparent px-2 py-1.5 text-[11.5px] outline-none';
const inputStyle = { borderColor: 'var(--line)', color: 'var(--ink)' } as const;
const miniCls = 'mono rounded border bg-transparent px-1.5 py-1 text-[10.5px] outline-none';

function Btn({ children, onClick, disabled, primary, title, small }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; title?: string; small?: boolean }) {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled}
      className={`press mono inline-flex shrink-0 items-center gap-1.5 rounded ${small ? 'px-2 py-1 text-[10.5px]' : 'px-2.5 py-1.5 text-[11px]'} font-medium disabled:opacity-35`}
      style={primary ? { background: 'var(--accent)', color: '#04150e' } : { border: '1px solid var(--line)', color: 'var(--ink-dim)' }}>
      {children}
    </button>
  );
}

function NumField({ label, value, onChange, step = 1, min, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <label className="flex flex-col gap-0.5 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
      {label}
      <input type="number" value={Math.round(value * 1000) / 1000} step={step} min={min} max={max} onChange={(e) => onChange(Number(e.target.value) || 0)} className={`${inputCls} w-full`} style={inputStyle} />
    </label>
  );
}

function PaintStretchControl({ frameCount, onStretch }: { frameCount: number; onStretch: (n: number) => void }) {
  const [n, setN] = useState(frameCount);
  return (
    <span className="mono inline-flex items-center gap-1 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>
      <input type="number" min={1} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))} className={`${miniCls} w-12`} style={inputStyle} />
      <Btn onClick={() => onStretch(n)} small title="Resample the frame sequence to this many frames (repeats or drops frames evenly)">Stretch</Btn>
    </span>
  );
}

/** A small draggable-handle graph for a keyframe's custom cubic-bezier timing curve — the same shape as CSS's cubic-bezier(), x1/y1/x2/y2 anchored between (0,0) and (1,1), y allowed to overshoot for back/elastic-style curves. */
function EaseGraphEditor({ ease, onChange }: { ease: CustomEase; onChange: (ease: CustomEase) => void }) {
  const W = 160, H = 100;
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<'p1' | 'p2' | null>(null);
  const toPx = (x: number, y: number) => ({ px: x * W, py: H - ((y + 0.5) / 2) * H });
  const fromPx = (px: number, py: number) => ({ x: Math.max(0, Math.min(1, px / W)), y: Math.max(-0.5, Math.min(1.5, (1 - py / H) * 2 - 0.5)) });
  const p0 = toPx(0, 0), p3 = toPx(1, 1), p1 = toPx(ease.x1, ease.y1), p2 = toPx(ease.x2, ease.y2);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const { x, y } = fromPx(e.clientX - rect.left, e.clientY - rect.top);
    if (dragRef.current === 'p1') onChange({ ...ease, x1: x, y1: y });
    else onChange({ ...ease, x2: x, y2: y });
  };
  // Capture on the <svg> itself (not e.target, the circle) — otherwise pointer-capture retargets every
  // subsequent move/up event straight to the circle, which has no listener, so onMove on the svg never fires.
  const grab = (which: 'p1' | 'p2') => (e: React.PointerEvent) => { dragRef.current = which; svgRef.current?.setPointerCapture(e.pointerId); };

  return (
    <svg ref={svgRef} data-testid="ease-graph-editor" width={W} height={H} className="mt-1.5 rounded border" style={{ borderColor: 'var(--line)', background: 'var(--surface)', touchAction: 'none' }}
      onPointerMove={onMove} onPointerUp={() => { dragRef.current = null; }}>
      <line x1={0} y1={toPx(0, 0).py} x2={W} y2={toPx(0, 0).py} stroke="var(--line)" strokeDasharray="2,2" />
      <line x1={0} y1={toPx(0, 1).py} x2={W} y2={toPx(0, 1).py} stroke="var(--line)" strokeDasharray="2,2" />
      <path d={`M ${p0.px} ${p0.py} C ${p1.px} ${p1.py}, ${p2.px} ${p2.py}, ${p3.px} ${p3.py}`} stroke="var(--accent)" fill="none" strokeWidth={2} />
      <line x1={p0.px} y1={p0.py} x2={p1.px} y2={p1.py} stroke="var(--ink-faint)" strokeWidth={1} />
      <line x1={p3.px} y1={p3.py} x2={p2.px} y2={p2.py} stroke="var(--ink-faint)" strokeWidth={1} />
      <circle cx={p1.px} cy={p1.py} r={5} fill="var(--accent)" style={{ cursor: 'grab' }} onPointerDown={grab('p1')} />
      <circle cx={p2.px} cy={p2.py} r={5} fill="var(--accent)" style={{ cursor: 'grab' }} onPointerDown={grab('p2')} />
    </svg>
  );
}

const fmt = (s: number) => `${s < 0 ? '-' : ''}${Math.floor(Math.abs(s) / 60)}:${(Math.abs(s) % 60).toFixed(2).padStart(5, '0')}`;

type MarkerSel = { kind: 'shake' | 'impact' | 'ramp' | 'posteffect' | 'bookmark'; id: string } | null;

/**
 * A layers-and-keyframes motion editor on a canvas stage: a particle/VFX engine, a stickman bone rig
 * (FK + a two-bone IK solver + optional physics secondary motion), a virtual camera with shake/impact
 * frames/speed ramping, blend-mode compositing, onion skinning, an audio waveform, and GIF/video export
 * alongside the original CSS/GSAP/HTML code export. See suites/motion/render.ts and exportMedia.ts for
 * how the same frame-drawing function backs the live stage and every exported frame.
 */
export function MotionStudio() {
  const [project, setProject] = useState<MotionProject>(emptyProject());
  const [loaded, setLoaded] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [selKf, setSelKf] = useState<string | null>(null);
  const [selMarker, setSelMarker] = useState<MarkerSel>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [onionOpen, setOnionOpen] = useState(false);
  const [exporting, setExporting] = useState<'gif' | 'video' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [waveform, setWaveform] = useState<WaveformBucket[] | null>(null);

  // ── paint tools state ─────────────────────────────────────────────────────
  const [paintTool, setPaintTool] = useState<PaintTool>('brush');
  const [brush, setBrush] = useState<BrushSettings>(newBrush('ink', '#1a1a1a'));
  const [gapClosePx, setGapClosePx] = useState(2);
  const [gradientKind, setGradientKind] = useState<'linear' | 'radial' | 'mesh'>('linear');
  const [, forcePaintRedraw] = useState(0);

  const stageRef = useRef<HTMLCanvasElement>(null);
  const audioElRef = useRef<HTMLAudioElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef(new Map<string, HTMLImageElement>());
  const [imagesVersion, setImagesVersion] = useState(0);
  const physicsRef = useRef(new Map<string, Map<string, PhysicsState>>());
  const projectRef = useRef(project);
  const timeRef = useRef(0);
  const drag = useRef<{ kind: 'layer'; id: string; ox: number; oy: number; sx: number; sy: number } | { kind: 'kf'; layerId: string; kfId: string } | { kind: 'playhead' } | { kind: 'ramp'; id: string; edge: 't0' | 't1' | 'move'; startT0: number; startT1: number; sx: number } | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const strokeRef = useRef<StrokePoint[] | null>(null);
  const meshSessionRef = useRef<{ layerId: string; strokeId: string; points: Array<{ x: number; y: number; color: string }> } | null>(null);

  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(() => { timeRef.current = time; }, [time]);

  useEffect(() => {
    void getSetting<unknown>(KEY, null).then((p) => { if (p) setProject(normalizeProject(p)); setLoaded(true); });
  }, []);
  useEffect(() => { if (loaded) void setSetting(KEY, project); }, [project, loaded]);

  const selected = project.layers.find((l) => l.id === selId) ?? null;

  // ── image preloading (image layers, and rasterised paint fills/gradients) ──────
  useEffect(() => {
    const load = (src: string) => {
      if (imagesRef.current.has(src)) return;
      const img = new Image();
      img.onload = () => setImagesVersion((v) => v + 1);
      img.src = src;
      imagesRef.current.set(src, img);
    };
    for (const l of project.layers) {
      if (l.kind === 'image' && l.src) load(l.src);
      if (l.kind === 'paint' && l.paint) {
        for (const f of l.paint.frames) for (const s of f.strokes) if (s.fill) load(s.fill.dataUrl);
      }
    }
  }, [project.layers]);

  // ── physics (secondary motion on `physics: true` bones, play-only — see rig.ts) ───────────────────────
  const poseNowFor = useCallback((layer: MotionLayer, t: number): Record<string, number> => {
    if (!layer.rig) return {};
    return poseAt(layer.rig, layer.keyframes, t, easeFn(layer.keyframes[0]?.easing ?? 'linear'));
  }, []);

  const stepAllPhysics = useCallback((proj: MotionProject, dt: number) => {
    for (const layer of proj.layers) {
      if (layer.kind !== 'rig' || !layer.rig) continue;
      if (layer.rig.ragdoll) {
        const base = poseNowFor(layer, timeRef.current);
        const prevMap = physicsRef.current.get(layer.id);
        const prevObj: Record<string, PhysicsState> = {};
        if (prevMap) for (const [id, st] of prevMap) prevObj[id] = st;
        const next = stepRagdollAll(layer.rig, prevObj, base, dt);
        const states = new Map<string, PhysicsState>();
        for (const id of Object.keys(next)) states.set(id, next[id]!);
        physicsRef.current.set(layer.id, states);
        continue;
      }
      const physicsBones = layer.rig.bones.filter((b) => b.physics);
      if (physicsBones.length === 0) { physicsRef.current.delete(layer.id); continue; }
      let states = physicsRef.current.get(layer.id);
      if (!states) { states = new Map(); physicsRef.current.set(layer.id, states); }
      const base = poseNowFor(layer, timeRef.current);
      for (const b of physicsBones) {
        const prev = states.get(b.id) ?? { angle: base[b.id] ?? b.baseAngle, angularVelocity: 0 };
        states.set(b.id, stepPhysicsBone(prev, base[b.id] ?? b.baseAngle, 0, dt));
      }
    }
  }, [poseNowFor]);

  const physicsSnapshot = useCallback((): Map<string, Record<string, number>> => {
    const out = new Map<string, Record<string, number>>();
    for (const [layerId, states] of physicsRef.current) {
      const layer = projectRef.current.layers.find((l) => l.id === layerId);
      if (!layer?.rig) continue;
      const merged = { ...poseNowFor(layer, timeRef.current) };
      for (const [boneId, st] of states) merged[boneId] = st.angle;
      out.set(layerId, merged);
    }
    return out;
  }, [poseNowFor]);

  useEffect(() => { if (!playing) physicsRef.current.clear(); }, [playing]);

  // ── drawing ─────────────────────────────────────────────────────────────────
  const draw = useCallback((proj: MotionProject, t: number, applyCamera: boolean, physicsPose?: Map<string, Record<string, number>>) => {
    const canvas = stageRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    drawFrame(ctx, proj, t, { images: imagesRef.current, selectedLayerId: selId, applyCamera, physicsPose });
  }, [selId]);

  useEffect(() => {
    if (playing) return;
    draw(project, time, false);
  }, [project, time, selId, playing, imagesVersion, draw]);

  // ── playback ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const proj = projectRef.current;
      const rate = effectiveRate(proj.speedRamps, timeRef.current);
      let next = timeRef.current + dt * rate;
      if (next >= proj.duration) next = 0;
      timeRef.current = next;
      setTime(next);
      stepAllPhysics(proj, dt);
      draw(proj, next, true, physicsSnapshot());
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, draw, stepAllPhysics, physicsSnapshot]);

  // ── audio playback sync ───────────────────────────────────────────────────
  useEffect(() => {
    const el = audioElRef.current;
    if (!el || !project.audio) return;
    if (playing) {
      el.currentTime = Math.max(0, time - project.audio.offset);
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const seek = (t: number) => setTime(Math.max(0, Math.min(project.duration, t)));

  // ── layers ──────────────────────────────────────────────────────────────────
  const onAddLayer = (kind: LayerKind) => {
    const next = addLayer(project, kind);
    setProject(next);
    setSelId(next.layers[next.layers.length - 1]!.id);
    setSelMarker(null);
    setAddOpen(false);
  };
  const onAddParticle = (preset: ParticlePreset) => {
    let next = addLayer(project, 'particles');
    const id = next.layers[next.layers.length - 1]!.id;
    const label = VFX_KINDS.find((v) => v.preset === preset)!.label;
    next = updateLayer(next, id, { name: label, particles: newParticleConfig(preset, Math.floor(Math.random() * 1e6)) });
    setProject(next);
    setSelId(id);
    setSelMarker(null);
    setAddOpen(false);
  };
  const onAddRig = () => {
    const next = addLayer(project, 'rig');
    const id = next.layers[next.layers.length - 1]!.id;
    setProject(updateLayer(next, id, { name: `Stick Rig ${project.layers.filter((l) => l.kind === 'rig').length + 1}` }));
    setSelId(id);
    setSelMarker(null);
    setAddOpen(false);
  };
  const patchLayer = (patch: Partial<MotionLayer>) => { if (selId) setProject((p) => updateLayer(p, selId, patch)); };
  const keyNow = (props: Partial<Omit<Keyframe, 'id' | 't'>>) => {
    if (!selId) return;
    setProject((p) => ({ ...p, layers: p.layers.map((l) => (l.id === selId ? setKeyframe(l, time, props) : l)) }));
  };
  const poseNow = (boneId: string, angle: number) => {
    if (!selected?.rig) return;
    const current = poseNowFor(selected, time);
    keyNow({ pose: { ...current, [boneId]: angle } });
  };
  const onDeleteLayer = () => { if (!selId) return; setProject((p) => removeLayer(p, selId)); setSelId(null); };

  /** Tiles a procedural walk/run cycle from the playhead to the end of the project, as ordinary pose keyframes (no different from a human having posed them). */
  const onGenerateGait = (mode: GaitMode) => {
    if (!selected?.rig) return;
    const rig = selected.rig;
    const cycleDuration = newGaitConfig(mode).cycleDuration;
    let layer = selected;
    let cycleStart = time;
    while (cycleStart < project.duration) {
      for (const frame of generateWalkCycle(rig, mode, cycleDuration, 10)) {
        const t = cycleStart + frame.t;
        if (t > project.duration) break;
        layer = setKeyframe(layer, t, { pose: frame.pose });
      }
      cycleStart += cycleDuration;
    }
    patchLayer({ keyframes: layer.keyframes });
  };

  /** Breaks a bone (and its subtree) off the rig at the playhead — it freezes its current world position/angle and flies off under gravity from here on, independent of the rest of the rig (see DetachEvent in rig.ts). */
  const onDetachBone = (boneId: string) => {
    if (!selected?.rig) return;
    const rig = selected.rig;
    const angles = poseNowFor(selected, time);
    const pose = computeRigPose(rig, angles, time, rig.detachments ?? []);
    const bonePose = pose.find((p) => p.id === boneId);
    if (!bonePose) return;
    const dirRad = (bonePose.worldAngle * Math.PI) / 180;
    const event: DetachEvent = {
      id: `detach_${Date.now().toString(36)}`,
      boneId, t: time,
      ax: bonePose.x, ay: bonePose.y, originAngle: bonePose.worldAngle,
      vx: Math.cos(dirRad) * 180, vy: Math.sin(dirRad) * 180 - 120,
      angularVelocity: (Math.random() - 0.5) * 240,
    };
    patchLayer({ rig: { ...rig, detachments: [...(rig.detachments ?? []), event] } });
  };

  // ── dragging a layer on the stage (camera is neutral while editing — see render.ts) ─────────────────
  const stageScale = () => {
    const el = stageRef.current;
    if (!el) return 1;
    return el.clientWidth / project.width;
  };
  const hitTestLayer = (sx: number, sy: number): MotionLayer | null => {
    for (let i = project.layers.length - 1; i >= 0; i--) {
      const l = project.layers[i]!;
      const v = valueAt(l, time);
      const cx = v.x + l.w / 2, cy = v.y + l.h / 2;
      const halfW = (l.w * v.scale) / 2, halfH = (l.h * v.scale) / 2;
      if (Math.abs(sx - cx) <= halfW && Math.abs(sy - cy) <= halfH) return l;
    }
    return null;
  };
  // ── paint: coordinate conversion + canvas access ───────────────────────────
  const stagePointFromEvent = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const canvas = stageRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const s = stageScale();
    return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s };
  };
  /** A paint layer's own local space — the inverse of the x/y/rotate/scale transform render.ts applies. */
  const toLocalPaint = (layer: MotionLayer, stageX: number, stageY: number): { x: number; y: number } => {
    const v = valueAt(layer, time);
    const cx = v.x + layer.w / 2, cy = v.y + layer.h / 2;
    const dx = stageX - cx, dy = stageY - cy;
    const rad = (-v.rotation * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const scale = v.scale || 1;
    return { x: (dx * cos - dy * sin) / scale, y: (dx * sin + dy * cos) / scale };
  };
  const stageCtx = (): CanvasRenderingContext2D | null => stageRef.current?.getContext('2d') ?? null;

  const redrawWithPreview = () => {
    draw(project, time, false);
    const pts = strokeRef.current;
    if (!pts || !selected) return;
    const ctx = stageCtx();
    if (!ctx) return;
    const erasing = paintTool === 'erase-pixel';
    drawStrokePreview(ctx, selected, time, pts, brush, erasing ? 'erase' : 'draw');
  };

  const currentFrameIndex = (layer: MotionLayer): number => (layer.paint ? paintFrameIndexAt(layer.paint, time) : 0);

  /** Rasterise a filled region/gradient into a small canvas and store it as a data: URL — the common tail of fill/gradient/cel-shade. */
  function rasterizeToFillStroke(
    maskOrPaint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, x: number, y: number, w: number, h: number, mode: 'draw' | 'erase' = 'draw',
  ): PaintStroke {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    const cctx = c.getContext('2d')!;
    maskOrPaint(cctx, c.width, c.height);
    const dataUrl = c.toDataURL();
    const img = new Image();
    img.onload = () => setImagesVersion((v) => v + 1);
    img.src = dataUrl;
    imagesRef.current.set(dataUrl, img);
    return { id: newId('stroke'), brush, nodes: [], mode, fill: { dataUrl, x, y, w, h } };
  }

  const commitFillAtLayer = (layer: MotionLayer, stroke: PaintStroke) => {
    if (!layer.paint) return;
    const idx = currentFrameIndex(layer);
    patchLayerById(layer.id, { paint: addStroke(layer.paint, idx, stroke) });
  };
  const patchLayerById = (id: string, patch: Partial<MotionLayer>) => setProject((p) => updateLayer(p, id, patch));

  // ── paint pointer handlers ─────────────────────────────────────────────────
  const onPaintPointerDown = (layer: MotionLayer, e: React.PointerEvent<HTMLCanvasElement>) => {
    const stage = stagePointFromEvent(e);
    const local = toLocalPaint(layer, stage.x, stage.y);
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    if (paintTool === 'brush' || paintTool === 'erase-pixel') {
      strokeRef.current = [{ x: local.x, y: local.y, pressure }];
      redrawWithPreview();
      return;
    }
    if (paintTool === 'erase-object' && layer.paint) {
      const idx = currentFrameIndex(layer);
      const frame = paintFrameAt(layer.paint, time);
      let bestId: string | null = null, bestDist = Infinity;
      for (const s of frame.strokes) {
        const pts = s.fill ? [{ x: s.fill.x + s.fill.w / 2, y: s.fill.y + s.fill.h / 2 }] : s.nodes;
        for (const p of pts) {
          const d = Math.hypot(p.x - local.x, p.y - local.y);
          if (d < bestDist) { bestDist = d; bestId = s.id; }
        }
      }
      if (bestId && bestDist < 60) patchLayerById(layer.id, { paint: removeStroke(layer.paint, idx, bestId) });
      return;
    }
    if (paintTool === 'eyedropper' || paintTool === 'color-replace') {
      const ctx = stageCtx();
      if (!ctx) return;
      const px = ctx.getImageData(Math.round(stage.x * stageScale()), Math.round(stage.y * stageScale()), 1, 1).data;
      const hex = `#${[px[0], px[1], px[2]].map((v) => v!.toString(16).padStart(2, '0')).join('')}`;
      if (paintTool === 'eyedropper') {
        setBrush((b) => ({ ...b, color: hex }));
      } else if (layer.paint) {
        const to = window.prompt(`Replace ${hex} with which hex colour, everywhere in this project?`, brush.color);
        if (to && /^#?[0-9a-f]{6}$/i.test(to)) {
          const toHex = to.startsWith('#') ? to : `#${to}`;
          setProject((p) => ({
            ...p,
            layers: p.layers.map((l) => {
              if (l.kind !== 'paint' || !l.paint) return l;
              return {
                ...l,
                paint: {
                  ...l.paint,
                  frames: l.paint.frames.map((f) => ({
                    strokes: f.strokes.map((s) => (!s.fill && sameColor(s.brush.color, hex) ? { ...s, brush: { ...s.brush, color: toHex } } : s)),
                  })),
                },
              };
            }),
          }));
        }
      }
      return;
    }
    if (paintTool === 'fill' && layer.paint) {
      const w = layer.w, h = layer.h;
      const flatCtx = document.createElement('canvas');
      flatCtx.width = w; flatCtx.height = h;
      const fctx = flatCtx.getContext('2d')!;
      const frame = paintFrameAt(layer.paint, time);
      for (const s of frame.strokes) {
        if (s.fill || s.brush.kind !== 'ink' && s.brush.kind !== 'pencil') continue;
        const dabs = strokeToDabsLocal(s);
        fctx.fillStyle = '#000';
        for (const d of dabs) { fctx.globalAlpha = d.opacity; fctx.beginPath(); fctx.arc(d.x + w / 2, d.y + h / 2, d.radius, 0, Math.PI * 2); fctx.fill(); }
      }
      const alpha = fctx.getImageData(0, 0, w, h).data;
      const alphaOnly = new Uint8ClampedArray(w * h);
      for (let i = 0; i < w * h; i++) alphaOnly[i] = alpha[i * 4 + 3]!;
      const seedX = Math.round(local.x + w / 2), seedY = Math.round(local.y + h / 2);
      const mask = floodFillWithGapClosing(alphaOnly, w, h, seedX, seedY, { gapClosePx });
      const stroke = rasterizeToFillStroke((cctx) => {
        const img = cctx.createImageData(w, h);
        const [r, g, b] = hexToRgbLocal(brush.color);
        for (let i = 0; i < w * h; i++) if (mask[i]) { img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = Math.round(brush.opacity * 255); }
        cctx.putImageData(img, 0, 0);
      }, -w / 2, -h / 2, w, h);
      commitFillAtLayer(layer, stroke);
      return;
    }
    if (paintTool === 'cel-shade' && layer.paint) {
      const w = layer.w, h = layer.h;
      const flatCtx = document.createElement('canvas');
      flatCtx.width = w; flatCtx.height = h;
      const fctx = flatCtx.getContext('2d')!;
      const frame = paintFrameAt(layer.paint, time);
      for (const s of frame.strokes) {
        if (s.fill) { fctx.drawImage(imagesRef.current.get(s.fill.dataUrl) ?? new Image(), s.fill.x + w / 2, s.fill.y + h / 2, s.fill.w, s.fill.h); continue; }
        const dabs = strokeToDabsLocal(s);
        fctx.fillStyle = s.brush.color;
        for (const d of dabs) { fctx.globalAlpha = d.opacity; fctx.beginPath(); fctx.arc(d.x + w / 2, d.y + h / 2, d.radius, 0, Math.PI * 2); fctx.fill(); }
      }
      const alpha = fctx.getImageData(0, 0, w, h).data;
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) mask[i] = alpha[i * 4 + 3]! > 16 ? 1 : 0;
      const shadow = autoCelShadow(mask, w, h, { lightAngleDeg: 45, offsetPx: Math.max(4, gapClosePx * 3) });
      const stroke = rasterizeToFillStroke((cctx) => {
        const img = cctx.createImageData(w, h);
        const [r, g, b] = hexToRgbLocal(brush.color);
        for (let i = 0; i < w * h; i++) if (shadow[i]) { img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 140; }
        cctx.putImageData(img, 0, 0);
      }, -w / 2, -h / 2, w, h);
      commitFillAtLayer(layer, stroke);
      return;
    }
    if (paintTool === 'gradient' && layer.paint) {
      if (gradientKind === 'mesh') {
        const session = meshSessionRef.current;
        const points = session && session.layerId === layer.id ? [...session.points, { x: local.x, y: local.y, color: brush.color }] : [{ x: local.x, y: local.y, color: brush.color }];
        const strokeId = session?.layerId === layer.id ? session.strokeId : newId('stroke');
        meshSessionRef.current = { layerId: layer.id, strokeId, points };
        if (points.length >= 2) {
          const w = layer.w, h = layer.h;
          const stroke = rasterizeToFillStroke((cctx) => {
            const img = cctx.createImageData(w, h);
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
              const hex = sampleMeshLocal(points, x - w / 2, y - h / 2);
              const [r, g, b] = hexToRgbLocal(hex);
              const i = (y * w + x) * 4;
              img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
            }
            cctx.putImageData(img, 0, 0);
          }, -w / 2, -h / 2, w, h);
          stroke.id = strokeId;
          const idx = currentFrameIndex(layer);
          const existing = paintFrameAt(layer.paint, time).strokes.find((s) => s.id === strokeId);
          patchLayerById(layer.id, { paint: existing ? { ...layer.paint, frames: layer.paint.frames.map((f, i) => (i === idx ? { strokes: f.strokes.map((s) => (s.id === strokeId ? stroke : s)) } : f)) } : addStroke(layer.paint, idx, stroke) });
        }
        return;
      }
      drag.current = { kind: 'layer', id: layer.id, ox: local.x, oy: local.y, sx: e.clientX, sy: e.clientY };
      return;
    }
    if (paintTool === 'lasso') {
      strokeRef.current = [{ x: local.x, y: local.y, pressure: 1 }];
      return;
    }
  };

  const onPaintPointerMove = (layer: MotionLayer, e: React.PointerEvent<HTMLCanvasElement>) => {
    if (paintTool === 'brush' || paintTool === 'erase-pixel') {
      if (!strokeRef.current) return;
      const stage = stagePointFromEvent(e);
      const local = toLocalPaint(layer, stage.x, stage.y);
      const pressure = e.pressure > 0 ? e.pressure : 0.5;
      const prev = strokeRef.current[strokeRef.current.length - 1]!;
      const smoothed = stabilizePoint(prev, { x: local.x, y: local.y, pressure }, brush.stabilizer);
      strokeRef.current.push(smoothed);
      redrawWithPreview();
      return;
    }
    if (paintTool === 'lasso' && strokeRef.current) {
      const stage = stagePointFromEvent(e);
      const local = toLocalPaint(layer, stage.x, stage.y);
      strokeRef.current.push({ x: local.x, y: local.y, pressure: 1 });
      draw(project, time, false);
      const ctx = stageCtx();
      if (ctx && strokeRef.current.length > 1) {
        const v = valueAt(layer, time);
        ctx.save();
        ctx.translate(v.x + layer.w / 2, v.y + layer.h / 2);
        ctx.strokeStyle = '#2ad4ff';
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        strokeRef.current.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
        ctx.restore();
      }
      return;
    }
  };

  const onPaintPointerUp = (layer: MotionLayer, e: React.PointerEvent<HTMLCanvasElement>) => {
    if ((paintTool === 'brush' || paintTool === 'erase-pixel') && strokeRef.current && layer.paint) {
      const points = strokeRef.current;
      strokeRef.current = null;
      if (points.length >= 1) {
        // The stabilizer lags behind the raw cursor by design (see brush.ts) — left alone, a stroke would
        // never quite reach the point where the pen actually lifted, leaving closed shapes with a visible
        // gap at every corner. Snap the true release point on as the stroke's real last point.
        const stage = stagePointFromEvent(e);
        const local = toLocalPaint(layer, stage.x, stage.y);
        const releasePressure = e.pressure > 0 ? e.pressure : points[points.length - 1]!.pressure;
        points.push({ x: local.x, y: local.y, pressure: releasePressure });
        const nodes = vectorizeStroke(points, 1.5);
        const stroke: PaintStroke = { id: newId('stroke'), brush, nodes, mode: paintTool === 'erase-pixel' ? 'erase' : 'draw' };
        const idx = currentFrameIndex(layer);
        patchLayerById(layer.id, { paint: addStroke(layer.paint, idx, stroke) });
      } else {
        draw(project, time, false);
      }
      return;
    }
    if (paintTool === 'lasso') {
      strokeRef.current = null;
      draw(project, time, false);
      return;
    }
    if (paintTool === 'gradient' && gradientKind !== 'mesh') {
      const d = drag.current;
      if (d && d.kind === 'layer' && layer.paint) {
        const w = layer.w, h = layer.h;
        const stroke = rasterizeToFillStroke((cctx) => {
          const grad = gradientKind === 'linear'
            ? cctx.createLinearGradient(d.ox + w / 2, d.oy + h / 2, toLocalPaint(layer, stagePointFromEvent({ clientX: 0, clientY: 0 }).x, 0).x + w / 2, d.oy + h / 2)
            : cctx.createRadialGradient(d.ox + w / 2, d.oy + h / 2, 0, d.ox + w / 2, d.oy + h / 2, Math.max(10, Math.hypot(w, h) / 3));
          grad.addColorStop(0, brush.color);
          grad.addColorStop(1, 'transparent');
          cctx.fillStyle = grad;
          cctx.fillRect(0, 0, w, h);
        }, -w / 2, -h / 2, w, h);
        commitFillAtLayer(layer, stroke);
      }
      drag.current = null;
      return;
    }
  };

  const onStagePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = stageRef.current;
    if (!canvas) return;
    const stage = stagePointFromEvent(e);
    if (selected?.kind === 'paint' && selected.paint) { onPaintPointerDown(selected, e); return; }
    const hit = hitTestLayer(stage.x, stage.y);
    setSelId(hit?.id ?? null);
    setSelMarker(null);
    if (!hit) return;
    const v = valueAt(hit, time);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind: 'layer', id: hit.id, ox: v.x, oy: v.y, sx: e.clientX, sy: e.clientY };
  };
  const onStagePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (selected?.kind === 'paint' && selected.paint && paintTool !== 'eyedropper' && paintTool !== 'fill' && paintTool !== 'cel-shade' && paintTool !== 'color-replace' && paintTool !== 'erase-object') {
      onPaintPointerMove(selected, e);
      return;
    }
    const d = drag.current;
    if (!d || d.kind !== 'layer') return;
    const s = stageScale();
    const nx = Math.round(d.ox + (e.clientX - d.sx) / s);
    const ny = Math.round(d.oy + (e.clientY - d.sy) / s);
    setProject((p) => ({ ...p, layers: p.layers.map((l) => (l.id === d.id ? setKeyframe(l, time, { x: nx, y: ny }) : l)) }));
  };
  const onStagePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (selected?.kind === 'paint' && selected.paint) { onPaintPointerUp(selected, e); return; }
    drag.current = null;
  };

  // ── timeline: keyframes ─────────────────────────────────────────────────────
  const trackWidth = () => timelineRef.current?.clientWidth ?? 600;
  const xToTime = (x: number) => Math.max(0, Math.min(project.duration, (x / trackWidth()) * project.duration));

  const onRulerPointerDown = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seek(xToTime(e.clientX - rect.left));
    setSelMarker(null);
    drag.current = { kind: 'playhead' };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onTimelinePointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return;
    const t = xToTime(e.clientX - rect.left);
    if (d.kind === 'playhead') seek(t);
    else if (d.kind === 'kf') setProject((p) => ({ ...p, layers: p.layers.map((l) => (l.id === d.layerId ? moveKeyframe(l, d.kfId, t) : l)) }));
    else if (d.kind === 'ramp') {
      const dt = t - xToTime(d.sx - rect.left);
      setProject((p) => ({
        ...p,
        speedRamps: p.speedRamps.map((r) => {
          if (r.id !== d.id) return r;
          if (d.edge === 't0') return { ...r, t0: Math.max(0, Math.min(r.t1 - 0.02, d.startT0 + dt)) };
          if (d.edge === 't1') return { ...r, t1: Math.max(r.t0 + 0.02, Math.min(project.duration, d.startT1 + dt)) };
          const span = d.startT1 - d.startT0;
          const nt0 = Math.max(0, Math.min(project.duration - span, d.startT0 + dt));
          return { ...r, t0: nt0, t1: nt0 + span };
        }),
      }));
    }
  };
  const onTimelinePointerUp = () => { drag.current = null; };

  const onKeyDiamondDown = (e: React.PointerEvent, layerId: string, kfId: string) => {
    e.stopPropagation();
    setSelId(layerId); setSelKf(kfId); setSelMarker(null);
    drag.current = { kind: 'kf', layerId, kfId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onTrackDoubleClick = (e: React.MouseEvent, layer: MotionLayer) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = xToTime(e.clientX - rect.left);
    setProject((p) => ({ ...p, layers: p.layers.map((l) => (l.id === layer.id ? setKeyframe(l, t, {}) : l)) }));
    setSelId(layer.id);
    setSelMarker(null);
  };
  const onDeleteKeyframe = () => {
    if (!selId || !selKf) return;
    setProject((p) => ({ ...p, layers: p.layers.map((l) => (l.id === selId ? removeKeyframe(l, selKf) : l)) }));
    setSelKf(null);
  };

  // ── camera / shake / impact / speed ramp ────────────────────────────────────
  const cam: CameraTransform = cameraAt(project.camera, time);
  const camPatch = (patch: Partial<Omit<CameraTransform, never>> & { easing?: Easing }) =>
    setProject((p) => ({ ...p, camera: setCameraKeyframe(p.camera, time, patch) }));
  const camKeyHere = () => camPatch({ x: cam.x, y: cam.y, zoom: cam.zoom, rotation: cam.rotation });
  const addShake = () => setProject((p) => ({ ...p, shakes: [...p.shakes, { id: `shake_${Date.now().toString(36)}`, t: time, duration: 0.3, magnitude: 24, seed: Math.floor(Math.random() * 1e6) }] }));
  const addImpact = () => setProject((p) => ({ ...p, impacts: [...p.impacts, { id: `impact_${Date.now().toString(36)}`, t: time, duration: 0.07, style: 'flash' }] }));
  const addRamp = () => setProject((p) => ({ ...p, speedRamps: [...p.speedRamps, { id: `ramp_${Date.now().toString(36)}`, t0: time, t1: Math.min(p.duration, time + 0.6), rate: 0.35 }] }));
  const patchShake = (id: string, patch: Partial<ShakeEvent>) => setProject((p) => ({ ...p, shakes: p.shakes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const patchImpact = (id: string, patch: Partial<ImpactFrame>) => setProject((p) => ({ ...p, impacts: p.impacts.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  const patchRamp = (id: string, patch: Partial<SpeedRamp>) => setProject((p) => ({ ...p, speedRamps: p.speedRamps.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const addPostEffect = (kind: PostEffectKind) => {
    const preset = POST_EFFECT_KINDS.find((k) => k.kind === kind)!;
    const effect: PostEffect = { id: `fx_${Date.now().toString(36)}`, t: time, duration: preset.defaultDuration, kind, strength: preset.defaultStrength };
    setProject((p) => ({ ...p, postEffects: [...p.postEffects, effect] }));
    setSelMarker({ kind: 'posteffect', id: effect.id });
    setCameraOpen(false);
  };
  const patchPostEffect = (id: string, patch: Partial<PostEffect>) => setProject((p) => ({ ...p, postEffects: p.postEffects.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const addBookmark = () => {
    const marker: TimelineMarker = { id: newId('marker'), t: time, label: 'Marker', color: '#ffd23f' };
    setProject((p) => ({ ...p, markers: [...p.markers, marker].sort((a, b) => a.t - b.t) }));
    setSelMarker({ kind: 'bookmark', id: marker.id });
  };
  const patchBookmark = (id: string, patch: Partial<TimelineMarker>) => setProject((p) => updateMarker(p, id, patch));
  const deleteMarker = () => {
    if (!selMarker) return;
    setProject((p) => {
      if (selMarker.kind === 'shake') return { ...p, shakes: p.shakes.filter((s) => s.id !== selMarker.id) };
      if (selMarker.kind === 'impact') return { ...p, impacts: p.impacts.filter((i) => i.id !== selMarker.id) };
      if (selMarker.kind === 'posteffect') return { ...p, postEffects: p.postEffects.filter((e) => e.id !== selMarker.id) };
      if (selMarker.kind === 'bookmark') return removeMarker(p, selMarker.id);
      return { ...p, speedRamps: p.speedRamps.filter((r) => r.id !== selMarker.id) };
    });
    setSelMarker(null);
  };

  // ── audio ────────────────────────────────────────────────────────────────────
  const onLoadAudio = async (file: File) => {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    try {
      const buf = await file.arrayBuffer();
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const decoded = await ctx.decodeAudioData(buf.slice(0));
      const channels: Float32Array[] = [];
      for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
      setWaveform(peaksFromSamples(mixChannelsDown(channels), 400));
      setProject((p) => ({ ...p, audio: { name: file.name, dataUrl, duration: decoded.duration, offset: 0 } }));
      void ctx.close();
    } catch {
      setWaveform(null);
      setProject((p) => ({ ...p, audio: { name: file.name, dataUrl, duration: p.duration, offset: 0 } }));
    }
  };

  // ── keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = !!(e.target as HTMLElement)?.closest('input,textarea');
      if ((e.key === 'Delete' || e.key === 'Backspace') && selKf && !typing) onDeleteKeyframe();
      if ((e.key === 'Delete' || e.key === 'Backspace') && selMarker && !typing) deleteMarker();
      if (e.key === ' ' && !typing) { e.preventDefault(); setPlaying((x) => !x); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selId, selKf, selMarker]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── export ──────────────────────────────────────────────────────────────────
  const fileBase = (project.title || 'motion').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'motion';
  const doExport = async (kind: 'css' | 'gsap' | 'html' | 'zip' | 'gif' | 'video') => {
    setExportError(null);
    if (kind === 'css') { downloadText(exportCss(project), `${fileBase}.css`, 'text/css;charset=utf-8'); setExportOpen(false); return; }
    if (kind === 'gsap') { downloadText(exportGsap(project), `${fileBase}.gsap.js`, 'text/javascript;charset=utf-8'); setExportOpen(false); return; }
    if (kind === 'html') { downloadText(exportHtml(project), `${fileBase}.html`, 'text/html;charset=utf-8'); setExportOpen(false); return; }
    if (kind === 'zip') { downloadZip(exportZip(project), `${fileBase}.zip`); setExportOpen(false); return; }
    setExportOpen(false);
    setExporting(kind);
    try {
      if (kind === 'gif') {
        const bytes = await renderGif(project, { images: imagesRef.current }, 15);
        downloadBlob(new Blob([bytes as unknown as ArrayBuffer], { type: 'image/gif' }), `${fileBase}.gif`);
      } else {
        const res = await renderVideo(project, { images: imagesRef.current }, 30);
        downloadBlob(res.blob, `${fileBase}.${res.extension}`);
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExporting(null);
    }
  };
  const videoCodec = useMemo(() => (typeof window === 'undefined' ? null : pickVideoCodec()), []);

  const loadExample = () => {
    if (project.layers.length > 0 && !window.confirm('Replace the current project with the "JJK Showcase" example?')) return;
    setProject(jjkShowcaseProject());
    setSelId(null); setSelKf(null); setSelMarker(null); setTime(0);
  };

  const stageScaleDisplay = useMemo(() => Math.min(1, 560 / project.width), [project.width]);

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg)' }}>
      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
        <SkillIcon name="film" size={16} className="shrink-0" />
        <input value={project.title} onChange={(e) => setProject((p) => ({ ...p, title: e.target.value }))} aria-label="Project name" className={`${inputCls} w-32 font-semibold`} style={inputStyle} />
        <select value={`${project.width}x${project.height}`} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); setProject((p) => ({ ...p, width: w!, height: h! })); }}
          aria-label="Stage size" className={inputCls} style={{ ...inputStyle, background: 'var(--panel)' }}>
          {STAGE_PRESETS.map((s) => <option key={s.label} value={`${s.w}x${s.h}`}>{s.label} · {s.w}×{s.h}</option>)}
        </select>
        <label className="mono flex items-center gap-1 text-[11px]" style={{ color: 'var(--ink-dim)' }}>
          dur
          <input type="number" min={0.5} max={60} step={0.5} value={project.duration} onChange={(e) => setProject((p) => ({ ...p, duration: Math.max(0.5, Number(e.target.value) || 1) }))} className={`${inputCls} w-14`} style={inputStyle} />
          s
        </label>
        <input type="color" value={project.background} onChange={(e) => setProject((p) => ({ ...p, background: e.target.value }))} aria-label="Stage background" className="h-7 w-8 rounded border" style={{ borderColor: 'var(--line)' }} />
        <Btn onClick={loadExample} small title="Load the JJK Showcase example project"><SkillIcon name="rocket" size={12} /> Example</Btn>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="relative">
            <Btn onClick={() => setCameraOpen((x) => !x)} title="Virtual camera: pan / zoom / rotate / shake / impact / speed ramp"><SkillIcon name="globe" size={13} /> Camera</Btn>
            {cameraOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border p-2.5 shadow-lg" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
                <p className="mono mb-1.5 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>camera at {fmt(time)}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  <NumField label="pan x" value={cam.x} onChange={(v) => camPatch({ x: v })} />
                  <NumField label="pan y" value={cam.y} onChange={(v) => camPatch({ y: v })} />
                  <NumField label="zoom" value={cam.zoom} step={0.05} min={0.1} onChange={(v) => camPatch({ zoom: Math.max(0.1, v) })} />
                  <NumField label="rotate" value={cam.rotation} onChange={(v) => camPatch({ rotation: v })} />
                </div>
                <Btn onClick={camKeyHere} small title="Hold the camera here with a keyframe"><SkillIcon name="spark" size={11} /> Key camera here</Btn>
                <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
                  <Btn onClick={addShake} small title="Add a screen-shake burst at the playhead"><SkillIcon name="bug" size={11} /> + Shake</Btn>
                  <Btn onClick={addImpact} small title="Add a 1-2 frame impact flash at the playhead"><SkillIcon name="spark" size={11} /> + Impact</Btn>
                  <Btn onClick={addRamp} small title="Add a slow-mo/fast speed-ramp region starting at the playhead"><SkillIcon name="trend" size={11} /> + Speed ramp</Btn>
                </div>
                <p className="mono mb-1 mt-2 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>screen-space effect at playhead</p>
                <div className="flex flex-wrap gap-1.5">
                  {POST_EFFECT_KINDS.map((k) => (
                    <Btn key={k.kind} onClick={() => addPostEffect(k.kind)} small title={`Add a ${k.label} burst at the playhead`}><SkillIcon name={k.icon} size={11} /> + {k.label}</Btn>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="relative">
            <Btn onClick={() => setAddOpen((x) => !x)} primary title="Add a layer"><SkillIcon name="wand" size={13} /> + Layer</Btn>
            {addOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border p-1 shadow-lg" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
                {BASIC_KINDS.map((k) => (
                  <button key={k.kind} type="button" onClick={() => onAddLayer(k.kind)} className="press mono flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11.5px]" style={{ color: 'var(--ink)' }}>
                    <SkillIcon name={k.icon} size={13} /> {k.label}
                  </button>
                ))}
                <div className="my-1 border-t" style={{ borderColor: 'var(--line)' }} />
                <p className="mono px-2 pb-1 text-[9.5px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>VFX</p>
                {VFX_KINDS.map((k) => (
                  <button key={k.preset} type="button" onClick={() => onAddParticle(k.preset)} className="press mono flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11.5px]" style={{ color: 'var(--ink)' }}>
                    <SkillIcon name={k.icon} size={13} /> {k.label}
                  </button>
                ))}
                <div className="my-1 border-t" style={{ borderColor: 'var(--line)' }} />
                <button type="button" onClick={onAddRig} className="press mono flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11.5px]" style={{ color: 'var(--ink)' }}>
                  <SkillIcon name="layers" size={13} /> Stick Rig
                </button>
              </div>
            )}
          </div>
          <div className="relative">
            <Btn onClick={() => setExportOpen((x) => !x)} title="Export"><SkillIcon name="package" size={13} /> Export</Btn>
            {exportOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border p-1 shadow-lg" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
                {([['html', 'Standalone .html'], ['css', 'CSS @keyframes'], ['gsap', 'GSAP script (.js)'], ['zip', 'All of it + .json']] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => void doExport(k)} className="press mono block w-full rounded px-2 py-1.5 text-left text-[11.5px]" style={{ color: 'var(--ink)' }}>{label}</button>
                ))}
                <div className="my-1 border-t" style={{ borderColor: 'var(--line)' }} />
                <button type="button" onClick={() => void doExport('gif')} className="press mono block w-full rounded px-2 py-1.5 text-left text-[11.5px]" style={{ color: 'var(--ink)' }}>Looping GIF (pixels)</button>
                <button type="button" onClick={() => void doExport('video')} disabled={!videoCodec} className="press mono block w-full rounded px-2 py-1.5 text-left text-[11.5px] disabled:opacity-40" style={{ color: 'var(--ink)' }} title={videoCodec ? `Records as ${videoCodec.extension.toUpperCase()}` : 'This browser cannot record video'}>
                  Video ({videoCodec ? videoCodec.extension.toUpperCase() : 'unsupported'})
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {exporting && (
        <div className="mono shrink-0 px-3 py-1 text-[10.5px]" style={{ color: 'var(--accent)', background: 'var(--panel)' }}>
          rendering {exporting === 'gif' ? 'GIF' : 'video'} frame-by-frame… this can take a few seconds
        </div>
      )}
      {exportError && (
        <div className="mono shrink-0 px-3 py-1 text-[10.5px]" style={{ color: 'var(--color-rose)', background: 'var(--panel)' }}>{exportError}</div>
      )}

      {/* Stage + properties */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {selected?.kind === 'paint' && selected.paint && (
          <PaintToolbar
            tool={paintTool} onToolChange={setPaintTool}
            brush={brush} onBrushChange={setBrush}
            gapClosePx={gapClosePx} onGapCloseChange={setGapClosePx}
            gradientKind={gradientKind} onGradientKindChange={setGradientKind}
            alphaLock={selected.paint.alphaLock} onAlphaLockChange={(v) => patchLayer({ paint: { ...selected.paint!, alphaLock: v } })}
            palette={project.palette} onPaletteChange={(pal) => setProject((p) => ({ ...p, palette: pal }))}
            onAutoFlatColor={() => {
              const w = selected.w, h = selected.h;
              const flat = document.createElement('canvas'); flat.width = w; flat.height = h;
              const fctx = flat.getContext('2d')!;
              const frame = paintFrameAt(selected.paint!, time);
              for (const s of frame.strokes) {
                if (s.fill || (s.brush.kind !== 'ink' && s.brush.kind !== 'pencil')) continue;
                fctx.fillStyle = '#000';
                for (const d of strokeToDabsLocal(s)) { fctx.globalAlpha = d.opacity; fctx.beginPath(); fctx.arc(d.x + w / 2, d.y + h / 2, d.radius, 0, Math.PI * 2); fctx.fill(); }
              }
              const alpha = fctx.getImageData(0, 0, w, h).data;
              const alphaOnly = new Uint8ClampedArray(w * h);
              for (let i = 0; i < w * h; i++) alphaOnly[i] = alpha[i * 4 + 3]!;
              const { labels, colorOf } = autoFlatColor(alphaOnly, w, h, project.palette.length ? project.palette : DEFAULT_PALETTE, { gapClosePx });
              const backgroundLabel = labels[0]; // the region touching the canvas corner is "outside", never flat-coloured
              const stroke = rasterizeToFillStroke((cctx) => {
                const img = cctx.createImageData(w, h);
                for (let i = 0; i < w * h; i++) {
                  const label = labels[i]!;
                  if (label < 0 || label === backgroundLabel || alphaOnly[i]! >= 16) continue; // skip the line art itself and the outside
                  const [r, g, b] = hexToRgbLocal(colorOf[label] ?? '#cccccc');
                  img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
                }
                cctx.putImageData(img, 0, 0);
              }, -w / 2, -h / 2, w, h);
              commitFillAtLayer(selected, stroke);
            }}
            onClearFrame={() => {
              const idx = currentFrameIndex(selected);
              setProject((p) => ({
                ...p,
                layers: p.layers.map((l) => (l.id === selected.id && l.paint ? { ...l, paint: { ...l.paint, frames: l.paint.frames.map((f, i) => (i === idx ? { strokes: [] } : f)) } } : l)),
              }));
            }}
          />
        )}
        <div className="flex flex-1 items-center justify-center overflow-auto p-4">
          <canvas
            ref={stageRef}
            width={project.width}
            height={project.height}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            className="shrink-0 touch-none rounded-lg border-2 shadow-lg"
            style={{ width: project.width * stageScaleDisplay, height: project.height * stageScaleDisplay, borderColor: 'var(--line)', cursor: selected?.kind === 'paint' ? 'crosshair' : undefined }}
          />
        </div>

        {/* Properties panel */}
        <div className="w-64 shrink-0 overflow-y-auto border-l p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          {selMarker ? (
            <MarkerPanel project={project} sel={selMarker} onPatchShake={patchShake} onPatchImpact={patchImpact} onPatchRamp={patchRamp} onPatchPostEffect={patchPostEffect} onPatchBookmark={patchBookmark} onDelete={deleteMarker} />
          ) : !selected ? (
            <p className="text-[11.5px] leading-[1.6]" style={{ color: 'var(--ink-faint)' }}>Pick a layer on the stage, or add one. Drag to move; the timeline below keys its position at the playhead. Camera previews during Play.</p>
          ) : (
            <LayerPanel
              layer={selected} time={time} selKf={selKf} groups={project.groups}
              onPatchLayer={patchLayer} onKeyNow={keyNow} onPoseNow={poseNow}
              onDeleteLayer={onDeleteLayer} onDeleteKeyframe={onDeleteKeyframe}
              onSetKfEasing={(easing) => setProject((p) => ({ ...p, layers: p.layers.map((l) => (l.id === selId ? { ...l, keyframes: l.keyframes.map((k) => (k.id === selKf ? { ...k, easing } : k)) } : l)) }))}
              onPatchKeyframe={(patch) => setProject((p) => ({ ...p, layers: p.layers.map((l) => (l.id === selId ? { ...l, keyframes: l.keyframes.map((k) => (k.id === selKf ? { ...k, ...patch } : k)) } : l)) }))}
              onNewGroup={() => setProject((p) => newGroup(p))}
              onInsertFrame={() => selected.paint && patchLayer({ paint: insertFrame(selected.paint, currentFrameIndex(selected)) })}
              onDuplicateFrame={() => selected.paint && patchLayer({ paint: duplicateFrame(selected.paint, currentFrameIndex(selected)) })}
              onDeleteFrame={() => selected.paint && patchLayer({ paint: deleteFrame(selected.paint, currentFrameIndex(selected)) })}
              onFrameFps={(fps) => selected.paint && patchLayer({ paint: { ...selected.paint, fps: Math.max(1, fps) } })}
              onHoldFrame={() => selected.paint && patchLayer({ paint: holdFrame(selected.paint, currentFrameIndex(selected), 1) })}
              onReverseFrames={() => selected.paint && patchLayer({ paint: reverseFrames(selected.paint) })}
              onPingPongFrames={() => selected.paint && patchLayer({ paint: pingPongFrames(selected.paint) })}
              onStretchFrames={(n) => selected.paint && patchLayer({ paint: stretchFrames(selected.paint, n) })}
              onGenerateGait={onGenerateGait}
              onDetachBone={onDetachBone}
            />
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="shrink-0 border-t" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
          <Btn onClick={() => setPlaying((x) => !x)} small title="Play / pause (space)"><SkillIcon name={playing ? 'bug' : 'spark'} size={11} />{playing ? 'Pause' : 'Play'}</Btn>
          <span className="mono text-[10.5px] tabular-nums" style={{ color: 'var(--ink-dim)' }}>{fmt(time)} / {fmt(project.duration)}</span>
          <Btn onClick={addBookmark} small title="Drop a named, coloured bookmark at the playhead"><SkillIcon name="doc" size={10} /> + Bookmark</Btn>
          <label className="mono flex items-center gap-1 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>
            <input type="checkbox" checked={project.onionSkin.enabled} onChange={(e) => setProject((p) => ({ ...p, onionSkin: { ...p.onionSkin, enabled: e.target.checked } }))} />
            onion skin
          </label>
          {project.onionSkin.enabled && (
            <div className="relative">
              <Btn onClick={() => setOnionOpen((x) => !x)} small title="Onion-skin settings"><SkillIcon name="layers" size={10} /> settings</Btn>
              {onionOpen && (
                <div className="absolute bottom-full left-0 z-30 mb-1 w-56 rounded-lg border p-2.5 shadow-lg" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
                  <div className="grid grid-cols-2 gap-1.5">
                    <NumField label="frames before" value={project.onionSkin.beforeCount} min={0} max={5} onChange={(v) => setProject((p) => ({ ...p, onionSkin: { ...p.onionSkin, beforeCount: Math.max(0, Math.min(5, Math.round(v))) } }))} />
                    <NumField label="frames after" value={project.onionSkin.afterCount} min={0} max={5} onChange={(v) => setProject((p) => ({ ...p, onionSkin: { ...p.onionSkin, afterCount: Math.max(0, Math.min(5, Math.round(v))) } }))} />
                  </div>
                  <label className="mt-1.5 flex items-center gap-2 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>before <input type="color" value={project.onionSkin.beforeColor} onChange={(e) => setProject((p) => ({ ...p, onionSkin: { ...p.onionSkin, beforeColor: e.target.value } }))} className="h-6 w-8 rounded border" style={{ borderColor: 'var(--line)' }} /></label>
                  <label className="mt-1 flex items-center gap-2 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>after <input type="color" value={project.onionSkin.afterColor} onChange={(e) => setProject((p) => ({ ...p, onionSkin: { ...p.onionSkin, afterColor: e.target.value } }))} className="h-6 w-8 rounded border" style={{ borderColor: 'var(--line)' }} /></label>
                  <label className="mt-1.5 flex items-center gap-2 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>opacity <input type="range" min={0.1} max={0.8} step={0.05} value={project.onionSkin.opacity} onChange={(e) => setProject((p) => ({ ...p, onionSkin: { ...p.onionSkin, opacity: Number(e.target.value) } }))} className="flex-1" /></label>
                  <label className="mt-1 flex items-center gap-2 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>step (s) <input type="number" step={0.01} min={0.01} value={project.onionSkin.frameStep} onChange={(e) => setProject((p) => ({ ...p, onionSkin: { ...p.onionSkin, frameStep: Math.max(0.01, Number(e.target.value) || 0.05) } }))} className={`${inputCls} w-16`} style={inputStyle} /></label>
                </div>
              )}
            </div>
          )}
          <label className="press mono ml-auto flex cursor-pointer items-center gap-1 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>
            <SkillIcon name="music" size={12} /> {project.audio ? project.audio.name.slice(0, 18) : 'load audio'}
            <input type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onLoadAudio(f); e.target.value = ''; }} />
          </label>
          {project.audio && <Btn onClick={() => { setProject((p) => ({ ...p, audio: undefined })); setWaveform(null); }} small title="Remove audio">✕</Btn>}
        </div>
        {project.audio && (
          <audio ref={audioElRef} src={project.audio.dataUrl} className="hidden" />
        )}
        <div ref={timelineRef} className="relative select-none px-3 pb-3" onPointerMove={onTimelinePointerMove} onPointerUp={onTimelinePointerUp}>
          <div className="relative cursor-pointer rounded" style={{ height: RULER_H, background: 'var(--surface)' }} onPointerDown={onRulerPointerDown}>
            {Array.from({ length: Math.floor(project.duration) + 1 }, (_, i) => (
              <span key={i} className="mono pointer-events-none absolute top-0.5 text-[9px]" style={{ left: `${(i / project.duration) * 100}%`, color: 'var(--ink-faint)' }}>{i}s</span>
            ))}
            {project.speedRamps.map((r) => (
              <div key={r.id}
                onPointerDown={(e) => { e.stopPropagation(); setSelMarker({ kind: 'ramp', id: r.id }); drag.current = { kind: 'ramp', id: r.id, edge: 'move', startT0: r.t0, startT1: r.t1, sx: e.clientX }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
                title={`speed ×${r.rate}`}
                className="absolute top-0 flex cursor-grab items-center justify-center text-[8px]"
                style={{ left: `${(r.t0 / project.duration) * 100}%`, width: `${((r.t1 - r.t0) / project.duration) * 100}%`, height: RULER_H, background: selMarker?.kind === 'ramp' && selMarker.id === r.id ? 'color-mix(in oklab, var(--accent) 45%, transparent)' : 'color-mix(in oklab, var(--accent) 22%, transparent)', color: 'var(--accent)' }}>
                ×{r.rate}
              </div>
            ))}
            {project.impacts.map((i) => (
              <div key={i.id}
                onPointerDown={(e) => { e.stopPropagation(); setSelMarker({ kind: 'impact', id: i.id }); seek(i.t); }}
                title={`impact (${i.style}) at ${i.t.toFixed(2)}s`}
                className="absolute top-0 h-full w-1.5 -translate-x-1/2 cursor-pointer"
                style={{ left: `${(i.t / project.duration) * 100}%`, background: i.style === 'bw' ? '#aaaaaa' : '#ffffff', outline: selMarker?.kind === 'impact' && selMarker.id === i.id ? '1px solid var(--accent)' : 'none' }} />
            ))}
            {project.postEffects.map((fx) => (
              <div key={fx.id}
                onPointerDown={(e) => { e.stopPropagation(); setSelMarker({ kind: 'posteffect', id: fx.id }); seek(fx.t); }}
                title={`${fx.kind} at ${fx.t.toFixed(2)}s`}
                className="absolute top-0 h-full w-1.5 -translate-x-1/2 cursor-pointer"
                style={{ left: `${(fx.t / project.duration) * 100}%`, background: '#ff5ec4', outline: selMarker?.kind === 'posteffect' && selMarker.id === fx.id ? '1px solid var(--accent)' : 'none' }} />
            ))}
            {project.markers.map((m) => (
              <div key={m.id}
                onPointerDown={(e) => { e.stopPropagation(); setSelMarker({ kind: 'bookmark', id: m.id }); seek(m.t); }}
                title={`${m.label} @ ${m.t.toFixed(2)}s`}
                className="absolute -top-1.5 h-2.5 w-2.5 -translate-x-1/2 cursor-pointer rotate-45"
                style={{ left: `${(m.t / project.duration) * 100}%`, background: m.color, outline: selMarker?.kind === 'bookmark' && selMarker.id === m.id ? '1px solid var(--ink)' : 'none' }} />
            ))}
            {project.shakes.map((s) => (
              <div key={s.id}
                onPointerDown={(e) => { e.stopPropagation(); setSelMarker({ kind: 'shake', id: s.id }); seek(s.t); }}
                title={`shake ${s.t.toFixed(2)}s–${(s.t + s.duration).toFixed(2)}s`}
                className="absolute bottom-0 h-1.5 cursor-pointer rounded"
                style={{ left: `${(s.t / project.duration) * 100}%`, width: `${(s.duration / project.duration) * 100}%`, background: selMarker?.kind === 'shake' && selMarker.id === s.id ? 'var(--color-amber)' : 'color-mix(in oklab, var(--color-amber) 60%, transparent)' }} />
            ))}
          </div>

          {waveform && (
            <div className="relative mt-0.5 flex items-center" style={{ height: WAVE_H, background: 'var(--surface)' }}>
              <svg width="100%" height={WAVE_H} preserveAspectRatio="none" viewBox={`0 0 ${waveform.length} 100`}>
                {waveform.map((b, i) => (
                  <rect key={i} x={i} y={50 - b.max * 50} width={1} height={Math.max(1, (b.max - b.min) * 50)} fill="var(--ink-faint)" />
                ))}
              </svg>
            </div>
          )}

          <div className="relative mt-1 flex flex-col gap-0.5">
            {project.groups.map((g) => {
              const members = project.layers.filter((l) => l.groupId === g.id);
              if (members.length === 0) return null;
              return (
                <div key={g.id}>
                  <div className="flex items-center gap-1.5 py-0.5">
                    <button type="button" onClick={() => setProject((p) => updateGroup(p, g.id, { collapsed: !g.collapsed }))} className="mono shrink-0 text-[9px]" style={{ color: 'var(--ink-faint)' }}>{g.collapsed ? '▶' : '▼'}</button>
                    <input value={g.name} onChange={(e) => setProject((p) => updateGroup(p, g.id, { name: e.target.value }))} className="mono w-20 shrink-0 truncate bg-transparent text-[10.5px] outline-none" style={{ color: 'var(--ink)' }} />
                    <input type="range" min={0} max={1} step={0.05} value={g.opacity} onChange={(e) => setProject((p) => updateGroup(p, g.id, { opacity: Number(e.target.value) }))} className="h-3 w-12" title="Folder opacity" />
                    <button type="button" onClick={() => setProject((p) => removeGroup(p, g.id))} className="mono shrink-0 text-[9px]" style={{ color: 'var(--color-rose)' }}>✕</button>
                  </div>
                  {!g.collapsed && members.map((l) => (
                    <LayerTrackRow key={l.id} layer={l} project={project} selId={selId} selKf={selKf} time={time} indent onSelect={() => { setSelId(l.id); setSelMarker(null); }}
                      onToggleVisible={() => patchLayerById(l.id, { visible: !l.visible })} onTrackDoubleClick={onTrackDoubleClick} onKeyDiamondDown={onKeyDiamondDown} seek={seek} />
                  ))}
                </div>
              );
            })}
            {project.layers.filter((l) => !l.groupId).map((l) => (
              <LayerTrackRow key={l.id} layer={l} project={project} selId={selId} selKf={selKf} time={time} onSelect={() => { setSelId(l.id); setSelMarker(null); }}
                onToggleVisible={() => patchLayerById(l.id, { visible: !l.visible })} onTrackDoubleClick={onTrackDoubleClick} onKeyDiamondDown={onKeyDiamondDown} seek={seek} />
            ))}
          </div>
          <div className="pointer-events-none absolute top-0 bottom-0 w-px" style={{ left: `calc(5rem + ${(time / project.duration) * 100}% * (100% - 5rem) / 100%)`, background: 'var(--accent)' }} />
        </div>
      </div>
    </div>
  );
}

// ── one row of the layer list / timeline track ──────────────────────────────────

function LayerTrackRow({ layer, project, selId, selKf, time, indent, onSelect, onToggleVisible, onTrackDoubleClick, onKeyDiamondDown, seek }: {
  layer: MotionLayer; project: MotionProject; selId: string | null; selKf: string | null; time: number; indent?: boolean;
  onSelect: () => void;
  onToggleVisible: () => void;
  onTrackDoubleClick: (e: React.MouseEvent, layer: MotionLayer) => void;
  onKeyDiamondDown: (e: React.PointerEvent, layerId: string, kfId: string) => void;
  seek: (t: number) => void;
}) {
  return (
    <div className={`flex items-center gap-2 ${indent ? 'pl-4' : ''}`}>
      <button type="button" onClick={onToggleVisible} className="mono shrink-0 text-[10px]" style={{ color: layer.visible ? 'var(--ink-dim)' : 'var(--ink-faint)' }} title="Toggle visibility">
        {layer.visible ? '◉' : '○'}
      </button>
      <button type="button" onClick={onSelect} className="mono w-16 shrink-0 truncate text-left text-[10.5px]" style={{ color: layer.id === selId ? 'var(--accent)' : 'var(--ink-dim)', opacity: layer.visible ? 1 : 0.5 }}>{layer.name}</button>
      {layer.kind === 'paint' && layer.paint ? (
        <div className="relative flex flex-1 gap-px overflow-hidden rounded" style={{ height: TRACK_H, background: layer.id === selId ? 'color-mix(in oklab, var(--accent) 10%, var(--surface))' : 'var(--surface)' }}>
          {layer.paint.frames.map((f, i) => (
            <button key={i} type="button" onClick={() => seek(i / layer.paint!.fps + 1e-4)}
              className="press shrink-0"
              style={{
                width: `${100 / layer.paint!.frames.length}%`,
                background: f.strokes.length ? 'color-mix(in oklab, var(--accent) 35%, var(--surface))' : 'transparent',
                outline: i === paintFrameIndexAt(layer.paint!, time) ? '2px solid var(--accent)' : 'none',
                outlineOffset: -1,
                borderRight: '1px solid var(--panel)',
              }}
              title={`frame ${i + 1}${f.strokes.length ? ` (${f.strokes.length} strokes)` : ' (empty)'}`} />
          ))}
        </div>
      ) : (
        <div className="relative flex-1 cursor-copy rounded" style={{ height: TRACK_H, background: layer.id === selId ? 'color-mix(in oklab, var(--accent) 10%, var(--surface))' : 'var(--surface)' }} onDoubleClick={(e) => onTrackDoubleClick(e, layer)}>
          {layer.keyframes.map((k) => (
            <div key={k.id} onPointerDown={(e) => onKeyDiamondDown(e, layer.id, k.id)}
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-grab"
              style={{ left: `${(k.t / project.duration) * 100}%`, background: k.id === selKf ? 'var(--accent)' : 'var(--ink)', border: '1px solid var(--panel)' }}
              title={`${k.t.toFixed(2)}s · ${k.easing}`} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── properties panel for a layer ───────────────────────────────────────────────

function LayerPanel({ layer, time, selKf, groups, onPatchLayer, onKeyNow, onPoseNow, onDeleteLayer, onDeleteKeyframe, onSetKfEasing, onPatchKeyframe, onNewGroup, onInsertFrame, onDuplicateFrame, onDeleteFrame, onFrameFps, onHoldFrame, onReverseFrames, onPingPongFrames, onStretchFrames, onGenerateGait, onDetachBone }: {
  layer: MotionLayer; time: number; selKf: string | null; groups: LayerGroup[];
  onPatchLayer: (patch: Partial<MotionLayer>) => void;
  onKeyNow: (props: Partial<Omit<Keyframe, 'id' | 't'>>) => void;
  onPoseNow: (boneId: string, angle: number) => void;
  onDeleteLayer: () => void;
  onDeleteKeyframe: () => void;
  onSetKfEasing: (easing: Easing) => void;
  onPatchKeyframe: (patch: Partial<Keyframe>) => void;
  onNewGroup: () => void;
  onInsertFrame: () => void;
  onDuplicateFrame: () => void;
  onDeleteFrame: () => void;
  onFrameFps: (fps: number) => void;
  onHoldFrame: () => void;
  onReverseFrames: () => void;
  onPingPongFrames: () => void;
  onStretchFrames: (n: number) => void;
  onGenerateGait: (mode: GaitMode) => void;
  onDetachBone: (boneId: string) => void;
}) {
  const v = valueAt(layer, time);
  const kf = layer.keyframes.find((k) => k.id === selKf) ?? null;
  const currentPose = layer.rig ? poseAt(layer.rig, layer.keyframes, time, easeFn(layer.keyframes[0]?.easing ?? 'linear')) : {};
  const frameIdx = layer.paint ? paintFrameIndexAt(layer.paint, time) : 0;

  return (
    <div className="flex flex-col gap-2.5">
      <input value={layer.name} onChange={(e) => onPatchLayer({ name: e.target.value })} aria-label="Layer name" className={`${inputCls} w-full font-semibold`} style={inputStyle} />

      <div className="flex items-center gap-2 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>
        <label className="mono flex items-center gap-1"><input type="checkbox" checked={layer.visible} onChange={(e) => onPatchLayer({ visible: e.target.checked })} /> visible</label>
        <label className="mono flex items-center gap-1" title="Only shows where the layer directly beneath it has coverage"><input type="checkbox" checked={layer.clipToBelow} onChange={(e) => onPatchLayer({ clipToBelow: e.target.checked })} /> clip to below</label>
      </div>
      <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-dim)' }}>
        folder
        <select value={layer.groupId ?? ''} onChange={(e) => (e.target.value === '__new__' ? onNewGroup() : onPatchLayer({ groupId: e.target.value || null }))} className={`${inputCls} flex-1`} style={{ ...inputStyle, background: 'var(--panel)' }}>
          <option value="">— none —</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          <option value="__new__">+ new folder…</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-dim)' }} title="How much of the camera's pan this layer follows — 1 = normal, less than 1 = a distant background that pans slower, more than 1 = a close foreground that pans faster">
        parallax
        <input type="number" step={0.05} value={layer.parallax} onChange={(e) => onPatchLayer({ parallax: Number(e.target.value) })} className={`${inputCls} w-16`} style={inputStyle} />
        <input type="range" min={0} max={2} step={0.05} value={layer.parallax} onChange={(e) => onPatchLayer({ parallax: Number(e.target.value) })} className="flex-1" />
      </label>

      {layer.kind === 'paint' && layer.paint && (
        <div className="border-t pt-2.5" style={{ borderColor: 'var(--line)' }}>
          <p className="mono mb-1.5 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>frame {frameIdx + 1} / {layer.paint.frames.length}</p>
          <div className="flex flex-wrap gap-1.5">
            <Btn onClick={onInsertFrame} small title="Insert a blank frame after this one"><SkillIcon name="doc" size={11} /> + Frame</Btn>
            <Btn onClick={onDuplicateFrame} small title="Duplicate this frame"><SkillIcon name="layers" size={11} /> Duplicate</Btn>
            <Btn onClick={onDeleteFrame} small title="Delete this frame"><SkillIcon name="bug" size={11} /> Delete</Btn>
          </div>
          <label className="mono mt-1.5 flex items-center gap-2 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>
            fps
            <input type="number" min={1} max={60} value={layer.paint.fps} onChange={(e) => onFrameFps(Number(e.target.value) || 12)} className={`${inputCls} w-16`} style={inputStyle} />
          </label>
          <p className="mono mb-1 mt-2 text-[9.5px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>frame operations</p>
          <div className="flex flex-wrap gap-1.5">
            <Btn onClick={onHoldFrame} small title="Repeat this frame once more right after itself"><SkillIcon name="spark" size={11} /> Hold</Btn>
            <Btn onClick={onReverseFrames} small title="Play the whole sequence back to front"><SkillIcon name="trend" size={11} /> Reverse</Btn>
            <Btn onClick={onPingPongFrames} small title="Forward then backward — a seamless back-and-forth loop"><SkillIcon name="layers" size={11} /> Ping-pong</Btn>
            <PaintStretchControl key={layer.paint.frames.length} frameCount={layer.paint.frames.length} onStretch={onStretchFrames} />
          </div>
        </div>
      )}

      {layer.kind === 'text' && <input value={layer.text} onChange={(e) => onPatchLayer({ text: e.target.value })} aria-label="Text content" className={`${inputCls} w-full`} style={inputStyle} />}
      {layer.kind === 'image' && (
        <label className="press mono flex cursor-pointer items-center justify-center gap-1.5 rounded border border-dashed px-2 py-2 text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>
          <SkillIcon name="image" size={13} /> {layer.src ? 'Replace image' : 'Choose image'}
          <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => onPatchLayer({ src: String(r.result) }); r.readAsDataURL(f); e.target.value = ''; }} />
        </label>
      )}
      {(layer.kind === 'text' || layer.kind === 'rect' || layer.kind === 'circle') && (
        <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-dim)' }}>
          colour <input type="color" value={layer.color} onChange={(e) => onPatchLayer({ color: e.target.value })} className="h-7 w-10 rounded border" style={{ borderColor: 'var(--line)' }} />
        </label>
      )}

      <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-dim)' }}>
        blend
        <select value={layer.blendMode} onChange={(e) => onPatchLayer({ blendMode: e.target.value as BlendMode })} className={`${inputCls} flex-1`} style={{ ...inputStyle, background: 'var(--panel)' }}>
          {BLEND_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex flex-col gap-0.5 text-[10px]" style={{ color: 'var(--ink-faint)' }}>w <input type="number" value={layer.w} onChange={(e) => onPatchLayer({ w: Math.max(4, Number(e.target.value) || 4) })} className={`${inputCls} w-full`} style={inputStyle} /></label>
        <label className="flex flex-col gap-0.5 text-[10px]" style={{ color: 'var(--ink-faint)' }}>h <input type="number" value={layer.h} onChange={(e) => onPatchLayer({ h: Math.max(4, Number(e.target.value) || 4) })} className={`${inputCls} w-full`} style={inputStyle} /></label>
      </div>

      {layer.kind === 'particles' && layer.particles && (
        <div className="border-t pt-2.5" style={{ borderColor: 'var(--line)' }}>
          <p className="mono mb-1.5 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>VFX — {layer.particles.preset}</p>
          <select value={layer.particles.preset} onChange={(e) => onPatchLayer({ particles: { ...newParticleConfig(e.target.value as ParticlePreset, layer.particles!.seed) } })} className={`${inputCls} mb-1.5 w-full`} style={{ ...inputStyle, background: 'var(--panel)' }}>
            {PARTICLE_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-1.5">
            <NumField label="spawn/s" value={layer.particles.spawnRate} min={0} onChange={(v) => onPatchLayer({ particles: { ...layer.particles!, spawnRate: Math.max(0, v) } })} />
            <NumField label="lifespan" value={layer.particles.lifespan} step={0.05} min={0.05} onChange={(v) => onPatchLayer({ particles: { ...layer.particles!, lifespan: Math.max(0.05, v) } })} />
            <NumField label="speed" value={layer.particles.speed} onChange={(v) => onPatchLayer({ particles: { ...layer.particles!, speed: v } })} />
            <NumField label="size" value={layer.particles.size} onChange={(v) => onPatchLayer({ particles: { ...layer.particles!, size: Math.max(1, v) } })} />
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>
            start <input type="color" value={layer.particles.colorStart} onChange={(e) => onPatchLayer({ particles: { ...layer.particles!, colorStart: e.target.value } })} className="h-6 w-8 rounded border" style={{ borderColor: 'var(--line)' }} />
            end <input type="color" value={layer.particles.colorEnd} onChange={(e) => onPatchLayer({ particles: { ...layer.particles!, colorEnd: e.target.value } })} className="h-6 w-8 rounded border" style={{ borderColor: 'var(--line)' }} />
          </div>
          <Btn onClick={() => onPatchLayer({ particles: { ...layer.particles!, seed: Math.floor(Math.random() * 1e6) } })} small title="Reshuffle the particle pool"><SkillIcon name="wand" size={11} /> Reshuffle</Btn>
        </div>
      )}

      {layer.kind === 'rig' && layer.rig && (
        <div className="border-t pt-2.5" style={{ borderColor: 'var(--line)' }}>
          <p className="mono mb-1.5 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>bones — pose at {fmt(time)}</p>
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
            {layer.rig.bones.map((b) => (
              <div key={b.id} className="flex flex-col gap-0.5 border-b pb-1" style={{ borderColor: 'var(--line)' }}>
                <div className="flex items-center gap-1.5">
                  <span className="mono w-20 shrink-0 truncate text-[10px]" style={{ color: 'var(--ink-dim)' }}>{b.name}</span>
                  <input type="number" value={Math.round((currentPose[b.id] ?? b.baseAngle) * 10) / 10} step={5}
                    onChange={(e) => onPoseNow(b.id, Number(e.target.value) || 0)}
                    className={`${miniCls} w-14`} style={inputStyle} />
                  <label className="mono flex items-center gap-0.5 text-[9px]" style={{ color: 'var(--ink-faint)' }} title="Secondary motion: this bone lags under gravity/momentum during Play instead of following its keyframed pose directly">
                    <input type="checkbox" checked={!!b.physics} onChange={(e) => onPatchLayer({ rig: { ...layer.rig!, bones: layer.rig!.bones.map((x) => (x.id === b.id ? { ...x, physics: e.target.checked } : x)) } })} />
                    phys
                  </label>
                  <Btn onClick={() => onDetachBone(b.id)} small title="Break this bone (and anything attached past it) off the rig here — it flies off and falls under gravity from the playhead on"><SkillIcon name="bug" size={10} /></Btn>
                </div>
                <div className="mono flex items-center gap-1 pl-[86px] text-[9px]" style={{ color: 'var(--ink-faint)' }} title="Joint limits — leave blank for none">
                  min <input type="number" value={b.minAngle ?? ''} placeholder="—"
                    onChange={(e) => onPatchLayer({ rig: { ...layer.rig!, bones: layer.rig!.bones.map((x) => (x.id === b.id ? { ...x, minAngle: e.target.value === '' ? undefined : Number(e.target.value) } : x)) } })}
                    className={`${miniCls} w-12`} style={inputStyle} />
                  max <input type="number" value={b.maxAngle ?? ''} placeholder="—"
                    onChange={(e) => onPatchLayer({ rig: { ...layer.rig!, bones: layer.rig!.bones.map((x) => (x.id === b.id ? { ...x, maxAngle: e.target.value === '' ? undefined : Number(e.target.value) } : x)) } })}
                    className={`${miniCls} w-12`} style={inputStyle} />
                </div>
              </div>
            ))}
          </div>

          <label className="mono mt-2 flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--ink-dim)' }} title="Every bone goes limp and falls under gravity during Play, instead of only ones marked phys">
            <input type="checkbox" checked={!!layer.rig.ragdoll} onChange={(e) => onPatchLayer({ rig: { ...layer.rig!, ragdoll: e.target.checked } })} />
            ragdoll (whole body) during Play
          </label>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <Btn onClick={() => onGenerateGait('walk')} small title="Generate a walk cycle from the playhead to the end of the project"><SkillIcon name="trend" size={11} /> + Walk cycle</Btn>
            <Btn onClick={() => onGenerateGait('run')} small title="Generate a run cycle from the playhead to the end of the project"><SkillIcon name="rocket" size={11} /> + Run cycle</Btn>
          </div>

          {layer.rig.detachments && layer.rig.detachments.length > 0 && (
            <div className="mt-2">
              <p className="mono mb-1 text-[9.5px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>detached</p>
              {layer.rig.detachments.map((d) => (
                <div key={d.id} className="mono flex items-center justify-between text-[10px]" style={{ color: 'var(--ink-dim)' }}>
                  <span>{layer.rig!.bones.find((b) => b.id === d.boneId)?.name ?? d.boneId} @ {d.t.toFixed(2)}s</span>
                  <Btn onClick={() => onPatchLayer({ rig: { ...layer.rig!, detachments: (layer.rig!.detachments ?? []).filter((x) => x.id !== d.id) } })} small title="Re-attach">✕</Btn>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {layer.kind === 'speedlines' && layer.speedlines && (
        <div className="border-t pt-2.5" style={{ borderColor: 'var(--line)' }}>
          <p className="mono mb-1.5 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>speed lines</p>
          <label className="mb-1.5 flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-dim)' }}>
            kind
            <select value={layer.speedlines.kind} onChange={(e) => onPatchLayer({ speedlines: { ...layer.speedlines!, kind: e.target.value as 'radial' | 'linear' } })} className={`${inputCls} flex-1`} style={{ ...inputStyle, background: 'var(--panel)' }}>
              <option value="radial">radial (impact burst)</option>
              <option value="linear">linear (fast pan/run)</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <NumField label="density" value={layer.speedlines.density} min={1} onChange={(v) => onPatchLayer({ speedlines: { ...layer.speedlines!, density: Math.max(1, Math.round(v)) } })} />
            <NumField label="length" value={layer.speedlines.length} min={1} onChange={(v) => onPatchLayer({ speedlines: { ...layer.speedlines!, length: Math.max(1, v) } })} />
            {layer.speedlines.kind === 'linear' && <NumField label="angle°" value={layer.speedlines.angleDeg} onChange={(v) => onPatchLayer({ speedlines: { ...layer.speedlines!, angleDeg: v } })} />}
            <NumField label="opacity" value={layer.speedlines.opacity} step={0.05} min={0} max={1} onChange={(v) => onPatchLayer({ speedlines: { ...layer.speedlines!, opacity: Math.max(0, Math.min(1, v)) } })} />
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>
            colour <input type="color" value={layer.speedlines.color} onChange={(e) => onPatchLayer({ speedlines: { ...layer.speedlines!, color: e.target.value } })} className="h-6 w-8 rounded border" style={{ borderColor: 'var(--line)' }} />
          </div>
          <Btn onClick={() => onPatchLayer({ speedlines: { ...layer.speedlines!, seed: Math.floor(Math.random() * 1e6) } })} small title="Reshuffle the line layout"><SkillIcon name="wand" size={11} /> Reshuffle</Btn>
        </div>
      )}

      <div className="border-t pt-2.5" style={{ borderColor: 'var(--line)' }}>
        <label className="mono flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>
          <input type="checkbox" checked={layer.motionBlur.enabled} onChange={(e) => onPatchLayer({ motionBlur: { ...layer.motionBlur, enabled: e.target.checked } })} />
          motion blur (trails behind real movement)
        </label>
        {layer.motionBlur.enabled && (
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <NumField label="strength" value={layer.motionBlur.strength} step={0.01} min={0} onChange={(v) => onPatchLayer({ motionBlur: { ...layer.motionBlur, strength: Math.max(0, v) } })} />
            <NumField label="ghosts" value={layer.motionBlur.samples} min={0} max={12} onChange={(v) => onPatchLayer({ motionBlur: { ...layer.motionBlur, samples: Math.max(0, Math.min(12, Math.round(v))) } })} />
          </div>
        )}
      </div>

      <div className="mt-1 border-t pt-2.5" style={{ borderColor: 'var(--line)' }}>
        <p className="mono mb-1.5 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>at {fmt(time)} — edit keys a keyframe here</p>
        <div className="grid grid-cols-2 gap-1.5">
          <NumField label="x" value={v.x} onChange={(val) => onKeyNow({ x: val })} />
          <NumField label="y" value={v.y} onChange={(val) => onKeyNow({ y: val })} />
          <NumField label="scale" value={v.scale} step={0.05} onChange={(val) => onKeyNow({ scale: val })} />
          <NumField label="rotate" value={v.rotation} onChange={(val) => onKeyNow({ rotation: val })} />
          <NumField label="opacity" value={v.opacity} step={0.05} min={0} max={1} onChange={(val) => onKeyNow({ opacity: Math.max(0, Math.min(1, val)) })} />
        </div>
        <Btn onClick={() => onKeyNow({})} small title="Add a keyframe at the playhead with the current values"><SkillIcon name="spark" size={11} /> Key here</Btn>
      </div>

      {kf && (
        <div className="border-t pt-2.5" style={{ borderColor: 'var(--line)' }}>
          <p className="mono mb-1.5 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>selected keyframe eases into the next</p>
          <select value={kf.customEase ? '__custom__' : kf.easing} onChange={(e) => (e.target.value === '__custom__' ? onPatchKeyframe({ customEase: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 } }) : (onPatchKeyframe({ customEase: undefined }), onSetKfEasing(e.target.value as Easing)))} className={`${inputCls} w-full`} style={{ ...inputStyle, background: 'var(--panel)' }}>
            {EASINGS.map((e) => <option key={e} value={e}>{e}</option>)}
            <option value="__custom__">custom (graph editor)…</option>
          </select>
          {kf.customEase && (
            <EaseGraphEditor ease={kf.customEase} onChange={(ease) => onPatchKeyframe({ customEase: ease })} />
          )}
          <p className="mono mb-1 mt-2.5 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }} title="Curves the spatial path this keyframe takes toward the next one — a straight line when both are left blank">motion path handle (out)</p>
          <div className="grid grid-cols-2 gap-1.5">
            <NumField label="handle dx" value={kf.pathOut?.dx ?? 0} onChange={(dx) => onPatchKeyframe({ pathOut: { dx, dy: kf.pathOut?.dy ?? 0 } })} />
            <NumField label="handle dy" value={kf.pathOut?.dy ?? 0} onChange={(dy) => onPatchKeyframe({ pathOut: { dx: kf.pathOut?.dx ?? 0, dy } })} />
          </div>
          {kf.pathOut && <Btn onClick={() => onPatchKeyframe({ pathOut: undefined })} small title="Back to a straight line leaving this keyframe">straighten</Btn>}
          <Btn onClick={onDeleteKeyframe} small title="Delete this keyframe (Del)"><SkillIcon name="bug" size={11} /> Delete key</Btn>
        </div>
      )}

      <Btn onClick={onDeleteLayer} title="Delete this layer"><SkillIcon name="bug" size={12} /> Delete layer</Btn>
    </div>
  );
}

// ── properties panel for a camera marker (shake / impact / speed ramp) ─────────

function MarkerPanel({ project, sel, onPatchShake, onPatchImpact, onPatchRamp, onPatchPostEffect, onPatchBookmark, onDelete }: {
  project: MotionProject; sel: NonNullable<MarkerSel>;
  onPatchShake: (id: string, patch: Partial<ShakeEvent>) => void;
  onPatchImpact: (id: string, patch: Partial<ImpactFrame>) => void;
  onPatchRamp: (id: string, patch: Partial<SpeedRamp>) => void;
  onPatchPostEffect: (id: string, patch: Partial<PostEffect>) => void;
  onPatchBookmark: (id: string, patch: Partial<TimelineMarker>) => void;
  onDelete: () => void;
}) {
  if (sel.kind === 'bookmark') {
    const m = project.markers.find((x) => x.id === sel.id);
    if (!m) return null;
    return (
      <div className="flex flex-col gap-2.5">
        <p className="mono text-[11px] font-semibold" style={{ color: 'var(--ink)' }}>Bookmark</p>
        <input value={m.label} onChange={(e) => onPatchBookmark(m.id, { label: e.target.value })} aria-label="Bookmark label" className={`${inputCls} w-full`} style={inputStyle} />
        <NumField label="at (s)" value={m.t} step={0.05} min={0} onChange={(v) => onPatchBookmark(m.id, { t: Math.max(0, v) })} />
        <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-dim)' }}>
          colour <input type="color" value={m.color} onChange={(e) => onPatchBookmark(m.id, { color: e.target.value })} className="h-7 w-10 rounded border" style={{ borderColor: 'var(--line)' }} />
        </label>
        <Btn onClick={onDelete} title="Delete this bookmark (Del)"><SkillIcon name="bug" size={12} /> Delete bookmark</Btn>
      </div>
    );
  }
  if (sel.kind === 'posteffect') {
    const fx = project.postEffects.find((x) => x.id === sel.id);
    if (!fx) return null;
    const preset = POST_EFFECT_KINDS.find((k) => k.kind === fx.kind)!;
    return (
      <div className="flex flex-col gap-2.5">
        <p className="mono text-[11px] font-semibold" style={{ color: 'var(--ink)' }}>{preset.label} effect</p>
        <NumField label="start (s)" value={fx.t} step={0.02} min={0} onChange={(v) => onPatchPostEffect(fx.id, { t: Math.max(0, v) })} />
        <NumField label="duration (s)" value={fx.duration} step={0.02} min={0.02} onChange={(v) => onPatchPostEffect(fx.id, { duration: Math.max(0.02, v) })} />
        {fx.kind !== 'invert' && (
          <NumField label={fx.kind === 'glitch' ? 'intensity' : fx.kind === 'warp' ? 'pull (px)' : 'offset (px)'} value={fx.strength} step={fx.kind === 'glitch' ? 0.05 : 1} onChange={(v) => onPatchPostEffect(fx.id, { strength: v })} />
        )}
        <Btn onClick={onDelete} title="Delete this effect (Del)"><SkillIcon name="bug" size={12} /> Delete effect</Btn>
      </div>
    );
  }
  if (sel.kind === 'shake') {
    const s = project.shakes.find((x) => x.id === sel.id);
    if (!s) return null;
    return (
      <div className="flex flex-col gap-2.5">
        <p className="mono text-[11px] font-semibold" style={{ color: 'var(--ink)' }}>Screen shake</p>
        <NumField label="start (s)" value={s.t} step={0.05} min={0} onChange={(v) => onPatchShake(s.id, { t: Math.max(0, v) })} />
        <NumField label="duration (s)" value={s.duration} step={0.02} min={0.02} onChange={(v) => onPatchShake(s.id, { duration: Math.max(0.02, v) })} />
        <NumField label="magnitude (px)" value={s.magnitude} onChange={(v) => onPatchShake(s.id, { magnitude: Math.max(0, v) })} />
        <Btn onClick={onDelete} title="Delete this shake (Del)"><SkillIcon name="bug" size={12} /> Delete shake</Btn>
      </div>
    );
  }
  if (sel.kind === 'impact') {
    const i = project.impacts.find((x) => x.id === sel.id);
    if (!i) return null;
    return (
      <div className="flex flex-col gap-2.5">
        <p className="mono text-[11px] font-semibold" style={{ color: 'var(--ink)' }}>Impact frame</p>
        <NumField label="start (s)" value={i.t} step={0.02} min={0} onChange={(v) => onPatchImpact(i.id, { t: Math.max(0, v) })} />
        <NumField label="duration (s)" value={i.duration} step={0.02} min={0.02} onChange={(v) => onPatchImpact(i.id, { duration: Math.max(0.02, v) })} />
        <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-dim)' }}>
          style
          <select value={i.style} onChange={(e) => onPatchImpact(i.id, { style: e.target.value as ImpactStyle })} className={`${inputCls} flex-1`} style={{ ...inputStyle, background: 'var(--panel)' }}>
            <option value="flash">white flash</option>
            <option value="bw">black &amp; white</option>
          </select>
        </label>
        <Btn onClick={onDelete} title="Delete this impact frame (Del)"><SkillIcon name="bug" size={12} /> Delete impact</Btn>
      </div>
    );
  }
  const r = project.speedRamps.find((x) => x.id === sel.id);
  if (!r) return null;
  return (
    <div className="flex flex-col gap-2.5">
      <p className="mono text-[11px] font-semibold" style={{ color: 'var(--ink)' }}>Speed ramp</p>
      <NumField label="start (s)" value={r.t0} step={0.05} min={0} onChange={(v) => onPatchRamp(r.id, { t0: Math.max(0, Math.min(r.t1 - 0.02, v)) })} />
      <NumField label="end (s)" value={r.t1} step={0.05} min={0} onChange={(v) => onPatchRamp(r.id, { t1: Math.max(r.t0 + 0.02, v) })} />
      <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-dim)' }}>
        rate
        <select value={r.rate} onChange={(e) => onPatchRamp(r.id, { rate: Number(e.target.value) })} className={`${inputCls} flex-1`} style={{ ...inputStyle, background: 'var(--panel)' }}>
          <option value={0.15}>0.15× (extreme slow-mo)</option>
          <option value={0.35}>0.35× (slow-mo)</option>
          <option value={0.6}>0.6× (slight slow)</option>
          <option value={2}>2× (fast)</option>
          <option value={3}>3× (very fast)</option>
        </select>
      </label>
      <Btn onClick={onDelete} title="Delete this speed ramp (Del)"><SkillIcon name="bug" size={12} /> Delete ramp</Btn>
    </div>
  );
}
