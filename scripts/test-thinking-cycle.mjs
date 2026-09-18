/**
 * node --experimental-strip-types --test scripts/test-thinking-cycle.mjs
 *
 * startPhraseCycle() shows rotating flavour text ("Analyzing architecture...",
 * "Verifying terminal heartbeat...") while a run is active. It used to
 * overwrite the thinking bubble on a hard 2.6s timer regardless of what else
 * had set it — so a real, specific progress message like "Compiling the APK
 * on the bridge…" (itself calling the same setThinking()) lost to the next
 * random flavour phrase within 2.6 seconds. A multi-minute Godot export then
 * spent nearly all of it showing irrelevant filler text with nothing to do
 * with what was actually happening — live bug report: "na topic ke hisab se
 * thinking bubble" (the bubble doesn't match the topic).
 *
 * runtime.ts is 'use client' and imports zustand, which does not run under
 * bare node — matching this suite's established convention (see
 * test-background-progress.mjs, test-paint-texture-fallback.mjs), this reads
 * the real source and asserts the fix is actually there.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../src/lib/agent/runtime.ts', import.meta.url), 'utf8');

const fn = /function startPhraseCycle\(lane: 'A' \| 'B'\): \(\) => void \{[\s\S]*?\n\}/.exec(src)?.[0];

test('startPhraseCycle exists', () => {
  assert.ok(fn, 'startPhraseCycle not found in runtime.ts');
});

test('a tick checks the live store phrase before overwriting it', () => {
  // Without this read, the interval cannot tell a real progress message from
  // its own last write, and will always stomp on it.
  assert.match(fn, /useWorkspace\.getState\(\)\.thinking\.phrase/);
});

test('the tick skips its own advance when something else has claimed the bubble', () => {
  // The guard must return/skip before index advances or setThinking is
  // called again — otherwise the check is dead code.
  const tick = /const timer = setInterval\(\(\) => \{([\s\S]*?)\}, 2600\);/.exec(fn)?.[1];
  assert.ok(tick, 'setInterval tick body not found');
  const guardIndex = tick.indexOf('return;');
  const advanceIndex = tick.indexOf('index = (index + 1)');
  assert.ok(guardIndex >= 0 && advanceIndex >= 0, 'expected an early return before advancing the index');
  assert.ok(guardIndex < advanceIndex, 'the early return must come before the index advances');
});

test('the cycle tracks what it itself last wrote, separately from the store', () => {
  assert.match(fn, /let lastWritten/);
  // Both the initial write and every tick's write must update it, or the
  // comparison drifts out of sync with the cycle's own state after one tick.
  assert.match(fn, /lastWritten = phrases\[index\]/);
});
