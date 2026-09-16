'use client';

import { VoiceTab } from './VoiceTab';

import { useCallback, useEffect, useState } from 'react';
import { DIALECT_LABELS, dialectFromUrl, type Dialect } from '@/lib/providers/dialects';
import { useWorkspace } from '@/lib/store';
import { db, isBrowser, type EndpointRecord } from '@/lib/db/schema';
import { uid } from '@/lib/db/history';
import type { CapabilityProbe } from '@/lib/providers/custom';
import type { VaultRecord } from '@/lib/db/schema';
import { isClientExposed, maskSecret, toEnvExample, toEnvFile, validateSecretName } from '@/lib/security/secrets';
import { downloadText } from '@/lib/zip';
import { isShellHosted, loadKeys, maskKey, nimConfigured, saveKeys, validateNimKey } from '@/lib/keys';
import { normalizeBase } from '@/lib/providers/model-list';

type Tab = 'guide' | 'keys' | 'bridge' | 'secrets' | 'endpoints' | 'deploy' | 'voice' | 'guard';

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

/**
 * Adding an endpoint, as a process rather than a form.
 *
 * The old version was one page of fields and a "detect capabilities" button.
 * It could report a perfectly healthy endpoint and still leave the user with
 * something that could not answer a single message, because detection only ever
 * proved a route existed — it never sent one.
 *
 * Three steps, each of which has to actually succeed:
 *   1. connect — the URL and key reach something, and we say what it speaks
 *   2. model   — pick one, then send a real message and read the real reply
 *   3. save    — only offered once a reply came back
 *
 * Anything that fails says what failed and what to do about it, at the step it
 * failed on.
 */

type WizardStep = 1 | 2 | 3;

interface TestResult {
  ok: boolean;
  reply?: string;
  error?: string;
  ms?: number;
}

