'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ZOOM_MAX, fmtTime } from './shared';

/**
 * Full-screen viewer for an image or a video, with zoom from 1x to 50x.
 * Wheel or pinch to zoom around the finger, drag to move, double-tap to jump in, and the slider or +/- for exact control.
 * Video plays under the zoom, so a detail can be watched move at 50x.
 */
export function ZoomViewer({ kind, src, title, onClose, onPrev, onNext }: {
  kind: 'image' | 'video';
  src: string;
  title?: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({ now: 0, len: 0 });

  const zoomAbout = useCallback((factor: number, px?: number, py?: number) => {
    const rect = stage.current?.getBoundingClientRect();
    setView((v) => {
      const s2 = Math.min(ZOOM_MAX, Math.max(1, v.s * factor));
      if (s2 === v.s) return v;
      if (s2 === 1) return { s: 1, x: 0, y: 0 };
      // Keep the point under the finger where it is: translate is measured from the stage centre.
      const cx = rect ? rect.left + rect.width / 2 : 0;
      const cy = rect ? rect.top + rect.height / 2 : 0;
      const p = { x: (px ?? cx) - cx, y: (py ?? cy) - cy };
      const k = s2 / v.s;
      return { s: s2, x: p.x - k * (p.x - v.x), y: p.y - k * (p.y - v.y) };
    });
  }, []);

  const setScale = (s: number) => zoomAbout(s / view.s);
  const reset = () => setView({ s: 1, x: 0, y: 0 });

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAbout(e.deltaY < 0 ? 1.25 : 0.8, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAbout]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoomAbout(1.5);
      else if (e.key === '-') zoomAbout(1 / 1.5);
      else if (e.key === '0') reset();
      else if (e.key === 'ArrowLeft') onPrev?.();
      else if (e.key === 'ArrowRight') onNext?.();
      else if (e.key === ' ' && kind === 'video') { e.preventDefault(); toggle(); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { reset(); setPlaying(false); setTime({ now: 0, len: 0 }); }, [src]);

  const down = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  };
  const move = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAbout(dist / pinch.current.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch.current = { dist };
    } else if (pointers.current.size === 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      setView((v) => (v.s > 1 ? { ...v, x: v.x + dx, y: v.y + dy } : v));
    }
  };
  const up = (e: React.PointerEvent) => { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null; };

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play(); else v.pause();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(8,6,4,0.94)' }} role="dialog" aria-modal="true" aria-label={title ?? 'Viewer'}>
      <div className="flex shrink-0 items-center gap-2 px-3 py-2" style={{ color: '#f6ebde' }}>
        <button type="button" onClick={onClose} className="press mono rounded-lg px-2.5 py-1.5 text-[12px]" aria-label="Close viewer">✕</button>
        <span className="min-w-0 flex-1 truncate text-[12px] opacity-80">{title}</span>
        {onPrev && <button type="button" onClick={onPrev} className="press mono rounded-lg px-2 py-1.5 text-[12px]" aria-label="Previous">‹</button>}
        {onNext && <button type="button" onClick={onNext} className="press mono rounded-lg px-2 py-1.5 text-[12px]" aria-label="Next">›</button>}
        <span className="mono text-[11px] tabular-nums" data-testid="zoom-level" style={{ color: 'var(--accent)' }}>{view.s < 10 ? view.s.toFixed(1) : Math.round(view.s)}×</span>
      </div>

      <div
        ref={stage}
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden"
        style={{ cursor: view.s > 1 ? 'grab' : 'zoom-in' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={(e) => (view.s > 1 ? reset() : zoomAbout(4, e.clientX, e.clientY))}
      >
        <div className="absolute inset-0 flex items-center justify-center" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: 'center', willChange: 'transform' }}>
          {kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={title ?? ''} draggable={false} className="max-h-full max-w-full" style={{ imageRendering: view.s > 6 ? 'pixelated' : 'auto' }} />
          ) : (
            <video
              ref={video} src={src} playsInline loop className="max-h-full max-w-full"
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
              onLoadedMetadata={(e) => setTime({ now: 0, len: e.currentTarget.duration })}
              onTimeUpdate={(e) => setTime({ now: e.currentTarget.currentTime, len: e.currentTarget.duration })}
            />
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2.5" style={{ color: '#f6ebde' }}>
        {kind === 'video' && (
          <>
            <button type="button" onClick={toggle} className="press mono w-9 rounded-lg px-2 py-1.5 text-[13px]" aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
            <input type="range" min={0} max={time.len || 1} step={0.01} value={time.now} aria-label="Seek"
              onChange={(e) => { if (video.current) video.current.currentTime = Number(e.target.value); }} className="min-w-24 flex-1 accent-[var(--accent)]" />
            <span className="mono w-20 text-[10.5px] tabular-nums opacity-70">{fmtTime(time.now)} / {fmtTime(time.len)}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => zoomAbout(1 / 1.5)} className="press mono rounded-lg px-2.5 py-1.5 text-[13px]" aria-label="Zoom out">−</button>
          <input type="range" min={0} max={Math.log(ZOOM_MAX)} step={0.01} value={Math.log(view.s)} aria-label="Zoom"
            onChange={(e) => setScale(Math.exp(Number(e.target.value)))} className="w-32 accent-[var(--accent)] sm:w-48" />
          <button type="button" onClick={() => zoomAbout(1.5)} className="press mono rounded-lg px-2.5 py-1.5 text-[13px]" aria-label="Zoom in">+</button>
          <button type="button" onClick={() => setScale(ZOOM_MAX)} className="press mono rounded-lg px-2 py-1.5 text-[10.5px]">50×</button>
          <button type="button" onClick={reset} className="press mono rounded-lg px-2 py-1.5 text-[10.5px]">fit</button>
        </div>
      </div>
    </div>
  );
}
