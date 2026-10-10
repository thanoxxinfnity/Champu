/** node --experimental-strip-types --test scripts/test-pipeline.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { wantsPonytail, PONYTAIL_RULE } from '../src/lib/pipeline/ponytail.ts';
import { parseReview, renderReview, reviewPrompt, selectFiles, sure } from '../src/lib/pipeline/review.ts';
import { detectProject, fromFile, projectLine, toFile } from '../src/lib/pipeline/memory-file.ts';
import { parsePipeline } from '../src/lib/pipeline/commands.ts';
import { parsePlan } from '../src/lib/agent/planner.ts';
import { buildSystemPrompt } from '../src/lib/agent/system-prompt.ts';
import { makeMemory } from '../src/lib/memory/memory.ts';

test('ponytail applies to edits of existing work, not to a fresh build', () => {
  assert.equal(wantsPonytail('fix the login bug', 0), false);
  assert.equal(wantsPonytail('build me a todo app', 5), false);
  assert.equal(wantsPonytail('is button ko theek karo', 5), true);
  assert.equal(wantsPonytail('refactor the header and add a feature', 3), true);
  assert.match(PONYTAIL_RULE, /PONYTAIL/);
});

test('the planner keeps up to four edge cases and drops junk', () => {
  const raw = JSON.stringify({ goal: 'g', tasks: [{ title: 'a', kind: 'codegen' }], edgeCases: ['empty input', 7, '', 'offline', 'a', 'x'.repeat(300), 'five', 'six'] });
  const plan = parsePlan(raw, 'g');
  assert.equal(plan.edgeCases.length, 4);
  assert.ok(plan.edgeCases.every((e) => e.length <= 120));
  assert.equal(parsePlan(JSON.stringify({ tasks: [{ title: 'a' }] }), 'g').edgeCases, undefined);
});

test('the prompt carries ponytail and edge cases only when given', () => {
  const plain = buildSystemPrompt({ lane: 'B' });
  assert.ok(!plain.includes('PONYTAIL') && !plain.includes('EDGE CASES'));
  const full = buildSystemPrompt({ lane: 'B', ponytail: PONYTAIL_RULE, edgeCases: ['empty list'] });
  assert.ok(full.includes('PONYTAIL') && full.includes('- empty list'));
});

test('review: only findings at 80% or more are shown, once each, sure ones first', () => {
  const raw = '```json\n' + JSON.stringify({ findings: [
    { check: 'bugs', file: 'a.js', line: 3, issue: 'off by one in loop', confidence: 90, fix: 'use <' },
    { check: 'bugs', file: 'a.js', line: 3, issue: 'Off by one in loop', confidence: 85 },
    { check: 'style', file: 'a.js', issue: 'name could be better', confidence: 40 },
    { check: 'nonsense', file: 'a.js', issue: 'x', confidence: 99 },
    { check: 'security', file: 'b.js', issue: 'key in source', confidence: 95 },
    { check: 'comments', file: 'b.js', issue: 'no number', confidence: 'high' },
  ] }) + '\n```';
  const all = parseReview(raw);
  assert.equal(all.length, 4);
  const shown = sure(all);
  assert.deepEqual(shown.map((f) => f.confidence), [95, 90]);
  const text = renderReview(all, 2);
  assert.match(text, /2 issues/);
  assert.match(text, /key in source/);
  assert.ok(!text.includes('name could be better'));
  assert.match(renderReview([], 1), /nothing I am 80% sure of/);
  assert.deepEqual(parseReview('not json'), []);
});

test('review reads code first, skips binaries and locks, and stays in budget', () => {
  const files = [
    { path: 'package-lock.json', content: 'x'.repeat(100) },
    { path: 'logo.png', content: 'binary' },
    { path: 'notes.txt', content: 'hello' },
    { path: 'src/app.ts', content: 'export const a = 1;' },
    { path: 'huge.js', content: 'y'.repeat(60000) },
  ];
  const picked = selectFiles(files, 20000);
  assert.ok(picked.some((f) => f.path === 'src/app.ts'));
  assert.ok(!picked.some((f) => /lock|png/.test(f.path)));
  assert.ok(picked.reduce((n, f) => n + f.content.length, 0) <= 20000);
  assert.equal(picked[0].path, 'src/app.ts');
  const p = reviewPrompt(picked);
  assert.match(p.system, /80/);
  assert.match(p.user, /### src\/app\.ts/);
});

test('the memory file round-trips and refuses garbage', () => {
  const m = makeMemory({ text: 'prefers Hinglish replies', kind: 'preference', tags: [] }, { now: 5, pinned: true });
  const project = detectProject(['project.godot', 'scripts/a.gd', 'node_modules/x/package.json', 'index.html']);
  assert.deepEqual(project.stack, ['GDScript', 'Godot']);
  assert.equal(project.files, 3);
  const back = fromFile(toFile([m], project, 9));
  assert.equal(back.memories[0].text, 'prefers Hinglish replies');
  assert.equal(back.updatedAt, 9);
  assert.equal(fromFile('nope'), null);
  assert.equal(fromFile('{"version":2,"memories":[]}'), null);
  assert.equal(fromFile('{"version":1,"memories":[{"id":1}]}').memories.length, 0);
  assert.match(projectLine(project), /Godot/);
  assert.equal(projectLine({ stack: [], files: 0 }), '');
});

test('/review and /pipeline are read from what is typed', () => {
  assert.deepEqual(parsePipeline('/review'), { kind: 'review' });
  assert.deepEqual(parsePipeline('/pipeline'), { kind: 'status' });
  assert.deepEqual(parsePipeline('/pipeline off review'), { kind: 'set', step: 'review', on: false });
  assert.deepEqual(parsePipeline('/pipeline on all'), { kind: 'set', step: 'all', on: true });
  assert.deepEqual(parsePipeline('/pipeline off memory'), { kind: 'set', step: 'memfile', on: false });
  assert.equal(parsePipeline('review my code please'), null);
});
