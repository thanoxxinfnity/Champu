'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { withKeys } from '@/lib/keys';
import { getSetting, setSetting } from '@/lib/db/history';
import { downloadText, downloadZip } from '@/lib/zip';
import { browserIo, loadOdIndex } from '@/lib/skills/opendesign/io';
import { openDesignContext } from '@/lib/skills/opendesign/context';
import type { OdIndex } from '@/lib/skills/opendesign/types';
import { SkillIcon } from '@/components/SkillIcon';
import {
  DEVICES,
  EMPTY_BOARD,
  exportEntries,
  extractHtml,
  newId,
  newScreenPrompt,
  nextSlot,
  revisePrompt,
  slug,
  systemPrompt,
  type CanvasBoard as Board,
  type CanvasScreen,
  type Device,
} from '@/lib/suites/canvas/board';

const KEY = 'canvas.board.v1';
const MIN_Z = 0.1;
const MAX_Z = 2;
const inputCls = 'mono rounded border bg-transparent px-2 py-1.5 text-[11.5px] outline-none';
const inputStyle = { borderColor: 'var(--line)', color: 'var(--ink)' } as const;

function Btn({ children, onClick, disabled, primary, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="press mono inline-flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-35"
      style={primary ? { background: 'var(--accent)', color: '#04150e' } : { border: '1px solid var(--line)', color: 'var(--ink-dim)' }}
    >
      {children}
    </button>
  );
}

/**
 * A board for designing the screens of an app or a website. Screens are made from a prompt (with Open Design's craft
 * rules and an optional design system behind them), arranged by dragging, revised by prompt and exported. It stays
 * a design tool: nothing is written to a project, a repo or GitHub.
 */
