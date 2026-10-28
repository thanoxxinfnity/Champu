'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { streamCompletion } from '@/lib/providers/chat-client';
import { endpointConfigFor } from '@/lib/providers/endpoint-models';
import { GATEWAY_ENDPOINT_ID, GATEWAY_PREFIX } from '@/lib/providers/gateway';
import { getSetting, setSetting } from '@/lib/db/history';
import { downloadText } from '@/lib/zip';
import {
  STACKS,
  createMessages,
  extractCode,
  fileName,
  updateMessages,
  withGeneratedImages,
  type Shot,
  type Stack,
} from '@/lib/suites/shot2code/prompts';

const KEY = 'shot2code.v1';
const MAX_SHOTS = 4;
const MAX_SIDE = 1600;

interface Version { code: string; note: string; at: number }
interface Saved { shots: Shot[]; stack: Stack; versions: Version[]; current: number; aiImages: boolean; model?: { provider: string; model: string; endpointId?: string } }

const inputCls = 'mono rounded border bg-transparent px-2 py-1.5 text-[11.5px] outline-none';
const inputStyle = { borderColor: 'var(--line)', color: 'var(--ink)' } as const;

function Btn({ children, onClick, disabled, primary, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="press mono inline-flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-35"
      style={primary ? { background: 'var(--accent)', color: '#04150e' } : { border: '1px solid var(--line)', color: 'var(--ink-dim)' }}
    >
      {children}
    </button>
  );
}

/** A screenshot shrunk so its long side is at most MAX_SIDE px (vision models resize anyway; smaller uploads are faster). */
async function readShot(file: Blob, name: string): Promise<Shot> {
  const url = await new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(new Error('Could not read the image.'));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => fail(new Error('That file is not an image.'));
    i.src = url;
  });
  const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  if (k >= 1 && url.length < 1_500_000) return { dataUrl: url, name };
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return { dataUrl: c.toDataURL('image/jpeg', 0.88), name };
}

/**
 * The preview runs the generated page in an opaque-origin sandbox (scripts on, no same-origin: it cannot reach this app's
 * storage). A small script added to it reports the element you click while "pick" is on, for a revision scoped to it.
 */
const PICKER = `<script>(function(){var on=false,last=null;window.addEventListener('message',function(e){if(e.data&&e.data.s2cPick!==undefined){on=!!e.data.s2cPick;if(!on&&last){last.style.outline='';last=null;}}});
document.addEventListener('mouseover',function(e){if(!on)return;if(last)last.style.outline='';last=e.target;last.style.outline='2px solid #22c55e';},true);
document.addEventListener('click',function(e){if(!on)return;e.preventDefault();e.stopPropagation();var t=e.target;if(last)last.style.outline='';var h=t.outerHTML;parent.postMessage({s2cPicked:h.length>4000?h.slice(0,4000):h},'*');on=false;},true);})();</script>`;

