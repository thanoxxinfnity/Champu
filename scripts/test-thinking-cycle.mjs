/**
 * node --experimental-strip-types --test scripts/test-thinking-cycle.mjs
 *
 * The thinking bubble must only say what the run is really doing.
 *
 * It used to rotate through a shuffled pool of flavour lines ("Verifying terminal
 * heartbeat…", "Discarding the clever one…") on a timer, which first drowned out real
 * progress messages and then, once that was fixed, still showed nonsense whenever nothing
 * real was happening. Live reports: "na topic ke hisab se thinking bubble", "yo random wala
 * thinking bubble bhe theek karo".
 *
 * runtime.ts and store.ts are 'use client' and import zustand, which does not run under
 * bare node — matching this suite's convention, this reads the sources. The wording itself is
 * tested for real in test-narrate.mjs.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(new URL('../src/lib/agent/runtime.ts', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/lib/store.ts', import.meta.url), 'utf8');
const bubble = readFileSync(new URL('../src/components/ThinkingBubble.tsx', import.meta.url), 'utf8');

test('there is no pool of flavour phrases left, and nothing rotates on a timer', () => {
  assert.ok(!/THINKING_PHRASES|LANE_B_PHRASES|phrasesForRun|Verifying terminal heartbeat/.test(store + runtime));
  const fn = /function startNarration\(lane: 'A' \| 'B'\): \(\) => void \{[\s\S]*?\n\}/.exec(runtime)?.[0];
  assert.ok(fn, 'startNarration not found');
  assert.ok(!/setInterval/.test(fn), 'the bubble must not change on a timer');
});

test('real stages feed the bubble: streaming, reasoning, and terminal commands', () => {
  assert.match(runtime, /narrate\(streamingPhrase\(full, lane\)\)/);
  assert.match(runtime, /narrate\('Reasoning…'\)/);
  assert.match(runtime, /narrate\(describeCommand\(command\)\)/);
});

test('the bubble only shows in the session that owns the run', () => {
  assert.match(bubble, /isRunningHere/);
  assert.match(bubble, /!thinking\.active \|\| !runningHere/);
});
