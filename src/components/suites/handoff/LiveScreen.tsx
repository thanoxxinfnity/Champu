'use client';
/** The agent's screen, live: the latest screenshot, a Live toggle that keeps pulling new ones, and Take over (tap to click, type). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import type { Mode } from '@/lib/handoff/actions';
import { screenshotName, type Screen } from '@/lib/handoff/loop';

export const GRAD = 'linear-gradient(140deg, hsl(18 88% 58%), hsl(338 78% 52%))';
const card = { borderColor: 'var(--line)', background: 'var(--panel)' } as const;
const ago = (t: number) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

function Btn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="press inline-flex items-center justify-center whitespace-nowrap rounded-xl border px-4 text-[13.5px] font-semibold" style={{ minHeight: 44, borderColor: 'var(--line)', color: 'var(--ink-dim)', background: 'var(--panel)' }}>{children}</button>;
}

/** Pulls a fresh screenshot of the bridge's browser or screen every few seconds while `live` is on (stops itself after 5 min). */
export function useLiveScreen(mode: Mode, initial: Screen | null = null) {
  const bridge = useWorkspace((s) => s.bridge);
  const hb = useWorkspace((s) => s.heartbeat.status);
  const online = hb === 'online' || hb === 'degraded';
  const [screen, setScreen] = useState<Screen | null>(initial);
  const [live, setLive] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { if (initial && (!screen || initial.at > screen.at)) setScreen(initial); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [initial]);
  const refresh = useCallback(async () => {
    if (!online) return;
    setRefreshing(true);
    try {
      if (mode === 'desktop') {
        const r = await bridge.desktop({ action: 'shot' });
        if (r.ok && r.image) setScreen({ dataUrl: await bridge.artifactDataUrl(r.image), width: r.width, height: r.height, at: Date.now() });
      } else {
        const r = await bridge.browser('browser_take_screenshot', {});
        const name = screenshotName(r.text);
        if (name) setScreen({ dataUrl: await bridge.artifactDataUrl(name), at: Date.now() });
      }
    } catch { /* next tick */ } finally { setRefreshing(false); }
  }, [bridge, mode, online]);
  useEffect(() => {
    if (!live) return;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      if (Date.now() - started > 5 * 60_000) { setLive(false); return; }
      if (document.visibilityState === 'visible') await refresh();
      if (!stop) setTimeout(() => void tick(), 2500);
    };
    void tick();
    return () => { stop = true; };
  }, [live, refresh]);
  const control = {
    click: (x: number, y: number) => void bridge.desktop({ action: 'click', x, y }).then(() => setTimeout(() => void refresh(), 500)),
    type: (t: string) => void bridge.desktop({ action: 'type', text: t }).then(() => void refresh()),
    key: (k: string) => void bridge.desktop({ action: 'key', key: k }).then(() => void refresh()),
  };
  return { screen, setScreen, live, setLive, refreshing, refresh, control, online };
}

/* ── live screen ─────────────────────────────────────────────────────────── */
export function LiveScreen({ screen, mode, canControl, onClick, onType, onKey, live, setLive, refreshing }: {
  screen: Screen | null; mode: Mode; canControl: boolean; live: boolean; setLive: (v: boolean) => void; refreshing: boolean;
  onClick: (x: number, y: number) => void; onType: (t: string) => void; onKey: (k: string) => void;
}) {
  const img = useRef<HTMLImageElement>(null);
  const [control, setControl] = useState(false);
  const [text, setText] = useState('');
  const [tap, setTap] = useState<{ x: number; y: number } | null>(null);
  const click = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!control || !img.current) return;
    const r = img.current.getBoundingClientRect();
    const sx = img.current.naturalWidth / r.width, sy = img.current.naturalHeight / r.height;
    const x = Math.round((e.clientX - r.left) * sx), y = Math.round((e.clientY - r.top) * sy);
    setTap({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
    setTimeout(() => setTap(null), 600);
    onClick(x, y);
  };
  return (
    <section className="overflow-hidden rounded-3xl border" style={card}>
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--line)' }}>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">{live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: 'hsl(4 80% 58%)' }} />}<span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: live ? 'hsl(4 80% 58%)' : 'var(--ink-faint)' }} /></span>
          <span className="text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>{mode === 'desktop' ? 'Agent’s screen' : 'Agent’s browser'}</span>
          {screen && <span className="mono text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>{ago(screen.at)}{refreshing ? ' · …' : ''}</span>}
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setLive(!live)} className="press mono rounded-lg border px-2.5 text-[11px] font-medium" style={{ minHeight: 32, borderColor: live ? 'hsl(4 80% 58% / .5)' : 'var(--line)', color: live ? 'hsl(4 80% 58%)' : 'var(--ink-dim)' }}>Live</button>
          {canControl && <button type="button" onClick={() => setControl(!control)} className="press mono rounded-lg border px-2.5 text-[11px] font-medium" style={{ minHeight: 32, borderColor: 'var(--line)', background: control ? GRAD : 'transparent', color: control ? '#fff' : 'var(--ink-dim)' }}>{control ? 'Controlling' : 'Take over'}</button>}
        </div>
      </header>
      <div className="relative grid min-h-[180px] place-items-center" style={{ background: 'repeating-conic-gradient(rgb(128 128 128 / .08) 0% 25%, transparent 0% 50%) 50% / 18px 18px' }}>
        {screen ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={img} src={screen.dataUrl} alt="What the agent sees" onClick={click} className="block h-auto w-full" style={{ cursor: control ? 'crosshair' : 'default', imageRendering: 'auto' }} />
            {tap && <span className="pointer-events-none absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full" style={{ left: `${tap.x}%`, top: `${tap.y}%`, background: 'hsl(18 90% 58% / .6)' }} />}
          </>
        ) : (
          <p className="px-6 py-10 text-center text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>The screen appears here as soon as the agent opens something. Tap “Live” to watch it continuously.</p>
        )}
      </div>
      {control && (
        <div className="space-y-2 border-t p-2.5" style={{ borderColor: 'var(--line)' }}>
          <p className="text-[11.5px]" style={{ color: 'var(--ink-dim)' }}>Tap the picture to click there. Type below to send keys to the screen.</p>
          <div className="flex gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && text) { onType(text); setText(''); } }} placeholder="Type text…" className="min-w-0 flex-1 rounded-xl border bg-transparent px-3 text-[14px] outline-none" style={{ borderColor: 'var(--line)', color: 'var(--ink)', minHeight: 44 }} />
            <Btn onClick={() => { if (text) { onType(text); setText(''); } }}>Send</Btn>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {['Return', 'Tab', 'BackSpace', 'Escape', 'ctrl+l', 'ctrl+c', 'ctrl+v', 'alt+Tab'].map((k) => (
              <button key={k} type="button" onClick={() => onKey(k)} className="press mono rounded-lg border px-2.5 text-[11px]" style={{ minHeight: 34, borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>{k}</button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

