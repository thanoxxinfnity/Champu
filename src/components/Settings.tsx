'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { db, isBrowser, type EndpointRecord } from '@/lib/db/schema';
import { uid } from '@/lib/db/history';
import type { CapabilityProbe } from '@/lib/providers/custom';

type Tab = 'bridge' | 'endpoints' | 'deploy' | 'guard';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mono block text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
        {label}
      </span>
      <div className="mt-1">{children}</div>
      {hint && (
        <span className="mt-1 block text-[10.5px] leading-[1.45]" style={{ color: 'var(--ink-faint)' }}>
          {hint}
        </span>
      )}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  borderColor: 'var(--line)',
  background: 'var(--surface)',
  color: 'var(--ink)',
};

const inputClass = 'mono w-full rounded-lg border px-2.5 py-2 text-[11.5px] outline-none placeholder:opacity-40';

function BridgeTab() {
  const heartbeat = useWorkspace((s) => s.heartbeat);
  const configureBridge = useWorkspace((s) => s.configureBridge);
  const bridge = useWorkspace((s) => s.bridge);

  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [via, setVia] = useState<'direct' | 'proxy'>('direct');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    void import('@/lib/db/history').then(async ({ getSetting }) => {
      const stored = await getSetting<{ url: string; token: string; via?: 'direct' | 'proxy' } | null>('bridge', null);
      if (stored) {
        setUrl(stored.url);
        setToken(stored.token);
        setVia(stored.via ?? 'direct');
      }
    });
  }, []);

  const test = async () => {
    setTesting(true);
    setResult(null);
    configureBridge({ url, token, via });
    try {
      const health = await bridge.health();
      setResult(
        `✔ ${health.agent} v${health.version} · ${health.platform}/${health.arch} · workspace ${health.workspace}`,
      );
    } catch (err) {
      setResult(`✘ ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div
        className="rounded-lg border p-3"
        style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
      >
        <p className="text-[11.5px] leading-[1.55]" style={{ color: 'var(--ink-dim)' }}>
          The bridge is a small daemon you run on your own machine. Chomugiri generates code in the browser either way —
          the bridge is what makes <em>compilation</em> possible: Android SDK builds, APK/ZIP packaging, test runs, shell
          scripts.
        </p>
        <pre
          className="mono mt-2 overflow-x-auto rounded p-2.5 text-[10.5px] leading-[1.7]"
          style={{ background: 'var(--panel)', color: 'var(--ink)' }}
        >{`# in this repo, on your dev machine
npm run agent

# then expose it
ngrok http 7717
#   or
cloudflared tunnel --url http://localhost:7717`}</pre>
        <p className="mt-2 text-[10.5px] leading-[1.45]" style={{ color: 'var(--color-amber)' }}>
          The token grants shell access as your user. Treat it like an SSH key, and stop the tunnel when you are done.
        </p>
      </div>

      <Field label="Tunnel URL" hint="The public https URL from ngrok or cloudflared.">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://abc123.ngrok-free.app"
          className={inputClass}
          style={inputStyle}
          spellCheck={false}
        />
      </Field>

      <Field label="Bridge token" hint="Printed in the agent's startup banner.">
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="password"
          placeholder="paste the token"
          className={inputClass}
          style={inputStyle}
          spellCheck={false}
        />
      </Field>

      <Field
        label="Transport"
        hint="Direct is faster. Switch to relay only if your tunnel strips CORS headers and direct calls fail."
      >
        <div className="flex gap-1.5">
          {(['direct', 'proxy'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setVia(mode)}
              className="mono flex-1 rounded-lg border px-2 py-1.5 text-[11px]"
              style={{
                borderColor: via === mode ? 'var(--accent)' : 'var(--line)',
                color: via === mode ? 'var(--accent)' : 'var(--ink-dim)',
              }}
            >
              {mode === 'direct' ? 'direct' : 'server relay'}
            </button>
          ))}
        </div>
      </Field>

      <button
        type="button"
        onClick={() => void test()}
        disabled={testing || !url || !token}
        className="mono w-full rounded-lg px-3 py-2 text-[11.5px] font-medium disabled:opacity-35"
        style={{ background: 'var(--accent)', color: '#04150e' }}
      >
        {testing ? 'connecting…' : 'save & test connection'}
      </button>

      {result && (
        <p
          className="mono rounded-lg border px-2.5 py-2 text-[10.5px] leading-[1.5]"
          style={{
            borderColor: result.startsWith('✔') ? 'color-mix(in oklab, var(--accent) 40%, var(--line))' : 'color-mix(in oklab, var(--color-rose) 40%, var(--line))',
            color: result.startsWith('✔') ? 'var(--accent)' : 'var(--color-rose)',
          }}
        >
          {result}
        </p>
      )}

      {heartbeat.health && (
        <div className="rounded-lg border p-2.5" style={{ borderColor: 'var(--line)' }}>
          <p className="mono mb-1.5 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
            detected toolchain
          </p>
          <div className="mono grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px]">
            {Object.entries(heartbeat.health.toolchains).map(([name, version]) => (
              <div key={name} className="flex items-baseline gap-1.5">
                <span style={{ color: version ? 'var(--accent)' : 'var(--color-rose)' }}>{version ? '✔' : '✘'}</span>
                <span style={{ color: 'var(--ink-dim)' }}>{name}</span>
                <span className="truncate" style={{ color: 'var(--ink-faint)' }}>
                  {version ?? 'absent'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EndpointsTab() {
  const endpoints = useWorkspace((s) => s.endpoints);
  const setEndpoints = useWorkspace((s) => s.setEndpoints);

  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<CapabilityProbe | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!isBrowser()) return;
    const rows = await db().endpoints.toArray().catch(() => [] as EndpointRecord[]);
    setEndpoints(rows);
  }, [setEndpoints]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const parseHeaders = (): Record<string, string> | null => {
    if (!headersText.trim()) return {};
    try {
      const parsed = JSON.parse(headersText) as Record<string, string>;
      if (typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const runProbe = async () => {
    const headers = parseHeaders();
    if (headers === null) {
      setError('Custom headers must be a JSON object, e.g. {"X-Org": "acme"}.');
      return;
    }

    setProbing(true);
    setError(null);
    setProbe(null);

    try {
      const res = await fetch('/api/endpoints/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey: apiKey || undefined, headers }),
      });
      const data = (await res.json()) as CapabilityProbe;
      setProbe(data);
      if (!data.ok) setError(data.error ?? 'Probe failed.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProbing(false);
    }
  };

  const save = async () => {
    if (!probe?.ok || !isBrowser()) return;
    const headers = parseHeaders() ?? {};

    const record: EndpointRecord = {
      id: uid('ep'),
      label: label || new URL(probe.baseUrl).host,
      baseUrl: probe.baseUrl,
      apiKey: apiKey || undefined,
      headers,
      capabilities: probe.capabilities,
      models: probe.models.map((m) => ({ id: m.id, label: m.label, capabilities: m.capabilities })),
      routes: probe.routes,
      lastProbedAt: Date.now(),
      probeOk: 1,
      enabled: 1,
      createdAt: Date.now(),
    };

    await db().endpoints.put(record);
    await reload();

    setLabel('');
    setBaseUrl('');
    setApiKey('');
    setHeadersText('');
    setProbe(null);
  };

  return (
    <div className="space-y-4">
      <p className="text-[11.5px] leading-[1.55]" style={{ color: 'var(--ink-dim)' }}>
        Add any OpenAI-compatible endpoint. Chomugiri probes it and, when it finds image, video, audio or 3D generation,
        instantiates a dedicated workspace tab for that modality with its own history.
      </p>

      <Field label="Label">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My inference server" className={inputClass} style={inputStyle} />
      </Field>

      <Field label="Base URL" hint="Include the version path, e.g. https://api.example.com/v1">
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" className={inputClass} style={inputStyle} spellCheck={false} />
      </Field>

      <Field label="API key" hint="Sent as `Authorization: Bearer …` unless a custom Authorization header is supplied below.">
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder="sk-…" className={inputClass} style={inputStyle} spellCheck={false} />
      </Field>

      <Field label="Custom headers" hint='JSON object. Example: {"X-Api-Version": "2024-10", "X-Org": "acme"}'>
        <textarea
          value={headersText}
          onChange={(e) => setHeadersText(e.target.value)}
          rows={2}
          placeholder="{}"
          className={`${inputClass} resize-y`}
          style={inputStyle}
          spellCheck={false}
        />
      </Field>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void runProbe()}
          disabled={probing || !baseUrl}
          className="mono flex-1 rounded-lg border px-3 py-2 text-[11.5px] disabled:opacity-35"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
        >
          {probing ? 'probing…' : 'detect capabilities'}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!probe?.ok}
          className="mono flex-1 rounded-lg px-3 py-2 text-[11.5px] font-medium disabled:opacity-35"
          style={{ background: 'var(--accent)', color: '#04150e' }}
        >
          add endpoint
        </button>
      </div>

      {error && (
        <p className="mono rounded-lg border px-2.5 py-2 text-[10.5px] leading-[1.5]" style={{ borderColor: 'color-mix(in oklab, var(--color-rose) 40%, var(--line))', color: 'var(--color-rose)' }}>
          {error}
        </p>
      )}

      {probe?.ok && (
        <div className="rounded-lg border p-2.5" style={{ borderColor: 'color-mix(in oklab, var(--accent) 35%, var(--line))' }}>
          <p className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--accent)' }}>
            detected · {probe.latencyMs}ms
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {probe.capabilities.map((c) => (
              <span key={c} className="mono rounded px-1.5 py-0.5 text-[9.5px]" style={{ background: 'var(--surface)', color: 'var(--ink-dim)' }}>
                {c}
              </span>
            ))}
          </div>
          <p className="mono mt-1.5 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
            {probe.models.length} model{probe.models.length === 1 ? '' : 's'} · routes {probe.routes.join(', ')}
          </p>
        </div>
      )}

      {endpoints.length > 0 && (
        <div>
          <p className="mono mb-1.5 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
            configured
          </p>
          <div className="space-y-1.5">
            {endpoints.map((ep) => (
              <div key={ep.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--line)' }}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11.5px]">{ep.label}</p>
                  <p className="mono truncate text-[9.5px]" style={{ color: 'var(--ink-faint)' }}>
                    {ep.baseUrl} · {ep.capabilities.join(', ')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await db().endpoints.delete(ep.id);
                    await reload();
                  }}
                  className="mono shrink-0 text-[10px]"
                  style={{ color: 'var(--color-rose)' }}
                >
                  remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DeployTab() {
  const vercelToken = useWorkspace((s) => s.vercelToken);
  const vercelTeamId = useWorkspace((s) => s.vercelTeamId);
  const setVercelCredentials = useWorkspace((s) => s.setVercelCredentials);
  const lastDeploy = useWorkspace((s) => s.lastDeploy);

  const [token, setToken] = useState(vercelToken);
  const [teamId, setTeamId] = useState(vercelTeamId);

  useEffect(() => {
    setToken(vercelToken);
    setTeamId(vercelTeamId);
  }, [vercelToken, vercelTeamId]);

  return (
    <div className="space-y-4">
      <p className="text-[11.5px] leading-[1.55]" style={{ color: 'var(--ink-dim)' }}>
        Generated frontend artifacts deploy straight to Vercel. The token is stored locally in IndexedDB and is sent
        only to Vercel, through this app&apos;s server route — api.vercel.com sends no CORS headers, so a direct browser
        call is not possible.
      </p>

      <Field label="Personal access token" hint="Create one at vercel.com/account/tokens with deployment scope.">
        <input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="…" className={inputClass} style={inputStyle} spellCheck={false} />
      </Field>

      <Field label="Team ID" hint="Optional. Required only for team-scoped deployments.">
        <input value={teamId} onChange={(e) => setTeamId(e.target.value)} placeholder="team_…" className={inputClass} style={inputStyle} spellCheck={false} />
      </Field>

      <button
        type="button"
        onClick={() => setVercelCredentials(token, teamId)}
        className="mono w-full rounded-lg px-3 py-2 text-[11.5px] font-medium"
        style={{ background: 'var(--accent)', color: '#04150e' }}
      >
        save credentials
      </button>

      {lastDeploy && (
        <div className="rounded-lg border p-2.5" style={{ borderColor: 'var(--line)' }}>
          <p className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
            last deployment · {lastDeploy.readyState}
          </p>
          {lastDeploy.url && (
            <a href={lastDeploy.url} target="_blank" rel="noopener noreferrer" className="mono mt-1 block truncate text-[11px]" style={{ color: 'var(--accent)' }}>
              {lastDeploy.url}
            </a>
          )}
          {lastDeploy.error && (
            <p className="mono mt-1 text-[10.5px]" style={{ color: 'var(--color-rose)' }}>
              {lastDeploy.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function GuardTab() {
  const fingerprints = useWorkspace((s) => s.fingerprints);
  const resetGuard = useWorkspace((s) => s.resetGuard);

  return (
    <div className="space-y-4">
      <p className="text-[11.5px] leading-[1.55]" style={{ color: 'var(--ink-dim)' }}>
        Every failure is normalised — paths, line numbers, addresses and timings stripped — and hashed. The second
        identical signature is a hard stop: that command is banned for the rest of the run, and the agent is handed a
        root-cause directive instead of a retry.
      </p>

      {fingerprints.length === 0 ? (
        <p className="mono rounded-lg border px-2.5 py-3 text-center text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-faint)' }}>
          no failures recorded this run
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            {fingerprints.map((fp) => (
              <div
                key={fp.hash}
                className="rounded-lg border p-2.5"
                style={{
                  borderColor: fp.count >= 2 ? 'color-mix(in oklab, var(--color-rose) 40%, var(--line))' : 'var(--line)',
                }}
              >
                <div className="flex items-baseline gap-2">
                  <span className="mono text-[9.5px]" style={{ color: 'var(--ink-faint)' }}>
                    {fp.hash}
                  </span>
                  <span
                    className="mono rounded px-1.5 py-0.5 text-[9px] uppercase"
                    style={{
                      background: fp.count >= 2 ? 'color-mix(in oklab, var(--color-rose) 16%, transparent)' : 'var(--surface)',
                      color: fp.count >= 2 ? 'var(--color-rose)' : 'var(--ink-dim)',
                    }}
                  >
                    {fp.count >= 2 ? `banned ×${fp.count}` : `×${fp.count}`}
                  </span>
                  <span className="mono ml-auto text-[9px]" style={{ color: 'var(--ink-faint)' }}>
                    {fp.kind}
                  </span>
                </div>
                <p className="mono mt-1 truncate text-[10.5px]" style={{ color: 'var(--ink)' }}>
                  {fp.subject}
                </p>
                <p className="mono mt-0.5 line-clamp-2 text-[9.5px] leading-[1.4]" style={{ color: 'var(--ink-faint)' }}>
                  {fp.signature.split('\n')[0]}
                </p>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={resetGuard}
            className="mono w-full rounded-lg border px-3 py-2 text-[11.5px]"
            style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
          >
            clear ledger &amp; lift bans
          </button>
        </>
      )}
    </div>
  );
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'bridge', label: 'Terminal Bridge' },
  { id: 'endpoints', label: 'Custom Endpoints' },
  { id: 'deploy', label: 'Deployment' },
  { id: 'guard', label: 'Anti-Loop Ledger' },
];

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('bridge');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-[14px] font-semibold tracking-tight">Settings</h2>
          <button type="button" onClick={onClose} className="mono ml-auto text-[12px]" style={{ color: 'var(--ink-faint)' }} aria-label="Close">
            ✕
          </button>
        </header>

        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2" style={{ borderColor: 'var(--line)' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="mono shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors"
              style={{
                background: tab === t.id ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : undefined,
                color: tab === t.id ? 'var(--accent)' : 'var(--ink-dim)',
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'bridge' && <BridgeTab />}
          {tab === 'endpoints' && <EndpointsTab />}
          {tab === 'deploy' && <DeployTab />}
          {tab === 'guard' && <GuardTab />}
        </div>
      </div>
    </div>
  );
}
