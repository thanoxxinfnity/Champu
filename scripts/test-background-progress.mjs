/**
 * node --experimental-strip-types --test scripts/test-background-progress.mjs
 *
 * store.ts and run-state.ts pull in Zustand and browser-only code that does
 * not run under bare node, and RunService.kt/MainActivity.kt are Kotlin — so
 * this checks the wiring the same way the rest of this suite checks
 * runtime.ts: read the real source, assert the call is actually there and in
 * the right place, rather than re-implementing the logic and testing that.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runState = readFileSync(new URL('../src/lib/shell/run-state.ts', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/lib/store.ts', import.meta.url), 'utf8');
const runService = readFileSync(
  new URL('../android/app/src/main/java/com/chomugiri/workspace/RunService.kt', import.meta.url), 'utf8',
);
const mainActivity = readFileSync(
  new URL('../android/app/src/main/java/com/chomugiri/workspace/MainActivity.kt', import.meta.url), 'utf8',
);

test('updateRunProgress sends the same wire shape RunService already treats as a notification update', () => {
  const fn = /export async function updateRunProgress[\s\S]*?\n}/.exec(runState)?.[0];
  assert.ok(fn, 'updateRunProgress is not exported from run-state.ts');
  assert.match(fn, /tell\(\{ active: true, topic: phrase \}\)/);
});

test('setThinking mirrors the current step to the background notification', () => {
  const fn = /setThinking: \(active, phrase\) =>[\s\S]*?\n {4}\}\),/.exec(store)?.[0];
  assert.ok(fn, 'setThinking implementation not found in store.ts');
  assert.match(fn, /updateRunProgress\(phrase\)/);
  // Only on a real, changed phrase — not on every call (setThinking(false) to
  // clear, or a repeat of the same phrase, must not spam the shell).
  assert.match(fn, /if \(active && phrase && phrase !== s\.thinking\.phrase\)/);
});

test('store.ts imports updateRunProgress from the real module, not a stray local redefinition', () => {
  assert.match(store, /import \{ updateRunProgress \} from '@\/lib\/shell\/run-state';/);
});

test('RunService.start re-posts the ongoing notification on every call, not only the first', () => {
  // The whole fix depends on this: repeated `active: true` messages during one
  // run must each update NOTIFICATION_RUNNING, not be ignored because the
  // service is already running. onStartCommand must call startForeground on
  // every invocation, unconditionally.
  const onStartCommand = /override fun onStartCommand\([\s\S]*?\n {4}\}/.exec(runService)?.[0];
  assert.ok(onStartCommand, 'onStartCommand not found in RunService.kt');
  assert.ok(!/if\s*\(.*isRunning|already/i.test(onStartCommand), 'onStartCommand must not guard against re-entry — that would silently drop progress updates');
  assert.match(onStartCommand, /startForeground\(NOTIFICATION_RUNNING, notification/);
});

test('MainActivity calls RunService.start unconditionally on every active state, not once per run', () => {
  const handler = /router\.onRunState = \{ state ->[\s\S]*?\n {8}\}\n {4}\}/.exec(mainActivity)?.[0];
  assert.ok(handler, 'onRunState handler not found in MainActivity.kt');
  assert.match(handler, /if \(state\.active\) \{\s*\n\s*RunService\.start\(this, state\.topic\)/);
  // No de-duplication against a previous topic — every call must reach
  // RunService.start so the notification text actually advances.
  assert.ok(!/lastTopic|previousTopic/i.test(handler));
});
