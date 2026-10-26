'use client';

import { useEffect, useState } from 'react';
import { BG_SETTING, NTFY_SETTING } from '@/lib/agent/background';
import { hasJobs } from '@/lib/bridge/update';
import { getSetting, setSetting } from '@/lib/db/history';
import { enableNotifications, notificationPermission, notificationsEnabled } from '@/lib/notify';
import { useWorkspace } from '@/lib/store';

const btn = 'press mono rounded-lg border px-2.5 py-1.5 text-[10.5px] disabled:opacity-40';

const randomTopic = () => `chomugiri-${Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14)}`;

/**
 * Background work: the terminal writes replies while the app is closed, and tells the phone when they are ready.
 * Everything here is optional and off until chosen; notifications are a single quiet slot, never a stream of messages.
 */
export function BackgroundWork() {
  const heartbeat = useWorkspace((s) => s.heartbeat);
  const online = heartbeat.status === 'online' || heartbeat.status === 'degraded';
  const capable = online && hasJobs(heartbeat.health);

  const [bg, setBg] = useState(false);
  const [notif, setNotif] = useState(false);
  const [perm, setPerm] = useState<string>('default');
  const [topic, setTopic] = useState('');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void getSetting<boolean>(BG_SETTING, false).then(setBg);
    void notificationsEnabled().then(setNotif);
    setPerm(notificationPermission());
    void getSetting<string>(NTFY_SETTING, '').then(setTopic);
  }, []);

  const toggleNotif = async () => {
    const r = await enableNotifications(!notif);
    setPerm(r);
    setNotif(await notificationsEnabled());
    if (r === 'denied') setNote('Notifications are blocked for this site. Allow them in the browser or phone settings, then try again.');
    else if (r === 'unsupported') setNote('This browser cannot show notifications.');
    else setNote(null);
  };

  const saveTopic = async (value: string) => {
    const clean = value.trim().replace(/[^\w.-]/g, '').slice(0, 64);
    setTopic(clean);
    await setSetting(NTFY_SETTING, clean);
  };

  const testPush = async () => {
    if (!topic) return;
    try {
      const res = await fetch(`https://ntfy.sh/${topic}`, { method: 'POST', headers: { Title: 'Chomugiri' }, body: 'Test: phone alerts from your terminal work.' });
      setNote(res.ok ? 'Sent. If the ntfy app is subscribed to this topic, it should buzz now.' : `ntfy answered ${res.status}.`);
    } catch (err) {
      setNote(`Could not reach ntfy.sh: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: 'var(--line)' }} data-testid="background-work">
      <p className="mono text-[11px]" style={{ color: 'var(--accent)' }}>Background work</p>
      <p className="text-[11.5px] leading-[1.5]" style={{ color: 'var(--ink-dim)' }}>
        With this on, a message is answered by the terminal bridge, so it keeps going when the app is closed or the phone kills it. Open the app later and the whole
        reply — text and files — is already in the chat. It needs bridge 1.3.0 and a free provider or your own endpoint (their keys are sent along; with “Auto-push keys” they
        also stay on the terminal).
      </p>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={bg} disabled={!capable} onChange={(e) => { setBg(e.target.checked); void setSetting(BG_SETTING, e.target.checked); }} data-testid="background-toggle" />
        <span className="text-[11.5px]" style={{ color: 'var(--ink)' }}>Answer in the background {capable ? '' : '(needs a connected bridge 1.3.0 or newer)'}</span>
      </label>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={notif} onChange={() => void toggleNotif()} disabled={perm === 'unsupported'} data-testid="notify-toggle" />
        <span className="text-[11.5px] leading-[1.5]" style={{ color: 'var(--ink)' }}>
          Notify me when a reply is ready
          <span className="block text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>One quiet notification at a time — a new one replaces the old, nothing piles up. Only when the app is not in front.</span>
        </span>
      </label>
      <div className="space-y-1.5">
        <p className="text-[11px]" style={{ color: 'var(--ink)' }}>Phone alert while the app is closed (optional)</p>
        <p className="text-[10.5px] leading-[1.5]" style={{ color: 'var(--ink-faint)' }}>
          Install the free “ntfy” app, subscribe to a private topic name, and put the same name here. The terminal sends one short message when a reply is ready. Anyone who knows
          the topic name can read those messages, so make it long and random.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={topic}
            onChange={(e) => void saveTopic(e.target.value)}
            placeholder="chomugiri-your-secret-topic"
            className="mono min-w-0 flex-1 rounded-lg border bg-transparent px-2 py-1.5 text-[11px]"
            style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
            data-testid="ntfy-topic"
          />
          <button type="button" className={btn} style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }} onClick={() => void saveTopic(randomTopic())}>make one</button>
          <button type="button" className={btn} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} disabled={!topic} onClick={() => void testPush()}>test</button>
        </div>
      </div>
      {note && <p className="text-[10.5px] leading-[1.5]" role="status" style={{ color: 'var(--ink-dim)' }}>{note}</p>}
    </div>
  );
}
