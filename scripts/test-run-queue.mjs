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
  assert.match(runtime, /enqueue\([\s\S]*?\);\s*[^\n]*\n\s*void drainQueue\(\);/);
});

test('a run that throws still lets the queue go on', () => {
  assert.match(runtime, /finally \{\s*useWorkspace\.getState\(\)\.endRun\(sessionId\);[\s\S]*?void drainQueue\(\);/);
});

test('sessions run side by side: one run per session, and only one build holds the shared slot', () => {
  assert.match(store, /runs: Record<string, RunInfo>/);
  assert.match(runtime, /!st\.runs\[sessionId\] && !claimed\.has\(sessionId\) && \(!heavy \|\| \(st\.runSessionId === null && !slotClaimed\)\)/);
  assert.ok(!/\bbusy\b/.test(runtime.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'no single global busy flag');
});

test('a queued message never takes the view away, and cannot jump ahead of its own session\'s earlier one', () => {
  const drain = /async function drainQueue[\s\S]*?\n\}/.exec(runtime)?.[0] ?? '';
  assert.ok(drain && !/openSessionById|openSession\(/.test(drain));
  assert.match(store, /blocked\.has\(item\.sessionId\)/);
});

test('stopping stops the session on screen, not every session', () => {
  const fn = /cancelRun: \(\) => \{[\s\S]*?\n  \},/.exec(store)?.[0] ?? '';
  assert.match(fn, /runs\[sessionId\]\?\.controller\.abort\(\)/);
  assert.ok(!/forEach|Object\.values\(runs\)/.test(fn));
});

test('a chat run cannot write files into a build\'s slot in another session', () => {
  assert.match(runtime, /held === null \|\| held === sessionId/);
});

test('the run does not wipe its own plan and files when it ends elsewhere', () => {
  assert.ok(!/if \(!isCurrent\(\)\) \{\s*after\.setPlan\(null\)/.test(runtime));
  assert.match(store, /slotSessionId/);
});

test('a manual terminal command does not speak for the run', () => {
  assert.match(runtime, /if \(opts\.narrate && opts\.sessionId\) narrate\(opts\.sessionId, describeCommand\(command\)\)/);
  assert.match(runtime, /narrate: true,/);
});
