'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSetting, setSetting } from '@/lib/db/history';
import { downloadText, downloadZip } from '@/lib/zip';
import { SkillIcon } from '@/components/SkillIcon';
import {
  EASINGS,
  STAGE_PRESETS,
  addLayer,
  easeFn,
  emptyProject,
  exportCss,
  exportGsap,
  exportHtml,
  exportZip,
  moveKeyframe,
  removeKeyframe,
  removeLayer,
  setKeyframe,
  updateLayer,
  valueAt,
  type Easing,
  type Keyframe,
  type LayerKind,
  type MotionLayer,
  type MotionProject,
} from '@/lib/suites/motion/project';

const KEY = 'motion.project.v1';
const TRACK_H = 30;
const RULER_H = 20;
const KINDS: Array<{ kind: LayerKind; icon: string; label: string }> = [
  { kind: 'text', icon: 'doc', label: 'Text' },
  { kind: 'rect', icon: 'blocks', label: 'Rectangle' },
  { kind: 'circle', icon: 'spark', label: 'Circle' },
  { kind: 'image', icon: 'image', label: 'Image' },
];

const inputCls = 'mono rounded border bg-transparent px-2 py-1.5 text-[11.5px] outline-none';
const inputStyle = { borderColor: 'var(--line)', color: 'var(--ink)' } as const;

function Btn({ children, onClick, disabled, primary, title, small }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; title?: string; small?: boolean }) {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled}
      className={`press mono inline-flex shrink-0 items-center gap-1.5 rounded ${small ? 'px-2 py-1 text-[10.5px]' : 'px-2.5 py-1.5 text-[11px]'} font-medium disabled:opacity-35`}
      style={primary ? { background: 'var(--accent)', color: '#04150e' } : { border: '1px solid var(--line)', color: 'var(--ink-dim)' }}>
      {children}
    </button>
  );
}

const fmt = (s: number) => `${s < 0 ? '-' : ''}${Math.floor(Math.abs(s) / 60)}:${(Math.abs(s) % 60).toFixed(2).padStart(5, '0')}`;

/**
 * A layers-and-keyframes motion editor: a stage, a properties panel, and a timeline you scrub and key
 * directly. Exports CSS, a GSAP script, or a self-contained HTML page — real motion code to drop into a
 * project, not a rendered video (see suites/motion/project.ts for why).
 */
