'use client';

import { useCallback, useEffect, useState } from 'react';
import { getKeys } from '@/lib/keys';
import { keyEnvFrom } from '@/lib/bridge/key-env';
import { useWorkspace } from '@/lib/store';

const btn = 'press mono rounded-lg border px-2.5 py-1.5 text-[10.5px] disabled:opacity-40';

/**
 * Keys on the terminal.
 *
 * The app can hand every API key it holds to the terminal bridge, which keeps them in a file on its own machine and gives them
 * to each command it runs. With the keys there, background work goes on with the app closed, so the phone does not have to
 * hold the app (and its memory) open. "Delete" takes them off the terminal again. The app keeps its own copy either way.
 */
export function TerminalKeys() {
  const bridge = useWorkspace((s) => s.bridge);
  const heartbeat = useWorkspace((s) => s.heartbeat);
  const endpoints = useWorkspace((s) => s.endpoints);
  const online = heartbeat.status === 'online' || heartbeat.status === 'degraded';

  const [held, setHeld] = useState<Array<{ name: string; hint: string }> | null>(null);
  const [busy, setBusy] = useState<'pull' | 'delete' | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!online) return setHeld(null);
    try {
      setHeld((await bridge.keys()).keys);
    } catch {
      // An older bridge has no key store; the buttons then say so when pressed.
      setHeld(null);
    }
  }, [bridge, online]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const env = keyEnvFrom(getKeys(), endpoints);
  const count = Object.keys(env).length;

  const pull = async () => {
    setBusy('pull');
    setNote(null);
    try {
      const r = await bridge.pushKeys(env);
      setNote({ ok: true, text: `${r.stored} key${r.stored === 1 ? '' : 's'} are now on the terminal. Commands it runs can read them as environment variables.` });
      await refresh();
    } catch (err) {
      const m = (err as Error).message;
      setNote({ ok: false, text: /no route|404/i.test(m) ? 'This terminal bridge is too old to hold keys. Update the agent (chomugiri-agent.mjs) and try again.' : m });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    setNote(null);
    try {
      const r = await bridge.deleteKeys();
      setNote({ ok: true, text: `Deleted ${r.deleted} key${r.deleted === 1 ? '' : 's'} from the terminal. The keys in this app are untouched.` });
      await refresh();
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: 'var(--line)' }} data-testid="terminal-keys">
      <p className="mono text-[11px]" style={{ color: 'var(--accent)' }}>API keys on the terminal</p>
      <p className="text-[11.5px] leading-[1.5]" style={{ color: 'var(--ink-dim)' }}>
        Keep your keys on the terminal bridge too. Background jobs then keep working with the app closed, so the app does not have to
        stay open and use phone memory.
        {held ? ` On the terminal now: ${held.length}.` : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={!online || busy !== null || count === 0} onClick={() => void pull()} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
          {busy === 'pull' ? 'pulling…' : `Pull APIs on terminal${count ? ` (${count})` : ''}`}
        </button>
        <button type="button" className={btn} disabled={!online || busy !== null || !held?.length} onClick={() => void remove()} style={{ borderColor: 'var(--line)', color: 'var(--color-rose, #e5484d)' }}>
          {busy === 'delete' ? 'deleting…' : 'Delete APIs from terminal'}
        </button>
      </div>
      {!online && <p className="text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>The terminal bridge is not connected (Settings → Terminal Bridge).</p>}
      {online && count === 0 && <p className="text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>No keys saved in this app yet.</p>}
      {held && held.length > 0 && (
        <ul className="mono max-h-28 space-y-0.5 overflow-y-auto text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
          {held.map((k) => (
            <li key={k.name} className="flex justify-between gap-3"><span className="truncate">{k.name}</span><span>{k.hint}</span></li>
          ))}
        </ul>
      )}
      {note && <p className="text-[10.5px] leading-[1.5]" role="status" style={{ color: note.ok ? 'var(--color-success)' : 'var(--color-danger)' }}>{note.text}</p>}
    </div>
  );
}
