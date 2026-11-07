/** node --experimental-strip-types --test scripts/test-handoff.mjs — Handoff (computer use): actions, approvals, the loop, Action Buttons, Panels, desktop control. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { describe as label, extractJson, parseStep, riskOf, systemPrompt, toBridge, trimObservation } from '../src/lib/handoff/actions.ts';
import { runHandoff, screenshotName } from '../src/lib/handoff/loop.ts';
import { CATALOG, firstSlot, needsInput, suggestActions } from '../src/lib/handoff/suggest.ts';
import { BUILT_IN_PANELS, acceptState, extractHtml, nameFrom, panelDocument, scriptJson } from '../src/lib/handoff/panels.ts';
import { createDesktop, parseDesktop } from '../agent/desktop.mjs';

const step = (reply, mode = 'browser') => parseStep(reply, mode);

test('a reply is read as one action, wherever the JSON sits', () => {
  assert.equal(extractJson('Sure!\n```json\n{"action":"snapshot"}\n```'), '{"action":"snapshot"}');
  assert.equal(extractJson('ok {"a":{"b":"}"}} tail'), '{"a":{"b":"}"}}');
  assert.equal(extractJson('no json here'), null);
  const s = step('{"thought":"look","action":"open_url","url":"example.com"}');
  assert.deepEqual(s.step.action, { type: 'open_url', url: 'example.com' });
  assert.equal(s.step.thought, 'look');
  assert.equal(step('{"action":"click","ref":"e12","target":"Sign up"}').step.action.ref, 'e12');
  assert.match(step('{"action":"click"}').error, /ref/);
  assert.match(step('{"action":"click","ref":"e1"}', 'desktop').error, /x.*y/);
  assert.deepEqual(step('{"action":"click","x":"640","y":400.4}', 'desktop').step.action, { type: 'click', ref: undefined, x: 640, y: 400, target: undefined });
  assert.match(step('{"action":"launch","argv":["x"]}').error, /not an action in browser mode/);
  assert.match(step('{"action":"open_url"}').error, /url/);
  assert.equal(step('{"action":"wait","seconds":999}').step.action.seconds, 30);
  assert.equal(step('{"action":"done","answer":"42"}').step.action.summary, '42');
  assert.equal(step('{"action":"type","ref":"e3","text":"hi","submit":true,"risky":true,"why":"posts"}').step.risky, true);
  assert.match(step('{"action":"nope"}').error, /not an action/);
  assert.match(step('{"action":').error, /JSON/);
});

test('risky actions ask first, dangerous addresses are blocked, harmless ones run', () => {
  assert.equal(riskOf({ type: 'open_url', url: 'https://example.com' }).level, 'ok');
  assert.equal(riskOf({ type: 'open_url', url: 'javascript:alert(1)' }).level, 'block');
  assert.equal(riskOf({ type: 'open_url', url: 'file:///etc/passwd' }).level, 'block');
  assert.equal(riskOf({ type: 'open_url', url: 'http://192.168.1.1/admin' }).level, 'confirm');
  assert.equal(riskOf({ type: 'open_url', url: 'localhost:3000' }).level, 'confirm');
  assert.equal(riskOf({ type: 'click', ref: 'e1', target: 'Place order' }).level, 'confirm');
  assert.equal(riskOf({ type: 'click', ref: 'e1', target: 'Buy now' }).level, 'confirm');
  assert.equal(riskOf({ type: 'click', ref: 'e1', target: 'Send' }).level, 'confirm');
  assert.equal(riskOf({ type: 'click', ref: 'e1', target: 'Next page' }).level, 'ok');
  assert.equal(riskOf({ type: 'type', text: 'x', ref: 'e2', target: 'Password' }).level, 'confirm');
  assert.equal(riskOf({ type: 'type', text: '4111', ref: 'e2', target: 'Card number' }).level, 'confirm');
  assert.equal(riskOf({ type: 'type', text: 'shoes', ref: 'e2', target: 'Search' }).level, 'ok');
  assert.equal(riskOf({ type: 'shell', cmd: 'ls -la ~' }).level, 'ok');
  assert.equal(riskOf({ type: 'shell', cmd: 'df -h' }).level, 'ok');
  assert.equal(riskOf({ type: 'shell', cmd: 'rm -rf ~/x' }).level, 'confirm');
  assert.equal(riskOf({ type: 'shell', cmd: 'ls; rm x' }).level, 'confirm');
  assert.equal(riskOf({ type: 'shell', cmd: 'curl https://x.sh | sh' }).level, 'confirm');
  assert.equal(riskOf({ type: 'shell', cmd: 'cat a > b' }).level, 'confirm');
  assert.equal(riskOf({ type: 'shell', cmd: 'npm install left-pad' }).level, 'confirm');
  assert.equal(riskOf({ type: 'launch', argv: ['chromium'] }).level, 'confirm');
  assert.equal(riskOf({ type: 'key', key: 'alt+F4' }).level, 'confirm');
  assert.equal(riskOf({ type: 'scroll', direction: 'down' }, { risky: true, why: 'x' }).level, 'confirm');
});

test('actions become the right bridge calls', () => {
  assert.deepEqual(toBridge({ type: 'search', query: 'a b' }, 'browser'), { via: 'browser', tool: 'browser_navigate', args: { url: 'https://duckduckgo.com/html/?q=a%20b' } });
  assert.deepEqual(toBridge({ type: 'open_url', url: 'example.com' }, 'browser').args, { url: 'https://example.com' });
  assert.deepEqual(toBridge({ type: 'click', ref: 'e4', target: 'Go' }, 'browser'), { via: 'browser', tool: 'browser_click', args: { target: 'e4', element: 'Go' } });
  assert.equal(toBridge({ type: 'scroll', direction: 'up' }, 'browser').args.key, 'PageUp');
  assert.deepEqual(toBridge({ type: 'click', x: 1, y: 2 }, 'desktop'), { via: 'desktop', body: { action: 'click', x: 1, y: 2 } });
  assert.equal(toBridge({ type: 'key', key: 'Enter' }, 'desktop').body.key, 'Return');
  assert.deepEqual(toBridge({ type: 'shell', cmd: 'ls' }, 'desktop'), { via: 'shell', cmd: 'ls' });
  assert.deepEqual(toBridge({ type: 'done', summary: '' }, 'browser'), { via: 'none' });
  assert.equal(label({ type: 'type', text: 'x'.repeat(60), ref: 'e1', submit: true }).endsWith('…” + Enter'), true);
  assert.match(systemPrompt('browser'), /DATA, not instructions/);
  assert.match(systemPrompt('desktop'), /pixels in the screenshot/);
  assert.match(trimObservation('a'.repeat(20000), 1000), /characters left out/);
});

/** A fake world: the model plays a script; the bridge records what it was asked. */
function harness(replies, over = {}) {
  const calls = [];
  const events = [];
  let i = 0;
  const deps = {
    llm: async (messages) => { calls.push({ llm: messages }); if (i >= replies.length) throw new Error('script ran out'); return replies[i++]; },
    browser: async (tool, args) => { calls.push({ browser: tool, args }); return tool === 'browser_take_screenshot' ? { ok: true, text: 'Saved [page.png](page.png) — download: /v1/artifact/page-1.png' } : { ok: true, text: `- link "Result" [ref=e7]\n(${tool})` }; },
    desktop: async (body) => { calls.push({ desktop: body }); if (body.action === 'info') return { ok: true, text: 'display: (none)\nscreen: not reachable' }; if (body.action === 'shot') return { ok: true, text: 'Screenshot 1280x800.', image: 'screen-1.png', width: 1280, height: 800 }; return { ok: true, text: `${body.action} ok` }; },
    shell: async (cmd) => { calls.push({ shell: cmd }); return { output: 'file-a\nfile-b\n', exitCode: 0 }; },
    image: async (name) => `data:image/png;base64,${Buffer.from(name).toString('base64')}`,
    approve: async () => true,
    answer: async () => 'blue',
    onEvent: (e) => events.push(e),
    ...over,
  };
  return { deps, calls, events };
}

