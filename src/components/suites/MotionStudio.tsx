'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSetting, setSetting } from '@/lib/db/history';
import { downloadBlob, downloadText, downloadZip } from '@/lib/zip';
import { SkillIcon } from '@/components/SkillIcon';
import {
  BLEND_MODES,
  EASINGS,
  STAGE_PRESETS,
  addLayer,
  emptyProject,
  exportCss,
  exportGsap,
  exportHtml,
  exportZip,
  moveKeyframe,
  normalizeProject,
  removeKeyframe,
  removeLayer,
  setKeyframe,
  updateLayer,
  valueAt,
  type BlendMode,
  type Easing,
  type Keyframe,
  type LayerKind,
  type MotionLayer,
  type MotionProject,
} from '@/lib/suites/motion/project';
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
import { newRig, poseAt, stepPhysicsBone, type PhysicsState } from '@/lib/suites/motion/rig';
import { drawFrame } from '@/lib/suites/motion/render';
import { pickVideoCodec, renderGif, renderVideo } from '@/lib/suites/motion/exportMedia';
import { peaksFromSamples, mixChannelsDown, type WaveformBucket } from '@/lib/suites/motion/audio';
import { jjkShowcaseProject } from '@/lib/suites/motion/presets';

const KEY = 'motion.project.v1';
const TRACK_H = 30;
const RULER_H = 20;
const WAVE_H = 28;

