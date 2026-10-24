'use client';

import { useEffect, useMemo, useState } from 'react';
import { db, type EndpointRecord } from '@/lib/db/schema';
import { saveKeys } from '@/lib/keys';
import { complete, gatewayResting } from '@/lib/providers/chat-client';
import type { CapabilityProbe } from '@/lib/providers/custom';
import { endpointConfigFor } from '@/lib/providers/endpoint-models';
import {
  FREE_CATALOG_SOURCE, buildEndpoint, endpointIdFor, freeProviders, parseKeyPaste, usableModels, type FreeProvider,
} from '@/lib/providers/free-catalog';
import { compactTokens, endpointKeys, parseTokenCount, summarize, type RestingItem } from '@/lib/providers/gateway';
import { useWorkspace } from '@/lib/store';
import { TerminalKeys } from './TerminalKeys';

const inputStyle: React.CSSProperties = { borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink)' };
const inputClass = 'mono w-full rounded-lg border px-2.5 py-2 text-[11.5px] outline-none placeholder:opacity-40';
const btn = 'press mono rounded-lg border px-2.5 py-1.5 text-[10.5px] disabled:opacity-40';
const faint: React.CSSProperties = { color: 'var(--ink-faint)' };

type Note = { ok: boolean; text: string };

/** The slide switch that decides whether the AI may use the free LLM APIs at all. Lives here and in Custom Endpoints. */
export function FreeApisSwitch() {
  const on = useWorkspace((s) => s.freeApis);
  const setFreeApis = useWorkspace((s) => s.setFreeApis);
  const connected = useWorkspace((s) => s.endpoints.filter((e) => e.freeId && e.enabled).length);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-2.5" style={{ borderColor: 'var(--line)' }}>
      <div className="min-w-0">
        <p className="text-[11.5px] font-medium">Let the AI use free LLM APIs</p>
        <p className="mt-0.5 text-[10.5px] leading-[1.45]" style={faint}>
          {on
            ? `On: ${connected} free provider${connected === 1 ? '' : 's'} connected; the AI can use them and the Gateway moves between them.`
            : 'Off: free providers are left out of the model list and the Gateway. NVIDIA, Pollinations and your own endpoints work as before.'}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Let the AI use free LLM APIs"
        data-testid="free-apis-switch"
        onClick={() => setFreeApis(!on)}
        className="press shrink-0 rounded-full px-0.5 py-0.5 transition-colors"
        style={{ width: 38, height: 22, background: on ? 'var(--accent)' : 'var(--line)' }}
      >
        <span className="block h-[18px] w-[18px] rounded-full bg-white transition-transform" style={{ transform: on ? 'translateX(16px)' : 'translateX(0)' }} />
      </button>
    </div>
  );
}

/**
 * Settings → Free LLM APIs: every LLM API with a permanent free tier (github.com/mnfst/awesome-free-llm-apis), connected
 * from one place, and the gateway that turns all of them into a single provider in the model switcher.
 */
