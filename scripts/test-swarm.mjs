/** node --experimental-strip-types --test scripts/test-swarm.mjs — the Swarm engine with a fake model. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractArtifacts, commandsOf, filesOf } from '../src/lib/agent/artifacts.ts';
import { batchModules, bracketBalance, parseArchitecture, parseReview, runSwarm, staticCheck } from '../src/lib/agent/swarm.ts';

const ARCH = JSON.stringify({
  summary: 'A tiny counter module and the page that uses it.',
  modules: [
    { path: 'src/counter.js', purpose: 'counts', uses: [] },
    { path: 'src/page.js', purpose: 'shows the count', uses: ['src/counter.js'] },
    { path: '../evil.js', purpose: 'bad path', uses: [] },
  ],
  notes: ['export named functions'],
});

test('the architecture is read from JSON, bad paths dropped, order kept', () => {
  const a = parseArchitecture('```json\n' + ARCH + '\n```');
  assert.deepEqual(a.modules.map((m) => m.path), ['src/counter.js', 'src/page.js']);
  assert.deepEqual(a.modules[1].uses, ['src/counter.js']);
  assert.equal(parseArchitecture('not json'), null);
  assert.equal(parseArchitecture('{"modules":[]}'), null);
  assert.deepEqual(batchModules([1, 2, 3, 4, 5].map((n) => ({ path: `f${n}`, purpose: '', uses: [] })), 2).map((b) => b.length), [2, 2, 1]);
});

test('a review is read, an unreadable one blocks nothing', () => {
  const r = parseReview('{"ok":false,"issues":[{"path":"a.js","problem":"calls missing fn","fix":"define it"},{"path":"","problem":"x"}]}');
  assert.equal(r.ok, false);
  assert.equal(r.issues.length, 1);
  assert.deepEqual(parseReview('garbage'), { ok: true, issues: [] });
});

test('local checks: cut-off files, placeholders, bad JSON, mixed indentation', () => {
  assert.match(bracketBalance('a.js', 'function f() {\n  if (x) {\n'), /unclosed/);
  assert.equal(bracketBalance('a.js', 'const s = "}{"; // ) \nfunction f() { return [1, (2)]; }\n'), null);
  assert.match(bracketBalance('a.ts', 'let a = (1];'), /unbalanced/);
  assert.ok(staticCheck('a.js', 'function f() {\n  // ... rest unchanged\n}').some((p) => /placeholder/.test(p)));
  assert.ok(staticCheck('a.json', '{"a":').some((p) => /not valid JSON/.test(p)));
  assert.ok(staticCheck('a.py', 'def f():\n\t  return 1\n').some((p) => /tabs and spaces/.test(p)));
  assert.deepEqual(staticCheck('ok.js', 'export const a = 1;\n'), []);
  assert.deepEqual(staticCheck('a.md', 'text ( with an open paren'), [], 'prose is not checked');
});

function fake(script) {
  const calls = [];
  return {
    calls,
    ask: async (role, system, user, opts) => {
      calls.push({ role, user, opts });
      const next = script[role]?.shift();
      if (next === undefined) throw new Error(`no scripted ${role} reply`);
      return typeof next === 'function' ? next(user) : next;
    },
  };
}

test('architect → coder (two batches) → reviewer finds a problem → coder fixes with an edit → clean review → one reply', async () => {
  const lines = [];
  const steps = [];
  const model = fake({
    architect: [ARCH],
    coder: [
      '```js path=src/counter.js\nexport function inc(n) {\n  return n + 1;\n}\n```',
      '```js path=src/page.js\nimport { inc } from "./counter.js";\nexport function show() {\n  return inc(0\n}\n```\n```bash path=@terminal\nnode src/page.js\n```',
      '<<<<<<< SEARCH path=src/page.js\n  return inc(0\n=======\n  return inc(0);\n>>>>>>> REPLACE',
    ],
    reviewer: ['{"ok":true,"issues":[]}', '{"ok":true,"issues":[]}'],
  });
  const r = await runSwarm('build a counter', { ...model, log: (l) => lines.push(l), step: (role, st) => steps.push(`${role}:${st}`), files: () => [] }, { batchSize: 1 });
  assert.deepEqual(r.changed.sort(), ['src/counter.js', 'src/page.js']);
  assert.equal(r.issues.length, 0);
  assert.equal(r.rounds, 2, 'the local check found the cut-off call in round 1, the second round came back clean');
  // the reply is one the runtime already understands
  const art = extractArtifacts(r.content, { shellRuns: false });
  const files = Object.fromEntries(filesOf(art).map((f) => [f.path, f.content]));
  assert.match(files['src/page.js'], /return inc\(0\);/);
  assert.deepEqual(commandsOf(art).map((c) => c.command), ['node src/page.js']);
  assert.match(r.content, /^A tiny counter module/);
  // clean, ordered progress
  assert.match(lines[0], /^\[1\/4\] Architect/);
  assert.ok(lines.some((l) => /^\[2\/4\] Coder · batch 2\/2/.test(l)));
  assert.ok(lines.some((l) => /^\[3\/4\] Reviewer ✗ 1 issue: src\/page\.js — unbalanced/.test(l)));
  assert.match(lines[lines.length - 1], /^\[4\/4\] Orchestrator · 2 files in sync/);
  assert.ok(steps.includes('architect:done') && steps.includes('coder:done') && steps.includes('reviewer:done') && steps.includes('orchestrator:done'));
  // only the last batch was told it may give commands
  const coderCalls = model.calls.filter((c) => c.role === 'coder');
  assert.match(coderCalls[0].user, /Write no commands in this batch/);
  assert.match(coderCalls[1].user, /last batch/);
});

test('without a usable plan the Coder works from the task alone', async () => {
  const model = fake({ architect: ['sorry, here is some prose'], coder: ['```js path=a.js\nexport const a = 1;\n```'], reviewer: ['{"ok":true,"issues":[]}'] });
  const lines = [];
  const r = await runSwarm('make a', { ...model, log: (l) => lines.push(l), files: () => [] });
  assert.deepEqual(r.changed, ['a.js']);
  assert.equal(r.architecture, null);
  assert.ok(lines.some((l) => /batch 1\/1: the whole task/.test(l)));
});

test('edits that do not match are asked for again with the reason', async () => {
  const model = fake({
    architect: [JSON.stringify({ summary: 's', modules: [{ path: 'a.js', purpose: 'p', uses: [] }], notes: [] })],
    coder: [
      '<<<<<<< SEARCH path=a.js\nconst nope = 1;\n=======\nconst yes = 1;\n>>>>>>> REPLACE',
      (user) => (/did not apply/.test(user) ? '<<<<<<< SEARCH path=a.js\nconst x = 1;\n=======\nconst y = 1;\n>>>>>>> REPLACE' : 'WRONG'),
    ],
    reviewer: ['{"ok":true,"issues":[]}'],
  });
  const r = await runSwarm('rename x', { ...model, log: () => {}, files: () => [{ path: 'a.js', content: 'const x = 1;\n' }] });
  assert.match(r.content, /const y = 1;/);
  assert.deepEqual(r.changed, ['a.js']);
});

test('a reviewer that errors does not stop the run; open problems are reported honestly', async () => {
  const model = fake({
    architect: [JSON.stringify({ summary: 's', modules: [{ path: 'a.js', purpose: 'p', uses: [] }], notes: [] })],
    coder: ['```js path=a.js\nfunction f( {\n```', '```js path=a.js\nfunction f( {\n```'],
    reviewer: [() => { throw new Error('model down'); }, () => { throw new Error('model down'); }],
  });
  const r = await runSwarm('x', { ...model, log: () => {}, files: () => [] });
  assert.ok(r.issues.length >= 1);
  assert.match(r.content, /Reviewer notes still open:/);
});

test('Stop ends the run at the next step and keeps what exists', async () => {
  const ctl = new AbortController();
  const model = fake({
    architect: [() => { ctl.abort(); return ARCH; }],
    coder: [],
    reviewer: [],
  });
  const r = await runSwarm('x', { ...model, log: () => {}, files: () => [], signal: ctl.signal });
  assert.equal(r.aborted, true);
});

test('the runtime runs the swarm only for a build, with the switch on and the button armed, and the Settings tab and dock chip exist', () => {
  const rt = readFileSync(new URL('../src/lib/agent/runtime.ts', import.meta.url), 'utf8');
  assert.match(rt, /runSwarm\(/);
  assert.match(rt, /swarmEngine && .*swarmArmed|swarmArmed && .*swarmEngine/);
  const st = readFileSync(new URL('../src/lib/store.ts', import.meta.url), 'utf8');
  assert.match(st, /swarmEngine: boolean/);
  assert.match(st, /getSetting<boolean>\('swarmEngine', false\)/);
  const settings = readFileSync(new URL('../src/components/Settings.tsx', import.meta.url), 'utf8');
  assert.match(settings, /\{ id: 'tools', label: 'Tools' \}/);
  const dock = readFileSync(new URL('../src/components/CommandDock.tsx', import.meta.url), 'utf8');
  assert.match(dock, /data-testid="swarm-chip"/);
});
