/**
 * node --experimental-strip-types --test scripts/test-godot-chat-fallback.mjs
 *
 * Lane B's Godot suite used to depend entirely on the chat model hand-writing
 * every scene and script as fenced code blocks in its own answer — the model
 * generation and texture painting after it only ran once
 * `detectGodotProject(files)` already succeeded on that hand-written output.
 *
 * Verified live against the real gateway (not simulated): a 300s call to NIM's
 * default model and a 100s call to Pollinations's default model each spent
 * their entire run narrating the plan or reasoning about it and reached
 * `AbortSignal.timeout` / ran out of budget without emitting a single file —
 * "0/7 complete" with no project, matching the live bug report. Game Studio's
 * dedicated button never hits this because it calls the deterministic
 * `buildProject()` directly instead of asking a model to write the project;
 * lane B chat now gets the same floor.
 *
 * runtime.ts is 'use client' and imports zustand, which does not run under
 * bare node — matching this suite's existing convention (see
 * test-background-progress.mjs, test-paint-texture-fallback.mjs), this reads
 * the real source and asserts the fallback is actually there and reachable,
 * rather than re-implementing the logic and testing that.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../src/lib/agent/runtime.ts', import.meta.url), 'utf8');

test('runtime.ts imports the deterministic project builder', () => {
  assert.match(src, /import \{ buildProject \} from '@\/lib\/suites\/godot\/project';/);
});

const fallbackBlock = /\/\/ ── Godot: a chat model that never finishes writing the project[\s\S]*?\n {4}\}\n/.exec(src)?.[0];

test('a fallback block exists for when the model never produces a working project', () => {
  assert.ok(fallbackBlock, 'the "model never finishes" fallback block was not found in runtime.ts');
});

test('the fallback triggers off detectGodotProject failing, not off the file count', () => {
  // The old gate ("files.length && detectGodotProject(files)") silently did
  // nothing at all when the model produced zero or a broken set of files —
  // this must fire in exactly that case.
  assert.match(fallbackBlock, /suite === 'godot' && design && !detectGodotProject\(files\)/);
});

test('the fallback calls the same buildProject() Game Studio already trusts', () => {
  assert.match(fallbackBlock, /buildProject\(\{ name: design\.name, dimension: design\.dimension, genre: design\.genre, view: design\.view \}\)/);
});

test('the built files are pushed into the workspace so the rest of the pipeline sees them', () => {
  assert.match(fallbackBlock, /files\.push\(artifact\)/);
  assert.match(fallbackBlock, /upsertFile\(artifact\)/);
});

test('the user is told plainly that the model did not finish, not left to guess', () => {
  assert.match(fallbackBlock, /did not finish writing the project/);
});

test('the fallback runs before the model/texture pipeline gate, so that pipeline still sees a real project', () => {
  const fallbackIndex = src.indexOf(fallbackBlock);
  const pipelineGateIndex = src.indexOf("if (suite === 'godot' && files.length && detectGodotProject(files)) {");
  assert.ok(fallbackIndex >= 0 && pipelineGateIndex >= 0);
  assert.ok(fallbackIndex < pipelineGateIndex, 'the fallback must run before the model/texture pipeline checks for a project');
});