export function MotionStudio() {
  const [project, setProject] = useState<MotionProject>(emptyProject());
  const [loaded, setLoaded] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [selKf, setSelKf] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'layer'; id: string; ox: number; oy: number; sx: number; sy: number } | { kind: 'kf'; layerId: string; kfId: string } | { kind: 'playhead' } | null>(null);
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    void getSetting<MotionProject | null>(KEY, null).then((p) => { if (p) setProject(p); setLoaded(true); });
  }, []);
  useEffect(() => { if (loaded) void setSetting(KEY, project); }, [project, loaded]);

  const selected = project.layers.find((l) => l.id === selId) ?? null;

  // ── playback ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => {
        const next = t + dt;
        return next >= project.duration ? 0 : next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, project.duration]);

  const seek = (t: number) => setTime(Math.max(0, Math.min(project.duration, t)));

  // ── layers ──────────────────────────────────────────────────────────────
  const onAddLayer = (kind: LayerKind) => {
    const next = addLayer(project, kind);
    setProject(next);
    setSelId(next.layers[next.layers.length - 1]!.id);
    setAddOpen(false);
  };
  const patchLayer = (patch: Partial<MotionLayer>) => { if (selId) setProject((p) => updateLayer(p, selId, patch)); };
  const keyNow = (props: Partial<Omit<Keyframe, 'id' | 't'>>) => {
    if (!selId) return;
    setProject((p) => ({ ...p, layers: p.layers.map((l) => (l.id === selId ? setKeyframe(l, time, props) : l)) }));
  };
  const onDeleteLayer = () => { if (!selId) return; setProject((p) => removeLayer(p, selId)); setSelId(null); };

  // ── dragging a layer on the stage ──────────────────────────────────────
  const stageScale = () => {
    const el = stageRef.current;
    if (!el) return 1;
    return el.clientWidth / project.width;
  };
  const onLayerPointerDown = (e: React.PointerEvent, layer: MotionLayer) => {
    e.stopPropagation();
    setSelId(layer.id);
    const v = valueAt(layer, time);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind: 'layer', id: layer.id, ox: v.x, oy: v.y, sx: e.clientX, sy: e.clientY };
  };
  const onStagePointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.kind !== 'layer') return;
    const s = stageScale();
    const nx = Math.round(d.ox + (e.clientX - d.sx) / s);
    const ny = Math.round(d.oy + (e.clientY - d.sy) / s);
    setProject((p) => ({ ...p, layers: p.layers.map((l) => (l.id === d.id ? setKeyframe(l, time, { x: nx, y: ny }) : l)) }));
  };
  const onStagePointerUp = () => { drag.current = null; };

  // ── timeline ────────────────────────────────────────────────────────────
  const trackWidth = () => timelineRef.current?.clientWidth ?? 600;
  const xToTime = (x: number) => Math.max(0, Math.min(project.duration, (x / trackWidth()) * project.duration));

  const onRulerPointerDown = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seek(xToTime(e.clientX - rect.left));
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
  };
  const onTimelinePointerUp = () => { drag.current = null; };

  const onKeyDiamondDown = (e: React.PointerEvent, layerId: string, kfId: string) => {
    e.stopPropagation();
    setSelId(layerId); setSelKf(kfId);
    drag.current = { kind: 'kf', layerId, kfId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onTrackDoubleClick = (e: React.MouseEvent, layer: MotionLayer) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = xToTime(e.clientX - rect.left);
    setProject((p) => ({ ...p, layers: p.layers.map((l) => (l.id === layer.id ? setKeyframe(l, t, {}) : l)) }));
    setSelId(layer.id);
  };
  const onDeleteKeyframe = () => {
    if (!selId || !selKf) return;
    setProject((p) => ({ ...p, layers: p.layers.map((l) => (l.id === selId ? removeKeyframe(l, selKf) : l)) }));
    setSelKf(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selKf && !(e.target as HTMLElement)?.closest('input,textarea')) onDeleteKeyframe();
      if (e.key === ' ' && !(e.target as HTMLElement)?.closest('input,textarea')) { e.preventDefault(); setPlaying((x) => !x); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selId, selKf]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── export ──────────────────────────────────────────────────────────────
  const fileBase = (project.title || 'motion').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'motion';
  const doExport = (kind: 'css' | 'gsap' | 'html' | 'zip') => {
    if (kind === 'css') downloadText(exportCss(project), `${fileBase}.css`, 'text/css;charset=utf-8');
    else if (kind === 'gsap') downloadText(exportGsap(project), `${fileBase}.gsap.js`, 'text/javascript;charset=utf-8');
    else if (kind === 'html') downloadText(exportHtml(project), `${fileBase}.html`, 'text/html;charset=utf-8');
    else downloadZip(exportZip(project), `${fileBase}.zip`);
    setExportOpen(false);
  };

  const stageScaleDisplay = useMemo(() => Math.min(1, 560 / project.width), [project.width]);
  const vSel = selected ? valueAt(selected, time) : null;

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg)' }}>
      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
        <SkillIcon name="film" size={16} className="shrink-0" />
        <input value={project.title} onChange={(e) => setProject((p) => ({ ...p, title: e.target.value }))} aria-label="Project name" className={`${inputCls} w-36 font-semibold`} style={inputStyle} />
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
        <div className="ml-auto flex items-center gap-1.5">
          <div className="relative">
            <Btn onClick={() => setAddOpen((x) => !x)} primary title="Add a layer"><SkillIcon name="wand" size={13} /> + Layer</Btn>
            {addOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border p-1 shadow-lg" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
                {KINDS.map((k) => (
                  <button key={k.kind} type="button" onClick={() => onAddLayer(k.kind)} className="press mono flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11.5px]" style={{ color: 'var(--ink)' }}>
                    <SkillIcon name={k.icon} size={13} /> {k.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <Btn onClick={() => setExportOpen((x) => !x)} title="Export motion code"><SkillIcon name="package" size={13} /> Export</Btn>
            {exportOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border p-1 shadow-lg" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
                {([['html', 'Standalone .html'], ['css', 'CSS @keyframes'], ['gsap', 'GSAP script (.js)'], ['zip', 'All of it + .json']] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => doExport(k)} className="press mono block w-full rounded px-2 py-1.5 text-left text-[11.5px]" style={{ color: 'var(--ink)' }}>{label}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stage + properties */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex flex-1 items-center justify-center overflow-auto p-4" onPointerMove={onStagePointerMove} onPointerUp={onStagePointerUp}>
          <div ref={stageRef} className="relative shrink-0 overflow-hidden rounded-lg border-2 shadow-lg" onPointerDown={() => setSelId(null)}
            style={{ width: project.width * stageScaleDisplay, height: project.height * stageScaleDisplay, background: project.background, borderColor: 'var(--line)' }}>
            <div style={{ transform: `scale(${stageScaleDisplay})`, transformOrigin: 'top left', width: project.width, height: project.height, position: 'relative' }}>
              {project.layers.map((l) => {
                const v = valueAt(l, time);
                const sel = l.id === selId;
                const common: React.CSSProperties = {
                  position: 'absolute', left: 0, top: 0, width: l.w, height: l.h,
                  transform: `translate(${v.x}px, ${v.y}px) rotate(${v.rotation}deg) scale(${v.scale})`,
                  opacity: v.opacity, cursor: 'move', outline: sel ? '2px solid var(--accent)' : 'none', outlineOffset: 2,
                  borderRadius: l.kind === 'circle' ? '50%' : undefined,
                  background: l.kind === 'text' ? 'transparent' : l.kind === 'image' ? undefined : l.color,
                };
                return (
                  <div key={l.id} onPointerDown={(e) => onLayerPointerDown(e, l)} style={common} title={l.name}>
                    {l.kind === 'text' && <span style={{ color: l.color, font: `700 ${Math.round(l.h * 0.6)}px/${l.h}px system-ui,sans-serif`, whiteSpace: 'nowrap', userSelect: 'none' }}>{l.text}</span>}
                    {l.kind === 'image' && l.src && <img src={l.src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Properties panel */}
        <div className="w-60 shrink-0 overflow-y-auto border-l p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          {!selected ? (
            <p className="text-[11.5px] leading-[1.6]" style={{ color: 'var(--ink-faint)' }}>Pick a layer on the stage, or add one. Drag to move; the timeline below keys its position at the playhead.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              <input value={selected.name} onChange={(e) => patchLayer({ name: e.target.value })} aria-label="Layer name" className={`${inputCls} w-full font-semibold`} style={inputStyle} />
              {selected.kind === 'text' && <input value={selected.text} onChange={(e) => patchLayer({ text: e.target.value })} aria-label="Text content" className={`${inputCls} w-full`} style={inputStyle} />}
              {selected.kind === 'image' && (
                <label className="press mono flex cursor-pointer items-center justify-center gap-1.5 rounded border border-dashed px-2 py-2 text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>
                  <SkillIcon name="image" size={13} /> {selected.src ? 'Replace image' : 'Choose image'}
                  <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => patchLayer({ src: String(r.result) }); r.readAsDataURL(f); e.target.value = ''; }} />
                </label>
              )}
              {selected.kind !== 'image' && (
                <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-dim)' }}>
                  colour <input type="color" value={selected.color} onChange={(e) => patchLayer({ color: e.target.value })} className="h-7 w-10 rounded border" style={{ borderColor: 'var(--line)' }} />
                </label>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <label className="flex flex-col gap-0.5 text-[10px]" style={{ color: 'var(--ink-faint)' }}>w <input type="number" value={selected.w} onChange={(e) => patchLayer({ w: Math.max(4, Number(e.target.value) || 4) })} className={`${inputCls} w-full`} style={inputStyle} /></label>
                <label className="flex flex-col gap-0.5 text-[10px]" style={{ color: 'var(--ink-faint)' }}>h <input type="number" value={selected.h} onChange={(e) => patchLayer({ h: Math.max(4, Number(e.target.value) || 4) })} className={`${inputCls} w-full`} style={inputStyle} /></label>
              </div>

              <div className="mt-1 border-t pt-2.5" style={{ borderColor: 'var(--line)' }}>
                <p className="mono mb-1.5 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>at {fmt(time)} — edit keys a keyframe here</p>
                {vSel && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <NumField label="x" value={vSel.x} onChange={(v) => keyNow({ x: v })} />
                    <NumField label="y" value={vSel.y} onChange={(v) => keyNow({ y: v })} />
                    <NumField label="scale" value={vSel.scale} step={0.05} onChange={(v) => keyNow({ scale: v })} />
                    <NumField label="rotate" value={vSel.rotation} onChange={(v) => keyNow({ rotation: v })} />
                    <NumField label="opacity" value={vSel.opacity} step={0.05} min={0} max={1} onChange={(v) => keyNow({ opacity: Math.max(0, Math.min(1, v)) })} />
                  </div>
                )}
                <Btn onClick={() => keyNow({})} small title="Add a keyframe at the playhead with the current values"><SkillIcon name="spark" size={11} /> Key here</Btn>
              </div>

              {selKf && selected.keyframes.find((k) => k.id === selKf) && (
                <div className="border-t pt-2.5" style={{ borderColor: 'var(--line)' }}>
                  <p className="mono mb-1.5 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>selected keyframe eases into the next</p>
                  <select value={selected.keyframes.find((k) => k.id === selKf)!.easing} onChange={(e) => setProject((p) => ({ ...p, layers: p.layers.map((l) => (l.id === selId ? { ...l, keyframes: l.keyframes.map((k) => (k.id === selKf ? { ...k, easing: e.target.value as Easing } : k)) } : l)) }))}
                    className={`${inputCls} w-full`} style={{ ...inputStyle, background: 'var(--panel)' }}>
                    {EASINGS.map((e) => <option key={e} value={e}>{e}</option>)}
                  </select>
                  <Btn onClick={onDeleteKeyframe} small title="Delete this keyframe (Del)"><SkillIcon name="bug" size={11} /> Delete key</Btn>
                </div>
              )}

              <Btn onClick={onDeleteLayer} title="Delete this layer"><SkillIcon name="bug" size={12} /> Delete layer</Btn>
            </div>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="shrink-0 border-t" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
        <div className="flex items-center gap-2 px-3 py-1.5">
          <Btn onClick={() => setPlaying((x) => !x)} small title="Play / pause (space)"><SkillIcon name={playing ? 'bug' : 'spark'} size={11} />{playing ? 'Pause' : 'Play'}</Btn>
          <span className="mono text-[10.5px] tabular-nums" style={{ color: 'var(--ink-dim)' }}>{fmt(time)} / {fmt(project.duration)}</span>
          <span className="mono ml-auto text-[10px]" style={{ color: 'var(--ink-faint)' }}>double-click a track to key · drag diamonds to retime · Del to remove a key</span>
        </div>
        <div ref={timelineRef} className="relative select-none px-3 pb-3" onPointerMove={onTimelinePointerMove} onPointerUp={onTimelinePointerUp}>
          <div className="relative cursor-pointer rounded" style={{ height: RULER_H, background: 'var(--surface)' }} onPointerDown={onRulerPointerDown}>
            {Array.from({ length: Math.floor(project.duration) + 1 }, (_, i) => (
              <span key={i} className="mono absolute top-0.5 text-[9px]" style={{ left: `${(i / project.duration) * 100}%`, color: 'var(--ink-faint)' }}>{i}s</span>
            ))}
          </div>
          <div className="relative mt-1 flex flex-col gap-0.5">
            {project.layers.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <button type="button" onClick={() => setSelId(l.id)} className="mono w-20 shrink-0 truncate text-left text-[10.5px]" style={{ color: l.id === selId ? 'var(--accent)' : 'var(--ink-dim)' }}>{l.name}</button>
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

function NumField({ label, value, onChange, step = 1, min, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <label className="flex flex-col gap-0.5 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
      {label}
      <input type="number" value={Math.round(value * 1000) / 1000} step={step} min={min} max={max} onChange={(e) => onChange(Number(e.target.value) || 0)} className={`${inputCls} w-full`} style={inputStyle} />
    </label>
  );
}