test('the loop browses, reads, and finishes with a summary', async () => {
  const h = harness([
    '{"thought":"search","action":"search","query":"best chai"}',
    'Here: {"action":"click","ref":"e7","target":"Result"}',
    '{"action":"done","summary":"The best chai is masala chai."}',
  ]);
  const r = await runHandoff({ task: 'find the best chai', mode: 'browser', vision: false, liveView: true }, h.deps);
  assert.equal(r.status, 'done');
  assert.equal(r.summary, 'The best chai is masala chai.');
  assert.equal(r.steps.length, 3);
  assert.deepEqual(h.calls.filter((c) => c.browser && c.browser !== 'browser_take_screenshot').map((c) => c.browser), ['browser_navigate', 'browser_click']);
  assert.ok(h.events.some((e) => e.kind === 'screen' && e.screen.dataUrl.startsWith('data:image/png')), 'live view got a screenshot');
  const last = h.calls.filter((c) => c.llm).at(-1).llm;
  assert.equal(last[0].role, 'system');
  assert.match(last.at(-1).content, /untrusted data/);
  assert.match(JSON.stringify(last), /ref=e7/, 'the page reached the model');
});

test('a risky step waits for the user, and a "no" is respected', async () => {
  const asked = [];
  const h = harness([
    '{"action":"click","ref":"e9","target":"Place order"}',
    '{"action":"done","summary":"Stopped before ordering."}',
  ], { approve: async (req) => { asked.push(req); return false; } });
  const r = await runHandoff({ task: 'order', mode: 'browser', vision: false }, h.deps);
  assert.equal(asked.length, 1);
  assert.match(asked[0].reason, /Place order/);
  assert.equal(h.calls.filter((c) => c.browser === 'browser_click').length, 0, 'never clicked');
  assert.equal(r.steps[0].approved, false);
  assert.match(JSON.stringify(h.calls.at(-1).llm), /did NOT approve/);
  assert.equal(r.status, 'done');
});

