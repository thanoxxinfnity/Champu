/** node --experimental-strip-types --test scripts/test-terminal-intent.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyLocal, wantsTerminal } from '../src/lib/agent/router.ts';
import { extractArtifacts, commandsOf, filesOf } from '../src/lib/agent/artifacts.ts';

test('asking for something to be done on the terminal is work, not chat', () => {
  for (const text of [
    'Donload godot on terminal fast please',
    'Donload godot on the terminal',
    'terminal me godot install karo',
    'install godot',
    'godot download karo',
    'run npm install on the shell',
  ]) {
    assert.equal(classifyLocal(text).lane, 'B', text);
  }
});

test('questions about the terminal stay conversation', () => {
  for (const text of ['what is a terminal?', 'how does curl work?', 'Hi', 'kya hai godot']) {
    assert.equal(wantsTerminal(text), false, text);
    assert.equal(classifyLocal(text).lane, 'A', text);
  }
});

test('a short reply or a link carries on the task already under way', () => {
  assert.equal(classifyLocal('Ha', { previousLane: 'B' }).lane, 'B');
  assert.equal(classifyLocal('Ya wala bro', { previousLane: 'B' }).lane, 'B');
  assert.equal(classifyLocal('https://drive.google.com/uc?export=download&id=1h90hi', { previousLane: 'B' }).lane, 'B');
  assert.equal(classifyLocal('Ha', { previousLane: 'A' }).lane, 'A');
  assert.equal(classifyLocal('why is that?', { previousLane: 'B' }).lane, 'A');
});

test('while executing, a bare shell block runs; otherwise it stays a snippet', () => {
  const text = 'Checking:\n```bash\ncommand -v godot\n```\n';
  assert.equal(commandsOf(extractArtifacts(text, { shellRuns: true })).length, 1);
  assert.equal(commandsOf(extractArtifacts(text)).length, 0);
  assert.equal(filesOf(extractArtifacts(text)).length, 1);
  const withPath = '```bash path=@terminal cwd=.\nls\n```\n';
  assert.equal(commandsOf(extractArtifacts(withPath)).length, 1);
});

import { resolveSuite } from '../src/lib/agent/router.ts';

test('installing Godot is a terminal job, not a game build', () => {
  assert.equal(resolveSuite('chat', 'Donload godot on terminal fast please', 'B'), 'chat');
  assert.equal(classifyLocal('Donload godot on terminal fast please').ops, true);
  assert.equal(classifyLocal('godot download karo').suite, undefined);
  // …but a game that merely mentions Godot still is one.
  assert.equal(resolveSuite('chat', 'make a zombie shooter game in godot', 'B'), 'godot');
  assert.equal(classifyLocal('Ha', { previousLane: 'B', previousOps: true }).ops, true);
  assert.equal(classifyLocal('Ha', { previousLane: 'B' }).ops, undefined);
});
