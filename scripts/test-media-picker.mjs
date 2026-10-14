/** node --experimental-strip-types --test scripts/test-media-picker.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { endpointsFor, modelsFor } from '../src/lib/providers/media-picker.ts';

const endpoint = (overrides = {}) => ({
  id: 'ep1', label: 'Test', baseUrl: 'https://x', capabilities: ['chat', 'model3d'],
  models: [], enabled: true, createdAt: 0, ...overrides,
});
const model = (id, capabilities) => ({ id, label: id, capabilities, enabled: true });

test('endpointsFor only returns endpoints that both are enabled and declare the capability', () => {
  const eps = [
    endpoint({ id: 'a', capabilities: ['chat', 'model3d'] }),
    endpoint({ id: 'b', capabilities: ['chat'], enabled: true }),
    endpoint({ id: 'c', capabilities: ['chat', 'model3d'], enabled: false }),
  ];
  assert.deepEqual(endpointsFor(eps, 'model3d').map((e) => e.id), ['a']);
});

test('modelsFor prefers models explicitly tagged for the capability', () => {
  const ep = endpoint({ models: [model('trellis-1', ['model3d']), model('gpt-5.5', ['chat'])] });
  assert.deepEqual(modelsFor(ep, 'model3d'), ['trellis-1']);
});

test('BUG FIX: when nothing is tagged for the capability, a chat-only model never shows up in a media picker', () => {
  // This is exactly the reported bug: a custom endpoint whose model-discovery could not classify
  // "gpt-5.5" defaults it to ['chat'] (see endpoint-models.ts), and the old fallback then listed
  // it as a choice in the 3D model picker.
  const ep = endpoint({ models: [model('gpt-5.5', ['chat']), model('1radox-base', ['chat', 'tools'])] });
  assert.deepEqual(modelsFor(ep, 'model3d'), [], 'no model should be offered — showing a chat model as a 3D option is worse than showing none');
});

test('fallback still offers a model whose capabilities are not purely text (last resort for an under-tagged endpoint)', () => {
  const ep = endpoint({ models: [model('gpt-5.5', ['chat']), model('some-3d-ish-but-untagged', ['image', 'model3d' /* actually tagged here is fine too */])] });
  // A model with any non-text capability survives the fallback filter even if it is not an exact
  // match for the requested capability (e.g. an image model on an endpoint with no proper 3D model).
  const ep2 = endpoint({ models: [model('gpt-5.5', ['chat']), model('flux-ish', ['image'])] });
  assert.deepEqual(modelsFor(ep2, 'model3d'), ['flux-ish']);
});

test('an endpoint whose every model is text-only offers nothing for 3D — not a guess', () => {
  const ep = endpoint({ models: [model('gpt-5.5', ['chat']), model('o-reasoner', ['chat', 'reasoning'])] });
  assert.deepEqual(modelsFor(ep, 'model3d'), []);
});

test('an endpoint with no models at all returns an empty list, not a crash', () => {
  assert.deepEqual(modelsFor(endpoint({ models: [] }), 'image'), []);
  assert.deepEqual(modelsFor(undefined, 'image'), []);
});

test('a disabled model is excluded even if it is correctly tagged', () => {
  const ep = endpoint({ models: [{ id: 'trellis-1', label: 'trellis-1', capabilities: ['model3d'], enabled: false }] });
  assert.deepEqual(modelsFor(ep, 'model3d'), []);
});