test('an approved step runs; a blocked address never does', async () => {
  const h = harness([
    '{"action":"open_url","url":"javascript:alert(1)"}',
    '{"action":"shell","cmd":"rm -rf build"}',
    '{"action":"done","summary":"ok"}',
  ]);
  const r = await runHandoff({ task: 't', mode: 'browser', vision: false }, h.deps);
  assert.equal(h.calls.filter((c) => c.browser === 'browser_navigate').length, 0);
  assert.equal(r.steps[0].result.startsWith('Blocked'), true);
  assert.deepEqual(h.calls.filter((c) => c.shell).map((c) => c.shell), ['rm -rf build']);
  assert.equal(r.steps[1].approved, true);
});

test('ask waits for the answer and passes it on; no answer stops the run', async () => {
  const h = harness(['{"action":"ask","question":"Which colour?"}', '{"action":"done","summary":"Got blue"}']);
  const r = await runHandoff({ task: 't', mode: 'browser', vision: false }, h.deps);
  assert.equal(r.status, 'done');
  assert.match(JSON.stringify(h.calls.at(-1).llm), /The user answered: blue/);
  const h2 = harness(['{"action":"ask","question":"OTP?"}'], { answer: async () => null });
  const r2 = await runHandoff({ task: 't', mode: 'browser', vision: false }, h2.deps);
  assert.equal(r2.status, 'stopped');
  assert.match(r2.summary, /OTP/);
});

test('desktop mode starts a private screen, sends screenshots to a vision model, clicks in its pixels', async () => {
  const h = harness(['{"action":"click","x":100,"y":200,"target":"File menu"}', '{"action":"done","summary":"Opened the menu"}']);
  const r = await runHandoff({ task: 'open the file menu', mode: 'desktop', vision: true }, h.deps);
  assert.equal(r.status, 'done');
  const d = h.calls.filter((c) => c.desktop).map((c) => c.desktop.action);
  assert.deepEqual(d.slice(0, 3), ['info', 'start', 'shot']);
  assert.ok(d.includes('click'));
  assert.equal(d.at(-1), 'shot', 'looked again after acting');
  const first = h.calls.find((c) => c.llm).llm.at(-1);
  assert.ok(Array.isArray(first.content) && first.content.some((p) => p.type === 'image_url'), 'the model saw the screen');
});