export function FreeProviders({ goTo }: { goTo: (tab: 'keys') => void }) {
  const endpoints = useWorkspace((s) => s.endpoints);
  const setEndpoints = useWorkspace((s) => s.setEndpoints);
  const models = useWorkspace((s) => s.models);
  const usage = useWorkspace((s) => s.usage);
  const setUsageBudget = useWorkspace((s) => s.setUsageBudget);
  const resetUsage = useWorkspace((s) => s.resetUsage);
  const last = useWorkspace((s) => s.gatewayLast);
  const selection = useWorkspace((s) => s.selection);
  const setSelection = useWorkspace((s) => s.setSelection);

  const [open, setOpen] = useState<string | null>(null);
  const [keysText, setKeysText] = useState<Record<string, string>>({});
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [paste, setPaste] = useState('');
  const [pasteResult, setPasteResult] = useState<string[]>([]);
  const [budgetText, setBudgetText] = useState('');
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Who the gateway is giving a rest right now, refreshed while this page is open.
  const [resting, setResting] = useState<RestingItem[]>([]);
  useEffect(() => {
    const tick = () => setResting(gatewayResting());
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);
  const until = (t: number) => {
    const s = Math.max(1, Math.round((t - Date.now()) / 1000));
    return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
  };

  const providers = useMemo(() => freeProviders(), []);
  const byId = useMemo(() => new Map(endpoints.map((e) => [e.id, e])), [endpoints]);
  const summary = summarize(usage);

  const reload = async () => setEndpoints(await db().endpoints.toArray());
  const say = (id: string, n: Note) => setNotes((x) => ({ ...x, [id]: n }));

  /** Counts what the gateway can reach: built-in providers plus every enabled custom model. */
  const reachable = useMemo(() => {
    const real = models.filter((m) => m.capabilities.includes('chat') && m.endpointId !== 'gateway' && m.origin !== 'partner-only');
    return { models: real.length, providers: new Set(real.map((m) => m.endpointId ?? m.provider)).size };
  }, [models]);

  const connect = async (p: FreeProvider, newKeys: string[], account?: string) => {
    const existing = byId.get(endpointIdFor(p.id));
    const keys = newKeys.length ? newKeys : existing ? endpointKeys(existing) : [];
    const record = buildEndpoint(p, { keys, accountId: account || accountFromBase(existing), keepModels: existing?.models });
    await db().endpoints.put({ ...record, createdAt: existing?.createdAt ?? record.createdAt });
    await reload();
    return record;
  };

  /** The account id is part of the Cloudflare base URL; recover it when the user is only adding a key. */
  const accountFromBase = (e?: EndpointRecord) => /accounts\/([0-9a-f]{32})\//i.exec(e?.baseUrl ?? '')?.[1];

  const onConnect = async (p: FreeProvider) => {
    setBusy(p.id);
    try {
      const keys = (keysText[p.id] ?? '').split(/\r?\n/).map((k) => k.trim()).filter(Boolean);
      const rec = await connect(p, keys, accountId);
      setKeysText((x) => ({ ...x, [p.id]: '' }));
      say(p.id, { ok: true, text: `Connected: ${rec.models.length} models${endpointKeys(rec).length > 1 ? `, ${endpointKeys(rec).length} keys used in turn` : ''}. Pick “Gateway · Auto” in the model switcher to use it with the others.` });
    } catch (e) {
      say(p.id, { ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const onTest = async (p: FreeProvider) => {
    const e = byId.get(endpointIdFor(p.id));
    if (!e) return;
    const cfg = endpointConfigFor([e], { provider: 'custom', endpointId: e.id });
    // A model that answers in plain text: a reasoning model can spend the whole token allowance thinking.
    const pick = e.models.find((m) => !m.capabilities.includes('reasoning') && m.enabled !== false) ?? e.models[0];
    if (!cfg || !pick) return;
    setBusy(`test:${p.id}`);
    const started = Date.now();
    try {
      const reply = await complete({
        provider: 'custom', model: pick.id, custom: cfg, maxTokens: 256,
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
      }, undefined, 60_000);
      const ms = Date.now() - started;
      await db().endpoints.put({ ...e, probeOk: 1, lastProbedAt: Date.now() });
      await reload();
      say(p.id, { ok: true, text: `Works: ${pick.id} answered “${reply.trim().slice(0, 60)}” in ${(ms / 1000).toFixed(1)} s.` });
    } catch (err) {
      await db().endpoints.put({ ...e, probeOk: 0, probeError: (err as Error).message.slice(0, 200) });
      await reload();
      say(p.id, { ok: false, text: `${pick.id}: ${(err as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  /** Asks the provider for its live model list and adds what the catalogue does not know (switched off, so nothing floods the switcher). */
  const onSync = async (p: FreeProvider) => {
    const e = byId.get(endpointIdFor(p.id));
    if (!e) return;
    setBusy(`sync:${p.id}`);
    try {
      const res = await fetch('/api/endpoints/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: e.baseUrl, apiKey: e.apiKey, dialect: e.dialect }),
        signal: AbortSignal.timeout(60_000),
      });
      const probe = (await res.json()) as CapabilityProbe & { error?: string };
      const live = (probe.models ?? []).filter((m) => m.capabilities.includes('chat'));
      if (!live.length) {
        say(p.id, { ok: false, text: probe.error ?? probe.routes?.[0] ?? 'The provider published no model list. The catalogue models stay.' });
        return;
      }
      const have = new Set(e.models.map((m) => m.id));
      const added = live.filter((m) => !have.has(m.id)).map((m) => ({ id: m.id, label: m.label, capabilities: m.capabilities, enabled: false }));
      await db().endpoints.put({ ...e, models: [...e.models, ...added], lastProbedAt: Date.now() });
      await reload();
      say(p.id, { ok: true, text: `${live.length} live models; ${added.length} new ones added, switched off. Turn them on under Custom Endpoints → models.` });
    } catch (err) {
      say(p.id, { ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const onDisconnect = async (p: FreeProvider) => {
    await db().endpoints.delete(endpointIdFor(p.id));
    await reload();
    say(p.id, { ok: true, text: 'Disconnected.' });
  };

  const connectKeyless = async () => {
    setBusy('keyless');
    const done: string[] = [];
    for (const p of providers.filter((x) => x.access === 'keyless' && !byId.has(endpointIdFor(x.id)))) {
      await connect(p, []);
      done.push(p.name);
    }
    setBusy(null);
    setPasteResult([done.length ? `Connected without a key: ${done.join(', ')}.` : 'The providers that need no key are already connected.']);
  };

  const connectPasted = async () => {
    setBusy('paste');
    const out: string[] = [];
    try {
      const { entries, unknown } = parseKeyPaste(paste);
      const grouped = new Map<string, { keys: string[]; account?: string }>();
      for (const e of entries) {
        const g = grouped.get(e.providerId) ?? { keys: [] };
        g.keys.push(e.key);
        if (e.accountId) g.account = e.accountId;
        grouped.set(e.providerId, g);
      }
      for (const [id, g] of grouped) {
        const p = providers.find((x) => x.id === id)!;
        try {
          if (p.access === 'builtin') {
            await saveKeys({ nim: g.keys[0] });
            out.push(`${p.name}: key saved (it is used through the built-in NVIDIA provider).`);
            continue;
          }
          const existing = byId.get(endpointIdFor(id));
          const keys = [...new Set([...(existing ? endpointKeys(existing) : []), ...g.keys])];
          const rec = await connect(p, keys, g.account);
          out.push(`${p.name}: connected, ${rec.models.length} models, ${keys.length} key${keys.length > 1 ? 's' : ''}.`);
        } catch (err) {
          out.push(`${p.name}: ${(err as Error).message}`);
        }
      }
      for (const u of unknown) out.push(`Not recognised: ${u}. Write it as provider: key (for example groq: gsk_…).`);
      if (!out.length) out.push('Nothing to connect. Paste one key per line, as provider: key, or just the key.');
      if (grouped.size) setPaste('');
    } finally {
      setPasteResult(out);
      setBusy(null);
    }
  };

  const saveBudget = () => {
    if (!budgetText.trim()) return setUsageBudget(undefined);
    const n = parseTokenCount(budgetText);
    if (n) setUsageBudget(n);
  };

  const gatewaySelected = selection.model.startsWith('gateway/');
  const providerRows = Object.entries(usage.byProvider)
    .map(([name, t]) => ({ name, tokens: t.prompt + t.completion, calls: t.calls }))
    .sort((a, b) => b.tokens - a.tokens);

  return (
    <div className="space-y-4">
      <FreeApisSwitch />
      {/* The gateway */}
      <div className="rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mono text-[11px]" style={{ color: 'var(--accent)' }}>Gateway: one provider, every model</p>
            <p className="mt-1 text-[11.5px] leading-[1.5]" style={{ color: 'var(--ink-dim)' }}>
              {reachable.models} models from {reachable.providers} providers can answer right now. “Gateway · Auto” in the model switcher picks a
              good one for you, spreads the work across providers, uses your keys in turn, and moves to the next model when one is busy,
              out of quota or down — before you see an error.
            </p>
          </div>
          <button
            type="button"
            className={`${btn} shrink-0 whitespace-nowrap`}
            disabled={gatewaySelected}
            onClick={() => setSelection({ provider: 'custom', model: 'gateway/auto', endpointId: 'gateway' })}
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          >
            {gatewaySelected ? 'in use' : 'use it'}
          </button>
        </div>
        {last && (
          <p className="mono mt-2 text-[10.5px]" style={faint}>
            last answer: {last.label}
            {last.switches > 0 ? ` (skipped ${last.switches})` : ''}
          </p>
        )}
        <div className="mt-2" data-testid="resting">
          <p className="mono text-[10px] uppercase tracking-[0.12em]" style={faint}>resting right now</p>
          {resting.length === 0 ? (
            <p className="mt-1 text-[10.5px]" style={faint}>Nothing — every connected model is ready.</p>
          ) : (
            <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
              {resting.slice(0, 20).map((r) => (
                <li key={`${r.what}-${r.why}`} className="flex items-baseline justify-between gap-2 text-[10.5px]">
                  <span className="min-w-0 truncate" style={{ color: 'var(--ink-dim)' }}>{r.what}</span>
                  <span className="mono shrink-0" style={faint}>{r.why} · back in {until(r.until)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Token meter */}
        <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
          <div className="flex items-baseline justify-between">
            <span className="mono text-[10px] uppercase tracking-[0.12em]" style={faint}>tokens used (counted on this device)</span>
            <span className="mono text-[12px]" style={{ color: 'var(--ink)' }}>{compactTokens(summary.total)}</span>
          </div>
          <div className="mono mt-1 flex flex-wrap gap-x-4 text-[10.5px]" style={faint}>
            <span>today {compactTokens(summary.today)}</span>
            <span>7 days {compactTokens(summary.last7)}</span>
            <span>{summary.calls} calls</span>
          </div>
          {summary.budget !== undefined && (
            <>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--line)' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.max(1, (summary.used ?? 0) * 100)}%`, background: 'var(--accent)' }} />
              </div>
              <p className="mono mt-1 text-[10.5px]" style={faint}>
                {compactTokens(summary.left ?? 0)} left of {compactTokens(summary.budget)}
              </p>
            </>
          )}
          <div className="mt-2 flex gap-2">
            <input
              value={budgetText}
              onChange={(e) => setBudgetText(e.target.value)}
              onBlur={saveBudget}
              placeholder={usage.budget ? `budget: ${usage.budget.toLocaleString()}` : 'your total, e.g. 7.6B'}
              inputMode="text"
              className={inputClass}
              style={inputStyle}
            />
            <button type="button" className={btn} style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }} onClick={saveBudget}>set</button>
          </div>
          {providerRows.length > 0 && (
            <>
              <button type="button" className="mono mt-2 text-[10.5px] underline" style={{ color: 'var(--ink-dim)' }} onClick={() => setShowBreakdown((v) => !v)}>
                {showBreakdown ? 'hide' : 'show'} per provider
              </button>
              {showBreakdown && (
                <div className="mt-1 space-y-0.5">
                  {providerRows.map((r) => (
                    <div key={r.name} className="mono flex justify-between text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>
                      <span className="truncate">{r.name}</span>
                      <span>{compactTokens(r.tokens)} · {r.calls} calls</span>
                    </div>
                  ))}
                  <button type="button" className="mono mt-1 text-[10px] underline" style={faint} onClick={resetUsage}>reset counters</button>
                </div>
              )}
            </>
          )}
          <p className="mt-2 text-[10px] leading-[1.4]" style={faint}>
            Providers that report usage are counted exactly; for the others it is estimated (about 4 characters a token). It is your own tally, not the provider’s bill.
          </p>
        </div>
      </div>

      {/* Quick connect */}
      <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
        <p className="mono text-[11px]" style={{ color: 'var(--ink-dim)' }}>Connect everything fast</p>
        <button type="button" className={btn} disabled={busy === 'keyless'} onClick={connectKeyless} style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}>
          {busy === 'keyless' ? 'connecting…' : 'Connect the providers that need no key'}
        </button>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={4}
          placeholder={'Paste all your keys, one per line:\ngroq: gsk_…\nAIza…   (Gemini keys are recognised)\nopenrouter: sk-or-…\nmistral: …'}
          className={inputClass}
          style={inputStyle}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <div className="flex items-center gap-2">
          <button type="button" className={btn} disabled={!paste.trim() || busy === 'paste'} onClick={connectPasted} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
            {busy === 'paste' ? 'connecting…' : 'Sort and connect'}
          </button>
          <span className="text-[10px]" style={faint}>Several keys for one provider are used in turn. Keys stay on this device.</span>
        </div>
        {pasteResult.map((line, i) => (
          <p key={i} className="mono text-[10.5px] leading-[1.45]" style={{ color: /not recognised|needs|Could not|cannot/i.test(line) ? 'var(--color-amber)' : 'var(--ink-dim)' }}>{line}</p>
        ))}
      </div>

      {/* Providers */}
      <div className="space-y-2">
        {providers.map((p) => {
          const e = byId.get(endpointIdFor(p.id));
          const keyCount = e ? endpointKeys(e).length : 0;
          const isOpen = open === p.id;
          const n = notes[p.id];
          const status = p.access === 'builtin'
            ? 'built in'
            : e
              ? e.probeOk ? 'connected ✓' : 'connected'
              : p.access === 'keyless' ? 'no key needed' : 'needs a key';
          return (
            <div key={p.id} className="rounded-xl border" style={{ borderColor: e ? 'color-mix(in oklab, var(--accent) 45%, var(--line))' : 'var(--line)' }}>
              <button type="button" onClick={() => setOpen(isOpen ? null : p.id)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
                <span className="text-[14px]" aria-hidden>{p.flag}</span>
                <span className="mono min-w-0 flex-1 truncate text-[12px]" style={{ color: 'var(--ink)' }}>{p.name}</span>
                <span className="mono shrink-0 text-[10px]" style={{ color: e ? 'var(--accent)' : 'var(--ink-faint)' }}>
                  {status}{e ? ` · ${e.models.filter((m) => m.enabled !== false).length} models${keyCount > 1 ? ` · ${keyCount} keys` : ''}` : ` · ${usableModels(p).length} models`}
                </span>
                <span aria-hidden style={faint}>{isOpen ? '▴' : '▾'}</span>
              </button>
              {isOpen && (
                <div className="space-y-2 border-t px-3 py-3" style={{ borderColor: 'var(--line)' }}>
                  <p className="text-[11px] leading-[1.5]" style={{ color: 'var(--ink-dim)' }}>{p.description}</p>
                  <p className="text-[10.5px] leading-[1.45]" style={faint}>
                    {p.keyHint}{' '}
                    <a href={p.signupUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>get a key ↗</a>
                  </p>

                  {p.access === 'builtin' ? (
                    <button type="button" className={btn} style={{ borderColor: 'var(--line)', color: 'var(--ink)' }} onClick={() => goTo('keys')}>
                      Open API Keys
                    </button>
                  ) : (
                    <>
                      {p.needsAccountId && (
                        <input
                          value={accountId}
                          onChange={(ev) => setAccountId(ev.target.value)}
                          placeholder={accountFromBase(e) ? 'Account ID saved' : 'Cloudflare Account ID (32 characters)'}
                          className={inputClass}
                          style={inputStyle}
                          spellCheck={false}
                        />
                      )}
                      <textarea
                        value={keysText[p.id] ?? ''}
                        onChange={(ev) => setKeysText((x) => ({ ...x, [p.id]: ev.target.value }))}
                        rows={2}
                        placeholder={
                          p.access === 'keyless'
                            ? 'Optional key (raises the limits). Empty = anonymous'
                            : keyCount ? `${keyCount} key${keyCount > 1 ? 's' : ''} saved — paste more (one per line) to replace them` : 'Paste your key (one per line for several)'
                        }
                        className={inputClass}
                        style={inputStyle}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={btn} disabled={busy === p.id} onClick={() => void onConnect(p)} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                          {busy === p.id ? 'connecting…' : e ? 'Update' : 'Connect'}
                        </button>
                        {e && (
                          <>
                            <button type="button" className={btn} disabled={busy === `test:${p.id}`} onClick={() => void onTest(p)} style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}>
                              {busy === `test:${p.id}` ? 'testing…' : 'Test'}
                            </button>
                            <button type="button" className={btn} disabled={busy === `sync:${p.id}`} onClick={() => void onSync(p)} style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>
                              {busy === `sync:${p.id}` ? 'asking…' : 'Live models'}
                            </button>
                            <button type="button" className={btn} onClick={() => void onDisconnect(p)} style={{ borderColor: 'var(--line)', color: 'var(--color-rose)' }}>
                              Disconnect
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                  {n && <p className="mono text-[10.5px] leading-[1.45]" style={{ color: n.ok ? 'var(--accent)' : 'var(--color-rose)' }}>{n.text}</p>}
                  {p.note && (
                    <details>
                      <summary className="mono cursor-pointer text-[10px]" style={faint}>limits and terms</summary>
                      <p className="mt-1 text-[10.5px] leading-[1.5]" style={faint}>{p.note}</p>
                    </details>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] leading-[1.5]" style={faint}>
        The provider list is{' '}
        <a href={FREE_CATALOG_SOURCE.repo} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>awesome-free-llm-apis</a>
        {' '}(CC0), as of {FREE_CATALOG_SOURCE.lastUpdated}. Free tiers change often; a model that stops answering is skipped by the gateway and
        “Live models” shows what a provider serves today. Free-tier prompts may be used by some providers for training: do not send secrets.
      </p>
    </div>
  );
}
