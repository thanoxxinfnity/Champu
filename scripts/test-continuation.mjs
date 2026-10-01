/** node --experimental-strip-types --test scripts/test-continuation.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isTruncated, planContinuation, planNudge } from '../src/lib/agent/continuation.ts';
import { extractArtifacts, filesOf, splitAtOpenBlock } from '../src/lib/agent/artifacts.ts';

test('every provider spelling of "hit the output limit" counts as truncated', () => {
  for (const reason of ['length', 'max_tokens', 'MAX_TOKENS', 'max_output_tokens', 'MaxTokens']) {
    assert.equal(isTruncated(reason), true, reason);
  }
});

test('a normal finish, a missing reason, and a content filter do not', () => {
  for (const reason of ['stop', 'end_turn', 'STOP', 'tool_calls', 'content_filter', '', undefined]) {
    assert.equal(isTruncated(reason), false, String(reason));
  }
});

const cutOff = [
  'Here is the game.',
  '',
  '```text path=project.godot',
  'config_version=5',
  '```',
  '',
  '```gdscript path=scripts/player.gd',
  'extends CharacterBody3D',
  'func _physics_process(delta):',
  '\tvelocity.y -= 9.8 * del',
].join('\n');

test('the unfinished block is found, named and removed from what is kept', () => {
  const split = splitAtOpenBlock(cutOff);
  assert.equal(split?.openPath, 'scripts/player.gd');
  assert.ok(split?.complete.includes('project.godot'));
  assert.ok(!split?.complete.includes('player.gd'));
  // What is kept parses to finished blocks only.
  assert.ok(filesOf(extractArtifacts(split.complete)).every((f) => f.complete));
});

test('text that ends outside any block has nothing to recover', () => {
  assert.equal(splitAtOpenBlock('```text path=a.txt\nhi\n```\nAnd that is all.'), null);
});

test('a longer closing fence and a nested shorter one are handled like the parser does', () => {
  const nested = '````md path=README.md\n```js\ncode\n```\nmore\n````\n\n```ts path=a.ts\nconst x =';
  const split = splitAtOpenBlock(nested);
  assert.equal(split?.openPath, 'a.ts');
  assert.ok(split?.complete.includes('README.md'));
});

test('the continuation names the cut-off file and forbids repeating finished ones', () => {
  const plan = planContinuation(cutOff);
  assert.ok(plan);
  assert.equal(plan.openPath, 'scripts/player.gd');
  assert.match(plan.prompt, /scripts\/player\.gd/);
  assert.match(plan.prompt, /Do not repeat files that were already completed/);
});

test('no continuation when not one block finished — another pass would only start over', () => {
  assert.equal(planContinuation('```gdscript path=a.gd\nextends Node\nfunc _rea'), null);
  assert.equal(planContinuation(''), null);
});

// ── A reply that announces a file and stops ─────────────────────────────────

const announcedOnly = [
  'Building a scroll-driven Minecraft world in three.js: voxel terrain, a blocky player with a walk cycle.',
  '',
  'Creating `index.html` — the page shell, import map for three.js, and the HUD overlay.',
].join('\n');

test('a reply that names a file and then ends is nudged to write it', () => {
  const plan = planNudge(announcedOnly);
  assert.ok(plan);
  assert.equal(plan.openPath, 'index.html');
  assert.match(plan.prompt, /named `index\.html` but never wrote it/);
  assert.match(plan.prompt, /only reply you get/);
  assert.equal(plan.kept, announcedOnly);
});

test('a reply that already contains a block is not nudged', () => {
  assert.equal(planNudge('Creating `a.txt`.\n\n```text path=a.txt\nhi\n```'), null);
  // An unfinished block still counts: that is a continuation, not a nudge.
  assert.equal(planNudge('Creating `a.txt`.\n\n```text path=a.txt\nhi'), null);
});

test('a reply that ends on a question to the user is left alone', () => {
  assert.equal(planNudge('Which engine do you want for `game.js`, Phaser or plain canvas?'), null);
});

test('with no file named it still asks for the files, without inventing a name', () => {
  const plan = planNudge('I will build the whole thing as a single page with animation.');
  assert.ok(plan);
  assert.equal(plan.openPath, undefined);
  assert.match(plan.prompt, /never wrote a file/);
});