test('the loop stops cleanly: bad replies, repeats, the step limit, the stop button', async () => {
  const bad = await runHandoff({ task: 't', mode: 'browser', vision: false }, harness(['hmm', 'still no', 'nope']).deps);
  assert.equal(bad.status, 'failed');
  assert.match(bad.summary, /format/);
  const same = '{"action":"scroll","direction":"down"}';
  const rep = await runHandoff({ task: 't', mode: 'browser', vision: false }, harness(Array(6).fill(same)).deps);
  assert.equal(rep.status, 'failed');
  assert.match(rep.summary, /Stuck/);
  const lim = await runHandoff({ task: 't', mode: 'browser', vision: false, maxSteps: 2 }, harness(['{"action":"snapshot"}', '{"action":"back"}', '{"action":"snapshot"}']).deps);
  assert.equal(lim.status, 'limit');
  const ctl = new AbortController();
  const h = harness(['{"action":"snapshot"}', '{"action":"snapshot"}'], { browser: async () => { ctl.abort(); return { ok: true, text: 'x' }; } });
  const st = await runHandoff({ task: 't', mode: 'browser', vision: false, signal: ctl.signal }, h.deps);
  assert.equal(st.status, 'stopped');
  const err = await runHandoff({ task: 't', mode: 'browser', vision: false }, harness([]).deps);
  assert.equal(err.status, 'failed');
});

test('a screenshot name is found in the browser’s answer', () => {
  assert.equal(screenshotName('saved — download: /v1/artifact/page-17.png)'), 'page-17.png');
  assert.equal(screenshotName('[x](a.png) — saved as shot%201.png in'), 'shot 1.png');
  assert.equal(screenshotName('no picture'), null);
});

test('Action Buttons fit the time and what the app knows', () => {
  assert.ok(CATALOG.length >= 20);
  assert.equal(new Set(CATALOG.map((b) => b.id)).size, CATALOG.length);
  const morning = suggestActions({ now: new Date('2026-11-07T08:00:00'), limit: 8 }).map((b) => b.id);
  assert.ok(morning.includes('news-brief'));
  assert.ok(!morning.includes('plan-tomorrow'));
  const evening = suggestActions({ now: new Date('2026-11-07T20:00:00'), limit: 8 }).map((b) => b.id);
  assert.ok(evening.includes('plan-tomorrow'));
  const dev = suggestActions({ now: new Date('2026-11-07T14:00:00'), memories: ['User builds Godot games and pushes to GitHub', 'uses a Vercel website'], limit: 5 }).map((b) => b.id);
  assert.ok(dev.includes('github-trending') && dev.includes('site-check'), dev.join(','));
  assert.ok(!suggestActions({}).some((b) => b.mode === 'desktop'), 'no desktop job without desktop control');
  assert.ok(suggestActions({ desktop: true, limit: 40 }).some((b) => b.mode === 'desktop'));
  const again = suggestActions({ recent: [{ task: 'check flights', mode: 'browser' }, { task: 'check flights', mode: 'browser' }] });
  assert.equal(again[0].prompt, 'check flights');
  assert.equal(again.filter((b) => b.tag === 'again').length, 1);
  const cp = CATALOG.find((b) => b.id === 'compare-prices');
  assert.ok(needsInput(cp));
  assert.equal(firstSlot(cp), 'product');
  assert.ok(!needsInput(CATALOG.find((b) => b.id === 'news-brief')));
});

