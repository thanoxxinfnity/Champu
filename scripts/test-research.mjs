/** node --experimental-strip-types --test scripts/test-research.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatResearch, needsResearch, planResearch, runResearch, summarizeResearch } from '../src/lib/agent/research.ts';
import { buildSystemPrompt } from '../src/lib/agent/system-prompt.ts';

const answer = (tag) => ({
  context: `[1] ${tag} page\nGodot 4.7.2 is the current stable release.`,
  sources: [{ n: 1, url: `https://example.org/${tag}`, title: `${tag} page` }],
  stats: { pagesFetched: 3 },
});

test('builds are researched; chat, slash commands and tiny messages are not', () => {
  assert.equal(needsResearch('build me a zombie survival game with guns', 'godot', 'B'), true);
  assert.equal(needsResearch('make an android todo app', 'android', 'B'), true);
  assert.equal(needsResearch('what is a linked list', 'chat', 'A'), false);
  assert.equal(needsResearch('explain recursion to me please', 'chat', 'A'), false);
  assert.equal(needsResearch('/research godot', 'godot', 'B'), false);
  assert.equal(needsResearch('hi', 'godot', 'B'), false);
});

test('the plan always checks the engine version for a Godot build, and caps at three searches', () => {
  const plan = planResearch('Build a Walking Zombie 2 style game using Microsoft TRELLIS models', 'godot', 2026);
  assert.ok(plan.length >= 2 && plan.length <= 3, `got ${plan.length}`);
  assert.ok(plan[0].query.includes('Godot Engine latest stable release version 2026'));
  assert.ok(plan.some((q) => /TRELLIS/.test(q.query)), 'the thing the user named is searched');
  assert.ok(plan.every((q) => q.why && q.query.length <= 170));
});

test('android and minecraft builds check their own moving targets', () => {
  assert.match(planResearch('make a todo app', 'android', 2026)[0].query, /Android Gradle Plugin/);
  // The authoritative page is read directly: search engines answer these with generic pages.
  assert.deepEqual(planResearch('make a todo app', 'android', 2026)[0].urls, ['https://developer.android.com/build/releases/gradle-plugin']);
  assert.deepEqual(planResearch('zombie game', 'godot', 2026)[0].urls, ['https://github.com/godotengine/godot/releases']);
  assert.match(planResearch('make an addon', 'minecraft', 2026)[0].query, /Bedrock/);
});

test('runResearch runs searches in parallel, keeps the hits and reports the misses', async () => {
  const seen = [];
  const report = await runResearch(
    [
      { why: 'a', query: 'q-a' },
      { why: 'b', query: 'q-b-empty' },
      { why: 'c', query: 'q-c-throws' },
    ],
    async ({ query }) => {
      seen.push(query);
      if (query === 'q-b-empty') return { context: '   ' };
      if (query === 'q-c-throws') throw new Error('network down');
      return answer('a');
    },
    { now: 1 },
  );
  assert.equal(seen.length, 3);
  assert.equal(report.findings.length, 1);
  assert.deepEqual(report.missed.sort(), ['q-b-empty', 'q-c-throws']);
  assert.equal(report.pagesRead, 3);
});

test('authoritative urls are passed to the route so it reads them instead of searching', async () => {
  let body;
  await runResearch([{ why: 'v', query: 'u-q', urls: ['https://example.org/releases'] }], async (b) => ((body = b), answer('u')), { now: 40 });
  assert.deepEqual(body.urls, ['https://example.org/releases']);
  await runResearch([{ why: 'v', query: 'no-urls' }], async (b) => ((body = b), answer('n')), { now: 41 });
  assert.equal('urls' in body, false);
});

test('a hung search cannot hold a build hostage', async () => {
  const t0 = Date.now();
  const report = await runResearch([{ why: 'x', query: 'q-hang' }], () => new Promise(() => {}), { timeoutMs: 80, now: 2 });
  assert.ok(Date.now() - t0 < 1000);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.missed, ['q-hang']);
});

test('a repeated question inside a session is answered from memory, not the network', async () => {
  let calls = 0;
  const post = async () => (calls += 1, answer('memo'));
  await runResearch([{ why: 'v', query: 'memo-q' }], post, { now: 10 });
  await runResearch([{ why: 'v', query: 'memo-q' }], post, { now: 20 });
  assert.equal(calls, 1);
});

test('the prompt block tells the model the pages outrank its memory, and what it could not check', async () => {
  const report = await runResearch(
    [{ why: 'current Godot version', query: 'ok-q' }, { why: 'x', query: 'bad-q' }],
    async ({ query }) => (query === 'ok-q' ? answer('ok') : null),
    { now: 30 },
  );
  const block = formatResearch(report);
  assert.match(block, /overrides what you remember/);
  assert.match(block, /Godot 4\.7\.2/);
  assert.match(block, /https:\/\/example\.org\/ok/);
  assert.match(block, /Could NOT be checked.*bad-q/);
  assert.match(summarizeResearch(report), /Researched before building.*example\.org/);
  assert.equal(summarizeResearch({ findings: [], missed: ['z'], pagesRead: 0 }), '');
});

test('research reaches the system prompt, and replaces the thin snippet search when both exist', () => {
  const research = { findings: [{ query: 'q', why: 'engine', context: 'ENGINE-FACT-XYZ', sources: [] }], missed: [], pagesRead: 1 };
  const liveSearch = { query: 'q', hits: [{ url: 'https://s', title: 'SNIPPET-TITLE', snippet: '' }], provider: 'p', attempts: '' };
  const withBoth = buildSystemPrompt({ lane: 'B', suite: 'godot', research, liveSearch, bridgeStatus: 'offline' });
  assert.match(withBoth, /ENGINE-FACT-XYZ/);
  assert.doesNotMatch(withBoth, /SNIPPET-TITLE/);
  const onlySnippets = buildSystemPrompt({ lane: 'B', suite: 'godot', liveSearch, bridgeStatus: 'offline' });
  assert.match(onlySnippets, /SNIPPET-TITLE/);
});

test('the bridge reads the installed Godot version instead of leaving it to memory', () => {
  const agent = readFileSync(new URL('../agent/chomugiri-agent.mjs', import.meta.url), 'utf8');
  assert.match(agent, /godot: probe\(`godot --version/);
  const runtime = readFileSync(new URL('../src/lib/agent/runtime.ts', import.meta.url), 'utf8');
  assert.match(runtime, /godot: \$\{heartbeat\.health\.toolchains\.godot/);
});
