'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORIES,
  TOOLS,
  categoryOf,
  defaultsFor,
  outToText,
  runTool,
  searchTools,
  toolById,
  type Category,
  type Field,
  type Out,
  type ToolDef,
  type Values,
} from '@/lib/tools';
import { Icon } from '@/components/Icon';

/* ── tiny storage helpers (private windows and blocked storage must not break the screen) ── */
const FAV_KEY = 'tools.fav.v1';
const REC_KEY = 'tools.recent.v1';
function load(key: string): string[] {
  try {
    const x = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string' && !!toolById(i)) : [];
  } catch { return []; }
}
function save(key: string, v: string[]) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch { return false; }
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/* ── colour per category ── */
const tint = (c: Category, a = 0.14) => `hsl(${c.hue} 75% 55% / ${a})`;
const gradient = (c: Category) => `linear-gradient(140deg, hsl(${c.hue} 85% 62%), hsl(${(c.hue + 38) % 360} 80% 46%))`;

function GlyphTile({ glyph, cat, size = 44 }: { glyph: string; cat: Category; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center font-semibold text-white"
      style={{ width: size, height: size, borderRadius: size * 0.3, background: gradient(cat), fontSize: size * (glyph.length > 2 && !glyph.startsWith('icon:') ? 0.3 : 0.42), boxShadow: `0 6px 16px -8px hsl(${cat.hue} 80% 40% / .9), inset 0 1px 0 rgb(255 255 255 / .25)`, letterSpacing: glyph.length > 2 && !glyph.startsWith('icon:') ? '-0.04em' : undefined }}
    >
      {glyph.startsWith('icon:') ? <Icon name={glyph.slice(5)} size={Math.round(size * 0.5)} stroke={1.9} /> : glyph}
    </span>
  );
}

/* ── form fields ── */
const inputBase = 'w-full rounded-xl border px-3 text-[14px] outline-none transition-colors focus:border-[var(--accent)]';
const inputStyle = { borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink)', minHeight: 44 } as const;

