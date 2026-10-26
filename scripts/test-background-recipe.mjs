/** node --experimental-strip-types --test scripts/test-background-recipe.mjs — a model call written out for the bridge, and the keys that go with it. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { recipeFor, recipesFor } from '../src/lib/providers/recipe.ts';
import { keyEnvFrom } from '../src/lib/bridge/key-env.ts';
import { hasJobs } from '../src/lib/bridge/update.ts';

const messages = [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }];

test('an OpenAI-style custom endpoint streams, carries its key and the final URL', () => {
  const r = recipeFor({ provider: 'custom', model: 'llama-3', label: 'Groq · llama-3', custom: { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk_secret' } }, messages, { maxTokens: 500 });
  assert.ok(r);
  assert.equal(r.stream, true);
  assert.equal(r.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(r.headers.Authorization, 'Bearer gsk_secret');
  assert.equal(r.body.model, 'llama-3');
  assert.equal(r.body.stream, true);
  assert.equal(r.body.messages.length, 2);
  assert.equal(r.label, 'Groq · llama-3');
});

test('an Anthropic endpoint is asked for one piece, with its own auth header', () => {
  const r = recipeFor({ provider: 'custom', model: 'claude-x', custom: { baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant', dialect: 'anthropic' } }, messages);
  assert.ok(r);
  assert.equal(r.stream, false);
  assert.match(r.url, /messages/);
  assert.equal(r.headers['x-api-key'], 'sk-ant');
  assert.equal(r.body.stream, false);
});

test('Pollinations works without a key; NVIDIA NIM cannot (its key stays on the server)', () => {
  const p = recipeFor({ provider: 'pollinations', model: 'openai' }, messages);
  assert.ok(p);
  assert.equal(p.url, 'https://text.pollinations.ai/openai');
  assert.equal(p.headers.Authorization, undefined);
  assert.equal(recipeFor({ provider: 'nim', model: 'meta/llama' }, messages), null);
});

test('recipesFor keeps the order, drops what cannot go, and stops at the limit', () => {
  const list = [
    { provider: 'nim', model: 'a' },
    { provider: 'custom', model: 'b', custom: { baseUrl: 'https://x.example/v1', apiKey: 'k' } },
    { provider: 'custom', model: 'c', custom: { baseUrl: 'https://y.example/v1', apiKey: 'k' } },
    { provider: 'pollinations', model: 'd' },
  ];
  assert.deepEqual(recipesFor(list, messages).map((r) => r.body.model), ['b', 'c', 'd']);
  assert.equal(recipesFor(list, messages, {}, 2).length, 2);
});

test('the Vercel token joins the other keys the terminal can hold', () => {
  assert.equal(keyEnvFrom({ vercel: ' vcp_abc ' }, []).VERCEL_TOKEN, 'vcp_abc');
  assert.deepEqual(keyEnvFrom({ vercel: '' }, []), {});
});

test('a bridge can run jobs when it says so or is new enough', () => {
  assert.equal(hasJobs({ version: '1.2.0', features: ['keys'] }), false);
  assert.equal(hasJobs({ version: '1.3.0' }), true);
  assert.equal(hasJobs({ version: '1.2.9', features: ['keys', 'jobs'] }), true);
  assert.equal(hasJobs(null), false);
});
