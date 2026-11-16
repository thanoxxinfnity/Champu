'use client';

/**
 * Two small things only the Android app needs.
 *  - SavedNotice: one line that says where a file went after a save (the shell writes it into Download/Chomugiri).
 *  - BackgroundPower: whether the phone lets the app keep working off-screen, with the two screens that allow it. Phone makers
 *    (vivo, Xiaomi, OPPO, realme, Samsung …) add their own battery manager that stops an app in the background whatever Android
 *    itself allows; only the user can switch that off, so the app says so plainly and opens the right screen.
 */
import { useCallback, useEffect, useState } from 'react';
import { shell } from '@/lib/app-update';
import { Icon } from '@/components/Icon';

export function SavedNotice() {
  const [note, setNote] = useState<{ name: string; where: string } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ name: string; where: string }>).detail;
      if (!d) return;
      setNote(d);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setNote(null), 6000);
    };
    window.addEventListener('chomugiri:saved', on);
    return () => { window.removeEventListener('chomugiri:saved', on); if (timer) clearTimeout(timer); };
  }, []);
  if (!note) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[95] flex justify-center px-4" role="status" data-testid="saved-notice">
      <div className="mono flex max-w-full items-center gap-2 rounded-xl border px-3 py-2 text-[11.5px] shadow-lg" style={{ borderColor: 'color-mix(in oklab, var(--accent) 50%, var(--line))', background: 'var(--panel)', color: 'var(--ink)' }}>
        <span style={{ color: 'var(--accent)' }}><Icon name="check" size={14} /></span>
        <span className="truncate">Saved {note.name}</span>
        <span className="truncate" style={{ color: 'var(--ink-faint)' }}>{note.where}</span>
      </div>
    </div>
  );
}

interface Power { supported?: boolean; exempt?: boolean; maker?: string; model?: string }

export function BackgroundPower() {
  const [p, setP] = useState<Power | null>(null);
  const read = useCallback(async () => {
    try { const r = await fetch('/api/shell/power', { cache: 'no-store' }); if (r.ok) setP((await r.json()) as Power); } catch { /* an older shell */ }
  }, []);
  useEffect(() => {
    if (shell()?.platform !== 'android') return;
    void read();
    const on = () => { if (document.visibilityState === 'visible') void read(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [read]);
  if (!p?.supported) return null;
  const act = (action: 'ask' | 'vendor') => void fetch('/api/shell/power', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).then(() => setTimeout(() => void read(), 1500)).catch(() => undefined);
  const maker = (p.maker ?? '').toLowerCase();
  const strict = /vivo|iqoo|xiaomi|redmi|poco|oppo|realme|oneplus|huawei|honor|samsung|tecno|infinix/.test(maker);
  const btn = 'press mono inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10.5px]';
  return (
    <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: p.exempt ? 'var(--line)' : 'color-mix(in oklab, var(--color-amber) 55%, var(--line))' }} data-testid="background-power">
      <p className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
        <Icon name="battery" size={15} />Keep working when the app is not on screen
      </p>
      <p className="text-[11px] leading-[1.55]" style={{ color: 'var(--ink-dim)' }}>
        {p.exempt
          ? 'Android lets this app run in the background.'
          : 'Android may stop this app when you leave it, and a reply then ends with "Stream interrupted" or "the app closed". Allow it to run without battery limits.'}
        {strict ? ` ${p.maker} phones have one more switch of their own: allow background activity and auto-start for this app there too, or a long reply is still cut off.` : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        {!p.exempt && <button type="button" className={btn} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => act('ask')} data-testid="power-ask"><Icon name="bolt" size={12} />Allow background work</button>}
        <button type="button" className={btn} style={{ borderColor: 'var(--line)', color: 'var(--ink)' }} onClick={() => act('vendor')} data-testid="power-vendor"><Icon name="settings" size={12} />Open the {strict ? `${p.maker} ` : ''}background settings</button>
      </div>
    </div>
  );
}
