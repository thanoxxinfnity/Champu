/**
 * Guards the two things that made the model switcher a minefield.
 *
 *   node --experimental-strip-types --test scripts/test-models.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isUnserved,
  isUnservedError,
  NON_CHAT,
  rememberUnserved,
  UNSERVED_IDS,
} from '../src/lib/providers/unserved.ts';
import { NIM_MODELS, POLLINATIONS_MODELS, DEFAULT_NIM_MODEL, PLANNER_NIM_MODEL } from '../src/lib/providers/registry.ts';

test('the ids that 404d in the live probe are all excluded', () => {
  // The two the user actually hit in the APK.
  assert.ok(isUnserved('meta/llama2-70b'));
  assert.ok(isUnserved('ai21labs/jamba-1.5-large-instruct'));
  assert.equal(UNSERVED_IDS.size, 43);
});

test('models verified to answer are not excluded', () => {
  for (const id of [
    'moonshotai/kimi-k3',
    'nvidia/nemotron-3-super-120b-a12b',
    'openai/gpt-oss-20b',
    'google/gemma-4-31b-it',
    'nvidia/nemotron-3.5-lightning-30b-a3b',
  ]) {
    assert.ok(!isUnserved(id), `${id} must stay selectable`);
  }
});

test('the default and planner models are both ones that work', () => {
  assert.ok(!isUnserved(DEFAULT_NIM_MODEL), 'the default model must not be a dead id');
  assert.ok(!isUnserved(PLANNER_NIM_MODEL), 'the planner model must not be a dead id');
});

test('no bundled NIM model is a known-dead id', () => {
  const dead = NIM_MODELS.filter((m) => isUnserved(m.id)).map((m) => m.id);
  assert.deepEqual(dead, [], `bundled registry offers dead ids: ${dead.join(', ')}`);
});

test('non-chat models are kept out of the chat switcher', () => {
  for (const id of [
    'nvidia/nemotron-3-embed-1b',
    'nvidia/llama-3.1-nemoguard-8b-content-safety',
    'nvidia/nemotron-parse',
    'nvidia/riva-translate-4b-instruct',
    'snowflake/arctic-embed-l',
  ]) {
    assert.ok(NON_CHAT.test(id), `${id} is not a chat model`);
  }
  for (const id of ['moonshotai/kimi-k3', 'openai/gpt-oss-20b', 'google/gemma-4-31b-it']) {
    assert.ok(!NON_CHAT.test(id), `${id} is a chat model and must stay`);
  }
});

test("NVIDIA's entitlement 404 is recognised, and nothing else is", () => {
  const body = '{"status":404,"title":"Not Found","detail":"Function \'2fddadfb-7e76-4c8a-9b82-f7d3fab94471\': Not found for account \'guYZ\'"}';
  assert.ok(isUnservedError(404, body));
  // A real missing route, or the same body under another status, is not this.
  assert.ok(!isUnservedError(404, '{"detail":"No route for /v1/nope"}'));
  assert.ok(!isUnservedError(500, body));
});

test('a live refusal is remembered, so the id fails only once', () => {
  const id = 'vendor/model-that-just-404d';
  assert.ok(!isUnserved(id));
  rememberUnserved(id);
  assert.ok(isUnserved(id));
});

test('Pollinations stays available with no key', () => {
  assert.ok(POLLINATIONS_MODELS.length > 0);
  assert.ok(POLLINATIONS_MODELS.some((m) => m.capabilities.includes('chat')));
});
