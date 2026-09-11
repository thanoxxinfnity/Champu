'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import {
  KEY_MAGENTA,
  keyColorPrompt,
  loadImage,
  pickColorAt,
  removeBackground,
  toHex,
  type MatteResult,
  type RGB,
} from '@/lib/suites/assets/matte';
import { bundleFor, type AssetTarget } from '@/lib/suites/assets/export';
import { downloadZip, formatBytes } from '@/lib/zip';
import { listAssets, saveAsset } from '@/lib/db/history';
import type { AssetRecord } from '@/lib/db/schema';

/**
 * Asset Studio — generate or upload, cut the background, export the platform set.
 *
 * The honest constraint, stated in the UI too: NVIDIA publishes no hosted matting
 * model, so this does not attempt general-purpose subject extraction on arbitrary
 * photographs. Instead it *controls* the background — generated assets are placed
 * on a flat chroma field chosen for the purpose, which makes the cut exact. For
 * uploads, the same flood fill works whenever the background is flat.
 */

const TARGETS: Array<{ id: AssetTarget; label: string; hint: string }> = [
  { id: 'android-icon', label: 'Android icon', hint: 'mipmap densities + adaptive icon + Play 512' },
  { id: 'android-drawable', label: 'Android drawable', hint: 'mdpi → xxxhdpi at one baseline dp' },
  { id: 'web-favicon', label: 'Web favicon', hint: 'favicon set + webmanifest + head snippet' },
  { id: 'web-image', label: 'Web image', hint: '1x/2x/3x + an Open Graph card' },
];

const field = 'mono w-full rounded-lg border bg-transparent px-2.5 py-2 text-[11.5px] outline-none';
const fieldStyle = { borderColor: 'var(--line)', color: 'var(--ink)' } as const;