test('Panels: a sandboxed document with its own storage that cannot break out', () => {
  assert.equal(extractHtml('here\n```html\n<div>hi</div>\n```'), '<div>hi</div>');
  assert.equal(extractHtml('no html'), null);
  const doc = panelDocument({ id: 'p1', html: '<html><head><title>x</title></head><body>b</body></html>', state: { note: '</script><script>alert(1)</script>' } });
  assert.match(doc, /Content-Security-Policy/);
  assert.match(doc, /default-src 'none'/);
  assert.ok(!doc.includes('</script><script>alert(1)'), 'state cannot close the script');
  assert.ok(doc.indexOf('Content-Security-Policy') < doc.indexOf('<title>'), 'CSP comes first');
  assert.match(panelDocument({ id: 'p', html: '<div>x</div>', state: {} }), /^<!doctype html><html><head>/);
  assert.equal(scriptJson('a<b'), '"a\\u003cb"');
  assert.deepEqual(acceptState({ panelSave: true, id: 'p1', state: { a: 1 } }, 'p1'), { a: 1 });
  assert.equal(acceptState({ panelSave: true, id: 'other', state: {} }, 'p1'), null);
  assert.equal(acceptState({ panelSave: true, id: 'p1', state: [1] }, 'p1'), null);
  assert.equal(acceptState({ panelSave: true, id: 'p1', state: { big: 'x'.repeat(300_000) } }, 'p1'), null);
  assert.deepEqual(nameFrom('make a gym workout log for me'), { name: 'Gym workout log', icon: '🏋️' });
  assert.equal(BUILT_IN_PANELS.length, 4);
  for (const p of BUILT_IN_PANELS) {
    assert.match(p.html, /panel\.get\(/, `${p.id} reads its data`);
    assert.match(p.html, /panel\.set\(/, `${p.id} saves its data`);
    assert.ok(!/localStorage|<script src|https?:\/\/(?!api)/.test(p.html), `${p.id} is self-contained`);
  }
});

test('desktop commands parse, and bad input is refused before anything runs', async () => {
  assert.deepEqual(parseDesktop(['click', '10', '20']), { action: 'click', args: { x: '10', y: '20' } });
  assert.deepEqual(parseDesktop(['type', 'hello', 'world']), { action: 'type', args: { text: 'hello world' } });
  assert.deepEqual(parseDesktop(['launch', 'xclock', '-digital']), { action: 'launch', args: { argv: ['xclock', '-digital'] } });
  assert.equal(parseDesktop(['help']).local, 'help');
  assert.match(parseDesktop(['fly']).error, /unknown/);
  const d = createDesktop({ outDir: mkdtempSync(path.join(tmpdir(), 'desk-')), env: {} });
  assert.match((await d.call('shot')).text, /no screen/i);
  assert.match((await d.call('click', { x: 1, y: 1 })).text, /no screen/i);
  assert.match((await d.call('fly')).text, /no screen|unknown/i);
});

const have = (bin) => { try { execFileSync('which', [bin], { stdio: 'ignore' }); return true; } catch { return false; } };
test('desktop control drives a real private screen (Xvfb + xdotool + ImageMagick)', { skip: !(have('Xvfb') && have('xdotool') && have('import')) && 'needs Xvfb, xdotool and ImageMagick' }, async () => {
  const out = mkdtempSync(path.join(tmpdir(), 'desk-'));
  const d = createDesktop({ outDir: out, env: {} });
  try {
    assert.ok((await d.call('start', { size: '1024x640' })).ok);
    const shot = await d.call('shot');
    assert.ok(shot.ok && shot.image, shot.text);
    assert.equal(shot.width, 1024);
    assert.ok((await d.call('click', { x: 20, y: 20 })).ok);
    assert.ok((await d.call('type', { text: 'hello' })).ok);
    assert.ok((await d.call('key', { key: 'ctrl+a' })).ok);
    assert.equal((await d.call('key', { key: 'ctrl+a; rm -rf' })).ok, false, 'shell characters in a key are refused');
    assert.equal((await d.call('launch', { argv: ['sh', '-c', 'echo $(id)'] })).ok, false, 'no shell tricks in launch');
    assert.equal((await d.call('click', { x: 'abc', y: 1 })).ok, false);
    assert.equal((await d.call('type', { text: 'x'.repeat(2001) })).ok, false);
  } finally {
    await d.close();
  }
});

// ── secure vault ────────────────────────────────────────────────────────────
import { createVault, describeForAgent, findByRef, fieldValue, hostMatches, openVault, redact, refOf, sealWith, urlIn, validateItem } from '../src/lib/handoff/vault.ts';
import { canRemember } from '../src/lib/handoff/actions.ts';

const ITEMS = [
  { id: 'a', kind: 'login', label: '', site: 'amazon.in', username: 'me@mail.com', password: 'S3cret!pass' },
  { id: 'b', kind: 'card', label: 'HDFC Visa', name: 'Tejas', number: '4111 1111 1111 1111', expiry: '08/29', cvv: '123' },
  { id: 'c', kind: 'identity', label: 'Home', fullName: 'Tejas Singh', email: 't@x.in', phone: '9876543210', address: '12 MG Road', city: 'Pune', pincode: '411001' },
];

test('the vault is encrypted with the PIN and a wrong PIN cannot open it', async () => {
  const { sealed, key, salt } = await createVault('246810', { items: ITEMS }, 2000);
  const raw = JSON.stringify(sealed);
  for (const secret of ['S3cret!pass', '4111', 'me@mail.com', '9876543210']) assert.ok(!raw.includes(secret), `${secret} is not stored in the clear`);
  assert.equal((await openVault(sealed, '246810')).data.items.length, 3);
  await assert.rejects(openVault(sealed, '246811'), /Wrong PIN/);
  const again = await sealWith(key, salt, { items: ITEMS.slice(0, 1) }, 2000);
  assert.notEqual(again.iv, sealed.iv, 'a fresh IV every save');
  assert.equal((await openVault(again, '246810')).data.items.length, 1);
  await assert.rejects(createVault('123', undefined, 2000), /at least 6/);
});

test('the agent sees names and fields, never a value; the phishing guard matches real sites only', () => {
  const d = describeForAgent(ITEMS, ['otp']);
  assert.match(d, /login:amazon — login for amazon\.in/);
  assert.match(d, /card:hdfc-visa — card “HDFC Visa” ending 1111/);
  assert.match(d, /identity:home/);
  assert.match(d, /once:otp/);
  for (const v of ['S3cret!pass', 'me@mail.com', '4111 1111', '123', '9876543210', '12 MG Road']) assert.ok(!d.includes(v), v);
  assert.equal(refOf(ITEMS[0], ITEMS), 'login:amazon');
  assert.equal(findByRef('LOGIN:amazon', ITEMS)?.id, 'a');
  assert.equal(fieldValue(ITEMS[0], 'password'), 'S3cret!pass');
  assert.equal(fieldValue(ITEMS[0], 'cvv'), null);
  assert.ok(hostMatches('www.amazon.in', 'amazon.in'));
  assert.ok(hostMatches('pay.amazon.in', 'https://www.amazon.in/'));
  assert.ok(!hostMatches('amazon.in.evil.com', 'amazon.in'));
  assert.ok(!hostMatches('notamazon.in', 'amazon.in'));
  assert.equal(urlIn('### Result\n"https://www.amazon.in/ap/signin?x=1"'), 'https://www.amazon.in/ap/signin?x=1');
  assert.equal(redact('card 4111-1111-1111-1111 and 4111111111111111 and pw S3cret!pass', ['4111 1111 1111 1111', 'S3cret!pass']), 'card •••• and •••• and pw ••••');
  assert.equal(validateItem({ ...ITEMS[1], number: '12' }), 'The card number looks wrong.');
  assert.equal(validateItem(ITEMS[0]), null);
  assert.equal(canRemember({ type: 'click', ref: 'e1', target: 'Sign in' }), true);
  assert.equal(canRemember({ type: 'click', ref: 'e1', target: 'Place order' }), false);
  assert.equal(canRemember({ type: 'shell', cmd: 'ls' }), false);
});

function vaultHarness(replies, { host = 'https://www.amazon.in/ap/signin', approve = async () => true, ask = async () => ['once:otp'] } = {}) {
  const typed = [];
  const asked = [];
  const access = {
    info: () => describeForAgent(ITEMS, ['otp']),
    get: (ref, field) => {
      if (ref === 'once:otp' && field === 'value') return { value: '482913', kind: 'once', label: 'otp' };
      const it = findByRef(ref, ITEMS); const v = it && fieldValue(it, field);
      return v ? { value: v, kind: it.kind, site: it.kind === 'login' ? it.site : undefined, label: it.label || it.site } : null;
    },
    ask: async (req) => { asked.push(req); return ask(req); },
  };
  const h = harness(replies, {
    browser: async (tool, args) => {
      if (tool === 'browser_evaluate') return { ok: true, text: `### Result\n"${host}"` };
      if (tool === 'browser_type') { typed.push(args.text); return { ok: true, text: `- textbox "Password": ${args.text}\n- button "Sign in" [ref=e9]` }; }
      return { ok: true, text: '- page' };
    },
    approve,
    vault: access,
  });
  return { ...h, typed, asked };
}

test('fill_secret types the real value on the right site and the model never sees it', async () => {
  const approvals = [];
  const v = vaultHarness([
    '{"action":"fill_secret","ref":"e5","secret":"login:amazon","field":"password","target":"Password"}',
    '{"action":"snapshot"}',
    '{"action":"done","summary":"Signed in"}',
  ], { approve: async (r) => { approvals.push(r); return true; } });
  const r = await runHandoff({ task: 'sign in to amazon', mode: 'browser', vision: true }, v.deps);
  assert.equal(r.status, 'done');
  assert.deepEqual(v.typed, ['S3cret!pass'], 'the page got the password');
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].host, 'www.amazon.in');
  assert.equal(approvals[0].rememberable, true);
  const everything = JSON.stringify(v.calls.filter((c) => c.llm)) + JSON.stringify(v.events) + JSON.stringify(r.steps);
  assert.ok(!everything.includes('S3cret!pass'), 'the password never reached the model, the events or the history');
  assert.match(JSON.stringify(v.calls.filter((c) => c.llm)[0].llm[0]), /login:amazon/, 'the model was told the vault names');
});

