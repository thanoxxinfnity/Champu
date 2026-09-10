'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { listAssets, saveAsset, deleteAsset } from '@/lib/db/history';
import type { AssetRecord } from '@/lib/db/schema';
import { dataUrlToBytes, downloadBlob } from '@/lib/zip';

type Provider = 'pollinations' | 'nim' | 'custom';

const NIM_IMAGE_MODELS = ['black-forest-labs/flux.1-dev', 'stabilityai/stable-diffusion-3-5-large'];
const POLLINATIONS_IMAGE_MODELS = ['flux', 'turbo'];

const SIZES: Array<[string, number, number]> = [
  ['1:1', 1024, 1024],
  ['16:9', 1344, 768],
  ['9:16', 768, 1344],
  ['4:3', 1152, 896],
];

/** Multi-provider image generator with a persistent local gallery. */
export function ImageSuite() {
  const endpoints = useWorkspace((s) => s.endpoints);

  const [provider, setProvider] = useState<Provider>('pollinations');
  const [model, setModel] = useState('flux');
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [size, setSize] = useState<[number, number]>([1024, 1024]);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gallery, setGallery] = useState<AssetRecord[]>([]);
  const [endpointId, setEndpointId] = useState<string>('');

  const imageEndpoints = endpoints.filter((e) => e.capabilities.includes('image') && e.enabled);

  const refresh = useCallback(async () => {
    setGallery(await listAssets('image', 120));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (provider === 'nim') setModel(NIM_IMAGE_MODELS[0]);
    else if (provider === 'pollinations') setModel(POLLINATIONS_IMAGE_MODELS[0]);
    else setModel(imageEndpoints[0]?.models.find((m) => m.capabilities.includes('image'))?.id ?? '');
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);

    const endpoint = imageEndpoints.find((e) => e.id === endpointId) ?? imageEndpoints[0];

    try {
      const res = await fetch('/api/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          prompt: prompt.trim(),
          negativePrompt: negative || undefined,
          width: size[0],
          height: size[1],
          count,
          custom:
            provider === 'custom' && endpoint
              ? { baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey, headers: endpoint.headers }
              : undefined,
        }),
      });

      const data = (await res.json()) as {
        images?: Array<{ dataUrl: string; model: string; seed: number }>;
        error?: string;
        errors?: string[];
      };

      if (!res.ok || !data.images?.length) {
        setError(data.error ?? 'Generation failed.');
        return;
      }

      if (data.errors?.length) {
        setError(`${data.images.length}/${count} generated. ${data.errors[0]}`);
      }

      for (const image of data.images) {
        await saveAsset({
          suite: 'image',
          kind: 'image',
          prompt: prompt.trim(),
          provider,
          model: image.model,
          dataUrl: image.dataUrl,
          bytes: Math.round((image.dataUrl.length * 3) / 4),
          meta: { seed: image.seed, width: size[0], height: size[1], negative },
        });
      }

      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const models = provider === 'nim' ? NIM_IMAGE_MODELS : provider === 'pollinations' ? POLLINATIONS_IMAGE_MODELS : (imageEndpoints.find((e) => e.id === endpointId)?.models ?? []).filter((m) => m.capabilities.includes('image')).map((m) => m.id);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b p-3" style={{ borderColor: 'var(--line)' }}>
        <div className="mx-auto w-full max-w-3xl space-y-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void generate();
            }}
            rows={2}
            placeholder="Describe the image. Be specific about subject, composition, lighting and style — vague prompts produce generic output."
            className="w-full resize-y rounded-lg border bg-transparent px-3 py-2 text-[13px] outline-none placeholder:opacity-45"
            style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
          />

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex rounded-lg border" style={{ borderColor: 'var(--line)' }}>
              {(['pollinations', 'nim', 'custom'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  disabled={p === 'custom' && !imageEndpoints.length}
                  className="mono px-2.5 py-1.5 text-[10.5px] transition-colors disabled:opacity-30"
                  style={{
                    background: provider === p ? 'color-mix(in oklab, var(--accent) 14%, transparent)' : undefined,
                    color: provider === p ? 'var(--accent)' : 'var(--ink-dim)',
                  }}
                  title={p === 'pollinations' ? 'Zero-key, free tier' : p === 'nim' ? 'NVIDIA NIM vision pipeline' : 'Your configured endpoint'}
                >
                  {p === 'pollinations' ? 'pollinations' : p === 'nim' ? 'nvidia nim' : 'custom'}
                </button>
              ))}
            </div>

            {provider === 'custom' && imageEndpoints.length > 0 && (
              <select
                value={endpointId}
                onChange={(e) => setEndpointId(e.target.value)}
                className="mono rounded-lg border px-2 py-1.5 text-[10.5px] outline-none"
                style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
              >
                {imageEndpoints.map((e) => (
                  <option key={e.id} value={e.id}>{e.label}</option>
                ))}
              </select>
            )}

            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="mono max-w-52 rounded-lg border px-2 py-1.5 text-[10.5px] outline-none"
              style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
            >
              {models.map((m) => (
                <option key={m} value={m}>{m.split('/').pop()}</option>
              ))}
            </select>

            <div className="flex rounded-lg border" style={{ borderColor: 'var(--line)' }}>
              {SIZES.map(([label, w, h]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSize([w, h])}
                  className="mono px-2 py-1.5 text-[10px]"
                  style={{
                    background: size[0] === w && size[1] === h ? 'color-mix(in oklab, var(--accent) 14%, transparent)' : undefined,
                    color: size[0] === w && size[1] === h ? 'var(--accent)' : 'var(--ink-dim)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="mono rounded-lg border px-2 py-1.5 text-[10.5px] outline-none"
              style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>×{n}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void generate()}
              disabled={busy || !prompt.trim()}
              className="mono ml-auto rounded-lg px-4 py-1.5 text-[11px] font-medium disabled:opacity-35"
              style={{ background: 'var(--accent)', color: '#04150e' }}
            >
              {busy ? 'generating…' : 'generate'}
            </button>
          </div>

          {provider === 'nim' && (
            <input
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
              placeholder="negative prompt (NIM only)"
              className="mono w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-[11px] outline-none placeholder:opacity-40"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
            />
          )}

          {error && (
            <p className="mono text-[10.5px] leading-[1.45]" style={{ color: 'var(--color-rose)' }}>
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {gallery.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="mono text-center text-[11px] leading-[1.6]" style={{ color: 'var(--ink-faint)' }}>
              No images yet.
              <br />
              Pollinations needs no key — start there.
            </p>
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {gallery.map((asset) => (
              <figure key={asset.id} className="group relative overflow-hidden rounded-lg border" style={{ borderColor: 'var(--line)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.dataUrl} alt={asset.prompt ?? ''} className="aspect-square w-full object-cover" loading="lazy" />
                <figcaption
                  className="absolute inset-x-0 bottom-0 translate-y-full p-2 transition-transform group-hover:translate-y-0"
                  style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.9))' }}
                >
                  <p className="mono line-clamp-2 text-[9.5px] leading-[1.4]" style={{ color: '#fafafa' }}>
                    {asset.prompt}
                  </p>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        asset.dataUrl &&
                        downloadBlob(
                          new Blob([dataUrlToBytes(asset.dataUrl) as unknown as ArrayBuffer], { type: 'image/png' }),
                          `chomugiri-${asset.id}.png`,
                        )
                      }
                      className="mono text-[9.5px]"
                      style={{ color: 'var(--accent)' }}
                    >
                      save
                    </button>
                    <button
                      type="button"
                      onClick={() => setPrompt(asset.prompt ?? '')}
                      className="mono text-[9.5px]"
                      style={{ color: '#a1a1aa' }}
                    >
                      reuse
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteAsset(asset.id);
                        await refresh();
                      }}
                      className="mono ml-auto text-[9.5px]"
                      style={{ color: '#f43f5e' }}
                    >
                      ✕
                    </button>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