export function AssetStudio() {
  const endpoints = useWorkspace((s) => s.endpoints);
  const appendTerminal = useWorkspace((s) => s.appendTerminal);

  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState<'pollinations' | 'nim'>('pollinations');
  const [name, setName] = useState('ic_launcher');
  const [target, setTarget] = useState<AssetTarget>('android-icon');
  const [background, setBackground] = useState('#09090B');
  const [baselineDp, setBaselineDp] = useState(96);

  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [matte, setMatte] = useState<MatteResult | null>(null);
  const [tolerance, setTolerance] = useState(28);
  const [feather, setFeather] = useState(1.5);
  const [keyColor, setKeyColor] = useState<RGB | null>(null);
  const [pickingKey, setPickingKey] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gallery, setGallery] = useState<AssetRecord[]>([]);

  const previewRef = useRef<HTMLDivElement>(null);
  const rawRef = useRef<HTMLCanvasElement | null>(null);

  const refreshGallery = useCallback(async () => setGallery(await listAssets('assets', 60)), []);
  useEffect(() => { void refreshGallery(); }, [refreshGallery]);

  /** Re-run the cut whenever a knob moves. Cheap: pixels are already local. */
  const recut = useCallback(async (url: string, opts?: { tolerance?: number; feather?: number; keyColor?: RGB | null }) => {
    setBusy('cutting');
    setError(null);
    try {
      const result = await removeBackground(url, {
        tolerance: opts?.tolerance ?? tolerance,
        feather: opts?.feather ?? feather,
        keyColor: (opts && 'keyColor' in opts ? opts.keyColor : keyColor) ?? undefined,
        padding: 8,
      });
      setMatte(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [tolerance, feather, keyColor]);

  // Paint the cut-out onto a checkerboard so alpha is actually visible.
  useEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    host.replaceChildren();
    if (!matte) return;

    const canvas = matte.canvas;
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '260px';
    canvas.style.width = 'auto';
    canvas.style.height = 'auto';
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto';
    canvas.style.cursor = pickingKey ? 'crosshair' : 'default';
    host.appendChild(canvas);
  }, [matte, pickingKey]);

  const generate = async () => {
    const subject = prompt.trim();
    if (!subject) return;

    setBusy('generating');
    setError(null);
    try {
      // The key colour is written into the prompt, so the cut is exact rather
      // than a guess at where the subject ends.
      const res = await fetch('/api/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: provider === 'nim' ? 'black-forest-labs/flux.1-dev' : 'flux',
          prompt: `${subject}. ${keyColorPrompt(KEY_MAGENTA)}`,
          width: 1024,
          height: 1024,
          count: 1,
        }),
      });
      const data = (await res.json()) as { images?: Array<{ dataUrl: string }>; error?: string };
      if (!res.ok || !data.images?.length) {
        setError(data.error ?? 'Generation failed.');
        return;
      }

      const url = data.images[0].dataUrl;
      setSourceUrl(url);
      rawRef.current = null;
      setKeyColor(KEY_MAGENTA);
      await recut(url, { keyColor: KEY_MAGENTA });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const ingest = async (file: File) => {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    }).catch(() => null);
    if (!url) return;

    setSourceUrl(url);
    setKeyColor(null);
    rawRef.current = null;
    await recut(url, { keyColor: null });
  };

  /** Tap the preview to nominate the background colour explicitly. */
  const onPreviewClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pickingKey || !sourceUrl) return;

    const canvas = matte?.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    // Sample the untouched original, not the cut-out — the cut has already
    // zeroed the very pixels we need to read.
    if (!rawRef.current) {
      const img = await loadImage(sourceUrl);
      const raw = document.createElement('canvas');
      raw.width = img.naturalWidth;
      raw.height = img.naturalHeight;
      raw.getContext('2d')?.drawImage(img, 0, 0);
      rawRef.current = raw;
    }

    const scaleX = rawRef.current.width / canvas.width;
    const scaleY = rawRef.current.height / canvas.height;
    const picked = pickColorAt(rawRef.current, x * scaleX, y * scaleY);
    if (!picked) return;

    setKeyColor(picked);
    setPickingKey(false);
    await recut(sourceUrl, { keyColor: picked });
  };

  const exportBundle = async () => {
    if (!matte) return;
    setBusy('exporting');
    try {
      const bundle = bundleFor(target, matte.canvas, name, { background, appName: name, baselineDp });
      downloadZip(bundle.entries, `${name.replace(/\W+/g, '-')}-${target}.zip`);
      for (const note of bundle.notes) appendTerminal({ stream: 'system', text: `📦 ${note}` });

      await saveAsset({
        suite: 'assets',
        kind: 'image',
        prompt: prompt || name,
        provider: 'local',
        model: 'matte',
        dataUrl: matte.canvas.toDataURL('image/png'),
        meta: { target, name, removedRatio: matte.removedRatio },
      });
      await refreshGallery();
    } finally {
      setBusy(null);
    }
  };

  const hasCustomSegmentation = endpoints.some((e) => e.enabled && e.routes.includes('/3d/generations'));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-3 p-4">
        {/* ── Source ───────────────────────────────────────────────────── */}
        <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <h3 className="mono mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
            source
          </h3>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder="A rounded shield icon with a lightning bolt, flat vector, emerald and indigo"
            className={`${field} resize-y`}
            style={fieldStyle}
          />

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <div className="flex rounded-lg border" style={{ borderColor: 'var(--line)' }}>
              {(['pollinations', 'nim'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className="press mono px-2.5 py-1.5 text-[10.5px]"
                  style={{
                    background: provider === p ? 'color-mix(in oklab, var(--accent) 14%, transparent)' : undefined,
                    color: provider === p ? 'var(--accent)' : 'var(--ink-dim)',
                  }}
                >
                  {p === 'nim' ? 'NVIDIA FLUX' : 'Pollinations'}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void generate()}
              disabled={busy !== null || !prompt.trim()}
              className="press mono rounded-lg px-3 py-1.5 text-[11px] font-semibold disabled:opacity-35"
              style={{ background: 'var(--accent)', color: '#04150e' }}
            >
              {busy === 'generating' ? 'generating…' : 'generate + cut'}
            </button>

            <label
              className="press mono cursor-pointer rounded-lg border px-3 py-1.5 text-[10.5px]"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
            >
              upload
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void ingest(file);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          <p className="mt-2 text-[10.5px] leading-[1.5]" style={{ color: 'var(--ink-faint)' }}>
            Generation places the subject on a flat magenta field that the cut then keys out exactly. Uploads work the
            same way whenever their background is flat — NVIDIA publishes no hosted matting model, so this is a
            chroma cut, not general subject extraction from a photo.
            {hasCustomSegmentation && ' A segmentation route was detected on one of your custom endpoints.'}
          </p>
        </section>

        {/* ── Cut ──────────────────────────────────────────────────────── */}
        {sourceUrl && (
          <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
                cut
              </h3>
              {matte && (
                <span className="mono text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                  {(matte.removedRatio * 100).toFixed(0)}% removed · key {toHex(matte.keyColor)} ·{' '}
                  {matte.canvas.width}×{matte.canvas.height}
                </span>
              )}
              <button
                type="button"
                onClick={() => setPickingKey((v) => !v)}
                className="press mono ml-auto rounded border px-2 py-1 text-[10px]"
                style={{
                  borderColor: pickingKey ? 'var(--accent)' : 'var(--line)',
                  color: pickingKey ? 'var(--accent)' : 'var(--ink-dim)',
                }}
              >
                {pickingKey ? 'tap the background…' : 'pick key colour'}
              </button>
            </div>

            <div
              ref={previewRef}
              onClick={onPreviewClick}
              className="rounded-lg p-3"
              style={{
                // Checkerboard, so transparency is unmistakable.
                backgroundImage:
                  'linear-gradient(45deg, #1a1a1f 25%, transparent 25%), linear-gradient(-45deg, #1a1a1f 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1a1f 75%), linear-gradient(-45deg, transparent 75%, #1a1a1f 75%)',
                backgroundSize: '16px 16px',
                backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
                backgroundColor: '#0e0e11',
                minHeight: 140,
              }}
            />

            {matte?.warnings.map((w, i) => (
              <p key={i} className="mt-1.5 text-[10.5px] leading-[1.45]" style={{ color: 'var(--color-amber)' }}>
                ⚠ {w}
              </p>
            ))}

            <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
              <label className="block">
                <span className="mono flex justify-between text-[9.5px] uppercase" style={{ color: 'var(--ink-faint)' }}>
                  <span>tolerance</span>
                  <span>{tolerance}</span>
                </span>
                <input
                  type="range"
                  min={4}
                  max={80}
                  value={tolerance}
                  onChange={(e) => setTolerance(Number(e.target.value))}
                  onPointerUp={() => sourceUrl && void recut(sourceUrl)}
                  className="mt-1 w-full accent-emerald-500"
                />
              </label>

              <label className="block">
                <span className="mono flex justify-between text-[9.5px] uppercase" style={{ color: 'var(--ink-faint)' }}>
                  <span>edge feather</span>
                  <span>{feather.toFixed(1)}</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={6}
                  step={0.5}
                  value={feather}
                  onChange={(e) => setFeather(Number(e.target.value))}
                  onPointerUp={() => sourceUrl && void recut(sourceUrl)}
                  className="mt-1 w-full accent-emerald-500"
                />
              </label>
            </div>
          </section>
        )}

        {/* ── Export ───────────────────────────────────────────────────── */}
        {matte && (
          <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
            <h3 className="mono mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
              export
            </h3>

            <div className="grid gap-1.5 sm:grid-cols-2">
              {TARGETS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTarget(t.id)}
                  className="press rounded-lg border px-2.5 py-2 text-left"
                  style={{
                    borderColor: target === t.id ? 'color-mix(in oklab, var(--accent) 45%, var(--line))' : 'var(--line)',
                    background: target === t.id ? 'color-mix(in oklab, var(--accent) 8%, transparent)' : undefined,
                  }}
                >
                  <div className="mono text-[11px]" style={{ color: target === t.id ? 'var(--accent)' : 'var(--ink)' }}>
                    {t.label}
                  </div>
                  <div className="mt-0.5 text-[10px] leading-[1.4]" style={{ color: 'var(--ink-faint)' }}>
                    {t.hint}
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-2.5 flex flex-wrap items-end gap-1.5">
              <label className="min-w-32 flex-1">
                <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>
                  resource name
                </span>
                <input value={name} onChange={(e) => setName(e.target.value)} className={field} style={fieldStyle} />
              </label>

              {(target === 'android-icon' || target === 'web-favicon') && (
                <label className="w-28">
                  <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>
                    background
                  </span>
                  <input
                    type="color"
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                    className="mt-0.5 h-[34px] w-full cursor-pointer rounded-lg border bg-transparent"
                    style={{ borderColor: 'var(--line)' }}
                  />
                </label>
              )}

              {target === 'android-drawable' && (
                <label className="w-24">
                  <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>
                    baseline dp
                  </span>
                  <input
                    type="number"
                    value={baselineDp}
                    min={16}
                    step={8}
                    onChange={(e) => setBaselineDp(Number(e.target.value) || 96)}
                    className={field}
                    style={fieldStyle}
                  />
                </label>
              )}
            </div>

            <button
              type="button"
              onClick={() => void exportBundle()}
              disabled={busy !== null}
              className="press mono mt-2.5 w-full rounded-lg px-3 py-2 text-[11.5px] font-semibold disabled:opacity-35"
              style={{ background: 'var(--accent)', color: '#04150e' }}
            >
              {busy === 'exporting' ? 'packaging…' : `export ${TARGETS.find((t) => t.id === target)?.label} set`}
            </button>
          </section>
        )}

        {error && (
          <p
            className="enter-pop rounded-lg border px-3 py-2 text-[11.5px] leading-5"
            style={{ borderColor: 'color-mix(in oklab, var(--color-rose) 40%, var(--line))', color: 'var(--color-rose)' }}
          >
            {error}
          </p>
        )}

        {gallery.length > 0 && (
          <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
            <h3 className="mono mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
              exported · {gallery.length}
            </h3>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {gallery.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => asset.dataUrl && void recut(asset.dataUrl)}
                  className="press overflow-hidden rounded-lg border"
                  style={{
                    borderColor: 'var(--line)',
                    backgroundImage:
                      'linear-gradient(45deg, #1a1a1f 25%, transparent 25%), linear-gradient(-45deg, #1a1a1f 25%, transparent 25%)',
                    backgroundSize: '10px 10px',
                  }}
                  title={asset.prompt}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.dataUrl} alt="" className="aspect-square w-full object-contain" loading="lazy" />
                </button>
              ))}
            </div>
          </section>
        )}

        <p className="mono px-1 text-[9.5px] leading-[1.6]" style={{ color: 'var(--ink-faint)' }}>
          {matte
            ? `${formatBytes(matte.canvas.width * matte.canvas.height * 4)} in memory · exports are PNG with alpha`
            : 'Generate or upload to begin.'}
        </p>
      </div>
    </div>
  );
}
