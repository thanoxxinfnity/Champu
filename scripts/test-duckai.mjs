/**
 * Duck.ai adapter tests.
 *
 * These lock in the facts that were established against the live service, so a
 * later edit cannot quietly turn the hand-off into something that pretends to be
 * an API call, or drift the wire ids away from what duck.ai actually accepts.
 *
 *   node --experimental-strip-types scripts/test-duckai.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DUCKAI_MODELS, DUCKAI_ORIGIN, duckaiHandoffUrl } from '../src/lib/providers/duckai.ts';

/** The exact ids duck.ai's own bundle puts on the wire, with FREE in availableTo. */
const WIRE_IDS = [
  'gpt-5.6-luna',
  'gpt-5.4-mini',
  'claude-haiku-4-5',
  'mistral-small-2603',
  'tinfoil/gpt-oss-120b',
  'tinfoil/gemma4-31b',
];

test('every requested model is registered, with the id duck.ai expects', () => {
  assert.deepEqual(DUCKAI_MODELS.map((m) => m.id).sort(), [...WIRE_IDS].sort());
});

test('all six are hand-off models, never API-callable', () => {
  for (const m of DUCKAI_MODELS) {
    assert.equal(m.origin, 'browser-only', `${m.id} must be browser-only`);
    assert.equal(m.provider, 'duckai');
    assert.equal(m.handoffUrl, DUCKAI_ORIGIN);
  }
});

test('each model says, in the picker, that it is free and why it opens a tab', () => {
  for (const m of DUCKAI_MODELS) {
    assert.ok(/free/i.test(m.note ?? ''), `${m.id} note must say it is free`);
    assert.ok(/browser/i.test(m.note ?? ''), `${m.id} note must explain the browser requirement`);
  }
});

test('hand-off URL carries the prompt and the model duck.ai will match', () => {
  const url = new URL(duckaiHandoffUrl('tinfoil/gemma4-31b', '  build me an APK  '));
  assert.equal(url.origin, DUCKAI_ORIGIN);
  assert.equal(url.searchParams.get('q'), 'build me an APK', 'prompt is trimmed, not mangled');
  assert.equal(url.searchParams.get('model'), 'tinfoil/gemma4-31b');
  // duck.ai auto-sends only on prompt=1, and drops short prompts unless home=1.
  assert.equal(url.searchParams.get('prompt'), '1');
  assert.equal(url.searchParams.get('home'), '1');
});

test('a one-word prompt still survives the hand-off', () => {
  // Without home=1 duck.ai silently drops prompts of <=4 chars or a single word.
  const url = new URL(duckaiHandoffUrl('gpt-5.4-mini', 'hi'));
  assert.equal(url.searchParams.get('q'), 'hi');
  assert.equal(url.searchParams.get('home'), '1');
});

test('prompt is encoded, so separators cannot be smuggled into the query', () => {
  const url = new URL(duckaiHandoffUrl('gpt-5.6-luna', 'a&model=evil#frag ?x'));
  assert.equal(url.searchParams.get('q'), 'a&model=evil#frag ?x');
  assert.equal(url.searchParams.get('model'), 'gpt-5.6-luna', 'injected model param must not win');
});

test('a model with no id still produces a usable duck.ai URL', () => {
  const url = new URL(duckaiHandoffUrl('', 'hello there'));
  assert.equal(url.searchParams.get('model'), null);
  assert.equal(url.searchParams.get('q'), 'hello there');
});