const BASIC_KINDS: Array<{ kind: LayerKind; icon: string; label: string }> = [
  { kind: 'text', icon: 'doc', label: 'Text' },
  { kind: 'rect', icon: 'blocks', label: 'Rectangle' },
  { kind: 'circle', icon: 'spark', label: 'Circle' },
  { kind: 'image', icon: 'image', label: 'Image' },
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

const fmt = (s: number) => `${s < 0 ? '-' : ''}${Math.floor(Math.abs(s) / 60)}:${(Math.abs(s) % 60).toFixed(2).padStart(5, '0')}`;

type MarkerSel = { kind: 'shake' | 'impact' | 'ramp'; id: string } | null;

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
  const [exporting, setExporting] = useState<'gif' | 'video' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [waveform, setWaveform] = useState<WaveformBucket[] | null>(null);

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

  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(() => { timeRef.current = time; }, [time]);

  useEffect(() => {
    void getSetting<unknown>(KEY, null).then((p) => { if (p) setProject(normalizeProject(p)); setLoaded(true); });
  }, []);
  useEffect(() => { if (loaded) void setSetting(KEY, project); }, [project, loaded]);

  const selected = project.layers.find((l) => l.id === selId) ?? null;

  // ── image preloading ───────────────────────────────────────────────────────
  useEffect(() => {
    for (const l of project.layers) {
      if (l.kind !== 'image' || !l.src || imagesRef.current.has(l.src)) continue;
      const img = new Image();
      img.onload = () => setImagesVersion((v) => v + 1);
      img.src = l.src;
      imagesRef.current.set(l.src, img);
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
  const onStagePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = stageRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const s = stageScale();
    const sx = (e.clientX - rect.left) / s, sy = (e.clientY - rect.top) / s;
    const hit = hitTestLayer(sx, sy);
    setSelId(hit?.id ?? null);
    setSelMarker(null);
    if (!hit) return;
    const v = valueAt(hit, time);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind: 'layer', id: hit.id, ox: v.x, oy: v.y, sx: e.clientX, sy: e.clientY };
  };
  const onStagePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.kind !== 'layer') return;
    const s = stageScale();
    const nx = Math.round(d.ox + (e.clientX - d.sx) / s);
    const ny = Math.round(d.oy + (e.clientY - d.sy) / s);
    setProject((p) => ({ ...p, layers: p.layers.map((l) => (l.id === d.id ? setKeyframe(l, time, { x: nx, y: ny }) : l)) }));
  };
  const onStagePointerUp = () => { drag.current = null; };

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
  const deleteMarker = () => {
    if (!selMarker) return;
    setProject((p) => {
      if (selMarker.kind === 'shake') return { ...p, shakes: p.shakes.filter((s) => s.id !== selMarker.id) };
      if (selMarker.kind === 'impact') return { ...p, impacts: p.impacts.filter((i) => i.id !== selMarker.id) };
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
        <div className="flex flex-1 items-center justify-center overflow-auto p-4">
          <canvas
            ref={stageRef}
            width={project.width}
            height={project.height}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            className="shrink-0 touch-none rounded-lg border-2 shadow-lg"
            style={{ width: project.width * stageScaleDisplay, height: project.height * stageScaleDisplay, borderColor: 'var(--line)' }}
          />
        </div>

        {/* Properties panel */}
        <div className="w-64 shrink-0 overflow-y-auto border-l p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          {selMarker ? (
            <MarkerPanel project={project} sel={selMarker} onPatchShake={patchShake} onPatchImpact={patchImpact} onPatchRamp={patchRamp} onDelete={deleteMarker} />
          ) : !selected ? (
            <p className="text-[11.5px] leading-[1.6]" style={{ color: 'var(--ink-faint)' }}>Pick a layer on the stage, or add one. Drag to move; the timeline below keys its position at the playhead. Camera previews during Play.</p>
          ) : (
            <LayerPanel
              layer={selected} time={time} selKf={selKf}
              onPatchLayer={patchLayer} onKeyNow={keyNow} onPoseNow={poseNow}
              onDeleteLayer={onDeleteLayer} onDeleteKeyframe={onDeleteKeyframe}
              onSetKfEasing={(easing) => setProject((p) => ({ ...p, layers: p.layers.map((l) => (l.id === selId ? { ...l, keyframes: l.keyframes.map((k) => (k.id === selKf ? { ...k, easing } : k)) } : l)) }))}
            />
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="shrink-0 border-t" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
          <Btn onClick={() => setPlaying((x) => !x)} small title="Play / pause (space)"><SkillIcon name={playing ? 'bug' : 'spark'} size={11} />{playing ? 'Pause' : 'Play'}</Btn>
          <span className="mono text-[10.5px] tabular-nums" style={{ color: 'var(--ink-dim)' }}>{fmt(time)} / {fmt(project.duration)}</span>
          <label className="mono flex items-center gap-1 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>
            <input type="checkbox" checked={project.onionSkin.enabled} onChange={(e) => setProject((p) => ({ ...p, onionSkin: { ...p.onionSkin, enabled: e.target.checked } }))} />
            onion skin
          </label>
          {project.onionSkin.enabled && (
            <input type="range" min={0.1} max={0.8} step={0.05} value={project.onionSkin.opacity}
              onChange={(e) => setProject((p) => ({ ...p, onionSkin: { ...p.onionSkin, opacity: Number(e.target.value) } }))}
              className="w-20" aria-label="Onion skin opacity" />
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
            {project.layers.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <button type="button" onClick={() => { setSelId(l.id); setSelMarker(null); }} className="mono w-20 shrink-0 truncate text-left text-[10.5px]" style={{ color: l.id === selId ? 'var(--accent)' : 'var(--ink-dim)' }}>{l.name}</button>
                <div className="relative flex-1 cursor-copy rounded" style={{ height: TRACK_H, background: l.id === selId ? 'color-mix(in oklab, var(--accent) 10%, var(--surface))' : 'var(--surface)' }} onDoubleClick={(e) => onTrackDoubleClick(e, l)}>
                  {l.keyframes.map((k) => (
                    <div key={k.id} onPointerDown={(e) => onKeyDiamondDown(e, l.id, k.id)}
                      className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-grab"
                      style={{ left: `${(k.t / project.duration) * 100}%`, background: k.id === selKf ? 'var(--accent)' : 'var(--ink)', border: '1px solid var(--panel)' }}
                      title={`${k.t.toFixed(2)}s · ${k.easing}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="pointer-events-none absolute top-0 bottom-0 w-px" style={{ left: `calc(5rem + ${(time / project.duration) * 100}% * (100% - 5rem) / 100%)`, background: 'var(--accent)' }} />
        </div>
      </div>
    </div>
  );
}

// ── properties panel for a layer ───────────────────────────────────────────────

function LayerPanel({ layer, time, selKf, onPatchLayer, onKeyNow, onPoseNow, onDeleteLayer, onDeleteKeyframe, onSetKfEasing }: {
  layer: MotionLayer; time: number; selKf: string | null;
  onPatchLayer: (patch: Partial<MotionLayer>) => void;
  onKeyNow: (props: Partial<Omit<Keyframe, 'id' | 't'>>) => void;
  onPoseNow: (boneId: string, angle: number) => void;
  onDeleteLayer: () => void;
  onDeleteKeyframe: () => void;
  onSetKfEasing: (easing: Easing) => void;
}) {
  const v = valueAt(layer, time);
  const kf = layer.keyframes.find((k) => k.id === selKf) ?? null;
  const currentPose = layer.rig ? poseAt(layer.rig, layer.keyframes, time, easeFn(layer.keyframes[0]?.easing ?? 'linear')) : {};

  return (
    <div className="flex flex-col gap-2.5">
      <input value={layer.name} onChange={(e) => onPatchLayer({ name: e.target.value })} aria-label="Layer name" className={`${inputCls} w-full font-semibold`} style={inputStyle} />

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
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto pr-1">
            {layer.rig.bones.map((b) => (
              <div key={b.id} className="flex items-center gap-1.5">
                <span className="mono w-20 shrink-0 truncate text-[10px]" style={{ color: 'var(--ink-dim)' }}>{b.name}</span>
                <input type="number" value={Math.round((currentPose[b.id] ?? b.baseAngle) * 10) / 10} step={5}
                  onChange={(e) => onPoseNow(b.id, Number(e.target.value) || 0)}
                  className={`${miniCls} w-16`} style={inputStyle} />
                <label className="mono flex items-center gap-0.5 text-[9px]" style={{ color: 'var(--ink-faint)' }} title="Secondary motion: this bone lags under gravity/momentum during Play instead of following its keyframed pose directly">
                  <input type="checkbox" checked={!!b.physics} onChange={(e) => onPatchLayer({ rig: { ...layer.rig!, bones: layer.rig!.bones.map((x) => (x.id === b.id ? { ...x, physics: e.target.checked } : x)) } })} />
                  phys
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

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
          <select value={kf.easing} onChange={(e) => onSetKfEasing(e.target.value as Easing)} className={`${inputCls} w-full`} style={{ ...inputStyle, background: 'var(--panel)' }}>
            {EASINGS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <Btn onClick={onDeleteKeyframe} small title="Delete this keyframe (Del)"><SkillIcon name="bug" size={11} /> Delete key</Btn>
        </div>
      )}

      <Btn onClick={onDeleteLayer} title="Delete this layer"><SkillIcon name="bug" size={12} /> Delete layer</Btn>
    </div>
  );
}

// ── properties panel for a camera marker (shake / impact / speed ramp) ─────────

function MarkerPanel({ project, sel, onPatchShake, onPatchImpact, onPatchRamp, onDelete }: {
  project: MotionProject; sel: NonNullable<MarkerSel>;
  onPatchShake: (id: string, patch: Partial<ShakeEvent>) => void;
  onPatchImpact: (id: string, patch: Partial<ImpactFrame>) => void;
  onPatchRamp: (id: string, patch: Partial<SpeedRamp>) => void;
  onDelete: () => void;
}) {
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
