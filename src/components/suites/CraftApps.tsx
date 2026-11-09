'use client';

/**
 * Craft apps — ArtCraft's open-source stand-ins for Adobe and Office (PhotoCraft, VectorCraft, FilmCraft, ...) and Craft Anything.
 * They are native programs (Rust), so they run on the Terminal Bridge computer, not inside the phone: this page installs them there
 * (downloaded from the project's GitHub release, SHA-256 checked when published), opens one on the bridge's private screen so you can
 * watch and tap it, and hands a job to the Handoff agent. The browser versions live at getartcraft.com.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { hasCraft } from '@/lib/bridge/update';
import type { CraftApp } from '@/lib/bridge/client';
import { queueHandoff } from '@/lib/handoff/specialties';
import { Icon } from './handoff/Icon';
import { GRAD, LiveScreen, useLiveScreen } from './handoff/LiveScreen';

const card = { borderColor: 'var(--line)', background: 'var(--panel)' } as const;
const SITE = 'https://www.getartcraft.com';

/** The icon drawn for each app (from the central set). */
const GLYPH: Record<string, string> = {
  photocraft: 'image', vectorcraft: 'pen', filmcraft: 'video', lightcraft: 'sun', effectcraft: 'sparkles', designcraft: 'layout',
  pdfcraft: 'file', wordcraft: 'file', deckcraft: 'layout', gridcraft: 'grid', cadcraft: 'ruler', figcraft: 'canvas', soundcraft: 'audio',
  texturecraft: 'palette', materialcraft: 'palette', anicraft: 'motion', artcraft: 'sparkles', 'craft-anything': 'wand',
};

/** The shell line that runs the bridge's own craft command (the bridge sets $CHOMUGIRI_AGENT for every command it runs). */
const craftCmd = (args: string) => `node "$CHOMUGIRI_AGENT" craft ${args}`;

function Btn({ children, onClick, primary, disabled, title }: { children: React.ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className="press inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3.5 text-[13px] font-semibold disabled:opacity-45"
      style={{ minHeight: 44, borderColor: primary ? 'transparent' : 'var(--line)', background: primary ? GRAD : 'var(--panel)', color: primary ? '#fff' : 'var(--ink-dim)' }}>{children}</button>
  );
}

