/**
 * node --experimental-strip-types --test scripts/test-paint-texture-fallback.mjs
 *
 * paintTexture used to be a single unbounded `fetch('/api/image', { provider:
 * 'nim', ... })` with no signal and no fallback. A user reported the Godot
 * runner build stuck at "0/7 complete" for ~111 minutes on a single "Painting
 * wet dark city asphalt…" step while NVIDIA NIM was degraded — every one of
 * the RUNNER_THEMES texture slots was hanging out to the platform's own
 * multi-minute ceiling with nothing to fail over to, and `thinking.since` only
 * resets on the false→true edge, so a run of several failing steps read as one
 * frozen one.
 *
 * runtime.ts imports zustand and other browser-only modules that don't run
 * under bare node, so — matching this suite's existing convention (see
 * test-background-progress.mjs) — this reads the real source and asserts the
 * fix is actually there, rather than re-implementing the logic and testing
 * that.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../src/lib/agent/runtime.ts', import.meta.url), 'utf8');

const paintTexture = /async function paintTexture\([\s\S]*?\n\}/.exec(src)?.[0];

test('paintTexture exists and takes an optional caller signal', () => {
  assert.ok(paintTexture, 'paintTexture not found in runtime.ts');
  assert.match(paintTexture, /signal\?:\s*AbortSignal/);
});

test('paintTexture tries NIM then falls back to Pollinations, like referenceImage', () => {
  assert.match(paintTexture, /provider:\s*'nim'/);
  assert.match(paintTexture, /provider:\s*'pollinations'/);
  // Both bodies must be tried in one loop — a body array, not two branches
  // that stop after the first failure.
  assert.match(paintTexture, /for \(const body of \[/);
});

test('paintTexture bounds every attempt with a timeout composed with the caller signal', () => {
  assert.match(paintTexture, /AbortSignal\.timeout\(/);
  assert.match(paintTexture, /AbortSignal\.any\(\[signal, timeout\]\)/);
  // The composed signal must actually reach the fetch call, not just exist.
  assert.match(paintTexture, /signal:\s*composed/);
});

test('a stalled or failing provider is caught, not left to abort the whole loop', () => {
  assert.match(paintTexture, /catch\s*\{/);
});

const runnerLoop = /if \(!files\.some\(\(f\) => f\.path\.startsWith\('textures\/'\)\)\) \{[\s\S]*?\n {6}\}\n {4}\}/.exec(src)?.[0];

test('the RUNNER_THEMES texture loop checks controller.signal.aborted between iterations', () => {
  assert.ok(runnerLoop, 'RUNNER_THEMES texture loop not found in runtime.ts');
  assert.match(runnerLoop, /if \(controller\.signal\.aborted\) break;/);
});

test('the RUNNER_THEMES loop passes controller.signal into both paintTexture calls', () => {
  const paintCalls = runnerLoop.match(/paintTexture\(/g) ?? [];
  const signalRefs = runnerLoop.match(/controller\.signal(?!\.aborted)/g) ?? [];
  assert.equal(paintCalls.length, 2, `expected 2 paintTexture calls, found ${paintCalls.length}`);
  assert.equal(signalRefs.length, 2, `expected controller.signal passed to both calls, found ${signalRefs.length} references`);
});