function withPicker(html: string): string {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${PICKER}</body>`) : html + PICKER;
}

/**
 * Screenshot → Code (after abi/screenshot-to-code, MIT): drop or paste screenshots, pick a stack, and a vision model writes the
 * page; then ask for changes in words, optionally after clicking the element to change in the preview. Every version is kept.
 */
export function ScreenshotToCode() {
  const models = useWorkspace((s) => s.models);
  const selection = useWorkspace((s) => s.selection);
  const [shots, setShots] = useState<Shot[]>([]);
  const [stack, setStack] = useState<Stack>('html_tailwind');
  const [versions, setVersions] = useState<Version[]>([]);
  const [current, setCurrent] = useState(-1);
  const [aiImages, setAiImages] = useState(true);
  const [model, setModel] = useState<{ provider: string; model: string; endpointId?: string }>({ provider: 'custom', model: `${GATEWAY_PREFIX}vision`, endpointId: GATEWAY_ENDPOINT_ID });
  const [extra, setExtra] = useState('');
  const [change, setChange] = useState('');
  const [picked, setPicked] = useState('');
  const [picking, setPicking] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'preview' | 'code' | 'compare'>('preview');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [loaded, setLoaded] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // ── Persistence ───────────────────────────────────────────────────────────
  useEffect(() => {
    void getSetting<Saved | null>(KEY, null).then((s) => {
      if (s && Array.isArray(s.versions)) {
        setShots(s.shots ?? []);
        setStack(s.stack ?? 'html_tailwind');
        setVersions(s.versions);
        setCurrent(Math.min(s.current ?? s.versions.length - 1, s.versions.length - 1));
        setAiImages(s.aiImages ?? true);
        if (s.model) setModel(s.model);
      } else {
        // No connected model that sees images yet: start from the chat's own model (Pollinations' OpenAI models read images, keyless).
        const st = useWorkspace.getState();
        if (!st.models.some((m) => m.capabilities.includes('vision') && !m.id.startsWith(GATEWAY_PREFIX)) && st.selection.model) {
          setModel({ provider: st.selection.provider, model: st.selection.model, endpointId: st.selection.endpointId });
        }
      }
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => { void setSetting(KEY, { shots, stack, versions: versions.slice(-20), current, aiImages, model }); }, 400);
    return () => clearTimeout(t);
  }, [loaded, shots, stack, versions, current, aiImages, model]);

  // ── Models that can see ───────────────────────────────────────────────────
  const visionModels = useMemo(() => models.filter((m) => m.capabilities.includes('vision')), [models]);
  const modelKey = `${model.provider}|${model.endpointId ?? ''}|${model.model}`;

  // ── Screenshots in ────────────────────────────────────────────────────────
  const addFiles = useCallback(async (files: Iterable<File>) => {
    setError(null);
    const out: Shot[] = [];
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try { out.push(await readShot(f, f.name || 'screenshot')); } catch (e) { setError((e as Error).message); }
    }
    if (out.length) setShots((s) => [...s, ...out].slice(-MAX_SHOTS));
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); void addFiles(files); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  // ── The picker in the preview ─────────────────────────────────────────────
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const h = (e.data as { s2cPicked?: string })?.s2cPicked;
      if (typeof h === 'string') { setPicked(h); setPicking(false); }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  useEffect(() => { frame.current?.contentWindow?.postMessage({ s2cPick: picking }, '*'); }, [picking]);

  // ── Generation ────────────────────────────────────────────────────────────
  const code = current >= 0 ? versions[current]?.code ?? '' : '';
  const shown = busy ? extractCode(streaming, true) ?? code : code;
  const rendered = useMemo(() => (shown ? withPicker(aiImages ? withGeneratedImages(shown) : shown) : ''), [shown, aiImages]);

  const run = async (messages: ReturnType<typeof createMessages>, note: string) => {
    setBusy(true);
    setError(null);
    setStreaming('');
    setTab('preview');
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const r = await streamCompletion({
        provider: model.provider as never,
        model: model.model,
        maxTokens: 16000,
        temperature: 0.2,
        custom: endpointConfigFor(useWorkspace.getState().endpoints, model),
        messages,
      }, { onDelta: (_d, full) => setStreaming(full) }, ctl.signal);
      if (r.error && !r.content) throw new Error(r.error);
      const html = extractCode(r.content) ?? extractCode(r.content, true);
      if (!html) throw new Error('The model did not return an HTML page. Try a model that sees images (Auto — sees images), or a clearer screenshot.');
      setVersions((v) => { const next = [...v, { code: html, note, at: Date.now() }]; setCurrent(next.length - 1); return next; });
    } catch (e) {
      if (!ctl.signal.aborted) setError((e as Error).message || 'Something went wrong.');
    } finally {
      setBusy(false);
      setStreaming('');
      abort.current = null;
    }
  };

  const generate = () => {
    if (!shots.length || busy) return;
    void run(createMessages(shots, stack, extra), `Built from ${shots.length} screenshot${shots.length > 1 ? 's' : ''} · ${STACKS.find((s) => s.id === stack)?.label}`);
  };
  const revise = () => {
    if (!code || !change.trim() || busy) return;
    void run(updateMessages(shots, stack, code, change, picked), change.trim().slice(0, 80));
    setChange('');
    setPicked('');
  };

  const finalHtml = () => (aiImages ? withGeneratedImages(code) : code);
  const openTab = () => {
    const url = URL.createObjectURL(new Blob([finalHtml()], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row" style={{ background: 'var(--bg)' }}>
      <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-b p-3 md:w-80 md:border-b-0 md:border-r" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
        <div>
          <div className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>Screenshot → Code</div>
          <div className="text-[11px]" style={{ color: 'var(--ink-dim)' }}>Drop, paste (Ctrl/⌘ V) or pick a screenshot or mock-up; a vision model rebuilds it as code.</div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter') fileInput.current?.click(); }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void addFiles(Array.from(e.dataTransfer.files)); }}
          className="press flex min-h-24 cursor-pointer flex-wrap items-center justify-center gap-2 rounded-lg border border-dashed p-2 text-center text-[11px]"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
        >
          {shots.length === 0 ? <span>Drop screenshots here, or tap to choose (up to {MAX_SHOTS})</span> : shots.map((s, i) => (
            <span key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.dataUrl} alt={s.name ?? `screenshot ${i + 1}`} className="h-20 w-auto rounded border" style={{ borderColor: 'var(--line)' }} />
              <button
                type="button"
                aria-label="Remove screenshot"
                onClick={(e) => { e.stopPropagation(); setShots((x) => x.filter((_, j) => j !== i)); }}
                className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full text-[11px]"
                style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)' }}
              >×</button>
            </span>
          ))}
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(Array.from(e.target.files)); e.target.value = ''; }} />
        </div>

        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-dim)' }}>
          Stack
          <select value={stack} onChange={(e) => setStack(e.target.value as Stack)} className={inputCls} style={inputStyle}>
            {STACKS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-dim)' }}>
          Model (must see images)
          <select
            value={modelKey}
            onChange={(e) => { const [provider, endpointId, ...rest] = e.target.value.split('|'); setModel({ provider, endpointId: endpointId || undefined, model: rest.join('|') }); }}
            className={inputCls}
            style={inputStyle}
          >
            <option value={`custom|${GATEWAY_ENDPOINT_ID}|${GATEWAY_PREFIX}vision`}>Auto — sees images (gateway)</option>
            {visionModels.filter((m) => m.id !== `${GATEWAY_PREFIX}vision`).map((m) => (
              <option key={`${m.provider}|${m.endpointId ?? ''}|${m.id}`} value={`${m.provider}|${m.endpointId ?? ''}|${m.id}`}>{m.label}</option>
            ))}
            {selection.model && !visionModels.some((m) => m.id === selection.model) && (
              <option value={`${selection.provider}|${selection.endpointId ?? ''}|${selection.model}`}>Chat model: {selection.model}</option>
            )}
          </select>
        </label>

        <textarea value={extra} onChange={(e) => setExtra(e.target.value)} rows={2} placeholder="Extra instructions (optional): dark mode, Hindi text, make it responsive…" className={inputCls} style={inputStyle} />

        <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-dim)' }}>
          <input type="checkbox" checked={aiImages} onChange={(e) => setAiImages(e.target.checked)} />
          Fill pictures with AI images (Pollinations, free)
        </label>

        <div className="flex gap-2">
          {busy
            ? <Btn primary onClick={() => abort.current?.abort()}>Stop</Btn>
            : <Btn primary onClick={generate} disabled={!shots.length}>Generate code</Btn>}
          {versions.length > 0 && !busy && <Btn onClick={() => { setVersions([]); setCurrent(-1); }}>Clear versions</Btn>}
        </div>
        {error && <div className="rounded border p-2 text-[11px]" style={{ borderColor: 'var(--color-rose)', color: 'var(--color-rose)' }}>{error}</div>}

        {versions.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="text-[11px] font-semibold" style={{ color: 'var(--ink)' }}>Versions</div>
            {versions.map((v, i) => (
              <button
                key={v.at}
                type="button"
                onClick={() => setCurrent(i)}
                className="press truncate rounded px-2 py-1 text-left text-[11px]"
                style={{ background: i === current ? 'color-mix(in oklab, var(--accent) 14%, transparent)' : undefined, color: i === current ? 'var(--accent)' : 'var(--ink-dim)' }}
                title={v.note}
              >v{i + 1} · {v.note}</button>
            ))}
          </div>
        )}
        <div className="mt-auto text-[10px]" style={{ color: 'var(--ink-dim)' }}>
          Based on <a href="https://github.com/abi/screenshot-to-code" target="_blank" rel="noreferrer" className="underline">abi/screenshot-to-code</a> (MIT).
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--line)' }}>
          {(['preview', 'code', 'compare'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className="press mono rounded px-2 py-1 text-[11px]"
              style={{ background: tab === t ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : undefined, color: tab === t ? 'var(--accent)' : 'var(--ink-dim)' }}>{t}</button>
          ))}
          <span className="mx-1 h-4 w-px" style={{ background: 'var(--line)' }} />
          {(['desktop', 'mobile'] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDevice(d)} className="press mono rounded px-2 py-1 text-[11px]"
              style={{ color: device === d ? 'var(--ink)' : 'var(--ink-dim)', textDecoration: device === d ? 'underline' : undefined }}>{d}</button>
          ))}
          <span className="flex-1" />
          {busy && <span className="mono text-[11px]" style={{ color: 'var(--color-amber)' }}>writing… {Math.round(streaming.length / 1000)}k chars</span>}
          <Btn onClick={() => void navigator.clipboard.writeText(finalHtml())} disabled={!code}>Copy</Btn>
          <Btn onClick={() => downloadText(finalHtml(), fileName(stack, shots[0]?.name), 'text/html;charset=utf-8')} disabled={!code}>Download</Btn>
          <Btn onClick={openTab} disabled={!code}>Open</Btn>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {!shown && !busy && (
            <div className="flex h-full items-center justify-center text-center text-[12px]" style={{ color: 'var(--ink-dim)' }}>
              Add a screenshot on the left and press Generate code. You can then ask for changes, or click an element in the preview to change just that.
            </div>
          )}
          {shown && tab === 'preview' && (
            <div className="mx-auto h-full" style={{ width: device === 'mobile' ? 390 : '100%', maxWidth: '100%' }}>
              <iframe ref={frame} title="Preview" sandbox="allow-scripts allow-forms allow-popups" srcDoc={rendered} className="h-full min-h-[480px] w-full rounded border bg-white" style={{ borderColor: 'var(--line)' }} />
            </div>
          )}
          {shown && tab === 'code' && (
            <pre className="mono h-full overflow-auto whitespace-pre-wrap rounded border p-3 text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}>{shown}</pre>
          )}
          {shown && tab === 'compare' && (
            <div className="grid h-full min-h-[480px] grid-cols-1 gap-3 md:grid-cols-2">
              <div className="overflow-auto rounded border" style={{ borderColor: 'var(--line)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {shots[0] && <img src={shots[0].dataUrl} alt="The screenshot" className="w-full" />}
              </div>
              <iframe title="Result" sandbox="allow-scripts" srcDoc={rendered} className="h-full w-full rounded border bg-white" style={{ borderColor: 'var(--line)' }} />
            </div>
          )}
        </div>

        {code && (
          <div className="flex flex-col gap-2 border-t p-3" style={{ borderColor: 'var(--line)' }}>
            {picked && (
              <div className="mono flex items-center gap-2 truncate rounded border px-2 py-1 text-[10.5px]" style={{ borderColor: 'var(--accent)', color: 'var(--ink-dim)' }}>
                <span className="truncate">Change only: {picked.slice(0, 140)}</span>
                <button type="button" onClick={() => setPicked('')} className="ml-auto" aria-label="Clear the picked element">×</button>
              </div>
            )}
            <div className="flex gap-2">
              <Btn onClick={() => { setTab('preview'); setPicking((p) => !p); }} disabled={busy} title="Click an element in the preview to change just that">
                {picking ? 'Picking… (click in preview)' : 'Pick element'}
              </Btn>
              <input
                value={change}
                onChange={(e) => setChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') revise(); }}
                placeholder="What to change? e.g. make the header sticky, buttons rounded, add a footer…"
                className={`${inputCls} min-w-0 flex-1`}
                style={inputStyle}
              />
              <Btn primary onClick={revise} disabled={busy || !change.trim()}>Update</Btn>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
