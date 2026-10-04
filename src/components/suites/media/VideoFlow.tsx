'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteAsset, getSetting, listAssets, setSetting } from '@/lib/db/history';
import type { AssetRecord } from '@/lib/db/schema';
import { useWorkspace } from '@/lib/store';
import { downloadAsset } from './LibraryView';
import { ZoomViewer } from './ZoomViewer';
import { apiBase, authHeaders, blobToDataUrl, endpointsFor, fmtTime, httpJson, mediaToBlob, modelsFor, pickMedia, saveMedia, sleep, srcOf } from './shared';

const ASPECTS: Array<[string, string]> = [['16:9', '1280x720'], ['9:16', '720x1280'], ['1:1', '1024x1024']];
const DURATIONS = [4, 6, 8, 10];
const DONE = /^(completed|succeeded|success|done|ready|finished)$/i;
const FAILED = /^(failed|error|cancel+ed|rejected|expired)$/i;

interface Job { id: string; prompt: string; startedAt: number; error?: string }

/**
 * Video, laid out like a film editor rather than a chat: a monitor on top, your scenes in a timeline in the middle,
 * and the prompt bar at the bottom. Several scenes can be generating at once; "Play all" runs them end to end.
 */
export function VideoFlow() {
  const endpoints = useWorkspace((s) => s.endpoints);
  const providers = endpointsFor(endpoints, 'video');
  const [endpointId, setEndpointId] = useState('');
  const endpoint = providers.find((e) => e.id === endpointId) ?? providers[0];
  const models = modelsFor(endpoint, 'video');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState(ASPECTS[0]);
  const [seconds, setSeconds] = useState(6);
  const [startFrame, setStartFrame] = useState<string | null>(null);
  const [clips, setClips] = useState<AssetRecord[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [playingAll, setPlayingAll] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [now, setNow] = useState(Date.now());
  const monitor = useRef<HTMLVideoElement>(null);
  const frameInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [time, setTime] = useState({ now: 0, len: 0 });
  const [paused, setPaused] = useState(true);

  const refresh = useCallback(async () => {
    const [list, saved] = await Promise.all([listAssets('video', 200), getSetting<string[]>('videoTimeline', [])]);
    setClips(list); setOrder(saved);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (!models.includes(model)) setModel(models[0] ?? ''); }, [endpoint?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!jobs.length) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [jobs.length]);

  // Timeline order: what the user arranged, then anything newer on the end (oldest first, like film).
  const timeline = [...clips].sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.createdAt - b.createdAt;
  });
  const current = timeline.find((c) => c.id === selected) ?? timeline[timeline.length - 1];
  const total = timeline.reduce((n, c) => n + (Number(c.meta?.seconds) || 0), 0);

  const move = async (id: string, d: number) => {
    const ids = timeline.map((c) => c.id);
    const i = ids.indexOf(id), j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOrder(ids); await setSetting('videoTimeline', ids);
  };

  const run = async (job: Job, text: string, frame: string | null) => {
    if (!endpoint) return;
    try {
      const host = new URL(endpoint.baseUrl).host;
      const route = endpoint.routes.find((r) => /videos?\/generations/.test(r)) ?? '/videos/generations';
      const base = apiBase(endpoint);
      const body: Record<string, unknown> = { model, prompt: text, size: aspect[1], seconds, duration: seconds, aspect_ratio: aspect[0], n: 1 };
      if (frame) body.image = frame;
      let json: any = await (await httpJson(`${base}${route}`, { method: 'POST', headers: authHeaders(endpoint), body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) }, host)).json();
      const id = json?.id ?? json?.task_id ?? json?.data?.[0]?.id;
      const started = Date.now();
      // A job: ask again until it is done (up to 15 minutes).
      while (!pickMedia(json) && id && Date.now() - started < 900_000) {
        const status = String(json?.status ?? json?.data?.[0]?.status ?? '');
        if (FAILED.test(status)) throw new Error(json?.error?.message ?? json?.error ?? `The provider stopped (${status}).`);
        if (DONE.test(status)) break;
        await sleep(4000);
        json = await (await httpJson(`${base}${route}/${id}`, { headers: authHeaders(endpoint) }, host).catch(() => httpJson(`${base}/videos/${id}`, { headers: authHeaders(endpoint) }, host))).json();
      }
      let found = pickMedia(json);
      let blob: Blob | undefined, url: string | undefined;
      if (found) ({ blob, url } = await mediaToBlob(found, 'video/mp4'));
      else if (id) blob = await (await httpJson(`${base}/videos/${id}/content`, { headers: authHeaders(endpoint) }, host)).blob();
      if (!blob && !url) throw new Error('The provider finished, but without a video file.');
      const saved = await saveMedia({ suite: 'video', kind: 'video', prompt: text, provider: endpoint.label, model, blob, url, meta: { seconds, aspect: aspect[0] } });
      setSelected(saved.id);
      setJobs((j) => j.filter((x) => x.id !== job.id));
      await refresh();
    } catch (err) {
      setJobs((j) => j.map((x) => (x.id === job.id ? { ...x, error: (err as Error).message } : x)));
    }
  };

  const generate = () => {
    const text = prompt.trim();
    if (!text || !endpoint) return;
    const job: Job = { id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, prompt: text, startedAt: Date.now() };
    setJobs((j) => [...j, job]);
    setPrompt('');
    void run(job, text, startFrame);
    setStartFrame(null);
  };

  const playAll = () => {
    if (!timeline.length) return;
    setPlayingAll(true);
    setSelected(timeline[0].id);
  };
  const onEnded = () => {
    if (!playingAll) return;
    const i = timeline.findIndex((c) => c.id === current?.id);
    if (i >= 0 && i < timeline.length - 1) setSelected(timeline[i + 1].id); else setPlayingAll(false);
  };
  useEffect(() => { if (playingAll) void monitor.current?.play().catch(() => undefined); }, [current?.id, playingAll]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="video-flow">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--line)' }}>
        <h2 className="hand text-[24px] leading-none">Video</h2>
        <span className="mono text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>{timeline.length} scene{timeline.length === 1 ? '' : 's'}{total ? ` · ${fmtTime(total)}` : ''}</span>
        <button type="button" onClick={playAll} disabled={!timeline.length} className="press mono ml-auto rounded-lg border px-3 py-1.5 text-[11px] disabled:opacity-40" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>▶ play all</button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/80 p-2" aria-label="Monitor">
        {current ? (
          <>
            <video ref={monitor} key={current.id} src={srcOf(current)} playsInline className="max-h-full max-w-full" onEnded={onEnded}
              onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
              onLoadedMetadata={(e) => setTime({ now: 0, len: e.currentTarget.duration })} onTimeUpdate={(e) => setTime({ now: e.currentTarget.currentTime, len: e.currentTarget.duration })} />
            <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-xl px-2.5 py-1.5" style={{ background: 'rgba(15,10,6,0.78)', color: '#f6ebde' }}>
              <button type="button" onClick={() => { const v = monitor.current; if (v) (v.paused ? void v.play() : v.pause()); }} className="press mono w-8 text-[13px]" aria-label={paused ? 'Play' : 'Pause'}>{paused ? '▶' : '❚❚'}</button>
              <input type="range" min={0} max={time.len || 1} step={0.01} value={time.now} aria-label="Seek" onChange={(e) => { if (monitor.current) monitor.current.currentTime = Number(e.target.value); }} className="min-w-0 flex-1 accent-[var(--accent)]" />
              <span className="mono text-[10px] tabular-nums opacity-75">{fmtTime(time.now)}</span>
              <button type="button" onClick={() => { monitor.current?.pause(); setPlayingAll(false); setZoom(true); }} className="press mono px-1.5 text-[12px]" aria-label="Open and zoom" title="Open & zoom up to 50×">⤢</button>
            </div>
          </>
        ) : (
          <p className="max-w-xs text-center text-[12.5px] leading-[1.7]" style={{ color: '#f6ebde99' }}>Your scenes play here. Describe the first one below.</p>
        )}
      </div>

      <div className="shrink-0 overflow-x-auto border-y px-3 py-2.5" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }} aria-label="Timeline">
        <div className="flex gap-2.5">
          {timeline.map((c, i) => (
            <div key={c.id} className="w-40 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: c.id === current?.id ? 'var(--accent)' : 'var(--line)', background: 'var(--panel)' }}>
              <button type="button" onClick={() => { setPlayingAll(false); setSelected(c.id); }} className="relative block aspect-video w-full bg-black" aria-label={`Scene ${i + 1}`}>
                <video src={`${srcOf(c)}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">{i + 1}</span>
              </button>
              <p className="truncate px-2 pt-1 text-[10.5px]" style={{ color: 'var(--ink-dim)' }} title={c.prompt}>{c.prompt}</p>
              <div className="flex items-center px-1 pb-1">
                <button type="button" onClick={() => void move(c.id, -1)} className="press px-1.5 text-[12px]" aria-label="Move earlier">‹</button>
                <button type="button" onClick={() => void move(c.id, 1)} className="press px-1.5 text-[12px]" aria-label="Move later">›</button>
                <button type="button" onClick={() => downloadAsset(c)} className="press ml-auto px-1.5 text-[12px]" aria-label="Download">⬇</button>
                <button type="button" onClick={async () => { await deleteAsset(c.id); void refresh(); }} className="press px-1.5 text-[12px]" aria-label="Delete scene">✕</button>
              </div>
            </div>
          ))}
          {jobs.map((j) => (
            <div key={j.id} className="flex w-40 shrink-0 flex-col justify-between rounded-xl border border-dashed p-2" style={{ borderColor: j.error ? 'var(--color-red, #e5484d)' : 'var(--accent)' }} role="status">
              <p className="line-clamp-3 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>{j.prompt}</p>
              {j.error ? (
                <div><p className="mt-1 text-[10px] leading-[1.4]" style={{ color: 'var(--color-red, #e5484d)' }}>{j.error.slice(0, 140)}</p>
                  <button type="button" onClick={() => setJobs((x) => x.filter((y) => y.id !== j.id))} className="press mono mt-1 text-[10px] underline">dismiss</button></div>
              ) : (
                <p className="mono mt-1 flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--accent)' }}><span className="thinking-dot" aria-hidden /> making… {Math.round((now - j.startedAt) / 1000)}s</p>
              )}
            </div>
          ))}
          <button type="button" onClick={() => composer.current?.focus()} className="press flex w-24 shrink-0 items-center justify-center rounded-xl border border-dashed text-[22px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-faint)' }} aria-label="Add a scene">+</button>
        </div>
      </div>

      <div className="shrink-0 p-3">
        <div className="mx-auto max-w-3xl rounded-2xl border p-2.5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <textarea ref={composer} value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); } }}
            placeholder="Describe the next scene — what is seen, how the camera moves…" className="w-full resize-none bg-transparent px-1.5 py-1 text-[13px] outline-none placeholder:opacity-45" style={{ color: 'var(--ink)' }} />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {providers.length > 1 && <select value={endpoint?.id} onChange={(e) => setEndpointId(e.target.value)} className="mono rounded border bg-transparent px-2 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }} aria-label="Provider">{providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>}
            <select value={model} onChange={(e) => setModel(e.target.value)} className="mono max-w-[10rem] rounded border bg-transparent px-2 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }} aria-label="Model">{models.map((m) => <option key={m} value={m}>{m}</option>)}</select>
            {ASPECTS.map((a) => <button key={a[0]} type="button" onClick={() => setAspect(a)} className="press mono rounded-full border px-2.5 py-1 text-[10.5px]" style={{ borderColor: aspect[0] === a[0] ? 'var(--accent)' : 'var(--line)', color: aspect[0] === a[0] ? 'var(--accent)' : 'var(--ink-dim)' }}>{a[0]}</button>)}
            {DURATIONS.map((d) => <button key={d} type="button" onClick={() => setSeconds(d)} className="press mono rounded-full border px-2.5 py-1 text-[10.5px]" style={{ borderColor: seconds === d ? 'var(--accent)' : 'var(--line)', color: seconds === d ? 'var(--accent)' : 'var(--ink-dim)' }}>{d}s</button>)}
            <button type="button" onClick={() => (startFrame ? setStartFrame(null) : frameInput.current?.click())} className="press mono rounded-full border px-2.5 py-1 text-[10.5px]" style={{ borderColor: startFrame ? 'var(--accent)' : 'var(--line)', color: startFrame ? 'var(--accent)' : 'var(--ink-dim)' }}>{startFrame ? '✕ start frame' : '＋ start frame'}</button>
            <input ref={frameInput} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setStartFrame(await blobToDataUrl(f)); e.target.value = ''; }} />
            <button type="button" onClick={generate} disabled={!prompt.trim() || !endpoint} className="press mono ml-auto rounded-xl px-4 py-1.5 text-[11.5px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--panel)' }}>generate scene</button>
          </div>
        </div>
      </div>

      {zoom && current && <ZoomViewer kind="video" src={srcOf(current)} title={current.prompt} onClose={() => setZoom(false)} />}
    </div>
  );
}