test('the phishing guard refuses a login on the wrong site, and http pages get nothing', async () => {
  const v = vaultHarness(['{"action":"fill_secret","ref":"e5","secret":"login:amazon","field":"password"}', '{"action":"done","summary":"x"}'], { host: 'https://amazon.in.evil.com/login' });
  const r = await runHandoff({ task: 't', mode: 'browser', vision: false }, v.deps);
  assert.deepEqual(v.typed, []);
  assert.match(r.steps[0].result, /evil\.com/);
  const v2 = vaultHarness(['{"action":"fill_secret","ref":"e5","secret":"card:hdfc-visa","field":"number"}', '{"action":"done","summary":"x"}'], { host: 'http://shop.example.com/pay' });
  const r2 = await runHandoff({ task: 't', mode: 'browser', vision: false }, v2.deps);
  assert.deepEqual(v2.typed, []);
  assert.match(r2.steps[0].result, /not https/);
  const v3 = vaultHarness(['{"action":"fill_secret","ref":"e5","secret":"card:hdfc-visa","field":"number"}', '{"action":"done","summary":"x"}'], { host: 'https://shop.example.com/pay', approve: async () => false });
  await runHandoff({ task: 't', mode: 'browser', vision: false }, v3.deps);
  assert.deepEqual(v3.typed, [], 'a card is never filled without a yes');
});

