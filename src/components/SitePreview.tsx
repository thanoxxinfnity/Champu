'use client';

import { useMemo, useState } from 'react';
import { bundleSite, previewCaveats, siteEntry, usesThree, type SiteFile } from '@/lib/suites/web/site';
import { useWorkspace } from '@/lib/store';

/**
 * The generated website, actually running.
 *
 * Before this, a site build ended at a file list: the user was told a 3D scene
 * had been written and had to believe it. Now the same files are assembled into
 * one document and run in a sandboxed iframe, at a width they choose — which is
 * also the only honest way to find out whether the thing renders at all.
 */

const WIDTHS = [
  { id: 'phone', label: 'phone', width: 390 },
  { id: 'tablet', label: 'tablet', width: 820 },
  { id: 'full', label: 'full', width: 0 },
] as const;

export function SitePreview() {
  const files = useWorkspace((s) => s.files);
  const [size, setSize] = useState<(typeof WIDTHS)[number]['id']>('full');
  // Remounts the iframe, which is the only way to restart an animation loop or
  // a scene that has already initialised.
  const [generation, setGeneration] = useState(0);

  const siteFiles = useMemo<SiteFile[]>(
    () =>
      Array.from(files.values())
        .filter((f) => typeof f.content === 'string')
        .map((f) => ({ path: f.path, content: f.content })),
    [files],
  );

  const entry = useMemo(() => siteEntry(siteFiles), [siteFiles]);
  const html = useMemo(() => (entry ? bundleSite(siteFiles, entry) : null), [siteFiles, entry]);
  const caveats = useMemo(() => (html ? previewCaveats(siteFiles, html) : []), [siteFiles, html]);
  const three = useMemo(() => usesThree(siteFiles), [siteFiles]);

  if (!entry || !html) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-[11.5px] leading-[1.6]" style={{ color: 'var(--ink-dim)' }}>
          No website in this session yet.
          <br />
          Ask for one — “build me a 3D landing page for a coffee brand” — and it renders here as it is written.
        </p>
      </div>
    );
  }

  const width = WIDTHS.find((w) => w.id === size)?.width ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1.5" style={{ borderColor: 'var(--line)' }}>
        <span className="mono text-[10px]" style={{ color: 'var(--ink-faint)' }}>
          {entry.path}
          {three ? ' · three.js' : ''}
        </span>
        <div className="ml-auto flex gap-1">
          {WIDTHS.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setSize(w.id)}
              className="press mono rounded-md border px-2 py-1 text-[10px]"
              style={{
                borderColor: size === w.id ? 'var(--accent)' : 'var(--line)',
                color: size === w.id ? 'var(--accent)' : 'var(--ink-dim)',
              }}
            >
              {w.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setGeneration((g) => g + 1)}
            className="press mono rounded-md border px-2 py-1 text-[10px]"
            style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
            title="Reload the scene from the top"
          >
            replay
          </button>
        </div>
      </div>

      {caveats.length > 0 && (
        <ul className="shrink-0 space-y-0.5 border-b px-2 py-1.5" style={{ borderColor: 'var(--line)' }}>
          {caveats.map((c) => (
            <li key={c} className="mono text-[9.5px]" style={{ color: 'var(--ink-faint)' }}>
              · {c}
            </li>
          ))}
        </ul>
      )}

      <div className="flex min-h-0 flex-1 justify-center overflow-auto" style={{ background: 'var(--bg)' }}>
        <iframe
          key={generation}
          title="site preview"
          srcDoc={html}
          className="h-full border-0"
          style={{ width: width ? `${width}px` : '100%', maxWidth: '100%', background: '#fff' }}
          // allow-scripts is what makes a 3D scene run at all. Same-origin is
          // deliberately withheld: generated code should not be able to reach
          // this workspace's own storage.
          sandbox="allow-scripts allow-modals allow-popups"
        />
      </div>
    </div>
  );
}
