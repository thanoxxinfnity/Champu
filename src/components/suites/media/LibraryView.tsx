'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteAsset, listAllAssets } from '@/lib/db/history';
import type { AssetRecord } from '@/lib/db/schema';
import { dataUrlToBytes, downloadBlob } from '@/lib/zip';
import { ZoomViewer } from './ZoomViewer';
import { ModelViewer } from './ModelViewer';
import { TrackPlayer } from './AudioStudio';
import { fmtBytes, srcOf } from './shared';

const FILTERS: Array<[AssetRecord['kind'] | 'all', string]> = [['all', 'All'], ['image', 'Images'], ['video', 'Videos'], ['audio', 'Audio'], ['model3d', '3D']];
const EXT: Record<string, string> = { image: 'png', video: 'mp4', audio: 'mp3', model3d: 'glb' };

export function downloadAsset(a: AssetRecord) {
  const name = `${(a.prompt ?? a.kind).slice(0, 40).replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || a.kind}.${EXT[a.kind] ?? 'bin'}`;
  if (a.dataUrl) {
    const mime = /^data:([^;,]+)/.exec(a.dataUrl)?.[1] ?? 'application/octet-stream';
    downloadBlob(new Blob([dataUrlToBytes(a.dataUrl) as BlobPart], { type: mime }), name);
  } else if (a.url) window.open(a.url, '_blank', 'noopener');
}

/** Everything the app has generated, in one place. Tap an image or a video to open it and zoom in up to 50x. */
export function LibraryView() {
  const [items, setItems] = useState<AssetRecord[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => { setItems(await listAllAssets(400)); setLoaded(true); }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const shown = useMemo(() => items.filter((a) => filter === 'all' || a.kind === filter), [items, filter]);
  const index = shown.findIndex((a) => a.id === open);
  const current = index >= 0 ? shown[index] : null;
  const go = (d: number) => {
    const visual = shown.filter((a) => a.kind === 'image' || a.kind === 'video');
    const at = visual.findIndex((a) => a.id === open);
    if (at >= 0 && visual.length > 1) setOpen(visual[(at + d + visual.length) % visual.length].id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="library">
      <div className="shrink-0 border-b px-3 py-2.5" style={{ borderColor: 'var(--line)' }}>
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
          <h2 className="hand text-[24px] leading-none">Library</h2>
          <span className="mono text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>{shown.length} item{shown.length === 1 ? '' : 's'}</span>
          <div className="ml-auto flex flex-wrap gap-1">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" onClick={() => setFilter(id)} className="press mono rounded-full border px-3 py-1 text-[10.5px]"
                style={{ borderColor: filter === id ? 'var(--accent)' : 'var(--line)', color: filter === id ? 'var(--accent)' : 'var(--ink-dim)', background: filter === id ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : undefined }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {shown.length === 0 ? (
          <p className="mx-auto mt-16 max-w-sm text-center text-[12.5px] leading-[1.7]" style={{ color: 'var(--ink-dim)' }}>
            {loaded ? 'Nothing here yet. Images, videos, audio and 3D models you generate are kept here — tap one to open it and zoom in up to 50×.' : 'Loading…'}
          </p>
        ) : (
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((a) => (
              <div key={a.id} className="group relative overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
                <button type="button" onClick={() => setOpen(a.id)} className="block aspect-square w-full" aria-label={`Open ${a.kind}: ${a.prompt ?? ''}`}>
                  {a.kind === 'image' && /* eslint-disable-next-line @next/next/no-img-element */ <img src={srcOf(a)} alt={a.prompt ?? ''} loading="lazy" className="h-full w-full object-cover" />}
                  {a.kind === 'video' && <video src={`${srcOf(a)}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />}
                  {a.kind === 'audio' && <span className="flex h-full items-center justify-center text-[34px]" style={{ color: 'var(--accent)' }}>♪</span>}
                  {a.kind === 'model3d' && <span className="flex h-full items-center justify-center text-[34px]" style={{ color: 'var(--accent)' }}>⬢</span>}
                  {a.kind === 'video' && <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">▷</span>}
                </button>
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[10.5px]" style={{ color: 'var(--ink-dim)' }} title={a.prompt}>{a.prompt || a.kind}</span>
                  <span className="mono shrink-0 text-[9px]" style={{ color: 'var(--ink-faint)' }}>{fmtBytes(a.bytes)}</span>
                  <button type="button" onClick={() => downloadAsset(a)} className="press mono px-1 text-[12px]" aria-label="Download" title="Download">⬇</button>
                  <button type="button" onClick={async () => { await deleteAsset(a.id); void refresh(); }} className="press mono px-1 text-[12px]" aria-label="Delete" title="Delete">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {current && (current.kind === 'image' || current.kind === 'video') && (
        <ZoomViewer kind={current.kind} src={srcOf(current)} title={current.prompt} onClose={() => setOpen(null)} onPrev={() => go(-1)} onNext={() => go(1)} />
      )}
      {current?.kind === 'audio' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(8,6,4,0.8)' }} onClick={() => setOpen(null)}>
          <div className="w-full max-w-lg rounded-2xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line)' }} onClick={(e) => e.stopPropagation()}>
            <TrackPlayer src={srcOf(current)} title={current.prompt ?? 'Audio'} />
            <button type="button" onClick={() => setOpen(null)} className="press mono mt-3 rounded-lg border px-3 py-1.5 text-[11px]" style={{ borderColor: 'var(--line)' }}>close</button>
          </div>
        </div>
      )}
      {current?.kind === 'model3d' && <ModelViewer src={srcOf(current)} title={current.prompt} onClose={() => setOpen(null)} overlay />}
    </div>
  );
}