test('request_secret opens the secure form; the code is filled without the model seeing it', async () => {
  const v = vaultHarness([
    '{"action":"request_secret","fields":["otp"],"why":"Amazon sent a code","site":"amazon.in"}',
    '{"action":"fill_secret","ref":"e7","secret":"once:otp","field":"value","target":"Code"}',
    '{"action":"done","summary":"Verified"}',
  ]);
  const r = await runHandoff({ task: 't', mode: 'browser', vision: false }, v.deps);
  assert.equal(r.status, 'done');
  assert.equal(v.asked[0].why, 'Amazon sent a code');
  assert.deepEqual(v.typed, ['482913']);
  assert.ok(!JSON.stringify(v.calls.filter((c) => c.llm)).includes('482913'));
  const closed = vaultHarness(['{"action":"request_secret","fields":["otp"],"why":"x"}', '{"action":"done","summary":"ok"}'], { ask: async () => null });
  const r2 = await runHandoff({ task: 't', mode: 'browser', vision: false }, closed.deps);
  assert.match(r2.steps[0].result, /closed/);
  assert.match(parseStep('{"action":"fill_secret","ref":"e1","secret":"login:x"}', 'browser').error, /field/);
  assert.match(parseStep('{"action":"fill_secret","ref":"e1","secret":"a","field":"b"}', 'desktop').error, /not an action in desktop/);
  assert.match(systemPrompt('desktop'), /Take over and type it themselves/);
});

