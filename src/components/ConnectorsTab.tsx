'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { db, isBrowser, type EndpointRecord } from '@/lib/db/schema';
import { uid } from '@/lib/db/history';
import type { CapabilityProbe } from '@/lib/providers/custom';

const inputStyle: React.CSSProperties = { borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink)' };
const inputClass = 'mono w-full rounded-lg border px-2.5 py-2 text-[11.5px] outline-none placeholder:opacity-40';

const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GOOGLE_KEY_PAGE = 'https://aistudio.google.com/apikey';
const GOOGLE_LABEL = 'Google Gemini';

/**
 * Connectors — one-tap setups for providers you already have an account with.
 *
 * Google (Gemini): "Get your key" opens Google AI Studio, where you sign in with your Google account and create an API key (free tier
 * included). Paste the key here, press Connect, and every Gemini model your key can use shows up in the model picker. It uses Google's
 * documented Gemini API; the key stays on this device and is sent only to Google.
 */
export function ConnectorsTab() {
  const setEndpoints = useWorkspace((s) => s.setEndpoints);
  const endpoints = useWorkspace((s) => s.endpoints);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const connected = endpoints.find((e) => e.label === GOOGLE_LABEL && e.baseUrl.includes('generativelanguage.googleapis.com'));

  const reload = useCallback(async () => {
    if (!isBrowser()) return;
    const rows = await db().endpoints.toArray().catch(() => [] as EndpointRecord[]);
    setEndpoints(rows);
  }, [setEndpoints]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const pasteKey = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        setNote('The clipboard is empty — copy the key on the Google page first.');
        return;
      }
      setKey(text);
      setNote('✔ Pasted. Press Connect.');
    } catch {
      setNote('The browser would not let the app read the clipboard — long-press the box and paste by hand.');
    }
  };

  const connect = async () => {
    const apiKey = key.trim();
    if (!apiKey) {
      setNote('Paste your Google API key first (Get your key → sign in → copy it).');
      return;
    }
    setBusy(true);
    setNote('Asking Google which models this key can use…');
    try {
      const res = await fetch('/api/endpoints/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: GOOGLE_BASE, apiKey, dialect: 'gemini' }),
        signal: AbortSignal.timeout(60_000),
      });
      const probe = (await res.json()) as CapabilityProbe & { error?: string };
      if (!probe.ok || !probe.models?.length) {
        setNote(`✘ Google did not accept that key${probe.error ? ` — ${probe.error}` : ''}. Copy it again from AI Studio.`);
        return;
      }
      // Replace an earlier Google connection instead of stacking a second one.
      if (connected) await db().endpoints.delete(connected.id);
      const record: EndpointRecord = {
        id: uid('ep'),
        label: GOOGLE_LABEL,
        baseUrl: GOOGLE_BASE,
        apiKey,
        headers: {},
        dialect: 'gemini',
        capabilities: probe.capabilities.length ? probe.capabilities : ['chat'],
        models: probe.models.map((m) => ({ id: m.id, label: m.label, capabilities: m.capabilities })),
        routes: probe.routes ?? [],
        lastProbedAt: Date.now(),
        probeOk: 1,
        enabled: 1,
        createdAt: Date.now(),
      };
      await db().endpoints.put(record);
      await reload();
      setKey('');
      setNote(`✔ Connected — ${record.models.length} Google models added to the model picker.`);
    } catch (err) {
      setNote(`✘ ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!connected) return;
    await db().endpoints.delete(connected.id);
    await reload();
    setNote('Disconnected. The key was removed from this device.');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold tracking-tight">Google · Gemini</h3>
          <span className="mono ml-auto text-[10.5px]" style={{ color: connected ? 'var(--accent)' : 'var(--ink-faint)' }}>
            {connected ? `● connected · ${connected.models.length} models` : '○ not connected'}
          </span>
        </div>
        <p className="mt-2 text-[11.5px] leading-[1.55]" style={{ color: 'var(--ink-dim)' }}>
          Sign in with your Google account, get a key, paste it here — then every Gemini model your key can use appears in the model picker.
          The key stays on this device and is sent only to Google.
        </p>

        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[11.5px] leading-[1.55]" style={{ color: 'var(--ink-dim)' }}>
          <li>Press <em>Get your key</em> — Google AI Studio opens.</li>
          <li>Sign in with Google, press <em>Create API key</em>, copy it.</li>
          <li>Come back, press <em>Paste key</em>, then <em>Connect</em>.</li>
        </ol>

        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <a
              href={GOOGLE_KEY_PAGE}
              target="_blank"
              rel="noopener noreferrer"
              className="press mono rounded-lg px-3 py-1.5 text-[11px] font-medium"
              style={{ background: 'var(--accent)', color: 'var(--accent-ink, #000)' }}
            >
              Get your key ↗
            </a>
            <button type="button" onClick={() => void pasteKey()} className="press mono rounded-lg border px-3 py-1.5 text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>
              Paste key
            </button>
          </div>
          <label className="block">
            <span className="mono block text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
              Google API key
            </span>
            <input
              className={`${inputClass} mt-1`}
              style={inputStyle}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="AIza…"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void connect()}
              className="press mono rounded-lg px-3 py-1.5 text-[11px] font-medium"
              style={{ background: 'var(--accent)', color: 'var(--accent-ink, #000)', opacity: busy ? 0.6 : 1 }}
            >
              {busy ? 'connecting…' : connected ? 'Reconnect' : 'Connect'}
            </button>
            {connected && (
              <button type="button" onClick={() => void disconnect()} className="press mono rounded-lg border px-3 py-1.5 text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>
                Disconnect
              </button>
            )}
          </div>
          {note && (
            <p className="text-[11px] leading-[1.5]" style={{ color: note.startsWith('✔') ? 'var(--accent)' : 'var(--ink-dim)' }}>
              {note}
            </p>
          )}
        </div>

        {connected && connected.models.length > 0 && (
          <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {connected.models.slice(0, 40).map((m) => (
              <li key={m.id} className="mono truncate rounded border px-2 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }} title={m.id}>
                {m.label || m.id}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border p-3 text-[10.5px] leading-[1.55]" style={{ borderColor: 'var(--line)', color: 'var(--ink-faint)' }}>
        This uses Google&rsquo;s official Gemini API (the key from AI Studio, free tier included). It is a normal custom endpoint, so you can also see and edit it under
        Custom Endpoints. Anthropic and OpenAI-style providers work the same way there.
      </div>
    </div>
  );
}
