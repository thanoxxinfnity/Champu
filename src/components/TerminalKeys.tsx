'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { lacksKeyStore, pushAgentFiles, restartCommand } from '@/lib/bridge/update';
import { copyText } from './codeActions';
import { currentKeyEnv, useAutoPush } from '@/lib/bridge/auto-push';

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

  // An older bridge has no key store. The app can write the new bridge files into its workspace; the user restarts it from them.
  const old = online && lacksKeyStore(heartbeat.health);
  const [updating, setUpdating] = useState(false);
  const [restart, setRestart] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const updateBridge = async () => {
    setUpdating(true);
    setNote(null);
    try {
      const r = await pushAgentFiles({
        fetchText: async (path) => {
          const res = await fetch(path, { cache: 'no-store' });
          if (!res.ok) throw new Error(`The app could not read ${path} (${res.status}).`);
          return res.text();
        },
        writeFiles: (files) => bridge.writeFiles(files),
      });
      const { url, token } = bridge.describe();
      setRestart(restartCommand({ workspace: heartbeat.health?.workspace ?? '~/chomugiri-work', token, url }));
      setNote({ ok: true, text: `The new bridge (${r.version}) is written to the bridge's workspace. Now restart it from the new files with the command below.` });
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message });
    } finally {
      setUpdating(false);
    }
  };

  void endpoints; // re-render when a custom endpoint changes, so the count and the push below stay current
  const env = currentKeyEnv();
  const autoOn = useAutoPush((s) => s.on);
  const autoSet = useAutoPush((s) => s.set);
  const autoLast = useAutoPush((s) => s.last);
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
      setNote({ ok: false, text: /no route|404/i.test(m) ? 'This terminal bridge is too old to hold keys. Use “Update the terminal bridge” above.' : m });
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
        <button type="button" className={btn} disabled={!online || old || busy !== null || count === 0} onClick={() => void pull()} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
          {busy === 'pull' ? 'pulling…' : `Pull APIs on terminal${count ? ` (${count})` : ''}`}
        </button>
        <button type="button" className={btn} disabled={!online || old || busy !== null || !held?.length} onClick={() => void remove()} style={{ borderColor: 'var(--line)', color: 'var(--color-rose, #e5484d)' }}>
          {busy === 'delete' ? 'deleting…' : 'Delete APIs from terminal'}
        </button>
      </div>
      <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-2.5" style={{ borderColor: autoOn ? 'var(--accent)' : 'var(--line)' }}>
        <input type="checkbox" className="mt-0.5" checked={autoOn} disabled={!online || old} onChange={(e) => autoSet(e.target.checked)} data-testid="auto-push" />
        <span className="text-[11.5px] leading-[1.5]" style={{ color: 'var(--ink-dim)' }}>
          <span style={{ color: 'var(--ink)' }}>Auto-push keys</span> — every key and every custom endpoint (with its base URL) goes to the terminal by itself when you add or
          change it, and again if the terminal loses them. No need to press the button.
        </span>
      </label>
      {autoOn && autoLast && <p className="text-[10.5px]" style={{ color: autoLast.ok ? 'var(--color-success)' : 'var(--color-danger)' }} role="status">{autoLast.text}</p>}
      {old && (
        <div className="space-y-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--color-amber, #d99a2b)' }} data-testid="bridge-old">
          <p className="text-[11px] leading-[1.5]" style={{ color: 'var(--ink-dim)' }}>
            Your terminal bridge is version {heartbeat.health?.version ?? 'unknown'}; keeping keys needs 1.2.0 or newer. The app can send the new bridge to it.
          </p>
          <button type="button" className={btn} disabled={updating} onClick={() => void updateBridge()} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
            {updating ? 'sending…' : 'Update the terminal bridge'}
          </button>
          {restart && (
            <div className="space-y-1.5">
              <p className="text-[10.5px] leading-[1.5]" style={{ color: 'var(--ink-dim)' }}>
                1. Stop the old bridge (Ctrl+C in its terminal). 2. Run this in that terminal:
              </p>
              <pre className="mono max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md border p-2 text-[10.5px]" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>{restart}</pre>
              <button
                type="button"
                className={btn}
                onClick={() => void copyText(restart).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1400); } })}
                style={{ borderColor: 'var(--line)', color: copied ? 'var(--accent)' : 'var(--ink-dim)' }}
              >
                {copied ? 'copied' : 'copy command'}
              </button>
              <p className="text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>Same workspace, port and token, so the app reconnects by itself. Then press Pull APIs on terminal.</p>
            </div>
          )}
        </div>
      )}
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