export function CraftApps() {
  const bridge = useWorkspace((s) => s.bridge);
  const heartbeat = useWorkspace((s) => s.heartbeat);
  const setSuite = useWorkspace((s) => s.setSuite);
  const online = heartbeat.status === 'online' || heartbeat.status === 'degraded';
  const craftOk = online && hasCraft(heartbeat.health as never);
  const [apps, setApps] = useState<CraftApp[] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<{ id: string; text: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [job, setJob] = useState('');
  const live = useLiveScreen('desktop');
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!craftOk) return;
    try { const r = await bridge.craft({ action: 'list' }); if (r.ok && r.apps) setApps(r.apps); } catch (e) { setNote((e as Error).message); }
  }, [bridge, craftOk]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => abort.current?.abort(), []);

  /** Runs `craft install <id>` on the bridge and shows its lines as they arrive. */
  const install = async (app: CraftApp) => {
    setBusy(app.id); setNote(''); setLog({ id: app.id, text: 'Starting…' });
    abort.current = new AbortController();
    try {
      const { execId } = await bridge.exec(craftCmd(`install ${app.id}`), { timeoutMs: 900_000 });
      let text = '';
      const r = await bridge.stream(execId, (f) => { if ((f.type === 'stdout' || f.type === 'stderr') && f.data) { text += f.data; setLog({ id: app.id, text: text.split('\n').slice(-6).join('\n') }); } }, abort.current.signal);
      if (r.exitCode !== 0) setNote(text.trim().split('\n').pop() ?? 'The install failed.');
      await load();
    } catch (e) { setNote((e as Error).message); } finally { setBusy(null); }
  };

  /** Starts the private screen if it is not running, then opens the app on it and shows the screen. */
  const open = async (app: CraftApp) => {
    setBusy(app.id); setNote('');
    try {
      const d = await bridge.desktop({ action: 'start' });
      if (!d.ok) throw new Error(d.text);
      const r = await bridge.craft({ action: 'open', app: app.id });
      if (!r.ok) throw new Error(r.text ?? 'Could not open it.');
      setOpenId(app.id);
      setTimeout(() => { void live.refresh(); live.setLive(true); }, 2500);
    } catch (e) { setNote((e as Error).message); } finally { setBusy(null); }
  };

  const giveJob = (app: CraftApp) => {
    const t = job.trim();
    if (!t) return;
    const how = app.id === 'craft-anything'
      ? `Use Craft Anything on this computer (run: ${craftCmd('anything --help')}) for this job, only on sites or apps I own or am allowed to study: `
      : `Use ${app.name} on this computer (installed: ${app.installed?.path ?? 'not yet'}; command line: ${craftCmd(`run ${app.id} --help`)}) for this job: `;
    queueHandoff(`${how}${t}`, 'desktop');
    setSuite('handoff');
  };

  const open_ = useMemo(() => apps?.find((a) => a.id === openId) ?? null, [apps, openId]);

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg)' }}>
      <header className="flex items-center gap-3 border-b px-3 py-2.5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
        <span className="grid h-9 w-9 place-items-center rounded-2xl text-white" style={{ background: GRAD }}><Icon name="craft" size={18} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[16px] font-semibold leading-tight" style={{ color: 'var(--ink)' }}>Craft apps</h1>
          <p className="mono truncate text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>open source · installed on your terminal computer</p>
        </div>
        <a href={SITE} target="_blank" rel="noreferrer" className="press mono rounded-lg border px-2.5 py-2 text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>Web versions</a>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-3 p-3">
          <section className="rounded-2xl border p-3 text-[12.5px] leading-relaxed" style={{ ...card, color: 'var(--ink-dim)' }}>
            <p><b style={{ color: 'var(--ink)' }}>What these are.</b> Source code under MIT or Apache-2.0 on github.com/storytold, not model weights. They are alpha desktop programs, so they run on the computer your Terminal Bridge runs on (Linux, Windows or Mac) and not inside the phone. Install one, open it on the bridge’s private screen, watch and tap it here, or give the Handoff agent a job in it. The AI features in ArtCraft call hosted models, each with its own terms.</p>
          </section>

          {!craftOk && (
            <section className="rounded-2xl border p-3 text-[13px]" style={{ ...card, color: 'var(--ink-dim)' }}>
              {online ? 'Your terminal bridge is older than 5.1. Open Settings, Terminal, and update the bridge to add Craft apps.' : 'Connect the Terminal Bridge first (Settings, Terminal). The apps are installed on that computer.'}
            </section>
          )}
          {note && <p className="rounded-xl border px-3 py-2 text-[12.5px]" style={{ borderColor: 'hsl(4 80% 58% / .5)', color: 'hsl(4 80% 58%)' }}>{note}</p>}

          {open_ && (
            <div className="space-y-2">
              <LiveScreen screen={live.screen} mode="desktop" canControl live={live.live} setLive={live.setLive} refreshing={live.refreshing}
                onClick={live.control.click} onType={live.control.type} onKey={live.control.key} />
              <p className="px-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>{open_.name} is running on the bridge’s private screen. Turn on “Take over” to tap and type.</p>
            </div>
          )}

          <ul className="space-y-2.5">
            {(apps ?? []).map((app) => (
              <li key={app.id} className="rounded-2xl border p-3" style={card}>
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}><Icon name={GLYPH[app.id] ?? 'box'} size={20} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <h2 className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>{app.name}</h2>
                      <span className="mono text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>instead of {app.replaces}</span>
                    </div>
                    <p className="mt-0.5 text-[12.5px] leading-snug" style={{ color: 'var(--ink-dim)' }}>{app.blurb}</p>
                    {app.agent && <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>{app.agent}</p>}
                    <p className="mono mt-1 text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
                      {app.installed ? `installed ${app.installed.tag}${app.installed.verified ? ' · checksum ok' : ' · no checksum published'}` : 'not installed'}
                    </p>
                  </div>
                </div>
                {log?.id === app.id && busy === app.id && <pre className="mono mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg p-2 text-[10.5px]" style={{ background: 'var(--surface)', color: 'var(--ink-dim)' }}>{log.text}</pre>}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {!app.installed
                    ? <Btn primary disabled={!craftOk || busy !== null} onClick={() => void install(app)}>{busy === app.id ? 'Installing…' : 'Install on terminal'}</Btn>
                    : <>
                        {app.cli !== 'direct' && <Btn primary disabled={busy !== null} onClick={() => void open(app)}>{busy === app.id ? 'Opening…' : 'Open on screen'}</Btn>}
                        <Btn disabled={busy !== null} onClick={() => void install(app)} title="Download the latest release again">Update</Btn>
                      </>}
                  <a href={app.url} target="_blank" rel="noreferrer" className="press inline-flex items-center rounded-xl border px-3.5 text-[13px] font-semibold" style={{ minHeight: 44, borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>GitHub</a>
                </div>
                {app.installed && (
                  <div className="mt-2 flex gap-2">
                    <input value={job} onChange={(e) => setJob(e.target.value)} placeholder={app.id === 'craft-anything' ? 'Rebuild my own landing page at …' : `A job for ${app.name}…`}
                      className="min-w-0 flex-1 rounded-xl border bg-transparent px-3 text-[14px] outline-none" style={{ borderColor: 'var(--line)', color: 'var(--ink)', minHeight: 44 }} />
                    <Btn disabled={!job.trim()} onClick={() => giveJob(app)}>Hand off</Btn>
                  </div>
                )}
              </li>
            ))}
            {craftOk && apps === null && <li className="px-1 text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>Asking the terminal…</li>}
          </ul>

          <p className="px-1 pb-4 text-[11px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
            Craft Anything studies a site, app or file and rebuilds your own version. Use it only on things you own or may study; its clean-room mode works from what a visitor sees. The ArtCraft name and logos are trademarks of their owner.
          </p>
        </div>
      </div>
    </div>
  );
}
