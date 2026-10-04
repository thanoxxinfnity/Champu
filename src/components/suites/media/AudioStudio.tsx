'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteAsset, listAssets } from '@/lib/db/history';
import type { AssetRecord } from '@/lib/db/schema';
import { useWorkspace } from '@/lib/store';
import { downloadAsset } from './LibraryView';
import { apiBase, authHeaders, endpointsFor, fmtTime, httpJson, mediaToBlob, modelsFor, pickMedia, saveMedia, srcOf } from './shared';

const BARS = 160;

/** Waveform player: the sound drawn as bars, click anywhere on it to jump there. */
export function TrackPlayer({ src, title, big }: { src: string; title: string; big?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({ now: 0, len: 0 });
  const [rate, setRate] = useState(1);

  useEffect(() => {
    let dead = false;
    setPeaks(null);
    (async () => {
      try {
        const buf = await (await fetch(src)).arrayBuffer();
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const decoded = await ctx.decodeAudioData(buf);
        void ctx.close();
        const data = decoded.getChannelData(0);
        const step = Math.max(1, Math.floor(data.length / BARS));
        const out: number[] = [];
        for (let i = 0; i < BARS; i++) {
          let max = 0;
          for (let j = 0; j < step; j++) max = Math.max(max, Math.abs(data[i * step + j] ?? 0));
          out.push(max);
        }
        const top = Math.max(...out, 0.001);
        if (!dead) setPeaks(out.map((p) => p / top));
      } catch {
        if (!dead) setPeaks(Array.from({ length: BARS }, (_, i) => 0.25 + 0.2 * Math.sin(i / 5))); // cannot decode here: a plain pattern, still playable
      }
    })();
    return () => { dead = true; };
  }, [src]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !peaks) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const done = time.len ? time.now / time.len : 0;
    const bw = w / BARS;
    const style = getComputedStyle(c);
    const accent = style.getPropertyValue('--accent').trim() || '#ff9a3c';
    const dim = style.getPropertyValue('--ink-faint').trim() || '#888';
    peaks.forEach((p, i) => {
      const bh = Math.max(2, p * h * 0.92);
      g.fillStyle = i / BARS <= done ? accent : dim;
      g.fillRect(i * bw + 0.5, (h - bh) / 2, Math.max(1, bw - 1.5), bh);
    });
  }, [peaks, time]);

  const toggle = () => { const a = audio.current; if (a) (a.paused ? void a.play() : a.pause()); };
  const seek = (e: React.MouseEvent) => {
    const a = audio.current, c = canvas.current;
    if (!a || !c || !a.duration) return;
    const r = c.getBoundingClientRect();
    a.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * a.duration;
  };

  return (
    <div>
      <p className="mb-2 truncate text-[12px]" style={{ color: 'var(--ink-dim)' }} title={title}>{title}</p>
      <canvas ref={canvas} onClick={seek} className={`w-full cursor-pointer ${big ? 'h-28' : 'h-14'}`} aria-label="Waveform — click to seek" />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={toggle} className="press mono w-9 rounded-lg border px-2 py-1.5 text-[13px]" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
        <span className="mono text-[10.5px] tabular-nums" style={{ color: 'var(--ink-faint)' }}>{fmtTime(time.now)} / {fmtTime(time.len)}</span>
        <select value={rate} onChange={(e) => { const r = Number(e.target.value); setRate(r); if (audio.current) audio.current.playbackRate = r; }} className="mono ml-auto rounded border bg-transparent px-1.5 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }} aria-label="Speed">
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>
      </div>
      <audio ref={audio} src={src} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setTime({ now: 0, len: e.currentTarget.duration })} onTimeUpdate={(e) => setTime({ now: e.currentTarget.currentTime, len: e.currentTarget.duration })} />
    </div>
  );
}

const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

