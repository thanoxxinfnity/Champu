/**
 * node --experimental-strip-types --test scripts/test-run-queue.mjs
 * Source-level guards for the run queue (runtime.ts is client code and does not load under bare node;
 * the behaviour itself is exercised end to end in a browser — see the commit that added it).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(new URL('../src/lib/agent/runtime.ts', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/lib/store.ts', import.meta.url), 'utf8');

test('two sends from a new chat share one session, and a queue left behind is started', () => {
  assert.match(runtime, /creating \?\?= /);
  assert.match(runtime, /if \(!busy\) void drainQueue\(\)/);
});

test('a run that throws still lets the queue go on', () => {
  assert.match(runtime, /finally \{\s*busy = false;[\s\S]*?void drainQueue\(\);/);
});

test('the run does not wipe its own plan and files when it ends elsewhere', () => {
  assert.ok(!/if \(!isCurrent\(\)\) \{\s*after\.setPlan\(null\)/.test(runtime));
  assert.match(store, /slotSessionId/);
});

test('a manual terminal command does not speak for the run', () => {
  assert.match(runtime, /if \(opts\.narrate\) narrate\(describeCommand\(command\)\)/);
  assert.match(runtime, /narrate: true,/);
});
