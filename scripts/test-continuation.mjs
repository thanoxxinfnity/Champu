/** node --experimental-strip-types --test scripts/test-continuation.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isTruncated, planContinuation } from '../src/lib/agent/continuation.ts';
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
