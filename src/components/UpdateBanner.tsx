'use client';

/**
 * "A newer version is ready" for the Android app: one quiet strip above the conversation with a Download button. The phone's browser
 * fetches the APK and Android asks before installing. Dismissing hides it for that version only.
 */
import { useEffect, useState } from 'react';
import { checkForUpdate, shell, type UpdateInfo } from '@/lib/app-update';
import { Icon } from '@/components/Icon';

const SKIP_KEY = 'chomugiri:update-skip';

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () => void checkForUpdate().then((u) => { if (alive) setInfo(u); }).catch(() => undefined);
    run();
    const onShow = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { alive = false; document.removeEventListener('visibilitychange', onShow); };
  }, []);
  if (!info) return null;
  let skipped = '';
  try { skipped = localStorage.getItem(SKIP_KEY) ?? ''; } catch { /* no storage */ }
  if (skipped === info.latest) return null;
  return (
    <div className="mono flex items-center gap-2 border-b px-3 py-2 text-[11.5px]" style={{ borderColor: 'var(--line)', background: 'color-mix(in oklab, var(--accent) 9%, var(--panel))', color: 'var(--ink)' }} data-testid="update-banner" role="status">
      <span style={{ color: 'var(--accent)' }}><Icon name="download" size={15} /></span>
      <span className="min-w-0 flex-1 truncate">Update ready: {info.latest} <span style={{ color: 'var(--ink-faint)' }}>(you have {info.current})</span></span>
      <a href={info.url} target="_blank" rel="noreferrer" className="press shrink-0 rounded-lg px-3 py-1.5 font-semibold" style={{ background: 'var(--accent)', color: 'var(--panel)' }} data-testid="update-download">Download</a>
      <button type="button" aria-label="Not now" className="press shrink-0 p-1" style={{ color: 'var(--ink-faint)' }} onClick={() => { try { localStorage.setItem(SKIP_KEY, info.latest); } catch { /* no storage */ } setInfo(null); }}><Icon name="x" size={14} /></button>
    </div>
  );
}

/** For Settings: the version this app is, and a button that asks for a newer one right now. */
export function UpdateCheck() {
  const sh = shell();
  const [state, setState] = useState<{ busy?: boolean; text?: string; info?: UpdateInfo | null }>({});
  if (!sh?.version) return null;
  const check = async () => {
    setState({ busy: true });
    try {
      const info = await checkForUpdate({ force: true });
      setState({ info, text: info ? `Version ${info.latest} is ready.` : 'This is the newest version.' });
    } catch (e) { setState({ text: (e as Error).message }); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11.5px]" data-testid="update-check">
      <span className="mono" style={{ color: 'var(--ink-dim)' }}>App version {sh.version}</span>
      <button type="button" onClick={() => void check()} disabled={state.busy} className="press mono inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10.5px] disabled:opacity-40" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}>
        <Icon name="refresh" size={12} />{state.busy ? 'Checking' : 'Check for update'}
      </button>
      {state.text && <span style={{ color: state.info ? 'var(--accent)' : 'var(--ink-faint)' }}>{state.text}</span>}
      {state.info && <a href={state.info.url} target="_blank" rel="noreferrer" className="press mono rounded-lg px-2.5 py-1.5 text-[10.5px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--panel)' }}>Download</a>}
    </div>
  );
}
