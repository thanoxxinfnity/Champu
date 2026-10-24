/** node --experimental-strip-types --test scripts/test-gateway.mjs — the free-provider catalogue and the gateway that mixes every connected model. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildEndpoint, capabilitiesFor, detectProviderByKey, endpointIdFor, freeProvider, freeProviders, parseKeyPaste, resolvedBase, usableModels,
} from '../src/lib/providers/free-catalog.ts';
import { endpointModels } from '../src/lib/providers/endpoint-models.ts';
import {
  addUsage, classifyError, compactTokens, parseTokenCount, createHealth, emptyUsage, estimateTokens, gatewayKind, gatewayModels, planCandidates, reportFailure,
  reportSuccess, runWithFailover, summarize, traitsOf, GATEWAY_ENDPOINT_ID,
  activeEndpoints, parseRateLimit, noteCall, limitUntil, restingNow,
} from '../src/lib/providers/gateway.ts';

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);

// ── The catalogue ───────────────────────────────────────────────────────────

test('the catalogue has every provider of the list, each with an https base URL, a key page and chat models', () => {
  const all = freeProviders();
  assert.equal(all.length, 17);
  assert.equal(new Set(all.map((p) => p.id)).size, 17);
  for (const p of all) {
    assert.match(p.chatBase, /^https:\/\//, p.id);
    assert.match(p.signupUrl, /^https:\/\//, p.id);
    assert.ok(usableModels(p).length > 0, `${p.id} has usable chat models`);
    assert.ok(p.keyHint, `${p.id} says where the key is`);
  }
  assert.ok(all.reduce((n, p) => n + p.models.length, 0) >= 120);
});

test('how each provider is called: dialects, anonymous access, the Cloudflare account id', () => {
  assert.equal(freeProvider('google-gemini').dialect, 'gemini');
  assert.equal(freeProvider('groq').dialect, 'openai');
  assert.deepEqual(freeProviders().filter((p) => p.access === 'keyless').map((p) => p.id).sort(), ['kilo-code', 'llm7-io', 'ovhcloud-ai-endpoints']);
  assert.equal(freeProvider('nvidia-nim').access, 'builtin');
  assert.equal(freeProvider('ollama-cloud').chatBase, 'https://ollama.com/v1');
  assert.equal(freeProvider('cohere').chatBase, 'https://api.cohere.ai/compatibility/v1');
  const cf = freeProvider('cloudflare-workers-ai');
  assert.equal(resolvedBase(cf, ''), null);
  assert.equal(resolvedBase(cf, 'abc'), null);
  assert.equal(resolvedBase(cf, 'a'.repeat(32)), `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/v1`);
  assert.ok(!usableModels(cf).some((m) => m.paid));
});

test('modalities become capabilities; a comma list is a provider range, not a model', () => {
  assert.deepEqual(capabilitiesFor('Text'), ['chat']);
  assert.deepEqual(capabilitiesFor('Text (reasoning)'), ['chat', 'reasoning']);
  assert.deepEqual(capabilitiesFor('Text + Image + Audio + Video'), ['chat', 'vision']);
  assert.deepEqual(capabilitiesFor('Multimodal'), ['chat', 'vision']);
  assert.deepEqual(capabilitiesFor('Text, Image, Audio, Embeddings'), ['chat']);
  assert.deepEqual(capabilitiesFor('Embeddings'), ['embedding']);
  const gonka = freeProvider('gonka-broker');
  assert.ok(usableModels(gonka).every((m) => m.capabilities.includes('chat')), 'embedding models are left out of the chat list');
});

test('connecting writes an ordinary custom endpoint, one per provider', () => {
  const g = freeProvider('groq');
  const e = buildEndpoint(g, { keys: ['gsk_a', 'gsk_b', 'gsk_a'], now: NOW, verified: true });
  assert.equal(e.id, endpointIdFor('groq'));
  assert.equal(e.freeId, 'groq');
  assert.equal(e.apiKey, 'gsk_a');
  assert.deepEqual(e.apiKeys, ['gsk_b']);
  assert.equal(e.dialect, 'openai');
  assert.equal(e.probeOk, 1);
  assert.equal(e.models.length, usableModels(g).length);
  assert.throws(() => buildEndpoint(g, {}), /needs an API key/);
  assert.throws(() => buildEndpoint(freeProvider('cloudflare-workers-ai'), { keys: ['t'] }), /Account ID/);
  const anon = buildEndpoint(freeProvider('ovhcloud-ai-endpoints'), { now: NOW });
  assert.equal(anon.apiKey, undefined);
  assert.equal(anon.probeOk, 0);
  // the picker sees its models like any custom endpoint's
  assert.ok(endpointModels([e]).every((m) => m.provider === 'custom' && m.endpointId === e.id && m.vendor === 'Groq'));
});

test('re-connecting keeps the models the user switched off and the ones a live refresh added', () => {
  const g = freeProvider('groq');
  const first = buildEndpoint(g, { keys: ['k'], now: NOW });
  first.models[0].enabled = false;
  first.models.push({ id: 'extra-live-model', label: 'extra-live-model', capabilities: ['chat'], enabled: false });
  const again = buildEndpoint(g, { keys: ['k2'], now: NOW + 1, keepModels: first.models });
  assert.equal(again.models.find((m) => m.id === first.models[0].id).enabled, false);
  assert.ok(again.models.some((m) => m.id === 'extra-live-model'));
});

test('a pasted pile of keys is sorted by provider', () => {
  assert.equal(detectProviderByKey('gsk_abc'), 'groq');
  assert.equal(detectProviderByKey('AIzaSyXYZ'), 'google-gemini');
  assert.equal(detectProviderByKey('sk-or-v1-abc'), 'openrouter');
  assert.equal(detectProviderByKey('hf_abc'), 'hugging-face');
  assert.equal(detectProviderByKey('nvapi-abc'), 'nvidia-nim');
  assert.equal(detectProviderByKey('sk-something'), null);
  const acct = 'b'.repeat(32);
  const { entries, unknown } = parseKeyPaste(`
    # my keys
    gsk_one
    groq: gsk_two
    Google Gemini = AIzaKey
    mistral: m-123
    cloudflare: ${acct}:cf-token
    hf=hf_x
    cloudflare: nothing-useful
    sk-mystery-key-1234567890
  `);
  assert.deepEqual(entries.map((e) => [e.providerId, e.key]), [
    ['groq', 'gsk_one'], ['groq', 'gsk_two'], ['google-gemini', 'AIzaKey'], ['mistral-ai', 'm-123'], ['cloudflare-workers-ai', 'cf-token'], ['hugging-face', 'hf_x'],
  ]);
  assert.equal(entries.find((e) => e.providerId === 'cloudflare-workers-ai').accountId, acct);
  assert.equal(unknown.length, 2);
  assert.ok(unknown.some((u) => /Cloudflare/.test(u)));
  assert.ok(!unknown.join(' ').includes('mystery-key-1234567890'), 'an unplaced key is shown shortened, not in full');
});

// ── Gateway: what a model is ────────────────────────────────────────────────

test('gateway entries are recognised, ordinary models are not', () => {
  assert.equal(gatewayKind('gateway/auto', 'custom'), 'auto');
  assert.equal(gatewayKind('gateway/fast'), 'fast');
  assert.equal(gatewayKind('gateway/nope', 'custom'), null);
  assert.equal(gatewayKind('gateway/auto', 'nim'), null);
  assert.equal(gatewayKind('llama-3.3-70b', 'custom'), null);
  const list = gatewayModels();
  assert.equal(list.length, 5);
  assert.ok(list.every((m) => m.endpointId === GATEWAY_ENDPOINT_ID && m.vendor === 'Gateway' && m.provider === 'custom'));
  assert.ok(gatewayModels().find((m) => m.id === 'gateway/reasoning').capabilities.includes('reasoning'));
});

test('a model is sized, and typed, from its name', () => {
  assert.equal(traitsOf('meta-llama/Llama-3.3-70B-Instruct', '', ['chat']).sizeB, 70);
  const moe = traitsOf('Qwen3.5-397B-A17B', '', ['chat']);
  assert.equal(moe.sizeB, 397);
  assert.equal(moe.activeB, 17);
  assert.ok(traitsOf('gemini-3.8-flash-lite', '', ['chat']).quick);
  assert.ok(traitsOf('gemini-3.8-pro', '', ['chat']).sizeB >= 200);
  assert.ok(traitsOf('codestral-latest', '', ['chat']).code);
  assert.ok(traitsOf('gpt-oss-120b', '', ['chat']).reasoning);
  assert.ok(traitsOf('anything', '', ['chat', 'reasoning']).reasoning);
});

// ── Gateway: choosing ───────────────────────────────────────────────────────

function world() {
  const groq = buildEndpoint(freeProvider('groq'), { keys: ['g1', 'g2'], now: NOW });
  const gemini = buildEndpoint(freeProvider('google-gemini'), { keys: ['AIzaA'], now: NOW });
  const ovh = buildEndpoint(freeProvider('ovhcloud-ai-endpoints'), { now: NOW });
  const endpoints = [groq, gemini, ovh];
  const models = [
    { id: 'nvidia/nemotron', provider: 'nim', label: 'nemotron', vendor: 'NVIDIA', capabilities: ['chat', 'reasoning'], origin: 'catalogue' },
    { id: 'openai-fast', provider: 'pollinations', label: 'Fast', vendor: 'Pollinations', capabilities: ['chat'], origin: 'catalogue' },
    ...endpointModels(endpoints),
    ...gatewayModels(),
  ];
  return { endpoints, models, health: createHealth() };
}

test('the plan mixes every provider, best first, and leaves out the gateway itself', () => {
  const w = world();
  const plan = planCandidates('auto', { ...w, now: NOW });
  assert.ok(plan.length >= 5 && plan.length <= 8);
  assert.ok(plan.every((c) => !c.model.startsWith('gateway/')));
  const vendors = new Set(plan.slice(0, 5).map((c) => c.vendor));
  assert.ok(vendors.size >= 4, `the first five come from ${vendors.size} providers: ${[...vendors]}`);
  assert.ok(plan.every((c) => c.provider !== 'custom' || c.custom?.baseUrl));
});

test('each kind of job prefers a different model', () => {
  const w = world();
  const best = (kind) => planCandidates(kind, { ...w, now: NOW })[0];
  assert.ok(/flash|8b|20b|oss-20b|nemo|9b|27b/i.test(best('fast').model), `fast picks ${best('fast').model}`);
  assert.ok(traitsOf(best('auto').model, '', ['chat']).sizeB >= 70, `auto picks ${best('auto').model}`);
  const vision = planCandidates('vision', { ...w, now: NOW });
  assert.ok(vision.length > 0 && vision.every((c) => w.models.find((m) => m.id === c.model && (m.endpointId ?? '') === (c.endpointId ?? '')).capabilities.includes('vision')));
});

test('equally good first picks take turns', () => {
  const w = world();
  const firsts = new Set();
  for (let i = 0; i < 6; i++) firsts.add(planCandidates('auto', { ...w, now: NOW, rotation: i })[0].label);
  assert.ok(firsts.size >= 2, `six requests started on ${firsts.size} different models`);
});

test('a provider with several keys uses them in turn, and skips a key that was refused', () => {
  const w = world();
  const groqPlan = () => planCandidates('auto', { ...w, now: NOW }).find((c) => c.vendor === 'Groq');
  const first = groqPlan();
  assert.equal(first.custom.apiKey, 'g1');
  reportSuccess(w.health, first, 2);
  assert.equal(groqPlan().custom.apiKey, 'g2', 'the next request starts on the next key');
  reportFailure(w.health, groqPlan(), 'auth', NOW);
  assert.equal(groqPlan().custom.apiKey, 'g1', 'the refused key is skipped');
  reportFailure(w.health, groqPlan(), 'auth', NOW);
  assert.equal(groqPlan(), undefined, 'when every key is refused the provider drops out');
  assert.ok(planCandidates('auto', { ...w, now: NOW + 61 * 60_000 }).some((c) => c.vendor === 'Groq'), 'and is given another chance an hour later');
});

test('errors are told apart', () => {
  assert.equal(classifyError({ status: 429, message: 'Too many requests' }), 'rate');
  assert.equal(classifyError({ message: 'Gateway returned 429.' }), 'rate');
  assert.equal(classifyError({ status: 429, message: 'You exceeded your current quota' }), 'quota');
  assert.equal(classifyError({ status: 429, message: 'Free tier daily limit reached (RPD)' }), 'quota');
  assert.equal(classifyError({ status: 402, message: 'Payment required' }), 'quota');
  assert.equal(classifyError({ status: 401, message: 'Invalid API key' }), 'auth');
  assert.equal(classifyError({ code: 'http_403', message: 'forbidden' }), 'auth');
  // the messages real providers gave for a wrong key, as the app's route relays them
  assert.equal(classifyError({ status: 502, code: 'INVALID_ARGUMENT', message: '400 API key not valid. Please pass a valid API key.' }), 'auth');
  assert.equal(classifyError({ status: 401, code: 'http_401', message: '401 Invalid API Key' }), 'auth');
  assert.equal(classifyError({ status: 401, code: 'http_401', message: '401 Missing Authentication header' }), 'auth');
  assert.equal(classifyError({ status: 502, message: '429 Too Many Requests' }), 'rate');
  assert.equal(classifyError({ status: 502, message: '503 Service Unavailable' }), 'server');
  assert.equal(classifyError({ status: 404, message: 'Not found' }), 'model');
  assert.equal(classifyError({ message: 'The model `x` does not exist' }), 'model');
  assert.equal(classifyError({ code: 'model_unsupported', message: 'nope' }), 'model');
  assert.equal(classifyError({ status: 503, message: 'overloaded' }), 'server');
  assert.equal(classifyError({ message: 'Gateway unreachable: fetch failed' }), 'server');
  assert.equal(classifyError({ message: 'Stream interrupted: boom' }), 'server');
  assert.equal(classifyError({ message: 'x returned an empty completion.', code: 'empty_completion' }), 'server');
  assert.equal(classifyError({ status: 400, message: 'bad request' }), 'client');
  assert.equal(classifyError({ message: 'Run cancelled.' }), 'cancel');
});

test('what failed is set aside for as long as the failure suggests, and backs off', () => {
  const w = world();
  const c = planCandidates('auto', { ...w, now: NOW })[0];
  const gone = (t) => !planCandidates('auto', { ...w, now: t, maxAttempts: 99 }).some((x) => x.label === c.label && x.keyIndex === c.keyIndex);
  reportFailure(w.health, c, 'rate', NOW);
  assert.ok(gone(NOW + 30_000));
  assert.ok(!gone(NOW + 61_000), 'a first rate limit rests a minute');
  reportFailure(w.health, c, 'rate', NOW + 61_000);
  assert.ok(gone(NOW + 61_000 + 90_000), 'a second one rests two');
  const d = planCandidates('auto', { ...w, now: NOW })[1];
  reportFailure(w.health, d, 'client', NOW);
  assert.ok(planCandidates('auto', { ...w, now: NOW, maxAttempts: 99 }).some((x) => x.label === d.label), 'a bad request is not held against the model');
});

test('failover: moves on past failures, stops at a cancel or once words are on the screen', async () => {
  const w = world();
  const plan = planCandidates('auto', { ...w, now: NOW });
  const seen = [];
  const out = await runWithFailover(plan, w.health, async (c) => {
    seen.push(c.label);
    if (seen.length === 1) return { ok: false, error: { status: 429, message: 'Too many requests' } };
    if (seen.length === 2) return { ok: false, error: { status: 404, message: 'model not found' } };
    if (seen.length === 3) return { ok: false, error: { message: 'Gateway unreachable: fetch failed' } };
    return { ok: true, value: `answered by ${c.label}` };
  }, { now: () => NOW });
  assert.equal(out.ok, true);
  assert.equal(out.tried.length, 3);
  assert.deepEqual(out.tried.map((t) => t.cls), ['rate', 'model', 'server']);
  assert.equal(out.value, `answered by ${plan[3].label}`);

  const halfway = await runWithFailover(plan, createHealth(), async () => ({ ok: false, error: { message: 'Stream interrupted: x' }, emitted: true }), { now: () => NOW });
  assert.equal(halfway.ok, false);
  assert.equal(halfway.tried.length, 1, 'a reply that already started is not retried elsewhere');

  const cancelled = await runWithFailover(plan, createHealth(), async () => ({ ok: false, error: { message: 'Run cancelled.' } }), { now: () => NOW });
  assert.equal(cancelled.tried.length, 1);

  const none = await runWithFailover([], createHealth(), async () => ({ ok: true, value: 1 }));
  assert.match(none.lastError, /Free LLM APIs/);

  const allFail = await runWithFailover(plan.slice(0, 2), createHealth(), async () => ({ ok: false, error: { status: 503, message: 'down' } }), { now: () => NOW });
  assert.match(allFail.lastError, /2 tried/);
});

// ── Token counter ───────────────────────────────────────────────────────────

test('tokens are counted per provider, model and day, against the budget', () => {
  let u = emptyUsage(NOW);
  u = addUsage(u, { provider: 'Groq', model: 'llama' }, { prompt: 1000, completion: 500 }, NOW);
  u = addUsage(u, { provider: 'Groq', model: 'llama' }, { prompt: 10, completion: 5 }, NOW);
  u = addUsage(u, { provider: 'OVH', model: 'gpt-oss' }, { prompt: 100, completion: 100 }, NOW - 86_400_000);
  assert.equal(u.total.calls, 3);
  assert.equal(u.byProvider.Groq.prompt, 1010);
  assert.equal(u.byProvider.Groq.calls, 2);
  assert.equal(u.byModel['OVH · gpt-oss'].completion, 100);
  const s = summarize({ ...u, budget: 7_600_000_000 }, NOW);
  assert.equal(s.total, 1715);
  assert.equal(s.today, 1515);
  assert.equal(s.last7, 1715);
  assert.equal(s.left, 7_600_000_000 - 1715);
  assert.ok(s.used > 0 && s.used < 1e-6);
  assert.equal(summarize(u, NOW).budget, undefined);
  assert.equal(estimateTokens(400), 100);
  assert.equal(estimateTokens(0), 0);
  assert.equal(compactTokens(7_600_000_000), '7.60B');
  assert.equal(compactTokens(48_200), '48.2K');
  assert.equal(compactTokens(999), '999');
  const before = JSON.stringify(u);
  addUsage(u, { provider: 'x', model: 'y' }, { prompt: 1, completion: 1 }, NOW);
  assert.equal(JSON.stringify(u), before, 'counting returns a new state');
});

test('a budget can be typed the way people say it', () => {
  assert.equal(parseTokenCount('7.6B'), 7_600_000_000);
  assert.equal(parseTokenCount('7,600,000,000'), 7_600_000_000);
  assert.equal(parseTokenCount('7.6 billion'), 7_600_000_000);
  assert.equal(parseTokenCount('500m'), 500_000_000);
  assert.equal(parseTokenCount('250k'), 250_000);
  assert.equal(parseTokenCount('12345'), 12345);
  assert.equal(parseTokenCount(''), undefined);
  assert.equal(parseTokenCount('lots'), undefined);
  assert.equal(parseTokenCount('0'), undefined);
});

test('the record stays small however long it runs', () => {
  let u = emptyUsage(NOW);
  for (let i = 0; i < 300; i++) u = addUsage(u, { provider: 'P', model: `m${i}` }, { prompt: i, completion: 1 }, NOW + i * 86_400_000);
  assert.ok(Object.keys(u.byDay).length <= 90);
  assert.ok(Object.keys(u.byModel).length <= 120);
  assert.equal(u.total.calls, 300);
});

// ── Wiring (these modules need a browser, so the source is read) ────────────

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('every chat call goes through the shared client, so the gateway and the meter see all of them', () => {
  const chat = read('src/lib/providers/chat-client.ts');
  assert.match(chat, /export async function streamCompletion/);
  assert.match(chat, /export async function complete/);
  assert.match(chat, /gatewayKind\(body\.model, body\.provider\)/);
  assert.match(chat, /runWithFailover/);
  assert.match(chat, /recordUsage/);
  // a gateway attempt that fails is replaced silently: its error is not passed to the caller's onError
  assert.match(chat, /const seen: StreamCallbacks = \{ onDelta: callbacks\.onDelta, onReasoning: callbacks\.onReasoning \}/);
  const runtime = read('src/lib/agent/runtime.ts');
  assert.match(runtime, /from '@\/lib\/providers\/chat-client'/);
  assert.doesNotMatch(runtime, /async function streamCompletion\(/);
  assert.doesNotMatch(runtime, /fetch\('\/api\/chat'/);
  for (const f of ['src/components/suites/CanvasBoard.tsx', 'src/components/suites/SkillsManager.tsx']) {
    const src = read(f);
    assert.match(src, /from '@\/lib\/providers\/chat-client'/, f);
    assert.doesNotMatch(src, /fetch\('\/api\/chat'/, f);
  }
});

test('the store lists the gateway next to the other models, counts tokens, and keeps the meter', () => {
  const store = read('src/lib/store.ts');
  assert.equal((store.match(/\.\.\.gatewayModels\(\)/g) ?? []).length, 3, 'loadModels, setEndpoints and the free-APIs switch all add it');
  assert.match(store, /freeApis: true/);
  assert.match(store, /getSetting<boolean>\('freeApis', true\)/);
  assert.match(store, /recordUsage:/);
  assert.match(store, /getSetting<UsageState \| null>\('gatewayUsage'/);
});

test('Settings has the Free LLM APIs tab and the picker puts the Gateway group first', () => {
  const settings = read('src/components/Settings.tsx');
  assert.match(settings, /\{ id: 'free', label: 'Free LLM APIs' \}/);
  assert.match(settings, /tab === 'free' && <FreeProviders/);
  const dock = read('src/components/CommandDock.tsx');
  assert.match(dock, /a\[0\] === 'Gateway' \? -1/);
});

test('the generated catalogue matches the pinned commit of the source list', () => {
  const data = read('src/lib/providers/free-catalog.data.ts');
  assert.match(data, /639807877a43bb85b34348ccf7146d7376fc75eb/);
  assert.match(read('scripts/sync-free-catalog.mjs'), /639807877a43bb85b34348ccf7146d7376fc75eb/);
});

// ── The free-APIs switch, published limits and the status list ──────────────

test('rate-limit text from the catalogue becomes numbers', () => {
  assert.deepEqual(parseRateLimit('15 RPM, 20K TPD'), { rpm: 15, tpd: 20000 });
  assert.deepEqual(parseRateLimit('30 RPM, 14.4K RPD, 6K TPM'), { rpm: 30, rpd: 14400, tpm: 6000 });
  assert.deepEqual(parseRateLimit('1,000 RPD'), { rpd: 1000 });
  assert.deepEqual(parseRateLimit('Varies'), {});
  assert.deepEqual(parseRateLimit(undefined), {});
});

test('with the switch off, free endpoints sit out', () => {
  const eps = [{ id: 'free-groq', freeId: 'groq' }, { id: 'own' }];
  assert.deepEqual(activeEndpoints(eps, true).map((e) => e.id), ['free-groq', 'own']);
  assert.deepEqual(activeEndpoints(eps, false).map((e) => e.id), ['own']);
});

function freeSetup(keys = ['k1']) {
  const g = freeProvider('groq');
  const e = buildEndpoint(g, { keys, now: NOW, verified: true });
  return { e, models: endpointModels([e]), model: usableModels(g).find((m) => parseRateLimit(m.rateLimit).rpm)?.id };
}

test('a model that used up its published per-minute allowance is skipped before the provider ever refuses it', () => {
  const { e, models, model } = freeSetup();
  assert.ok(model, 'groq publishes an RPM for at least one model');
  const rpm = parseRateLimit(usableModels(freeProvider('groq')).find((m) => m.id === model).rateLimit).rpm;
  const health = createHealth();
  const first = planCandidates('auto', { models, endpoints: [e], health, now: NOW, maxAttempts: 100 }).find((c) => c.model === model);
  assert.ok(first);
  for (let i = 0; i < rpm; i++) noteCall(health, first, 100, NOW + i * 100);
  const during = planCandidates('auto', { models, endpoints: [e], health, now: NOW + 5000, maxAttempts: 100 });
  assert.equal(during.some((c) => c.model === model), false, 'resting while the minute is full');
  const after = planCandidates('auto', { models, endpoints: [e], health, now: NOW + 65_000, maxAttempts: 100 });
  assert.equal(after.some((c) => c.model === model), true, 'back once the minute has passed');
});

test('with two keys, the second takes over when the first is at its limit', () => {
  const { e, models, model } = freeSetup(['k1', 'k2']);
  const rpm = parseRateLimit(usableModels(freeProvider('groq')).find((m) => m.id === model).rateLimit).rpm;
  const health = createHealth();
  const c = planCandidates('auto', { models, endpoints: [e], health, now: NOW, maxAttempts: 100 }).find((x) => x.model === model);
  assert.equal(c.keyIndex, 0);
  for (let i = 0; i < rpm; i++) noteCall(health, c, 10, NOW + i);
  const next = planCandidates('auto', { models, endpoints: [e], health, now: NOW + 1000, maxAttempts: 100 }).find((x) => x.model === model);
  assert.equal(next.keyIndex, 1);
});

test('daily token limits are counted too, with a margin', () => {
  const health = createHealth();
  const c = { provider: 'custom', model: 'm', endpointId: 'e', keyIndex: 0 };
  noteCall(health, c, 19_000, NOW);
  assert.ok(limitUntil(health, c, { tpd: 20_000 }, NOW + 10) > NOW, '95 % of the day is used: set aside');
  assert.equal(limitUntil(health, c, { tpd: 100_000 }, NOW + 10), 0);
  assert.equal(limitUntil(health, c, { tpd: 20_000 }, NOW + 25 * 3600_000), 0, 'a day later it is free again');
});

test('the status list says who is resting, why and until when', () => {
  const { e } = freeSetup();
  const health = createHealth();
  const cand = { provider: 'custom', model: 'llama-3.3-70b-versatile', endpointId: e.id, keyIndex: 0, label: 'x', vendor: 'Groq', score: 1 };
  reportFailure(health, cand, 'rate', NOW);
  reportFailure(health, { ...cand, model: 'other' }, 'quota', NOW);
  const list = restingNow(health, [e], NOW + 1000);
  const rate = list.find((r) => r.what.endsWith('llama-3.3-70b-versatile'));
  assert.equal(rate.what, 'Groq · llama-3.3-70b-versatile');
  assert.equal(rate.why, 'rate limit hit');
  assert.ok(rate.until > NOW + 1000);
  assert.equal(list.find((r) => r.what.endsWith('other')).why, 'free quota used up');
  assert.equal(restingNow(health, [e], NOW + 3 * 3600_000).length, 0, 'nothing rests forever');
});

test('a pinned free model falls back to the gateway chain, and the calls are metered', () => {
  const src = read('src/lib/providers/chat-client.ts');
  assert.match(src, /function routeFor\(/);
  assert.match(src, /freeApis/);
  assert.match(src, /noteCall\(health/);
  assert.match(src, /restingNow\(/);
});
