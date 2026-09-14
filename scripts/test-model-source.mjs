/** node --experimental-strip-types --test scripts/test-model-source.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { meshyError, resultFrom, taskIdFrom } from '../src/lib/suites/godot/meshy.ts';
import { hostedRefusal, trellisError } from '../src/lib/suites/godot/trellis.ts';
import { buildLocally, sourceChain, trellisAvailability } from '../src/lib/suites/godot/model-source.ts';

// ── Meshy ───────────────────────────────────────────────────────────────────

test('a task id is found whichever way Meshy spells it', () => {
  // Meshy documents { result }, but ids elsewhere in the same API are `id` or
  // `task_id`. Reading a successful create as a failure costs a paid generation.
  assert.equal(taskIdFrom({ result: 'abc' }), 'abc');
  assert.equal(taskIdFrom({ id: 'abc' }), 'abc');
  assert.equal(taskIdFrom({ task_id: 'abc' }), 'abc');
  assert.equal(taskIdFrom({ data: { result: 'abc' } }), 'abc');
  assert.equal(taskIdFrom({ nothing: 1 }), null);
  assert.equal(taskIdFrom(null), null);
});

test('Meshy statuses are read case-correctly, not compared to the wrong case', () => {
  // Meshy answers in capitals. Comparing against lower case makes every task
  // look like it is still running, forever.
  assert.equal(resultFrom({ status: 'PENDING' }).status, 'queued');
  assert.equal(resultFrom({ status: 'IN_PROGRESS', progress: 40 }).status, 'running');
  assert.equal(resultFrom({ status: 'IN_PROGRESS', progress: 40 }).progress, 40);
  assert.equal(resultFrom({ status: 'FAILED' }).status, 'failed');
  assert.equal(resultFrom({ status: 'CANCELED' }).status, 'failed');
});

test('a finished model is found in both the flat and the nested shape', () => {
  const flat = resultFrom({ status: 'SUCCEEDED', model_urls: { glb: 'https://x/m.glb', fbx: 'https://x/m.fbx' } });
  assert.equal(flat.status, 'done');
  assert.equal(flat.modelUrl, 'https://x/m.glb');

  // A rigging task nests its output under `result`.
  const rigged = resultFrom({ status: 'SUCCEEDED', result: { rigged_model_urls: { glb: 'https://x/rigged.glb' } } });
  assert.equal(rigged.status, 'done');
  assert.equal(rigged.modelUrl, 'https://x/rigged.glb');
  assert.equal(rigged.riggedUrl, 'https://x/rigged.glb');
});

test('a success with no model is a failure, not a success', () => {
  // Returning done with no URL would have the caller write an empty file.
  const result = resultFrom({ status: 'SUCCEEDED' });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /no model URL/);
});

test('a failed task carries Meshy\'s own reason', () => {
  const result = resultFrom({ status: 'FAILED', task_error: { message: 'prompt rejected' } });
  assert.match(result.error, /prompt rejected/);
});

test('Meshy errors say where the key goes, not what the server said', () => {
  // Both "Missing API key" and "Invalid API key" are real 401s and neither tells
  // a user anything actionable.
  assert.match(meshyError(401, '{"message":"Missing API key"}'), /Settings → API Keys/);
  assert.match(meshyError(401, '{"message":"Invalid API key"}'), /Settings → API Keys/);
  assert.match(meshyError(402, '{}'), /out of credits/);
  assert.match(meshyError(429, '{}'), /rate limiting/);
  assert.match(meshyError(500, 'not json at all'), /500/);
});

// ── TRELLIS ─────────────────────────────────────────────────────────────────

test('the hosted TRELLIS demo is recognised and explained, not reported as a bug', () => {
  // Verified against the live API: an uploaded image answers 422 with this
  // wording, and a prompt answers 500 after ~90 seconds. Both mean the same
  // thing — the hosted deployment only serves NVIDIA's own examples — and a
  // user who reads "500" will retry and re-enter their key instead.
  const refusal = hostedRefusal(422, '{"detail":"Expected: example_id, got: base64"}');
  assert.match(refusal, /only accepts its own sample images/);
  assert.match(hostedRefusal(500, 'Internal Server Error'), /demo deployment/);
  assert.equal(hostedRefusal(401, '{}'), null, 'a real auth failure is not a demo refusal');
});

test('a TRELLIS auth failure still reads as an auth failure', () => {
  assert.match(trellisError(401, '{}'), /rejected the NIM key/);
  assert.match(trellisError(403, '{}'), /rejected the NIM key/);
});

// ── The chain ───────────────────────────────────────────────────────────────

test('Meshy comes first when both keys are set, because it rigs', () => {
  assert.deepEqual(sourceChain({ meshy: 'm', tripo: 't' }), ['meshy', 'tripo', 'built']);
  assert.deepEqual(sourceChain({ tripo: 't' }), ['tripo', 'built']);
  assert.deepEqual(sourceChain({ meshy: 'm' }), ['meshy', 'built']);
});

test('the chain always ends in the code-built model', () => {
  // Every hosted source can be out of credit, rate limited or down. None of
  // them failing should mean the user gets no model at all.
  for (const keys of [{}, { meshy: 'm' }, { tripo: 't' }, { meshy: 'm', tripo: 't', nim: 'n', trellisUrl: 'http://x' }]) {
    assert.equal(sourceChain(keys).at(-1), 'built');
  }
  // Whitespace is not a key.
  assert.deepEqual(sourceChain({ meshy: '   ', tripo: '' }), ['built']);
});

test('TRELLIS is only reachable through a self-hosted URL', () => {
  // The hosted endpoint cannot serve a prompt, so putting it in the chain would
  // cost ninety seconds and then fail on every single run.
  assert.ok(!sourceChain({ nim: 'nvapi-x' }).includes('trellis'));
  assert.ok(sourceChain({ nim: 'nvapi-x', trellisUrl: 'http://gpu:8000/v1/infer' }).includes('trellis'));
  // A URL with no key cannot authenticate.
  assert.ok(!sourceChain({ trellisUrl: 'http://gpu:8000' }).includes('trellis'));
});

test('the reason TRELLIS is skipped is available to show, not swallowed', () => {
  assert.match(trellisAvailability({}), /only serves its own sample images/);
  assert.match(trellisAvailability({ trellisUrl: 'http://x' }), /no NVIDIA key/);
  assert.equal(trellisAvailability({ trellisUrl: 'http://x', nim: 'n' }), null);
});

// ── The floor ───────────────────────────────────────────────────────────────

const PARTS = [
  { name: 'body', size: [8, 12, 4], at: [0, 12, 0] },
  { name: 'head', size: [8, 8, 8], at: [0, 24, 0] },
  { name: 'leftLeg', size: [4, 12, 4], at: [2, 0, 0] },
];

test('the code-built model is rigged for a body plan that has joints', () => {
  const biped = buildLocally({ prompt: 'a hero', plan: 'biped', parts: PARTS });
  assert.equal(biped.rigged, true);
  assert.ok(biped.bytes.byteLength > 0);

  // A blob has nothing to articulate, so it is honestly reported as unrigged
  // rather than given bones that never move.
  const blob = buildLocally({ prompt: 'a slime', plan: 'blob', parts: PARTS });
  assert.equal(blob.rigged, false);
});

test('the floor produces a real glb, not an empty file', () => {
  const { bytes } = buildLocally({ prompt: 'a hero', plan: 'biped', parts: PARTS });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, 'magic is "glTF"');
  assert.equal(view.getUint32(8, true), bytes.byteLength, 'the declared length matches');
});
