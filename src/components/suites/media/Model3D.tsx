'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteAsset, listAssets } from '@/lib/db/history';
import type { AssetRecord } from '@/lib/db/schema';
import { useWorkspace } from '@/lib/store';
import { downloadAsset } from './LibraryView';
import { ModelViewer } from './ModelViewer';
import { apiBase, authHeaders, endpointsFor, httpJson, mediaToBlob, modelsFor, pickMedia, saveMedia, sleep, srcOf } from './shared';

/** 3D: describe an object, get a model you can turn around. Also opens a .glb from your files. */
export function Model3D() {
  const endpoints = useWorkspace((s) => s.endpoints);
  const providers = endpointsFor(endpoints, 'model3d');
  const [endpointId, setEndpointId] = useState('');
  const endpoint = providers.find((e) => e.id === endpointId) ?? providers[0];
  const models = modelsFor(endpoint, 'model3d');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<AssetRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => setItems(await listAssets('model3d', 100)), []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (!models.includes(model)) setModel(models[0] ?? ''); }, [endpoint?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = items.find((i) => i.id === selected) ?? items[0];

  const generate = async () => {
    if (!endpoint || !prompt.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const host = new URL(endpoint.baseUrl).host;
      const path = endpoint.routes.find((r) => /3d\/generations/.test(r)) ?? '/3d/generations';
      const res = await httpJson(`${apiBase(endpoint)}${path}`, { method: 'POST', headers: authHeaders(endpoint), body: JSON.stringify({ model, prompt: prompt.trim(), response_format: 'b64_json' }), signal: AbortSignal.timeout(600_000) }, host);
      let json: any = await res.json();
      const jobId = json?.id ?? json?.task_id;
      // Some providers answer with a job to wait for.
      for (let i = 0; i < 120 && jobId && !pickMedia(json) && !/fail|error|cancel/i.test(String(json?.status)); i++) {
        await sleep(5000);
        json = await (await httpJson(`${apiBase(endpoint)}${path}/${jobId}`, { headers: authHeaders(endpoint) }, host)).json();
      }
      const found = pickMedia(json);
      if (!found) throw new Error(json?.error?.message ?? 'The provider finished without a 3D model.');
      const { blob, url } = await mediaToBlob(found, 'model/gltf-binary');
      const saved = await saveMedia({ suite: 'model3d', kind: 'model3d', prompt: prompt.trim(), provider: endpoint.label, model, blob, url });
      setSelected(saved.id); await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  };

  const openFile = async (f: File | undefined) => {
    if (!f) return;
    const saved = await saveMedia({ suite: 'model3d', kind: 'model3d', prompt: f.name, provider: 'file', model: 'glb', blob: new Blob([await f.arrayBuffer()], { type: 'model/gltf-binary' }) });
    setSelected(saved.id); await refresh();
  };

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row" data-testid="model3d">
      <section className="flex min-h-[18rem] min-w-0 flex-1 flex-col">
        {now ? <ModelViewer key={now.id} src={srcOf(now)} title={now.prompt} />
          : <p className="m-auto max-w-xs px-4 text-center text-[12.5px] leading-[1.7]" style={{ color: 'var(--ink-dim)' }}>Describe an object below, or open a .glb file. The model appears here and you can turn it around.</p>}
        <div className="shrink-0 space-y-2 border-t p-3" style={{ borderColor: 'var(--line)' }}>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="A low-poly red sports car" className="w-full resize-y rounded-lg border bg-transparent px-3 py-2 text-[13px] outline-none" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }} />
          <div className="flex flex-wrap items-center gap-1.5">
            {providers.length > 1 && <select value={endpoint?.id} onChange={(e) => setEndpointId(e.target.value)} className="mono rounded border bg-transparent px-2 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}>{providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>}
            <select value={model} onChange={(e) => setModel(e.target.value)} className="mono max-w-[12rem] rounded border bg-transparent px-2 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }} aria-label="Model">{models.map((m) => <option key={m} value={m}>{m}</option>)}</select>
            <button type="button" onClick={() => file.current?.click()} className="press mono rounded-lg border px-3 py-1.5 text-[11px]" style={{ borderColor: 'var(--line)' }}>open .glb</button>
            <input ref={file} type="file" accept=".glb,model/gltf-binary" hidden onChange={(e) => { void openFile(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" onClick={() => void generate()} disabled={busy || !prompt.trim() || !endpoint} className="press mono ml-auto rounded-lg px-4 py-1.5 text-[11.5px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--panel)' }}>{busy ? 'building…' : 'make model'}</button>
          </div>
          {error && <p className="text-[11px] leading-[1.5]" role="alert" style={{ color: 'var(--color-red, #e5484d)' }}>{error}</p>}
        </div>
      </section>
      <aside className="max-h-44 shrink-0 overflow-y-auto border-t p-3 md:max-h-none md:w-64 md:border-l md:border-t-0" style={{ borderColor: 'var(--line)' }}>
        <p className="mono mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>Models</p>
        <ul className="space-y-1.5">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-1 rounded-lg border px-2 py-1.5" style={{ borderColor: i.id === now?.id ? 'var(--accent)' : 'var(--line)' }}>
              <button type="button" onClick={() => setSelected(i.id)} className="min-w-0 flex-1 truncate text-left text-[11.5px]" style={{ color: 'var(--ink-dim)' }}>⬢ {i.prompt}</button>
              <button type="button" onClick={() => downloadAsset(i)} className="press px-1 text-[12px]" aria-label="Download">⬇</button>
              <button type="button" onClick={async () => { await deleteAsset(i.id); void refresh(); }} className="press px-1 text-[12px]" aria-label="Delete">✕</button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
