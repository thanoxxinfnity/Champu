/** node --test scripts/test-needs-terminal.mjs — which messages must not go to a background reply (they need commands). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The function is self-contained apart from the lane classifier; lift it out of the module so the test needs no browser store.
const src = readFileSync(new URL('../src/lib/agent/background.ts', import.meta.url), 'utf8');
const body = /export function needsTerminal\([^)]*\): boolean \{([\s\S]*?)\n\}/.exec(src)[1];
const needsTerminal = new Function('input', 'lane', 'classifyLocal', body);
const call = (t, lane) => needsTerminal(t, lane, () => ({ lane: 'A' }));

test('work that needs commands is kept out of background replies', () => {
  for (const t of ['run npm test', 'is my terminal online?', 'mera terminal online hai kya', 'apk bana do', 'file bhej do', 'टर्मिनल ऑनलाइन है क्या', '/browse open example.com', 'install blender on the bridge', 'take a screenshot of google.com']) assert.equal(call(t), true, t);
});
test('plain talk and builds may go to the background (the terminal writes the files even if the phone closes the app)', () => {
  assert.equal(call('make me a camera app with 200x zoom', 'B'), false);
  assert.equal(call('ek camera wala app bana do jisme zoom ho', 'B'), false);
  for (const t of ['explain closures in javascript', 'write a poem about rain', 'hello bhai kaise ho', 'what is the capital of France']) assert.equal(call(t), false, t);
});
test('the background prompt no longer says the terminal is offline', () => {
  assert.ok(!/bridgeStatus: 'offline'/.test(src));
  assert.ok(/bridgeStatus: 'background'/.test(src));
});
