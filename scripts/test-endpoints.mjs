/** node --experimental-strip-types --test scripts/test-endpoints.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { modelIdsFrom } from '../src/lib/providers/model-list.ts';

test('the OpenAI envelope is read', () => {
  assert.deepEqual(modelIdsFrom({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }), ['gpt-4o', 'gpt-4o-mini']);
});

test("kie.ai's nested envelope is read — this is the shape that reported 'answered nothing'", () => {
  const real = { code: 200, msg: 'success', data: { total: 2, models: [{ model: 'gpt-5-2', slug: 'gpt-5-2' }, { model: 'gemini-3-pro' }] } };
  assert.deepEqual(modelIdsFrom(real), ['gpt-5-2', 'gemini-3-pro']);
});

test('a bare array, and an array of plain strings, both work', () => {
  assert.deepEqual(modelIdsFrom([{ name: 'llama3' }]), ['llama3']);
  assert.deepEqual(modelIdsFrom(['a', 'b']), ['a', 'b']);
});

test('{ models: [...] } at the top level works', () => {
  assert.deepEqual(modelIdsFrom({ models: [{ id: 'x' }] }), ['x']);
});

test('rows with no usable id are dropped rather than becoming empty entries', () => {
  assert.deepEqual(modelIdsFrom({ data: [{ id: 'ok' }, { foo: 1 }, { id: '' }] }), ['ok']);
});

test('nothing useful yields an empty list, never a throw', () => {
  for (const input of [null, undefined, 0, '', {}, { data: {} }, { data: { nothing: 1 } }]) {
    assert.deepEqual(modelIdsFrom(input), [], JSON.stringify(input));
  }
});

// ── Where to look for the list ──────────────────────────────────────────────

import { modelListCandidates } from '../src/lib/providers/model-list.ts';

test('the obvious path is tried first', () => {
  const urls = modelListCandidates('https://api.example.com/v1').map((c) => c.url);
  assert.equal(urls[0], 'https://api.example.com/v1/models');
});

test('kie.ai is reachable: chat at /v1, models at /api/v1 — a different prefix', () => {
  const urls = modelListCandidates('https://api.kie.ai/v1').map((c) => c.url);
  // Appending to the base can never find this, which is why the probe failed.
  assert.ok(urls.includes('https://api.kie.ai/api/v1/models'), urls.join(' | '));
});

test('the reverse also works, for a base that already carries /api', () => {
  const urls = modelListCandidates('https://api.example.com/api/v1').map((c) => c.url);
  assert.ok(urls.includes('https://api.example.com/v1/models'), urls.join(' | '));
});

test('trailing slashes do not produce a doubled path', () => {
  const urls = modelListCandidates('https://api.example.com/v1///').map((c) => c.url);
  assert.equal(urls[0], 'https://api.example.com/v1/models');
});

test('candidates are unique, so no path is fetched twice', () => {
  const urls = modelListCandidates('https://api.example.com/v1').map((c) => c.url);
  assert.equal(new Set(urls).size, urls.length);
});

test('a base that will not parse still yields the one obvious candidate', () => {
  const urls = modelListCandidates('not a url').map((c) => c.url);
  assert.deepEqual(urls, ['not a url/models']);
});

// ── Pasted URLs ─────────────────────────────────────────────────────────────

import { chatBaseCandidates, normalizeBase } from '../src/lib/providers/model-list.ts';

test('a pasted endpoint URL is treated as a base, not appended to', () => {
  // This exact paste produced "answered nothing" — the probe asked for
  // /api/v1/models/models.
  assert.equal(normalizeBase('https://api.kie.ai/api/v1/models'), 'https://api.kie.ai/api/v1');
  assert.equal(normalizeBase('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1');
  assert.equal(normalizeBase('https://api.example.com/v1/completions'), 'https://api.example.com/v1');
});

test('a base that is already a base is left alone', () => {
  assert.equal(normalizeBase('https://api.kie.ai/v1'), 'https://api.kie.ai/v1');
  assert.equal(normalizeBase('https://api.kie.ai/v1/'), 'https://api.kie.ai/v1');
});

test('/chat/completions is stripped whole, not down to a stray /chat', () => {
  assert.equal(normalizeBase('https://x.com/v1/chat/completions'), 'https://x.com/v1');
});

test('a model id containing "models" in the host is not mangled', () => {
  assert.equal(normalizeBase('https://models.example.com/v1'), 'https://models.example.com/v1');
});

test('both prefixes are offered, because chat and models can live apart', () => {
  // kie.ai: chat at /v1, models at /api/v1.
  assert.deepEqual(chatBaseCandidates('https://api.kie.ai/api/v1/models'), [
    'https://api.kie.ai/api/v1',
    'https://api.kie.ai/v1',
  ]);
  assert.deepEqual(chatBaseCandidates('https://api.kie.ai/v1'), [
    'https://api.kie.ai/v1',
    'https://api.kie.ai/api/v1',
  ]);
});

test('candidates are unique and the typed one is tried first', () => {
  const c = chatBaseCandidates('https://api.example.com/v1');
  assert.equal(c[0], 'https://api.example.com/v1');
  assert.equal(new Set(c).size, c.length);
});

// ── Chat models only ────────────────────────────────────────────────────────

import { chatModelsOnly } from '../src/lib/providers/model-list.ts';

test('video, image and audio models are kept out of the chat switcher', () => {
  const kie = [
    'gpt-5-2',
    'gemini-3-pro',
    'kling/v2-1-master-text-to-video',
    'google/imagen4-ultra',
    'elevenlabs/text-to-speech-turbo-2-5',
    'recraft/crisp-upscale',
    'bytedance/seedream-v4-text-to-image',
    'veo-3-1',
    'nano-banana-pro',
  ];
  assert.deepEqual(chatModelsOnly(kie), ['gpt-5-2', 'gemini-3-pro']);
});

test('ordinary chat ids all survive', () => {
  const ids = ['gpt-4o', 'claude-sonnet-4-6', 'llama-3.3-70b-instruct', 'deepseek-chat', 'mistral-small'];
  assert.deepEqual(chatModelsOnly(ids), ids);
});

test('a list of only media models is shown rather than emptied', () => {
  // The heuristic is wrong for that endpoint; showing nothing is worse.
  const media = ['veo-3-1', 'kling/v2-1-pro'];
  assert.deepEqual(chatModelsOnly(media), media);
});

test('music, audio and animation jobs are filtered out too', () => {
  const kie = [
    'gpt-5-2',
    'gemini-2.5-pro',
    'infinitalk/from-audio',
    'wan/2-2-animate-replace',
    'ai-music-api/generate',
    '4o-image-api',
    'elevenlabs/text-to-dialogue-v3',
    'recraft/crisp-upscale',
  ];
  assert.deepEqual(chatModelsOnly(kie), ['gpt-5-2', 'gemini-2.5-pro']);
});