/** Audio: write what to say (or describe a sound), get a track you can see and scrub. */
export function AudioStudio() {
  const endpoints = useWorkspace((s) => s.endpoints);
  const providers = endpointsFor(endpoints, 'audio');
  const [endpointId, setEndpointId] = useState('');
  const endpoint = providers.find((e) => e.id === endpointId) ?? providers[0];
  const models = modelsFor(endpoint, 'audio');
  const [model, setModel] = useState('');
  const canCompose = !!endpoint?.routes.some((r) => /audio\/generations/.test(r));
  const [mode, setMode] = useState<'speak' | 'compose'>('speak');
  const [text, setText] = useState('');
  const [voice, setVoice] = useState('alloy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<AssetRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => setTracks(await listAssets('audio', 100)), []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (!models.includes(model)) setModel(models[0] ?? ''); }, [endpoint?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = tracks.find((t) => t.id === selected) ?? tracks[0];

  const make = async () => {
    if (!endpoint || !text.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const path = mode === 'compose' ? '/audio/generations' : '/audio/speech';
      const body = mode === 'compose' ? { model, prompt: text.trim(), response_format: 'mp3' } : { model, input: text.trim(), voice, response_format: 'mp3' };
      const res = await httpJson(`${apiBase(endpoint)}${path}`, { method: 'POST', headers: authHeaders(endpoint), body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) }, new URL(endpoint.baseUrl).host);
      const type = res.headers.get('content-type') ?? '';
      let blob: Blob | undefined, url: string | undefined;
      if (/^audio\//.test(type) || /octet-stream/.test(type)) blob = new Blob([await res.arrayBuffer()], { type: type.startsWith('audio/') ? type : 'audio/mpeg' });
      else {
        const found = pickMedia(await res.json());
        if (!found) throw new Error('The provider answered, but without any audio in it.');
        ({ blob, url } = await mediaToBlob(found, 'audio/mpeg'));
      }
      const saved = await saveMedia({ suite: 'audio', kind: 'audio', prompt: text.trim(), provider: endpoint.label, model, blob, url, meta: { voice, mode } });
      setSelected(saved.id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row" data-testid="audio-studio">
      <section className="flex min-h-0 flex-1 flex-col border-b p-4 md:border-b-0 md:border-r" style={{ borderColor: 'var(--line)' }}>
        <h2 className="hand text-[26px] leading-none">Audio</h2>
        <div className="mt-3 flex-1 overflow-y-auto">
          {now ? <TrackPlayer key={now.id} src={srcOf(now)} title={now.prompt ?? 'Track'} big />
            : <p className="mt-10 text-center text-[12.5px] leading-[1.7]" style={{ color: 'var(--ink-dim)' }}>Your first track will appear here as a waveform you can play and scrub.</p>}
        </div>
        <div className="mt-3 space-y-2">
          {canCompose && (
            <div className="flex gap-1">
              {(['speak', 'compose'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} className="press mono rounded-full border px-3 py-1 text-[10.5px]" style={{ borderColor: mode === m ? 'var(--accent)' : 'var(--line)', color: mode === m ? 'var(--accent)' : 'var(--ink-dim)' }}>{m === 'speak' ? 'speak text' : 'compose sound'}</button>
              ))}
            </div>
          )}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void make(); }}
            placeholder={mode === 'speak' ? 'What should it say?' : 'Describe the sound or music'} className="w-full resize-y rounded-lg border bg-transparent px-3 py-2 text-[13px] outline-none" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }} />
          <div className="flex flex-wrap items-center gap-1.5">
            {providers.length > 1 && <select value={endpoint?.id} onChange={(e) => setEndpointId(e.target.value)} className="mono rounded border bg-transparent px-2 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}>{providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>}
            <select value={model} onChange={(e) => setModel(e.target.value)} className="mono max-w-[11rem] rounded border bg-transparent px-2 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }} aria-label="Model">{models.map((m) => <option key={m} value={m}>{m}</option>)}</select>
            {mode === 'speak' && <select value={voice} onChange={(e) => setVoice(e.target.value)} className="mono rounded border bg-transparent px-2 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }} aria-label="Voice">{VOICES.map((v) => <option key={v}>{v}</option>)}</select>}
            <button type="button" onClick={() => void make()} disabled={busy || !text.trim() || !endpoint} className="press mono ml-auto rounded-lg px-4 py-1.5 text-[11.5px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--panel)' }}>{busy ? 'making…' : 'make audio'}</button>
          </div>
          {error && <p className="text-[11px] leading-[1.5]" role="alert" style={{ color: 'var(--color-red, #e5484d)' }}>{error}</p>}
        </div>
      </section>
      <aside className="max-h-56 shrink-0 overflow-y-auto p-3 md:max-h-none md:w-72">
        <p className="mono mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>Tracks</p>
        {tracks.length === 0 && <p className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>None yet.</p>}
        <ul className="space-y-1.5">
          {tracks.map((t) => (
            <li key={t.id} className="flex items-center gap-1 rounded-lg border px-2 py-1.5" style={{ borderColor: t.id === now?.id ? 'var(--accent)' : 'var(--line)' }}>
              <button type="button" onClick={() => setSelected(t.id)} className="min-w-0 flex-1 truncate text-left text-[11.5px]" style={{ color: 'var(--ink-dim)' }}>♪ {t.prompt}</button>
              <button type="button" onClick={() => downloadAsset(t)} className="press px-1 text-[12px]" aria-label="Download">⬇</button>
              <button type="button" onClick={async () => { await deleteAsset(t.id); void refresh(); }} className="press px-1 text-[12px]" aria-label="Delete">✕</button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