function FieldView({ f, value, onChange, cat }: { f: Field; value: Values[string]; onChange: (v: Values[string]) => void; cat: Category }) {
  const label = (
    <span className="mono mb-1.5 block text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>{f.label}</span>
  );
  switch (f.kind) {
    case 'text':
      return (
        <label className="block">{label}
          <input value={String(value ?? '')} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" className={inputBase + (f.mono ? ' mono' : '')} style={inputStyle} />
        </label>
      );
    case 'area':
      return (
        <label className="block">{label}
          <textarea value={String(value ?? '')} placeholder={f.placeholder} rows={f.rows ?? 5} onChange={(e) => onChange(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" className={inputBase + ' resize-y py-2.5 leading-relaxed' + (f.mono ? ' mono' : '')} style={{ ...inputStyle, minHeight: 96 }} />
        </label>
      );
    case 'number':
      return (
        <label className="block">{label}
          <div className="relative">
            <input type="number" inputMode="decimal" value={String(value ?? '')} min={f.min} max={f.max} step={f.step ?? 'any'} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} className={inputBase + ' mono'} style={{ ...inputStyle, paddingRight: f.unit ? 44 : undefined }} />
            {f.unit && <span className="mono pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: 'var(--ink-faint)' }}>{f.unit}</span>}
          </div>
        </label>
      );
    case 'select': {
      const opts = f.options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
      if (opts.length <= 4 && opts.every((o) => o.label.length <= 14)) {
        return (
          <div>{label}
            <div role="radiogroup" aria-label={f.label} className="flex gap-1 rounded-xl border p-1" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
              {opts.map((o) => {
                const on = o.value === value;
                return (
                  <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)} className="press flex-1 rounded-lg px-2 text-[13px] font-medium" style={{ minHeight: 38, background: on ? gradient(cat) : 'transparent', color: on ? '#fff' : 'var(--ink-dim)' }}>
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      }
      return (
        <label className="block">{label}
          <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={inputBase} style={inputStyle}>
            {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      );
    }
    case 'toggle': {
      const on = value === true;
      return (
        <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="press flex w-full items-center justify-between rounded-xl border px-3 text-left text-[14px]" style={{ ...inputStyle, minHeight: 44 }}>
          <span>{f.label}</span>
          <span className="relative h-6 w-10 shrink-0 rounded-full transition-colors" style={{ background: on ? gradient(cat) : 'var(--line)' }}>
            <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? 18 : 2 }} />
          </span>
        </button>
      );
    }
    case 'color':
      return (
        <label className="block">{label}
          <div className="flex items-center gap-2 rounded-xl border px-2" style={{ ...inputStyle, padding: '0 8px' }}>
            <input type="color" value={String(value || '#000000')} onChange={(e) => onChange(e.target.value)} aria-label={f.label} className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0" />
            <input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className="mono min-w-0 flex-1 bg-transparent text-[13px] outline-none" style={{ color: 'var(--ink)', minHeight: 40 }} spellCheck={false} />
          </div>
        </label>
      );
    case 'range':
      return (
        <label className="block">
          <span className="mono mb-1 flex items-baseline justify-between text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
            <span>{f.label}</span><span className="text-[13px] normal-case" style={{ color: 'var(--ink)' }}>{String(value)}{f.unit ?? ''}</span>
          </span>
          <input type="range" min={f.min} max={f.max} step={f.step ?? 1} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} className="h-8 w-full" style={{ accentColor: `hsl(${cat.hue} 80% 55%)` }} />
        </label>
      );
    case 'date':
      return (
        <label className="block">{label}
          <input type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={inputBase + ' mono'} style={inputStyle} />
        </label>
      );
    case 'datetime':
      return (
        <label className="block">{label}
          <input type="datetime-local" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={inputBase + ' mono'} style={inputStyle} />
        </label>
      );
  }
}

/* ── results ── */
function CopyBtn({ text, label = 'Copy', onDone }: { text: string; label?: string; onDone: (m: string) => void }) {
  return (
    <button type="button" onClick={async () => onDone((await copyText(text)) ? 'Copied' : 'Copy failed')} className="press mono rounded-lg border px-2.5 text-[11px] font-medium" style={{ minHeight: 32, borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>
      {label}
    </button>
  );
}

function Card({ title, children, actions }: { title?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--line)' }}>
          <span className="mono text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>{title}</span>
          <span className="flex gap-1.5">{actions}</span>
        </header>
      )}
      {children}
    </section>
  );
}

function CssPreview({ style }: { style: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.style.cssText = style; }, [style]);
  return <div ref={ref} className="h-32 w-full" aria-hidden />;
}

function SvgView({ svg, name, onDone }: { svg: string; name: string; onDone: (m: string) => void }) {
  const src = useMemo(() => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, [svg]);
  const png = () => {
    const img = new Image();
    img.onload = () => {
      const w = Math.max(img.naturalWidth || 512, 512), h = Math.round(w * ((img.naturalHeight || 512) / (img.naturalWidth || 512)));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); if (!g) return onDone('PNG not supported');
      g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, w, h);
      c.toBlob((b) => { if (b) saveBlob(b, name.replace(/\.svg$/, '') + '.png'); else onDone('PNG failed'); });
    };
    img.onerror = () => onDone('PNG failed');
    img.src = src;
  };
  return (
    <Card title="Preview" actions={<>
      <button type="button" className="press mono rounded-lg border px-2.5 text-[11px] font-medium" style={{ minHeight: 32, borderColor: 'var(--line)', color: 'var(--ink-dim)' }} onClick={() => saveBlob(new Blob([svg], { type: 'image/svg+xml' }), name)}><Icon name="download" size={13} /> SVG</button>
      <button type="button" className="press mono rounded-lg px-2.5 text-[11px] font-medium text-white" style={{ minHeight: 32, background: 'var(--accent)' }} onClick={png}><Icon name="download" size={13} /> PNG</button>
      <CopyBtn text={svg} label="Code" onDone={onDone} />
    </>}>
      <div className="grid place-items-center p-4" style={{ background: 'repeating-conic-gradient(rgb(128 128 128 / .12) 0% 25%, transparent 0% 50%) 50% / 16px 16px' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Result" className="max-h-[360px] w-auto max-w-full rounded-lg" style={{ imageRendering: 'pixelated' }} />
      </div>
    </Card>
  );
}

function Result({ out, cat, onDone }: { out: Out; cat: Category; onDone: (m: string) => void }) {
  switch (out.kind) {
    case 'error':
      return <div role="alert" className="rounded-2xl border px-4 py-3 text-[13.5px]" style={{ borderColor: 'hsl(8 70% 55% / .5)', background: 'hsl(8 70% 55% / .1)', color: 'var(--ink)' }}><span className="inline-flex items-start gap-2"><Icon name="alert" size={16} style={{ marginTop: 2 }} />{out.message}</span></div>;
    case 'text':
      return (
        <Card title="Result" actions={<CopyBtn text={out.text} onDone={onDone} />}>
          <pre className="mono max-h-[55vh] overflow-auto whitespace-pre-wrap break-words p-3 text-[13px] leading-relaxed" style={{ color: 'var(--ink)' }}>{out.text || '—'}</pre>
        </Card>
      );
    case 'list':
      return (
        <Card title={`${out.items.length} result${out.items.length === 1 ? '' : 's'}`} actions={<CopyBtn text={out.items.join('\n')} label="Copy all" onDone={onDone} />}>
          <ul className="max-h-[55vh] divide-y overflow-auto" style={{ borderColor: 'var(--line)' }}>
            {out.items.map((it, i) => (
              <li key={i} style={{ borderColor: 'var(--line)' }}>
                <button type="button" onClick={async () => onDone((await copyText(it)) ? 'Copied' : 'Copy failed')} className="press mono block w-full break-all px-3 py-2.5 text-left text-[13px]" style={{ color: 'var(--ink)', minHeight: 44 }}>{it}</button>
              </li>
            ))}
          </ul>
        </Card>
      );
    case 'table':
      return (
        <Card title="Table" actions={<CopyBtn text={outToText(out)} onDone={onDone} />}>
          <div className="max-h-[55vh] overflow-auto">
            <table className="w-full border-collapse text-left text-[12.5px]">
              <thead><tr>{out.head.map((h, i) => <th key={i} className="mono sticky top-0 px-3 py-2 text-[10.5px] uppercase tracking-wider" style={{ background: 'var(--surface)', color: 'var(--ink-faint)' }}>{h}</th>)}</tr></thead>
              <tbody>{out.rows.map((r, i) => <tr key={i} className="border-t" style={{ borderColor: 'var(--line)' }}>{r.map((c, j) => <td key={j} className={'px-3 py-2 align-top' + (j === 0 ? ' mono font-medium' : '')} style={{ color: j === 0 ? 'var(--ink)' : 'var(--ink-dim)' }}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </Card>
      );
    case 'stats':
      return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {out.items.map((s, i) => (
            <button key={i} type="button" onClick={async () => onDone((await copyText(s.value)) ? `Copied ${s.label}` : 'Copy failed')} className="press rounded-2xl border p-3 text-left" style={{ borderColor: 'var(--line)', background: i === 0 ? tint(cat, 0.16) : 'var(--panel)' }}>
              <span className="mono block text-[10px] uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>{s.label}</span>
              <span className={'mt-1 block break-words font-semibold leading-snug ' + (i === 0 ? 'text-[19px]' : 'text-[15px]')} style={{ color: 'var(--ink)' }}>{s.value}</span>
            </button>
          ))}
        </div>
      );
    case 'swatches':
      return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {out.items.map((s, i) => (
            <button key={i} type="button" onClick={async () => onDone((await copyText(s.hex)) ? `Copied ${s.hex}` : 'Copy failed')} className="press overflow-hidden rounded-2xl border text-left" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
              <span className="block h-16" style={{ background: s.hex }} />
              <span className="mono block px-2.5 py-2 text-[12px]" style={{ color: 'var(--ink)' }}>{s.hex}{s.label && <span className="block truncate text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>{s.label}</span>}</span>
            </button>
          ))}
        </div>
      );
    case 'svg':
      return <SvgView svg={out.svg} name={out.name ?? 'image.svg'} onDone={onDone} />;
    case 'bars': {
      const max = Math.max(1, ...out.items.map((i) => i.value));
      return (
        <Card title="Chart">
          <ul className="space-y-2 p-3">
            {out.items.map((b, i) => (
              <li key={i} className="grid grid-cols-[84px_1fr_auto] items-center gap-2 text-[12.5px]">
                <span className="mono truncate" style={{ color: 'var(--ink-dim)' }}>{b.label}</span>
                <span className="h-3 overflow-hidden rounded-full" style={{ background: 'var(--surface)' }}>
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (b.value / max) * 100)}%`, background: gradient(cat) }} />
                </span>
                <span className="mono tabular-nums" style={{ color: 'var(--ink)' }}>{b.value}</span>
              </li>
            ))}
          </ul>
        </Card>
      );
    }
    case 'calendar': {
      const first = new Date(Date.UTC(out.year, out.month, 1));
      const lead = (first.getUTCDay() + 6) % 7;
      const days = new Date(Date.UTC(out.year, out.month + 1, 0)).getUTCDate();
      const cells = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
      const name = first.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      return (
        <Card title={name}>
          <div className="grid grid-cols-7 gap-1 p-3 text-center text-[12.5px]">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="mono py-1 text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>{d}</span>)}
            {cells.map((d, i) => {
              const mark = d !== null && out.marks?.includes(d);
              const wk = i % 7 >= 5;
              return <span key={i} className="grid h-9 place-items-center rounded-lg tabular-nums" style={d === null ? undefined : { background: mark ? gradient(cat) : 'var(--surface)', color: mark ? '#fff' : wk ? 'var(--ink-dim)' : 'var(--ink)', fontWeight: mark ? 700 : 400 }}>{d}</span>;
            })}
          </div>
        </Card>
      );
    }
    case 'diff':
      return (
        <Card title="Differences" actions={<CopyBtn text={outToText(out)} onDone={onDone} />}>
          <div className="mono max-h-[55vh] overflow-auto py-1 text-[12.5px]">
            {out.rows.map((r, i) => (
              <div key={i} className="flex gap-2 px-3 py-0.5" style={{ background: r.t === '+' ? 'hsl(145 60% 45% / .16)' : r.t === '-' ? 'hsl(0 70% 55% / .16)' : undefined, color: 'var(--ink)' }}>
                <span style={{ color: r.t === '+' ? 'hsl(145 60% 45%)' : r.t === '-' ? 'hsl(0 70% 60%)' : 'var(--ink-faint)' }}>{r.t === ' ' ? '·' : r.t}</span>
                <span className="whitespace-pre-wrap break-all">{r.s || ' '}</span>
              </div>
            ))}
          </div>
        </Card>
      );
    case 'css':
      return (
        <div className="space-y-3">
          <Card title="Preview"><CssPreview style={out.preview} /></Card>
          {out.css && (
            <Card title="CSS" actions={<CopyBtn text={out.css} onDone={onDone} />}>
              <pre className="mono overflow-auto whitespace-pre-wrap break-words p-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink)' }}>{out.css}</pre>
            </Card>
          )}
        </div>
      );
    case 'multi':
      return (
        <div className="space-y-3">
          {out.parts.map((p, i) => (
            <div key={i}>
              {p.title && <div className="mono mb-1.5 text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>{p.title}</div>}
              <Result out={p.out} cat={cat} onDone={onDone} />
            </div>
          ))}
        </div>
      );
  }
}

/* ── one open tool ── */
const VALUE_STORE = new Map<string, Values>();
function ToolPanel({ tool, fav, onFav, onBack, onToast }: { tool: ToolDef; fav: boolean; onFav: () => void; onBack: () => void; onToast: (m: string) => void }) {
  const cat = categoryOf(tool);
  const [vals, setVals] = useState<Values>(() => VALUE_STORE.get(tool.id) ?? defaultsFor(tool));
  const [out, setOut] = useState<Out | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const go = useCallback(async (v: Values) => {
    const n = ++seq.current;
    setBusy(true);
    const o = await runTool(tool, v);
    if (n === seq.current) { setOut(o); setBusy(false); }
  }, [tool]);

  useEffect(() => {
    const v = VALUE_STORE.get(tool.id) ?? defaultsFor(tool);
    setVals(v); setOut(null);
    if (!tool.manual) void go(v);
  }, [tool, go]);

  const set = (id: string, x: Values[string]) => {
    const next = { ...vals, [id]: x };
    setVals(next);
    VALUE_STORE.set(tool.id, next);
    if (!tool.manual) {
      const mine = ++seq.current; // cancel older runs, then debounce
      setTimeout(() => { if (mine === seq.current) void go(next); }, 160);
    }
  };

  const example = () => { const v = { ...defaultsFor(tool), ...tool.example }; setVals(v); void go(v); };
  const reset = () => { VALUE_STORE.delete(tool.id); const v = defaultsFor(tool); setVals(v); setOut(null); if (!tool.manual) void go(v); };
  const shareTxt = out && out.kind !== 'error' ? outToText(out) : '';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b px-3 py-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
        <button type="button" onClick={onBack} aria-label="Back to all tools" className="press grid place-items-center rounded-xl border text-[18px] md:hidden" style={{ width: 40, height: 40, borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>‹</button>
        <GlyphTile glyph={tool.glyph} cat={cat} size={42} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-semibold leading-tight" style={{ color: 'var(--ink)' }}>{tool.name}</h2>
          <p className="truncate text-[12px]" style={{ color: 'var(--ink-dim)' }}>{tool.blurb}</p>
        </div>
        <button type="button" onClick={onFav} aria-pressed={fav} aria-label={fav ? 'Remove from favourites' : 'Add to favourites'} className="press grid place-items-center rounded-xl " style={{ width: 40, height: 40, color: fav ? 'hsl(45 95% 55%)' : 'var(--ink-faint)' }}><Icon name={fav ? 'starFill' : 'star'} size={20} /></button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 pb-24">
        <Card>
          <div className="space-y-3 p-3">
            {tool.fields.map((f) => <FieldView key={f.id} f={f} value={vals[f.id]} onChange={(x) => set(f.id, x)} cat={cat} />)}
            <div className="flex flex-wrap gap-2 pt-1">
              {tool.manual && (
                <button type="button" onClick={() => void go(vals)} className="press min-w-[9rem] flex-1 whitespace-nowrap rounded-xl px-4 text-[14px] font-semibold text-white" style={{ minHeight: 46, background: gradient(cat), boxShadow: `0 8px 20px -10px hsl(${cat.hue} 80% 40%)` }}>
                  {busy ? 'Working…' : out ? <span className="inline-flex items-center gap-1.5"><Icon name="refresh" size={15} />Generate again</span> : 'Generate'}
                </button>
              )}
              <button type="button" onClick={example} className="press mono rounded-xl border px-3 text-[12px] font-medium" style={{ minHeight: 46, borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>Example</button>
              <button type="button" onClick={reset} className="press mono rounded-xl border px-3 text-[12px] font-medium" style={{ minHeight: 46, borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>Reset</button>
            </div>
          </div>
        </Card>

        <div aria-live="polite" style={{ opacity: busy && !tool.manual ? 0.6 : 1, transition: 'opacity .15s' }}>
          {out ? <Result out={out} cat={cat} onDone={onToast} /> : tool.manual ? (
            <p className="px-1 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>Tap Generate to see the result.</p>
          ) : null}
        </div>

        {shareTxt && shareTxt.length < 20000 && !['svg', 'swatches'].includes(out!.kind) && typeof navigator !== 'undefined' && 'share' in navigator && (
          <button type="button" onClick={() => void navigator.share({ text: shareTxt }).catch(() => {})} className="press mono w-full rounded-xl border text-[12px]" style={{ minHeight: 44, borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>Share result…</button>
        )}
      </div>
    </div>
  );
}

/* ── tile + browser ── */
function Tile({ t, fav, onOpen, onFav, active }: { t: ToolDef; fav: boolean; onOpen: () => void; onFav: () => void; active: boolean }) {
  const cat = categoryOf(t);
  return (
    <div className="group relative">
      <button type="button" onClick={onOpen} className="press flex w-full items-center gap-3 rounded-2xl border p-2.5 pr-11 text-left transition-colors" style={{ borderColor: active ? `hsl(${cat.hue} 75% 55% / .8)` : 'var(--line)', background: active ? tint(cat, 0.12) : 'var(--panel)', minHeight: 64 }}>
        <GlyphTile glyph={t.glyph} cat={cat} size={42} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>{t.name}</span>
          <span className="line-clamp-2 text-[11.5px] leading-snug" style={{ color: 'var(--ink-dim)' }}>{t.blurb}</span>
        </span>
      </button>
      <button type="button" onClick={onFav} aria-pressed={fav} aria-label={fav ? `Unfavourite ${t.name}` : `Favourite ${t.name}`} className="press absolute right-1 top-1/2 grid -translate-y-1/2 place-items-center rounded-xl " style={{ width: 40, height: 40, color: fav ? 'hsl(45 95% 55%)' : 'var(--ink-faint)' }}><Icon name={fav ? 'starFill' : 'star'} size={18} /></button>
    </div>
  );
}

type Filter = 'all' | 'fav' | 'recent' | Category['id'];

export function ToolsHub() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [favs, setFavs] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setFavs(load(FAV_KEY)); setRecent(load(REC_KEY)); }, []);
  const say = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1600);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const toggleFav = (id: string) => setFavs((f) => { const n = f.includes(id) ? f.filter((x) => x !== id) : [id, ...f]; save(FAV_KEY, n); return n; });
  const open = (id: string) => {
    setOpenId(id);
    setRecent((r) => { const n = [id, ...r.filter((x) => x !== id)].slice(0, 12); save(REC_KEY, n); return n; });
  };

  const list = useMemo(() => {
    if (filter === 'fav') return favs.map(toolById).filter((t): t is ToolDef => !!t).filter((t) => !q.trim() || searchTools(q).includes(t));
    if (filter === 'recent') return recent.map(toolById).filter((t): t is ToolDef => !!t).filter((t) => !q.trim() || searchTools(q).includes(t));
    return searchTools(q, filter === 'all' ? undefined : filter);
  }, [q, filter, favs, recent]);

  const grouped = useMemo(() => {
    if (q.trim() || filter !== 'all') return null;
    return CATEGORIES.map((c) => ({ c, items: TOOLS.filter((t) => t.cat === c.id) }));
  }, [q, filter]);

  const current = openId ? toolById(openId) : undefined;
  const chip = (id: Filter, label: string, hue?: number) => {
    const on = filter === id;
    return (
      <button key={id} type="button" onClick={() => setFilter(id)} aria-pressed={on} className="press mono shrink-0 rounded-full border px-3.5 text-[12px] font-medium" style={{ minHeight: 36, borderColor: on ? 'transparent' : 'var(--line)', background: on ? (hue !== undefined ? `linear-gradient(140deg, hsl(${hue} 85% 62%), hsl(${(hue + 38) % 360} 80% 46%))` : 'var(--accent)') : 'var(--panel)', color: on ? '#fff' : 'var(--ink-dim)' }}>
        {label}
      </button>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row" style={{ background: 'var(--bg)' }}>
      {/* browser column — hidden on a phone while a tool is open */}
      <aside className={(current ? 'hidden md:flex ' : 'flex ') + 'min-h-0 w-full shrink-0 flex-col border-r md:w-[380px]'} style={{ borderColor: 'var(--line)' }}>
        <div className="space-y-3 px-3 pb-2 pt-3">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-[20px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>Tools</h1>
              <p className="mono text-[11px]" style={{ color: 'var(--ink-faint)' }}>{TOOLS.length} tools · all run on your device</p>
            </div>
          </div>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-faint)' }}><Icon name="search" size={16} /></span>
            <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search — emi, qr, json, password…" aria-label="Search tools" className={inputBase + ' pl-9'} style={{ ...inputStyle, borderRadius: 14 }} />
          </div>
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1" role="group" aria-label="Filter by category">
            {chip('all', 'All')}
            {chip('fav', `Favourites ${favs.length}`)}
            {chip('recent', 'Recent')}
            {CATEGORIES.map((c) => chip(c.id, c.name, c.hue))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-24">
          {grouped ? grouped.map(({ c, items }) => (
            <section key={c.id} className="mb-5">
              <div className="mb-2 flex items-center gap-2.5">
                <GlyphTile glyph={c.glyph} cat={c} size={26} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>{c.name} <span className="mono font-normal" style={{ color: 'var(--ink-faint)' }}>{items.length}</span></h2>
                  <p className="truncate text-[11px]" style={{ color: 'var(--ink-faint)' }}>{c.blurb}</p>
                </div>
              </div>
              <div className="space-y-2">{items.map((t) => <Tile key={t.id} t={t} fav={favs.includes(t.id)} onFav={() => toggleFav(t.id)} onOpen={() => open(t.id)} active={openId === t.id} />)}</div>
            </section>
          )) : list.length ? (
            <div className="space-y-2">{list.map((t) => <Tile key={t.id} t={t} fav={favs.includes(t.id)} onFav={() => toggleFav(t.id)} onOpen={() => open(t.id)} active={openId === t.id} />)}</div>
          ) : (
            <div className="grid place-items-center gap-1 py-16 text-center">
              <span aria-hidden style={{ color: 'var(--ink-faint)' }}><Icon name={filter === 'fav' ? 'star' : 'search'} size={34} /></span>
              <p className="text-[14px] font-medium" style={{ color: 'var(--ink)' }}>{filter === 'fav' && !q ? 'No favourites yet' : filter === 'recent' && !q ? 'Nothing opened yet' : 'No tool matches'}</p>
              <p className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>{filter === 'fav' && !q ? 'Tap the star on any tool to pin it here.' : 'Try another word, or pick All.'}</p>
            </div>
          )}
        </div>
      </aside>

      {/* tool column */}
      <main className={(current ? 'flex ' : 'hidden md:flex ') + 'min-h-0 min-w-0 flex-1 flex-col'}>
        {current ? (
          <ToolPanel key={current.id} tool={current} fav={favs.includes(current.id)} onFav={() => toggleFav(current.id)} onBack={() => setOpenId(null)} onToast={say} />
        ) : (
          <div className="grid h-full place-items-center p-8 text-center">
            <div>
              <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl text-white" style={{ background: 'linear-gradient(140deg, hsl(262 85% 62%), hsl(320 80% 50%))', boxShadow: '0 14px 30px -14px hsl(290 80% 40%)' }}><Icon name="sparkle" size={30} /></div>
              <p className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>Pick a tool</p>
              <p className="mt-1 text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>Calculators, converters, generators, developer helpers and more.</p>
            </div>
          </div>
        )}
      </main>

      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4" style={{ opacity: toast ? 1 : 0, transform: toast ? 'translateY(0)' : 'translateY(8px)', transition: 'opacity .18s, transform .18s' }}>
        <span className="mono rounded-full px-4 py-2 text-[12px] font-medium shadow-lg" style={{ background: 'var(--ink)', color: 'var(--bg)' }}>{toast}</span>
      </div>
    </div>
  );
}