export function CanvasBoard() {
  const selection = useWorkspace((s) => s.selection);
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState({ x: 40, y: 40, z: 0.5 });
  const [sel, setSel] = useState<string | null>(null);
  const [od, setOd] = useState<OdIndex | null>(null);

  const [device, setDevice] = useState<Device>('phone');
  const [name, setName] = useState('');
  const [brief, setBrief] = useState('');
  const [change, setChange] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'pan' | 'move'; id?: string; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; z: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    void getSetting<Board>(KEY, EMPTY_BOARD).then((b) => { setBoard(b?.screens ? b : EMPTY_BOARD); setLoaded(true); });
    void loadOdIndex().then(setOd);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => void setSetting(KEY, board), 400);
    return () => clearTimeout(t);
  }, [board, loaded]);

  const selected = useMemo(() => board.screens.find((s) => s.id === sel) ?? null, [board, sel]);
  const patch = useCallback((id: string, p: Partial<CanvasScreen>) => setBoard((b) => ({ ...b, screens: b.screens.map((s) => (s.id === id ? { ...s, ...p } : s)) })), []);

  const fit = useCallback(() => {
    const el = stage.current;
    if (!el || !board.screens.length) { setView({ x: 40, y: 40, z: 0.5 }); return; }
    const w = Math.max(...board.screens.map((s) => s.x + DEVICES[s.device].w)) - Math.min(...board.screens.map((s) => s.x));
    const h = Math.max(...board.screens.map((s) => s.y + DEVICES[s.device].h)) - Math.min(...board.screens.map((s) => s.y));
    const z = Math.min(MAX_Z, Math.max(MIN_Z, Math.min((el.clientWidth - 80) / w, (el.clientHeight - 100) / h)));
    const minX = Math.min(...board.screens.map((s) => s.x));
    const minY = Math.min(...board.screens.map((s) => s.y));
    setView({ x: 40 - minX * z, y: 60 - minY * z, z });
  }, [board.screens]);
  const fitted = useRef(false);
  useEffect(() => { if (loaded && !fitted.current) { fitted.current = true; fit(); } }, [loaded, fit]);

  // ── Model ─────────────────────────────────────────────────────────────────
  const ask = async (system: string, user: string): Promise<string> => {
    const res = await fetch('/api/chat', withKeys({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: selection.provider,
        model: selection.model,
        stream: false,
        maxTokens: 8000,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(240_000),
    }));
    const data = (await res.json()) as { content?: string; error?: string };
    if (!res.ok || !data.content) throw new Error(data.error ?? 'The model returned nothing usable.');
    return data.content;
  };

  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try { await job(); } catch (e) { setError((e as Error).message || 'Something went wrong.'); } finally { setBusy(null); }
  };

  const addScreen = () => {
    const text = brief.trim();
    if (!text || busy) return;
    const screenName = name.trim() || `Screen ${board.screens.length + 1}`;
    void run(`Designing ${screenName}…`, async () => {
      const ctx = od ? await openDesignContext(text, od, browserIo, { force: board.system ? { system: board.system } : undefined }).catch(() => null) : null;
      const reply = await ask(systemPrompt({ designContext: ctx?.text }), newScreenPrompt({ name: screenName, device, brief: text, siblings: board.screens }));
      const html = extractHtml(reply);
      if (!html) throw new Error('The model did not return a full HTML page. Try again or shorten the brief.');
      const id = newId();
      const slot = nextSlot(board.screens, device);
      setBoard((b) => ({ ...b, screens: [...b.screens, { id, name: screenName, device, html, brief: text, ...slot }] }));
      setSel(id);
      setName('');
      setBrief('');
    });
  };

  const reviseScreen = () => {
    const text = change.trim();
    if (!selected || !text || busy) return;
    const target = selected;
    void run(`Revising ${target.name}…`, async () => {
      const reply = await ask(systemPrompt({}), revisePrompt(target, text));
      const html = extractHtml(reply);
      if (!html) throw new Error('The model did not return a full HTML page. Try again.');
      patch(target.id, { html, brief: `${target.brief}\n+ ${text}` });
      setChange('');
    });
  };

  const duplicate = () => {
    if (!selected) return;
    const id = newId();
    setBoard((b) => ({ ...b, screens: [...b.screens, { ...selected, id, name: `${selected.name} copy`, x: selected.x + 40, y: selected.y + 40 }] }));
    setSel(id);
  };
  const remove = () => {
    if (!selected) return;
    setBoard((b) => ({ ...b, screens: b.screens.filter((s) => s.id !== selected.id) }));
    setSel(null);
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const fileBase = slug(board.title, new Set());
  const exportZip = () => board.screens.length && downloadZip(exportEntries(board), `${fileBase}.zip`);
  const exportOne = () => selected && downloadText(selected.html, `${slug(selected.name)}.html`, 'text/html;charset=utf-8');
  const copyHtml = () => selected && navigator.clipboard?.writeText(selected.html).catch(() => undefined);

  // ── Pan, zoom, move ───────────────────────────────────────────────────────
  const zoomAt = (factor: number, cx: number, cy: number) =>
    setView((v) => {
      const z = Math.min(MAX_Z, Math.max(MIN_Z, v.z * factor));
      const k = z / v.z;
      return { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  const centre = () => ({ x: (stage.current?.clientWidth ?? 600) / 2, y: (stage.current?.clientHeight ?? 400) / 2 });

  const onStageDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), z: view.z };
      drag.current = null;
      return;
    }
    const target = (e.target as HTMLElement).closest?.('[data-screen]') as HTMLElement | null;
    if (target?.dataset.handle) {
      const s = board.screens.find((x) => x.id === target.dataset.screen);
      if (s) { setSel(s.id); drag.current = { kind: 'move', id: s.id, sx: e.clientX, sy: e.clientY, ox: s.x, oy: s.y }; setDragging(true); return; }
    }
    if (!target) setSel(null);
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    setDragging(true);
  };
  const onStageMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = stage.current!.getBoundingClientRect();
      const z = Math.min(MAX_Z, Math.max(MIN_Z, pinch.current.z * (d / pinch.current.dist)));
      zoomAt(z / view.z, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    else if (d.id) patch(d.id, { x: Math.round(d.ox + dx / view.z), y: Math.round(d.oy + dy / view.z) });
  };
  const onStageUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (!pointers.current.size) { drag.current = null; setDragging(false); }
  };
  const onWheel = (e: React.WheelEvent) => {
    const rect = stage.current!.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
    else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  };

  const systems = od?.systems ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg)' }}>
      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
        <SkillIcon name="layers" size={16} className="shrink-0" />
        <input
          value={board.title}
          onChange={(e) => setBoard((b) => ({ ...b, title: e.target.value }))}
          aria-label="Board name"
          className={`${inputCls} w-40 font-semibold`}
          style={inputStyle}
        />
        <select
          value={board.system ?? ''}
          onChange={(e) => setBoard((b) => ({ ...b, system: e.target.value || undefined }))}
          aria-label="Design system"
          className={`${inputCls} max-w-[11rem]`}
          style={{ ...inputStyle, background: 'var(--panel)' }}
          title="A look from Open Design to design the next screens against"
        >
          <option value="">Design system: auto</option>
          {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Btn onClick={() => zoomAt(1 / 1.25, centre().x, centre().y)} title="Zoom out">−</Btn>
          <span className="mono w-10 text-center text-[11px]" style={{ color: 'var(--ink-dim)' }}>{Math.round(view.z * 100)}%</span>
          <Btn onClick={() => zoomAt(1.25, centre().x, centre().y)} title="Zoom in">+</Btn>
          <Btn onClick={fit} title="Fit all screens">Fit</Btn>
          <Btn onClick={exportZip} disabled={!board.screens.length} primary title="Screens + design tokens + overview, as a zip">
            <SkillIcon name="package" size={13} /> Export zip
          </Btn>
        </div>
      </div>

      {/* Composer */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--line)' }}>
        <select value={device} onChange={(e) => setDevice(e.target.value as Device)} aria-label="Device" className={inputCls} style={{ ...inputStyle, background: 'var(--panel)' }}>
          {(Object.keys(DEVICES) as Device[]).map((d) => <option key={d} value={d}>{DEVICES[d].label} {DEVICES[d].w}×{DEVICES[d].h}</option>)}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Screen name" className={`${inputCls} w-32`} style={inputStyle} />
        <input
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addScreen(); }}
          placeholder="Describe the screen — e.g. home screen of a chai-ordering app with a menu grid and a cart bar"
          className={`${inputCls} min-w-[12rem] flex-1`}
          style={inputStyle}
        />
        <Btn onClick={addScreen} disabled={!!busy || !brief.trim()} primary><SkillIcon name="wand" size={13} /> Add screen</Btn>
      </div>
      {(busy || error) && (
        <div className="shrink-0 px-3 py-1.5 text-[11.5px]" style={{ color: error ? 'var(--danger, #e5484d)' : 'var(--accent)', background: 'var(--panel)' }} role="status">
          {error ?? busy}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Board */}
        <div
          ref={stage}
          className="relative min-h-0 flex-1 overflow-hidden"
          style={{ touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab', backgroundImage: 'radial-gradient(var(--line) 1px, transparent 1px)', backgroundSize: `${24 * view.z}px ${24 * view.z}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
          onPointerDown={onStageDown}
          onPointerMove={onStageMove}
          onPointerUp={onStageUp}
          onPointerCancel={onStageUp}
          onWheel={onWheel}
        >
          {!board.screens.length && loaded && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <div className="max-w-sm" style={{ color: 'var(--ink-dim)' }}>
                <p className="mb-1 text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>Empty board</p>
                <p className="text-[12px] leading-[1.55]">Pick a device, describe a screen above and press Add screen. Make as many as the app or site needs, drag them into a flow, then Export zip and bring it into your own project.</p>
              </div>
            </div>
          )}
          <div style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: '0 0', position: 'absolute', left: 0, top: 0 }}>
            {board.screens.map((s) => {
              const d = DEVICES[s.device];
              const on = s.id === sel;
              return (
                <div key={s.id} data-screen={s.id} style={{ position: 'absolute', left: s.x, top: s.y, width: d.w }}>
                  <div
                    data-screen={s.id}
                    data-handle="1"
                    className="mono flex items-center justify-between rounded-t-md px-2 py-1 text-[13px]"
                    style={{ cursor: 'move', background: on ? 'var(--accent)' : 'var(--panel)', color: on ? '#04150e' : 'var(--ink-dim)', border: '1px solid var(--line)', borderBottom: 0, userSelect: 'none', transform: `scale(${Math.max(1, 0.8 / view.z)})`, transformOrigin: '0 100%', width: `${100 / Math.max(1, 0.8 / view.z)}%` }}
                  >
                    <span className="truncate font-semibold">{s.name}</span>
                    <span className="opacity-70">{d.label}</span>
                  </div>
                  <iframe
                    title={s.name}
                    srcDoc={s.html}
                    sandbox="allow-scripts"
                    width={d.w}
                    height={d.h}
                    style={{ display: 'block', border: 0, background: '#fff', borderRadius: s.device === 'phone' ? 28 : 8, outline: on ? '3px solid var(--accent)' : '1px solid var(--line)', pointerEvents: dragging ? 'none' : on ? 'auto' : 'none' }}
                  />
                  {!on && <div data-screen={s.id} onPointerDown={() => setSel(s.id)} style={{ position: 'absolute', left: 0, right: 0, top: 28, bottom: 0, cursor: 'pointer' }} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected screen */}
        {selected && (
          <aside className="flex max-h-[45%] w-full shrink-0 flex-col gap-2 overflow-y-auto border-t p-3 md:max-h-none md:w-72 md:border-l md:border-t-0" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
            <input value={selected.name} onChange={(e) => patch(selected.id, { name: e.target.value })} aria-label="Screen name" className={`${inputCls} font-semibold`} style={inputStyle} />
            <select value={selected.device} onChange={(e) => patch(selected.id, { device: e.target.value as Device })} aria-label="Frame size" className={inputCls} style={{ ...inputStyle, background: 'var(--panel)' }}>
              {(Object.keys(DEVICES) as Device[]).map((d) => <option key={d} value={d}>{DEVICES[d].label} {DEVICES[d].w}×{DEVICES[d].h}</option>)}
            </select>
            <textarea
              value={change}
              onChange={(e) => setChange(e.target.value)}
              rows={3}
              placeholder="What should change? e.g. make the header darker, add a search bar, bigger buttons"
              className={`${inputCls} resize-none`}
              style={inputStyle}
            />
            <Btn onClick={reviseScreen} disabled={!!busy || !change.trim()} primary><SkillIcon name="pen" size={13} /> Revise this screen</Btn>
            <div className="flex flex-wrap gap-1.5">
              <Btn onClick={duplicate}><SkillIcon name="layers" size={13} /> Duplicate</Btn>
              <Btn onClick={exportOne}><SkillIcon name="doc" size={13} /> .html</Btn>
              <Btn onClick={copyHtml}><SkillIcon name="code" size={13} /> Copy</Btn>
              <Btn onClick={remove}>Delete</Btn>
            </div>
            <p className="text-[11px] leading-[1.5]" style={{ color: 'var(--ink-faint)' }}>
              Drag a screen by its title bar to move it. Export zip bundles every screen, shared design tokens and an overview page for you to import into your own project.
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}