function EndpointsTab() {
  const endpoints = useWorkspace((s) => s.endpoints);
  const setEndpoints = useWorkspace((s) => s.setEndpoints);

  const [step, setStep] = useState<WizardStep>(1);

  // Step 1
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [dialect, setDialect] = useState<'' | Dialect>('');
  const [headersText, setHeadersText] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [probe, setProbe] = useState<CapabilityProbe | null>(null);

  // Step 2
  const [model, setModel] = useState('');
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  // Step 3
  const [label, setLabel] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [temperature, setTemperature] = useState('');
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);

  /** Editing anything invalidates what the last attempt said about it. */
  const edited = <T,>(set: (v: T) => void) => (v: T) => {
    setError(null);
    set(v);
  };

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

  const restart = () => {
    setStep(1);
    setProbe(null);
    setTest(null);
    setModel('');
    setError(null);
  };

  // ── Step 1: connect ───────────────────────────────────────────────────────

  const connect = async () => {
    const headers = parseHeaders();
    if (headers === null) {
      setError('Custom headers must be a JSON object, e.g. {"X-Org": "acme"}.');
      return;
    }
    if (!baseUrl.trim()) {
      setError('Paste the endpoint URL first — the one from your provider’s docs is fine.');
      return;
    }

    setConnecting(true);
    setError(null);
    setProbe(null);
    setTest(null);

    try {
      const res = await fetch('/api/endpoints/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey: apiKey || undefined, headers, dialect: dialect || undefined }),
      });
      const result = (await res.json()) as CapabilityProbe & { error?: string };
      setProbe(result);

      // A failed probe is not a dead end: plenty of endpoints publish no model
      // list at all, and typing the id by hand is a perfectly good answer. So
      // the flow continues either way — the next step is where the truth is.
      setModel(result.models?.[0]?.id ?? '');
      setStep(2);
    } catch (err) {
      setError(`Could not reach the app’s own server: ${(err as Error).message}`);
    } finally {
      setConnecting(false);
    }
  };

  // ── Step 2: prove it answers ──────────────────────────────────────────────

  const sendTest = async () => {
    if (!model.trim()) {
      setError('Pick a model, or type the id your provider gave you.');
      return;
    }

    const headers = parseHeaders() ?? {};
    setTesting(true);
    setError(null);
    setTest(null);
    const started = Date.now();

    try {
      // A real completion, not a route check. This is the whole point of the
      // rebuild: detection proving a route exists is not the same as the
      // endpoint answering, and the gap between them is where every one of
      // these failures lived.
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'custom',
          model: model.trim(),
          stream: false,
          maxTokens: 32,
          messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
          custom: {
            baseUrl: probe?.ok ? probe.baseUrl : normalizeBase(baseUrl),
            apiKey: apiKey || undefined,
            headers,
            dialect: dialect || probe?.dialect || undefined,
          },
        }),
      });

      const payload = (await res.json()) as { content?: string; error?: string };
      if (!res.ok || payload.error) {
        setTest({ ok: false, error: payload.error ?? `The endpoint answered ${res.status}.`, ms: Date.now() - started });
        return;
      }

      const reply = (payload.content ?? '').trim();
      if (!reply) {
        setTest({
          ok: false,
          error: 'The endpoint accepted the request and returned an empty reply. Often a wrong model id, or a model that is not a chat model.',
          ms: Date.now() - started,
        });
        return;
      }

      setTest({ ok: true, reply: reply.slice(0, 200), ms: Date.now() - started });
      if (!label) setLabel(hostOf(probe?.baseUrl ?? baseUrl));
      setStep(3);
    } catch (err) {
      setTest({ ok: false, error: (err as Error).message, ms: Date.now() - started });
    } finally {
      setTesting(false);
    }
  };

  // ── Step 3: save ──────────────────────────────────────────────────────────

  const save = async () => {
    const headers = parseHeaders() ?? {};
    const url = probe?.ok ? probe.baseUrl : normalizeBase(baseUrl);

    setSaving(true);
    setError(null);
    try {
      const probed = (probe?.models ?? []).map((m) => ({ id: m.id, label: m.label, capabilities: m.capabilities }));
      const chosen = probed.some((m) => m.id === model.trim())
        ? probed
        : [{ id: model.trim(), label: model.trim(), capabilities: ['chat'] }, ...probed];

      const record: EndpointRecord = {
        id: uid('ep'),
        label: label.trim() || hostOf(url),
        baseUrl: url,
        apiKey: apiKey || undefined,
        headers,
        dialect: dialect || probe?.dialect || dialectFromUrl(url) || undefined,
        maxTokens: Number(maxTokens) > 0 ? Number(maxTokens) : undefined,
        temperature: temperature.trim() === '' ? undefined : Number(temperature),
        capabilities: probe?.ok && probe.capabilities.length ? probe.capabilities : ['chat'],
        models: chosen,
        routes: probe?.ok ? probe.routes : ['verified by a test message'],
        lastProbedAt: Date.now(),
        // Verified means a message actually came back, not that a route existed.
        probeOk: test?.ok ? 1 : 0,
        enabled: 1,
        createdAt: Date.now(),
      };

      await db().endpoints.put(record);
      await reload();

      setBaseUrl('');
      setApiKey('');
      setHeadersText('');
      setLabel('');
      setMaxTokens('');
      setTemperature('');
      setDialect('');
      restart();
    } catch (err) {
      setError(`Could not save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const stepTitles = ['Connect', 'Test a model', 'Name and save'] as const;

  return (
    <div className="space-y-4">
      {/* Where you are, and what is left. */}
      <div className="flex items-center gap-1.5">
        {stepTitles.map((title, i) => {
          const n = (i + 1) as WizardStep;
          const done = step > n;
          const here = step === n;
          return (
            <div key={title} className="flex flex-1 items-center gap-1.5">
              <button
                type="button"
                onClick={() => n < step && setStep(n)}
                disabled={n > step}
                className="mono flex items-center gap-1.5 text-[10.5px]"
                style={{ color: here ? 'var(--accent)' : done ? 'var(--ink-dim)' : 'var(--ink-faint)' }}
              >
                <span
                  className="flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[9px]"
                  style={{
                    borderColor: here || done ? 'var(--accent)' : 'var(--line)',
                    background: here ? 'var(--accent)' : 'transparent',
                    color: here ? 'var(--panel)' : done ? 'var(--accent)' : 'var(--ink-faint)',
                  }}
                >
                  {done ? '✓' : n}
                </span>
                {title}
              </button>
              {i < 2 && <span className="h-px flex-1" style={{ background: 'var(--line)' }} />}
            </div>
          );
        })}
      </div>

      <hr className="ink-rule" />

      {/* ── Step 1 ───────────────────────────────────────────────────────── */}
      {step === 1 && (
        <>
          <p className="text-[11.5px] leading-[1.55]" style={{ color: 'var(--ink-dim)' }}>
            Paste the URL your provider gives you — the one from their docs, exactly as it is. Anthropic-style
            (<code>/v1/messages</code>), Gemini and OpenAI-style endpoints all work; which one it is gets worked out
            from the URL.
          </p>

          <Field label="Endpoint URL" hint="e.g. https://api.example.com/v1 — a full endpoint path is fine too.">
            <input
              value={baseUrl}
              onChange={(e) => edited(setBaseUrl)(e.target.value)}
              placeholder="https://api.example.com/v1"
              className={inputClass}
              style={inputStyle}
              spellCheck={false}
              autoCapitalize="off"
            />
          </Field>

          <Field label="API key" hint="Sent in whichever header this endpoint's protocol reads. Stored on this device only.">
            <input
              value={apiKey}
              onChange={(e) => edited(setApiKey)(e.target.value)}
              type="password"
              placeholder="sk-…"
              className={inputClass}
              style={inputStyle}
              spellCheck={false}
            />
          </Field>

          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="mono text-[10.5px]"
            style={{ color: 'var(--ink-faint)' }}
          >
            {advanced ? '− fewer options' : '+ protocol and custom headers'}
          </button>

          {advanced && (
            <>
              <Field label="Protocol" hint="Auto reads it from the URL. Set it by hand only if that gets it wrong.">
                <div className="flex flex-wrap gap-1.5">
                  {([['', 'auto'], ['openai', 'OpenAI'], ['anthropic', 'Anthropic'], ['gemini', 'Gemini']] as const).map(
                    ([value, name]) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => edited(setDialect)(value as '' | Dialect)}
                        className="press mono rounded-lg border px-2.5 py-1.5 text-[10.5px]"
                        style={{
                          borderColor: dialect === value ? 'var(--accent)' : 'var(--line)',
                          color: dialect === value ? 'var(--accent)' : 'var(--ink-dim)',
                          background: dialect === value ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : 'transparent',
                        }}
                      >
                        {name}
                      </button>
                    ),
                  )}
                </div>
              </Field>

              <Field label="Custom headers" hint='JSON object. Example: {"X-Org": "acme"}'>
                <textarea
                  value={headersText}
                  onChange={(e) => edited(setHeadersText)(e.target.value)}
                  rows={2}
                  placeholder="{}"
                  className={`${inputClass} resize-y`}
                  style={inputStyle}
                  spellCheck={false}
                />
              </Field>
            </>
          )}

          <button
            type="button"
            onClick={() => void connect()}
            disabled={connecting || !baseUrl.trim()}
            className="press hand w-full rounded-xl px-4 py-2.5 text-[13px]"
            style={{ background: 'var(--accent)', color: 'var(--panel)', opacity: connecting || !baseUrl.trim() ? 0.5 : 1 }}
          >
            {connecting ? 'connecting…' : 'Connect →'}
          </button>
        </>
      )}

      {/* ── Step 2 ───────────────────────────────────────────────────────── */}
      {step === 2 && (
        <>
          {probe?.ok ? (
            <div className="sketch-b p-2.5">
              <p className="mono text-[10.5px]" style={{ color: 'var(--color-success)' }}>
                ✔ connected in {probe.latencyMs}ms{probe.dialect ? ` · speaks ${DIALECT_LABELS[probe.dialect]}` : ''}
              </p>
              <p className="mono mt-1 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                {probe.models.length} model{probe.models.length === 1 ? '' : 's'} found at {probe.baseUrl}
              </p>
            </div>
          ) : (
            <div className="sketch-b p-2.5">
              <p className="mono text-[10.5px]" style={{ color: 'var(--color-amber)' }}>
                {probe?.error ?? 'No model list published.'}
              </p>
              <p className="mt-1 text-[10.5px] leading-[1.5]" style={{ color: 'var(--ink-dim)' }}>
                Not necessarily a problem — plenty of endpoints publish no list. Type the model id your provider gave
                you and send a test message; that is what decides it.
              </p>
            </div>
          )}

          {probe?.models && probe.models.length > 0 && (
            <Field label="Pick a model" hint="Tap one, or type a different id below.">
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {probe.models.slice(0, 60).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => edited(setModel)(m.id)}
                    className="press mono rounded-lg border px-2 py-1 text-[10px]"
                    style={{
                      borderColor: model === m.id ? 'var(--accent)' : 'var(--line)',
                      color: model === m.id ? 'var(--accent)' : 'var(--ink-dim)',
                    }}
                  >
                    {m.id}
                  </button>
                ))}
              </div>
            </Field>
          )}

          <Field label="Model id" hint="Exactly as your provider writes it.">
            <input
              value={model}
              onChange={(e) => edited(setModel)(e.target.value)}
              placeholder="claude-opus-5"
              className={inputClass}
              style={inputStyle}
              spellCheck={false}
              autoCapitalize="off"
            />
          </Field>

          {test && (
            <div
              className="sketch-b p-2.5"
              style={{ borderColor: test.ok ? 'var(--color-success)' : 'var(--color-danger)' }}
            >
              <p className="mono text-[10.5px]" style={{ color: test.ok ? 'var(--color-success)' : 'var(--color-danger)' }}>
                {test.ok ? `✔ it answered in ${test.ms}ms` : '✕ it did not answer'}
              </p>
              <p className="mono mt-1 break-words text-[10px]" style={{ color: 'var(--ink-dim)' }}>
                {test.ok ? `“${test.reply}”` : test.error}
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={restart}
              className="press mono rounded-xl border px-3 py-2.5 text-[11px]"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
            >
              ← back
            </button>
            <button
              type="button"
              onClick={() => void sendTest()}
              disabled={testing || !model.trim()}
              className="press hand flex-1 rounded-xl px-4 py-2.5 text-[13px]"
              style={{ background: 'var(--accent)', color: 'var(--panel)', opacity: testing || !model.trim() ? 0.5 : 1 }}
            >
              {testing ? 'sending a test message…' : 'Send a test message →'}
            </button>
          </div>

          {test && !test.ok && (
            <button
              type="button"
              onClick={() => setStep(3)}
              className="mono w-full text-[10.5px]"
              style={{ color: 'var(--ink-faint)' }}
            >
              save it anyway — I know this endpoint works
            </button>
          )}
        </>
      )}

      {/* ── Step 3 ───────────────────────────────────────────────────────── */}
      {step === 3 && (
        <>
          {test?.ok ? (
            <div className="sketch-b p-2.5" style={{ borderColor: 'var(--color-success)' }}>
              <p className="mono text-[10.5px]" style={{ color: 'var(--color-success)' }}>
                ✔ {model} answered in {test.ms}ms. This endpoint works.
              </p>
              {test.reply && (
                <p className="mono mt-1 break-words text-[10px]" style={{ color: 'var(--ink-dim)' }}>
                  it said: “{test.reply}”
                </p>
              )}
            </div>
          ) : (
            <div className="sketch-b p-2.5" style={{ borderColor: 'var(--color-amber)' }}>
              <p className="mono text-[10.5px]" style={{ color: 'var(--color-amber)' }}>
                Saving without a successful test — it will be marked unverified.
              </p>
            </div>
          )}

          <Field label="Name it" hint="Shown in the model switcher next to each of its models.">
            <input
              value={label}
              onChange={(e) => edited(setLabel)(e.target.value)}
              placeholder={hostOf(probe?.baseUrl ?? baseUrl)}
              className={inputClass}
              style={inputStyle}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Max output tokens" hint="Optional. Set it if this endpoint rejects large requests.">
              <input
                value={maxTokens}
                onChange={(e) => edited(setMaxTokens)(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                placeholder="e.g. 4096"
                className={inputClass}
                style={inputStyle}
              />
            </Field>
            <Field label="Temperature" hint="Optional default.">
              <input
                value={temperature}
                onChange={(e) => edited(setTemperature)(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                placeholder="e.g. 0.7"
                className={inputClass}
                style={inputStyle}
              />
            </Field>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="press mono rounded-xl border px-3 py-2.5 text-[11px]"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
            >
              ← back
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="press hand flex-1 rounded-xl px-4 py-2.5 text-[13px]"
              style={{ background: 'var(--accent)', color: 'var(--panel)', opacity: saving ? 0.5 : 1 }}
            >
              {saving ? 'saving…' : 'Add endpoint'}
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="mono text-[10.5px]" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}

      {/* ── What is already configured ───────────────────────────────────── */}
      {endpoints.length > 0 && (
        <>
          <hr className="ink-rule" />
          <div>
            <p className="mono mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
              configured
            </p>
            <div className="space-y-1.5">
              {endpoints.map((ep) => (
                <div
                  key={ep.id}
                  className="flex items-center gap-2 rounded-lg border px-2.5 py-2"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-[12px]" style={{ color: 'var(--ink)' }}>
                      {ep.label}
                      {!ep.probeOk && (
                        <span
                          className="mono shrink-0 rounded px-1 py-px text-[8.5px]"
                          style={{ background: 'color-mix(in oklab, var(--color-amber) 16%, transparent)', color: 'var(--color-amber)' }}
                          title="Saved without a successful test message"
                        >
                          unverified
                        </span>
                      )}
                    </p>
                    <p className="mono truncate text-[9.5px]" style={{ color: 'var(--ink-faint)' }}>
                      {ep.baseUrl} · {ep.models.length} model{ep.models.length === 1 ? '' : 's'}
                      {ep.dialect ? ` · ${ep.dialect}` : ''}
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
        </>
      )}
    </div>
  );
}

/** The host, for a default label. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || 'endpoint';
  }
}

/**
 * Secrets vault.
 *
 * Environment variables live here rather than in a prompt or a generated file,
 * and are injected into a Vercel deployment at build time. Deliberately blunt
 * about the storage guarantee: IndexedDB is origin-scoped and device-local —
 * the same promise a .env.local makes, and nothing stronger.
 */
function SecretsTab() {
  const [secrets, setSecrets] = useState<VaultRecord[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [scope, setScope] = useState<VaultRecord['scope']>('both');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!isBrowser()) return;
    setSecrets(await db().vault.orderBy('name').toArray().catch(() => []));
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const add = async () => {
    const invalid = validateSecretName(name);
    if (invalid) { setError(invalid); return; }
    if (!value.trim()) { setError('A value is required.'); return; }
    if (secrets.some((s) => s.name === name)) { setError(`${name} already exists — remove it first.`); return; }

    const now = Date.now();
    await db().vault.put({
      id: `vault_${now.toString(36)}`,
      name,
      value: value.trim(),
      scope,
      targets: ['production', 'preview', 'development'],
      note: note.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });

    setName(''); setValue(''); setNote(''); setError(null);
    await reload();
  };

  const toggleReveal = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <p className="text-[11.5px] leading-[1.55]" style={{ color: 'var(--ink-dim)' }}>
        Variables stored here are injected into a Vercel build and never enter a prompt, a generated file, or a history
        export. They are held in this browser&apos;s IndexedDB — origin-scoped and local to this device, the same
        guarantee a <code>.env.local</code> gives. Not a managed secret store.
      </p>

      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
        <div className="flex flex-wrap items-end gap-1.5">
          <label className="min-w-40 flex-1">
            <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
              placeholder="STRIPE_SECRET_KEY"
              className={inputClass}
              style={inputStyle}
            />
          </label>
          <label className="w-28">
            <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>scope</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as VaultRecord['scope'])}
              className={inputClass}
              style={{ ...inputStyle, background: 'var(--surface)' }}
            >
              <option value="both">build + runtime</option>
              <option value="build">build only</option>
              <option value="runtime">runtime only</option>
            </select>
          </label>
        </div>

        <label className="mt-1.5 block">
          <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>value</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            type="password"
            placeholder="…"
            className={inputClass}
            style={inputStyle}
            spellCheck={false}
          />
        </label>

        <label className="mt-1.5 block">
          <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} style={inputStyle} />
        </label>

        {name && isClientExposed(name) && (
          <p className="mt-1.5 text-[10.5px] leading-[1.45]" style={{ color: 'var(--color-amber)' }}>
            ⚠ {name.split('_')[0]}_ prefixed variables are inlined into the client bundle and shipped to every visitor.
            Only put values here that are safe to publish.
          </p>
        )}

        {error && (
          <p className="mt-1.5 text-[10.5px]" style={{ color: 'var(--color-rose)' }}>{error}</p>
        )}

        <button
          type="button"
          onClick={() => void add()}
          className="press mono mt-2 w-full rounded-lg px-3 py-2 text-[11.5px] font-semibold"
          style={{ background: 'var(--accent)', color: '#04150e' }}
        >
          add variable
        </button>
      </div>

      {secrets.length > 0 && (
        <>
          <div className="space-y-1.5">
            {secrets.map((secret) => (
              <div key={secret.id} className="rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--line)' }}>
                <div className="flex items-center gap-2">
                  <span className="mono truncate text-[11.5px]" style={{ color: 'var(--ink)' }}>{secret.name}</span>
                  {isClientExposed(secret.name) && (
                    <span
                      className="mono rounded px-1 py-0.5 text-[8.5px] uppercase"
                      style={{ background: 'color-mix(in oklab, var(--color-amber) 18%, transparent)', color: 'var(--color-amber)' }}
                    >
                      public
                    </span>
                  )}
                  <span className="mono text-[9px]" style={{ color: 'var(--ink-faint)' }}>{secret.scope}</span>
                  <button
                    type="button"
                    onClick={() => toggleReveal(secret.id)}
                    className="press mono ml-auto text-[10px]"
                    style={{ color: 'var(--ink-faint)' }}
                  >
                    {revealed.has(secret.id) ? 'hide' : 'reveal'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => { await db().vault.delete(secret.id); await reload(); }}
                    className="press mono text-[10px]"
                    style={{ color: 'var(--color-rose)' }}
                  >
                    remove
                  </button>
                </div>
                <code className="mono mt-1 block truncate text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                  {revealed.has(secret.id) ? secret.value : maskSecret(secret.value)}
                </code>
                {secret.note && (
                  <p className="mt-0.5 text-[10px]" style={{ color: 'var(--ink-faint)' }}>{secret.note}</p>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => downloadText(toEnvFile(secrets), '.env.local', 'text/plain')}
              className="press mono flex-1 rounded-lg border px-3 py-2 text-[10.5px]"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
            >
              ↓ .env.local (with values)
            </button>
            <button
              type="button"
              onClick={() => downloadText(toEnvExample(secrets), '.env.example', 'text/plain')}
              className="press mono flex-1 rounded-lg border px-3 py-2 text-[10.5px]"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
            >
              ↓ .env.example (names only)
            </button>
          </div>
        </>
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


/**
 * Where the NVIDIA key goes.
 *
 * This tab is the fix for the app's worst first-run failure: NIM models are the
 * default, NIM needs a key, and the only place to put one used to be a .env.local
 * file on the server — so a fresh install looked simply broken, with no route
 * from the symptom to the cause.
 *
 * In the APK the native shell owns the key and this posts to it; in a browser it
 * is stored with the rest of the workspace and sent with each request. The tab
 * does not need to care which, beyond telling the user where their key ended up.
 */
function KeysTab() {
  const loadModels = useWorkspace((s) => s.loadModels);
  const models = useWorkspace((s) => s.models);
  // The Vercel token lives here too: every credential the app needs belongs in
  // one place. Settings → Deployment still edits the same value.
  const vercelToken = useWorkspace((s) => s.vercelToken);
  const vercelTeamId = useWorkspace((s) => s.vercelTeamId);
  const setVercelCredentials = useWorkspace((s) => s.setVercelCredentials);
  const [vercel, setVercel] = useState('');
  const [team, setTeam] = useState('');

  useEffect(() => {
    setVercel(vercelToken);
    setTeam(vercelTeamId);
  }, [vercelToken, vercelTeamId]);

  const [nim, setNim] = useState('');
  const [pollinations, setPollinations] = useState('');
  const [tripo, setTripo] = useState('');
  const [meshy, setMeshy] = useState('');
  const [sketchfab, setSketchfab] = useState('');
  const [kaggle, setKaggle] = useState('');
  const [trellisUrl, setTrellisUrl] = useState('');
  const [reveal, setReveal] = useState(false);
  const [shell, setShell] = useState(false);
  /**
   * Whether a key is already stored where this page cannot read it.
   *
   * In the APK the key lives in the native store by design, so the field
   * renders empty — which looked exactly like the key had been deleted. Worse,
   * saving again would have posted that empty field and actually deleted it.
   */
  const [nimSaved, setNimSaved] = useState(false);
  const [nimTouched, setNimTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [keys, hosted, configured] = await Promise.all([loadKeys(), isShellHosted(), nimConfigured()]);
      if (!alive) return;
      setShell(hosted);
      setNim(keys.nim);
      setPollinations(keys.pollinations);
      setTripo(keys.tripo);
      setMeshy(keys.meshy);
      setSketchfab(keys.sketchfab);
      setKaggle(keys.kaggle);
      setTrellisUrl(keys.trellisUrl);
      setNimSaved(configured);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const nimCount = models.filter((m) => m.provider === 'nim').length;

  const save = useCallback(async () => {
    // An untouched field means "leave it as it is", not "clear it".
    const sendNim = nimTouched || !nimSaved;
    const problem = sendNim ? validateNimKey(nim) : null;
    if (problem) {
      setStatus({ kind: 'error', text: problem });
      return;
    }

    setSaving(true);
    setStatus({ kind: 'info', text: 'Saving, then checking the key against NVIDIA…' });
    try {
      const modelKeys = { pollinations, tripo, meshy, sketchfab, trellisUrl, kaggle };
      await saveKeys(sendNim ? { nim, ...modelKeys } : modelKeys);
      setVercelCredentials(vercel.trim(), team.trim());
      // The catalogue is the real test: it only returns NIM models if the key
      // was accepted, so a successful reload is proof rather than a guess.
      await loadModels(true);
      const live = useWorkspace.getState().models.filter((m) => m.provider === 'nim').length;
      if (sendNim && !nim.trim()) {
        setStatus({ kind: 'info', text: 'Key cleared. Pollinations still works without one.' });
      } else if (live > 0) {
        setStatus({ kind: 'ok', text: `Key accepted — ${live} NVIDIA models are available.` });
      } else {
        setStatus({
          kind: 'error',
          text: 'Saved, but NVIDIA returned no models. The key may be wrong or expired — regenerate it at build.nvidia.com.',
        });
      }
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }, [nim, pollinations, tripo, meshy, sketchfab, trellisUrl, kaggle, vercel, team, nimTouched, nimSaved, loadModels, setVercelCredentials]);

  const clear = useCallback(async () => {
    setNimTouched(false);
    setNimSaved(false);
    setNim('');
    setPollinations('');
    setTripo('');
    setMeshy('');
    setTrellisUrl('');
    setVercel('');
    setTeam('');
    await saveKeys({ nim: '', pollinations: '', tripo: '', meshy: '', sketchfab: '', trellisUrl: '', kaggle: '' });
    setVercelCredentials('', '');
    await loadModels(true);
    setStatus({ kind: 'info', text: 'Keys cleared from this device.' });
  }, [loadModels, setVercelCredentials]);

  const statusColor =
    status?.kind === 'ok' ? 'var(--color-success)' : status?.kind === 'error' ? 'var(--color-danger)' : 'var(--ink-dim)';

  return (
    <div className="space-y-4">
      <p className="text-[11.5px] leading-[1.55]" style={{ color: 'var(--ink-dim)' }}>
        Chomugiri needs an NVIDIA NIM key to run its main models. It is free — sign in at{' '}
        <a href="https://build.nvidia.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
          build.nvidia.com
        </a>
        , open any model, and copy the key from the API tab. Pollinations answers with no key at all, and is smaller.
      </p>

      <Field
        label="NVIDIA NIM API key"
        hint={
          shell
            ? 'Stored by the app itself, not in the page. It never leaves your device except to NVIDIA.'
            : 'Stored on this device and sent only to Chomugiri’s own server, which forwards it to NVIDIA. Nothing is written to a file.'
        }
      >
        <div className="flex gap-1.5">
          <input
            className={inputClass}
            style={inputStyle}
            type={reveal ? 'text' : 'password'}
            value={nim}
            spellCheck={false}
            autoComplete="off"
            placeholder="nvapi-..."
            onChange={(e) => {
              setNim(e.target.value);
              setStatus(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            className="press mono shrink-0 rounded-lg border px-2.5 text-[10.5px]"
            style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
            aria-label={reveal ? 'Hide key' : 'Show key'}
          >
            {reveal ? 'hide' : 'show'}
          </button>
        </div>
      </Field>

      {!reveal && nim && (
        <p className="mono text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
          saved as {maskKey(nim)}
        </p>
      )}

      {nimSaved && !nim && (
        <p className="mono text-[10.5px]" style={{ color: 'var(--color-success)' }}>
          ✔ a key is saved on this device — leave the field empty to keep it
        </p>
      )}

      <Field
        label="Pollinations token (optional)"
        hint="Pollinations works with no token at all. Adding one only raises your rate limit."
      >
        <input
          className={inputClass}
          style={inputStyle}
          type={reveal ? 'text' : 'password'}
          value={pollinations}
          spellCheck={false}
          autoComplete="off"
          placeholder="leave empty to stay on the free tier"
          onChange={(e) => setPollinations(e.target.value)}
        />
      </Field>

      <Field
        label="Sketchfab token (optional) — download existing models"
        hint="Tried first for characters: somebody has usually already modelled and rigged the thing, and one download beats ninety seconds of generation. Searching works without this; only downloading needs it. Get one at sketchfab.com/settings/password. Only models whose licence permits shipping are offered, and the credit the licence asks for is written into CREDITS.md."
      >
        <input
          className={inputClass}
          style={inputStyle}
          type={reveal ? 'text' : 'password'}
          value={sketchfab}
          spellCheck={false}
          autoComplete="off"
          placeholder="leave empty to generate models instead"
          onChange={(e) => setSketchfab(e.target.value)}
        />
      </Field>

      <Field
        label="Kaggle token (optional) — 3D models on a free GPU"
        hint="The free generator that is actually up. Kaggle gives every account a Tesla T4 and thirty hours a week of it, and this runs Pixal3D on it — a prompt becomes an image, the image becomes a GLB with real textures. It is your account and your quota; there is no shared one. Generate a token at kaggle.com/settings → API Tokens. Slower than a hosted endpoint, because a notebook has to queue and boot, so a build asks for every model it needs in one run."
      >
        <input
          className={inputClass}
          style={inputStyle}
          type={reveal ? 'text' : 'password'}
          value={kaggle}
          spellCheck={false}
          autoComplete="off"
          placeholder="KGAT_…"
          onChange={(e) => setKaggle(e.target.value)}
        />
      </Field>

      <Field
        label="Meshy AI key (optional) — 3D models, rigged"
        hint="Tried first when set, because Meshy is the only one of these that rigs what it generates — a rigged model can be animated, an unrigged one is scenery. Get one at meshy.ai."
      >
        <input
          className={inputClass}
          style={inputStyle}
          type={reveal ? 'text' : 'password'}
          value={meshy}
          spellCheck={false}
          autoComplete="off"
          placeholder="msy_… — leave empty to use code-built geometry"
          onChange={(e) => setMeshy(e.target.value)}
        />
      </Field>

      <Field
        label="Tripo AI key (optional) — 3D models"
        hint="Used when there is no Meshy key. Tripo makes good meshes but does not rig them, so a character from Tripo will not animate without rigging it by hand. Get one at platform.tripo3d.ai."
      >
        <input
          className={inputClass}
          style={inputStyle}
          type={reveal ? 'text' : 'password'}
          value={tripo}
          spellCheck={false}
          autoComplete="off"
          placeholder="tsk_… — leave empty to use code-built geometry"
          onChange={(e) => setTripo(e.target.value)}
        />
      </Field>

      <Field
        label="TRELLIS container URL (optional)"
        hint="Optional override. Microsoft TRELLIS already runs on your NVIDIA key — Chomugiri calls NVIDIA's real TRELLIS NIM, not the build.nvidia.com demo (that one only serves NVIDIA's own sample pictures). Their hosted one is currently failing its own jobs, so Chomugiri falls through to Meshy, Tripo or built-in geometry and says so. Running the container yourself (nvcr.io/nim/microsoft/trellis, needs a GPU) bypasses that — paste its URL here."
      >
        <input
          className={inputClass}
          style={inputStyle}
          type="text"
          value={trellisUrl}
          spellCheck={false}
          autoComplete="off"
          placeholder="http://…:8000 — leave empty to use NVIDIA's hosted TRELLIS"
          onChange={(e) => setTrellisUrl(e.target.value)}
        />
      </Field>

      <p className="text-xs opacity-70">
        Order is Meshy, then Tripo, then TRELLIS on your NVIDIA key, then code-built geometry that is
        rigged locally — blocky, but instant, free and always available. That last one is the floor
        whenever a hosted generator is out of credit, slow, or down.
      </p>

      <hr className="ink-rule" />

      <ImageModelField />

      <hr className="ink-rule" />

      <Field
        label="Vercel token"
        hint="Only needed to launch or update a website. Create one at vercel.com/account/tokens. Stored on this device and sent only to Vercel, through this app's own server."
      >
        <input
          className={inputClass}
          style={inputStyle}
          type={reveal ? 'text' : 'password'}
          value={vercel}
          spellCheck={false}
          autoComplete="off"
          placeholder="leave empty if you are not deploying"
          onChange={(e) => {
            setVercel(e.target.value);
            setStatus(null);
          }}
        />
      </Field>

      <Field label="Vercel team id (optional)" hint="Only for deploying into a team rather than your personal account.">
        <input
          className={inputClass}
          style={inputStyle}
          value={team}
          spellCheck={false}
          autoComplete="off"
          placeholder="team_..."
          onChange={(e) => setTeam(e.target.value)}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="press mono rounded-lg px-3.5 py-1.5 text-[11.5px] font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: 'var(--panel)' }}
        >
          {saving ? 'checking…' : 'save & test'}
        </button>
        <button
          type="button"
          onClick={() => void clear()}
          className="press mono rounded-lg border px-2.5 py-1.5 text-[10.5px]"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
        >
          clear
        </button>
        <span className="mono text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
          {nimCount > 0 ? `${nimCount} NVIDIA models loaded` : 'no NVIDIA models loaded'}
        </span>
      </div>

      {status && (
        <p className="text-[11px] leading-[1.5]" style={{ color: statusColor }}>
          {status.text}
        </p>
      )}

      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
        <p className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
          no key handy?
        </p>
        <p className="mt-1.5 text-[11px] leading-[1.5]" style={{ color: 'var(--ink-dim)' }}>
Chomugiri still works — Pollinations needs no key at all. Pick it from the model menu in the command
          dock. NVIDIA is only needed for the larger models and for image generation.
        </p>
      </div>
    </div>
  );
}


/**
 * What the app is and how to switch it on.
 *
 * Written because most of what Chomugiri does was only discoverable by already
 * knowing it was there — the terminal bridge, the suites, the slash commands,
 * the asset studio. A feature nobody finds is a feature that does not exist.
 */
function GuideTab() {
  const models = useWorkspace((s) => s.models);
  const heartbeat = useWorkspace((s) => s.heartbeat);
  const endpoints = useWorkspace((s) => s.endpoints);
  const vercelToken = useWorkspace((s) => s.vercelToken);

  const nimCount = models.filter((m) => m.provider === 'nim').length;

  const steps = [
    {
      done: nimCount > 0,
      title: 'Add a model key',
      body: 'API Keys → NVIDIA NIM. Free at build.nvidia.com. It powers the build lane — terminal steps, deployment and the Minecraft suite. Pollinations also answers with no key, and is smaller.',
      state: nimCount > 0 ? `${nimCount} NVIDIA models ready` : 'not set — Pollinations still works',
    },
    {
      done: endpoints.length > 0,
      title: 'Add your own endpoint (optional)',
      body: 'Custom Endpoints takes any OpenAI-compatible server. Detection fills in the model list; if the server does not publish one, type the model id yourself and add it anyway.',
      state: endpoints.length ? `${endpoints.length} configured` : 'none — optional',
    },
    {
      done: heartbeat.status === 'online',
      title: 'Connect a terminal (optional)',
      body: 'Terminal Bridge runs real shell commands on your own machine over ngrok or Cloudflare. Needed only for native compilation — APKs, toolchains, test runs. Everything else is built in the browser.',
      state: heartbeat.status === 'online' ? 'online' : 'offline — browser-side builds still work',
    },
    {
      done: Boolean(vercelToken),
      title: 'Add a Vercel token (optional)',
      body: 'API Keys → Vercel token. Only needed to put a generated site on the internet.',
      state: vercelToken ? 'ready to launch' : 'not set — only needed for deployment',
    },
  ];

  const suites = [
    ['Chat', 'Ask anything. Questions get answered directly; describe something to build and it switches to building it.'],
    ['Android', 'Generates a full Android project and compiles an APK when the terminal bridge is connected.'],
    ['Minecraft', 'Bedrock add-ons end to end — manifests, items, entities, a 3D model for anything that needs one, and painted textures. Exports an installable .mcaddon.'],
    ['Studio', 'Slide decks, documents and a visual canvas from a prompt.'],
    ['MCP Builder', 'Scaffolds Model Context Protocol servers for Claude Code, Cursor and others.'],
    ['Workdrive', 'Research mode: searches, reads and writes up what it found.'],
    ['Asset Studio', 'Generate an image, cut its background out, and export icon sets for Android or the web.'],
    ['Skills', 'Your own slash commands, saved and reusable.'],
  ];

  return (
    <div className="space-y-5">
      <div>
        <p className="hand text-[24px] leading-none">Getting set up</p>
        <p className="mt-1.5 text-[11.5px] leading-[1.55]" style={{ color: 'var(--ink-dim)' }}>
          Only the first step is required, and even that has a free fallback. Everything below it is optional and the app
          says so when something it needs is missing.
        </p>
      </div>

      <div className="space-y-2">
        {steps.map((step, i) => (
          <div
            key={step.title}
            className="rounded-lg border p-2.5"
            style={{
              borderColor: step.done ? 'color-mix(in oklab, var(--color-success) 45%, var(--line))' : 'var(--line)',
              background: 'var(--surface)',
            }}
          >
            <p className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--ink)' }}>
              <span className="mono text-[10px]" style={{ color: step.done ? 'var(--color-success)' : 'var(--ink-faint)' }}>
                {step.done ? '✔' : String(i + 1).padStart(2, '0')}
              </span>
              {step.title}
            </p>
            <p className="mt-1 text-[11px] leading-[1.5]" style={{ color: 'var(--ink-dim)' }}>
              {step.body}
            </p>
            <p className="mono mt-1 text-[10px]" style={{ color: step.done ? 'var(--color-success)' : 'var(--ink-faint)' }}>
              {step.state}
            </p>
          </div>
        ))}
      </div>

      <hr className="ink-rule" />

      <div>
        <p className="hand text-[20px] leading-none">What each suite does</p>
        <div className="mt-2 space-y-1.5">
          {suites.map(([name, what]) => (
            <div key={name} className="text-[11px] leading-[1.5]">
              <span className="mono" style={{ color: 'var(--accent)' }}>
                {name}
              </span>
              <span style={{ color: 'var(--ink-dim)' }}> — {what}</span>
            </div>
          ))}
        </div>
      </div>

      <hr className="ink-rule" />

      <div>
        <p className="hand text-[20px] leading-none">Worth knowing</p>
        <ul className="mt-2 space-y-1.5 text-[11px] leading-[1.5]" style={{ color: 'var(--ink-dim)' }}>
          <li>
            <span className="mono" style={{ color: 'var(--ink)' }}>Slash commands</span> — type <span className="mono">/</span>{' '}
            in the box: /make-apk, /build-mcpack, /deploy, /research, /audit-code, /make-deck.
          </li>
          <li>
            <span className="mono" style={{ color: 'var(--ink)' }}>Drafts</span> — the ⑂ button answers twice and lets you
            pick. Costs two completions; on NVIDIA&apos;s free tier they run one after the other.
          </li>
          <li>
            <span className="mono" style={{ color: 'var(--ink)' }}>Background runs</span> — start something and leave. When
            it finishes you get a notice naming the topic; double-click it to jump back to that conversation.
          </li>
          <li>
            <span className="mono" style={{ color: 'var(--ink)' }}>Secrets</span> — the vault holds environment variables
            for deployment. Paste a key into the chat box and sending is blocked until it is removed.
          </li>
          <li>
            <span className="mono" style={{ color: 'var(--ink)' }}>Theme</span> — the ☀ / ◐ / ☾ control in the header.
            ◐ follows your phone.
          </li>
          <li>
            <span className="mono" style={{ color: 'var(--ink)' }}>History</span> — every suite keeps its own, searchable
            from the sidebar, stored on this device only.
          </li>
        </ul>
      </div>
    </div>
  );
}


/**
 * Which model paints generated art.
 *
 * Worth exposing because the answer differs by what the user has: FLUX gives
 * the best textures but needs an NVIDIA key, and Pollinations needs none at
 * all. Picking silently would mean quality quietly depending on a setting the
 * user cannot see.
 */
function ImageModelField() {
  const imageModel = useWorkspace((s) => s.imageModel);
  const setImageModel = useWorkspace((s) => s.setImageModel);
  const models = useWorkspace((s) => s.models);
  const nimReady = models.some((m) => m.provider === 'nim');

  const options = [
    { value: 'nim:black-forest-labs/flux.1-dev', label: 'FLUX.1 dev (NVIDIA) — best quality', needsKey: true },
    { value: 'pollinations:flux', label: 'FLUX (Pollinations) — no key needed', needsKey: false },
    { value: 'pollinations:turbo', label: 'Turbo (Pollinations) — fastest', needsKey: false },
  ];

  return (
    <Field
      label="Image model"
      hint="Paints Minecraft textures and Asset Studio images. Generated large and reduced afterwards, so detail matters more than output size."
    >
      <select
        className={inputClass}
        style={inputStyle}
        value={imageModel}
        onChange={(e) => setImageModel(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
            {o.needsKey && !nimReady ? ' — needs an NVIDIA key' : ''}
          </option>
        ))}
      </select>
    </Field>
  );
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'guide', label: 'Setup Guide' },
  { id: 'keys', label: 'API Keys' },
  { id: 'bridge', label: 'Terminal Bridge' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'endpoints', label: 'Custom Endpoints' },
  { id: 'deploy', label: 'Deployment' },
  { id: 'voice', label: 'Voice' },
  { id: 'guard', label: 'Anti-Loop Ledger' },
];

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('guide');

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
          {tab === 'guide' && <GuideTab />}
          {tab === 'keys' && <KeysTab />}
          {tab === 'bridge' && <BridgeTab />}
          {tab === 'secrets' && <SecretsTab />}
          {tab === 'endpoints' && <EndpointsTab />}
          {tab === 'deploy' && <DeployTab />}
          {tab === 'voice' && <VoiceTab />}
          {tab === 'guard' && <GuardTab />}
        </div>
      </div>
    </div>
  );
}