// ── specialties, schedules, remembered approvals, chat handover ─────────────
import { describeSchedule, guideOf, isAllowed, isDue, lastSlot, nextRun, parseHandoffCommand, queueHandoff, specialtyFromRun, takeQueued } from '../src/lib/handoff/specialties.ts';

test('a finished run becomes a Specialty that guides the next run', async () => {
  const sp = specialtyFromRun({ task: 'Check my electricity bill on the MSEB site', mode: 'browser', steps: [{ label: 'Open mahadiscom.in', ok: true }, { label: 'Read the page', ok: true }, { label: 'Click Pay bill', ok: false }, { label: 'Click View bill', ok: true }, { label: 'Wait 2s', ok: true }, { label: 'Finished', ok: true }] }, '', 1);
  assert.deepEqual(sp.steps, ['Open mahadiscom.in', 'Click View bill']);
  assert.equal(sp.name, 'Check my electricity bill on');
  assert.equal(guideOf(sp), '1. Open mahadiscom.in\n2. Click View bill');
  const h = harness(['{"action":"done","summary":"ok"}']);
  await runHandoff({ task: sp.task, mode: 'browser', vision: false, guide: guideOf(sp) }, h.deps);
  assert.match(h.calls[0].llm[0].content, /A way that worked for this job before[\s\S]*Click View bill/);
});

test('schedules run once per slot, on the right days, and not when missed long ago', () => {
  const base = { id: 's', task: 'news', mode: 'browser', on: true, createdAt: new Date('2026-11-01T00:00:00').getTime() };
  const daily = { ...base, every: 'day', time: '08:30' };
  assert.equal(isDue(daily, new Date('2026-11-07T08:29:00')), false);
  assert.equal(isDue(daily, new Date('2026-11-07T08:31:00')), true);
  assert.equal(isDue({ ...daily, lastRun: new Date('2026-11-07T08:31:00').getTime() }, new Date('2026-11-07T09:00:00')), false, 'not twice');
  assert.equal(isDue(daily, new Date('2026-11-07T20:00:00')), false, 'missed by hours: skipped');
  assert.equal(isDue({ ...daily, on: false }, new Date('2026-11-07T08:31:00')), false);
  const wk = { ...base, every: 'weekday', time: '09:00' };
  assert.equal(isDue(wk, new Date('2026-11-07T09:05:00')), false, '7 Nov 2026 is a Saturday');
  assert.equal(isDue(wk, new Date('2026-11-09T09:05:00')), true);
  const weekly = { ...base, every: 'week', weekday: 0, time: '10:00' };
  assert.equal(nextRun(weekly, new Date('2026-11-07T12:00:00')).toDateString(), new Date('2026-11-08T10:00:00').toDateString());
  assert.equal(lastSlot({ ...daily, time: '25:00' }, new Date()), null);
  assert.equal(describeSchedule(wk), 'Mon–Fri at 09:00');
});

test('allowed steps stay on their site; a job from the chat is handed over once', () => {
  const rules = [{ host: 'github.com', kind: 'click', createdAt: 0 }];
  assert.ok(isAllowed(rules, 'github.com', 'click'));
  assert.ok(isAllowed(rules, 'gist.github.com', 'click'));
  assert.ok(!isAllowed(rules, 'github.com.evil.io', 'click'));
  assert.ok(!isAllowed(rules, 'github.com', 'type'));
  assert.ok(!isAllowed(rules, undefined, 'click'));
  assert.deepEqual(parseHandoffCommand('/handoff compare prices of AirPods'), { task: 'compare prices of AirPods' });
  assert.deepEqual(parseHandoffCommand('/handoff'), { task: '' });
  assert.equal(parseHandoffCommand('/handoffs x'), null);
  assert.equal(parseHandoffCommand('please handoff'), null);
  queueHandoff('book nothing, just look', 'browser');
  assert.deepEqual(takeQueued(), { task: 'book nothing, just look', mode: 'browser' });
  assert.equal(takeQueued(), null);
});
