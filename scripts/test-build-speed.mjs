/**
 * node --experimental-strip-types --test scripts/test-build-speed.mjs
 * Source-level guards for what made a game take a quarter of an hour: the model thinking for minutes first, and
 * ten textures painted one by one, each waiting out a slow provider before the next was tried.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { requestBody, takesReasoningEffort } from '../src/lib/providers/dialects.ts';

const runtime = readFileSync(new URL('../src/lib/agent/runtime.ts', import.meta.url), 'utf8');
const kotlin = readFileSync(new URL('../android/app/src/main/java/com/chomugiri/workspace/providers/Upstream.kt', import.meta.url), 'utf8');

test('a build asks reasoning models for low effort, but only models known to take it get the field', () => {
  const req = { provider: 'nim', model: 'moonshotai/kimi-k3', messages: [], reasoningEffort: 'low' };
  assert.equal(requestBody('openai', req, 'moonshotai/kimi-k3', true).reasoning_effort, 'low');
  assert.equal(requestBody('openai', { ...req, model: 'meta/llama-3.1-70b' }, 'meta/llama-3.1-70b', true).reasoning_effort, undefined);
  assert.equal(requestBody('openai', { ...req, reasoningEffort: undefined }, 'moonshotai/kimi-k3', true).reasoning_effort, undefined);
  assert.ok(takesReasoningEffort('openai/gpt-oss-20b'));
  assert.match(runtime, /reasoningEffort: lane === 'B' \? 'low' : undefined/);
});

test('the Android server forwards the same field, to the same models', () => {
  assert.match(kotlin, /reasoningEffort/);
  assert.match(kotlin, /kimi\|gpt-oss/);
});

test('textures are painted a few at a time, inside a time budget', () => {
  assert.match(runtime, /PAINT_AT_ONCE = 3/);
  assert.match(runtime, /PAINT_BUDGET_MS/);
  assert.match(runtime, /Array\.from\(\{ length: PAINT_AT_ONCE \}, worker\)/);
});

test('a slow NVIDIA image service is not waited out once per texture', () => {
  assert.match(runtime, /nimImageFailedAt/);
  assert.match(runtime, /nimDown \? \[\{ body: free/);
});
