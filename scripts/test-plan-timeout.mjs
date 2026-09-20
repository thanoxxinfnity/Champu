/**
 * node --experimental-strip-types --test scripts/test-plan-timeout.mjs
 *
 * `complete()` — the non-streaming call `buildPlan()` uses for Lane B's
 * "Decomposing into atomic steps…" step — had no timeout of its own, only the
 * caller's manual AbortSignal (the Stop button). Live bug report with
 * screenshots: asked Chomugiri to build a website, the plan step showed
 * "Decomposing into atomic steps… 5s" and then hung there — the run stayed
 * "running…" in the input bar with no progress and no error, on both the
 * chat tab and the terminal tab, because a stalled provider on this call
 * never rejected, so buildPlan()'s own try/catch (which falls back to
 * heuristicPlan()) never had anything to catch. Same failure shape
 * paintTexture() was fixed for earlier — see test-paint-texture-fallback.mjs.
 *
 * runtime.ts imports zustand and other browser-only modules that don't run
 * under bare node, so — matching this suite's existing convention — this
 * reads the real source and asserts the fix is actually there.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../src/lib/agent/runtime.ts', import.meta.url), 'utf8');

const completeFn = /async function complete\([\s\S]*?\n\}/.exec(src)?.[0];

test('complete exists and takes an optional caller signal', () => {
  assert.ok(completeFn, 'complete not found in runtime.ts');
  assert.match(completeFn, /signal\?:\s*AbortSignal/);
});

test('complete bounds the call with a timeout composed with the caller signal', () => {
  assert.match(completeFn, /AbortSignal\.timeout\(/);
  assert.match(completeFn, /AbortSignal\.any\(\[signal, timeout\]\)/);
  // The composed signal must actually reach the fetch call, not just exist.
  assert.match(completeFn, /signal:\s*composed/);
});

const buildPlanFn = /async function buildPlan\([\s\S]*?\n\}/.exec(src)?.[0];

test('buildPlan falls back to a heuristic plan when complete() fails', () => {
  assert.ok(buildPlanFn, 'buildPlan not found in runtime.ts');
  assert.match(buildPlanFn, /catch\s*\{/);
  assert.match(buildPlanFn, /heuristicPlan\(input, suite\)/);
});
