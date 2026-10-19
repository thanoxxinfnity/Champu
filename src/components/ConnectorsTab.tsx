'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { parseBridgeInput } from '@/lib/bridge/parse';
import { startLogin } from '@/lib/antigravity/client';

const inputStyle: React.CSSProperties = { borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink)' };
const inputClass = 'mono w-full rounded-lg border px-2.5 py-2 text-[11.5px] outline-none placeholder:opacity-40';

/**
 * Connectors — other apps whose models Chomugiri can borrow.
 *
 * Antigravity (through AntiGem): paste the bridge address and its token and every model the signed-in Antigravity account has
 * shows up in the model picker. Chats to those models run inside Antigravity's own agent sandbox, driven from this device.
 */
export function ConnectorsTab() {
  const ag = useWorkspace((s) => s.antigravity);
  const connect = useWorkspace((s) => s.connectAntigravity);
  const disconnect = useWorkspace((s) => s.disconnectAntigravity);
  const [combined, setCombined] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (ag.config?.bridgeUrl && !combined) setCombined(ag.config.token ? `${ag.config.bridgeUrl}#${ag.config.token}` : ag.config.bridgeUrl);
  }, [ag.config, combined]);

  /** Looks for the AntiGem bridge on this device: its /api/health answers without a token. */
  const detect = async () => {
    setNote('Looking for AntiGem on this device…');
    for (const port of [1234, 8080, 1236, 8081, 1235]) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) {
          const { token } = parseBridgeInput(combined);
          setCombined(`http://127.0.0.1:${port}${token ? `#${token}` : '#'}`);
          setNote(`✔ Found a bridge on port ${port}. Now paste the token (copy it in AntiGem, then press "Paste token").`);
          return;
        }
      } catch {
        // not this port
      }
    }
    setNote('No bridge found on this device. Is AntiGem running? Or paste a tunnel address instead.');
  };

  /** Reads the clipboard: a bare 12-character token is added to the address; a whole address#token replaces the field. */
  const pasteToken = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        setNote('The clipboard is empty — copy the security token in AntiGem first.');
        return;
      }
      if (/^[A-Za-z0-9]{8,16}$/.test(text)) {
        const { url } = parseBridgeInput(combined);
        setCombined(`${url || 'http://127.0.0.1:1234'}#${text}`);
        setNote('✔ Token pasted. Press Connect.');
      } else {
        setCombined(text);
        setNote('✔ Pasted. Press Connect.');
      }
    } catch {
      setNote('The browser would not let the app read the clipboard — long-press the box and paste by hand.');
    }
  };

  const [loginUrl, setLoginUrl] = useState('');

  /** Quick access to the Antigravity sign-in: the bridge starts a login, we get the Google sign-in address and open it. */
  const signIn = async () => {
    const { url, token } = parseBridgeInput(combined);
    if (!url || !token) {
      setNote('First fill the address and token (Find AntiGem → Paste token), then press Sign in.');
      return;
    }
    setBusy(true);
    setNote('Asking AntiGem for the Antigravity sign-in page…');
    try {
      const link = await startLogin({ bridgeUrl: url.replace(/^https:\/\/(127\.0\.0\.1|localhost)/, 'http://$1'), token });
      setLoginUrl(link);
      setNote('✔ Sign-in page ready. It opens now — sign in with Google there, come back here and press Connect.');
      window.open(link, '_blank', 'noopener');
    } catch (err) {
      setNote(`✘ ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    const { url, token } = parseBridgeInput(combined);
    if (!url) {
      setNote('Paste the AntiGem bridge address first, like http://127.0.0.1:1234#YOURTOKEN');
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const n = await connect({ bridgeUrl: url.replace(/^https:\/\/(127\.0\.0\.1|localhost)/, 'http://$1'), token });
      setNote(`✔ Connected — ${n} Antigravity model${n === 1 ? '' : 's'} added to the picker.`);
    } catch (err) {
      setNote(`✘ ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold tracking-tight">Antigravity</h3>
          <span className="mono rounded px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider" style={{ background: 'color-mix(in oklab, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
            experimental
          </span>
          <span className="mono ml-auto text-[10.5px]" style={{ color: ag.connected ? 'var(--accent)' : 'var(--ink-faint)' }}>
            {ag.connected ? `● connected · ${ag.models.length} models` : '○ not connected'}
          </span>
        </div>
        <p className="mt-2 text-[11.5px] leading-[1.55]" style={{ color: 'var(--ink-dim)' }}>
          Uses your own <strong>AntiGem</strong> app (github.com/Santoshkurmi/antigem). Start it, sign in to Antigravity there, press <em>Find AntiGem</em>, copy the security token in AntiGem and press <em>Paste token</em>, then press <em>Sign in to Antigravity</em> — it opens the Google sign-in page for you. Every Antigravity model then appears in the model picker, and those chats run in
          Antigravity&rsquo;s own agent sandbox — nothing is sent through our servers.
        </p>

        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="mono block text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
              AntiGem bridge — address#token
            </span>
            <input
              className={`${inputClass} mt-1`}
              style={inputStyle}
              value={combined}
              onChange={(e) => setCombined(e.target.value)}
              placeholder="http://127.0.0.1:1234#abc123def456"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run()}
              className="press mono rounded-lg px-3 py-1.5 text-[11px] font-medium"
              style={{ background: 'var(--accent)', color: 'var(--accent-ink, #000)', opacity: busy ? 0.6 : 1 }}
            >
              {busy ? 'connecting…' : ag.connected ? 'Reconnect' : 'Connect'}
            </button>
            <button type="button" onClick={() => void detect()} className="press mono rounded-lg border px-3 py-1.5 text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>
              Find AntiGem
            </button>
            <button type="button" disabled={busy} onClick={() => void signIn()} className="press mono rounded-lg border px-3 py-1.5 text-[11px]" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
              Sign in to Antigravity
            </button>
            <button type="button" onClick={() => void pasteToken()} className="press mono rounded-lg border px-3 py-1.5 text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>
              Paste token
            </button>
            {ag.connected && (
              <button type="button" onClick={() => { disconnect(); setNote(null); }} className="press mono rounded-lg border px-3 py-1.5 text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>
                Disconnect
              </button>
            )}
          </div>
          {loginUrl && (
            <p className="text-[10.5px] leading-[1.5]" style={{ color: 'var(--ink-dim)' }}>
              If the page did not open:{' '}
              <a href={loginUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>open the sign-in page</a>
              {' · '}
              <button type="button" className="underline" onClick={() => void navigator.clipboard?.writeText(loginUrl)}>copy link</button>
            </p>
          )}
          {(note || ag.error) && (
            <p className="text-[11px] leading-[1.5]" style={{ color: (note ?? ag.error).startsWith('✔') ? 'var(--accent)' : 'var(--ink-dim)' }}>
              {note ?? ag.error}
            </p>
          )}
        </div>

        {ag.connected && ag.models.length > 0 && (
          <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {ag.models.map((m) => (
              <li key={m.id} className="mono truncate rounded border px-2 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }} title={m.note}>
                {m.label.replace('Antigravity · ', '')}
                {m.emitsReasoning ? ' · thinking' : ''}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border p-3 text-[10.5px] leading-[1.55]" style={{ borderColor: 'var(--line)', color: 'var(--ink-faint)' }}>
        <strong style={{ color: 'var(--ink-dim)' }}>Honest status:</strong> this connector speaks the same hub protocol AntiGem uses, but it has only been tested against
        a stand-in hub, not a live Antigravity daemon. If a step fails, the message above says which call the hub rejected — send that and it can be fixed quickly. It
        needs the bridge reachable from this device (same phone, same Wi-Fi, or a tunnel). Browsers only let the app call the hub if the hub allows cross-origin requests; if the message says the request was blocked, that is the cause and a small proxy is the fix.
      </div>
    </div>
  );
}
