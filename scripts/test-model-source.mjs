/** node --experimental-strip-types --test scripts/test-model-source.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { meshyError, resultFrom, taskIdFrom } from '../src/lib/suites/godot/meshy.ts';
import { DEMO_ENDPOINT, modelFrom, requestBody, trellisError } from '../src/lib/suites/godot/trellis.ts';
import { buildLocally, resetTrellisState, sourceChain, trellisAvailability } from '../src/lib/suites/godot/model-source.ts';

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

test('the request carries a mode, which is what makes it a real request', () => {
  // Without `mode` the service guesses, and a body carrying both a prompt and
  // an image is ambiguous. Omitting it is why the first attempts never got past
  // validation.
  const text = requestBody({ prompt: 'a stone golem' });
  assert.equal(text.mode, 'text');
  assert.equal(text.prompt, 'a stone golem');
  assert.equal(text.output_format, 'glb');

  const image = requestBody({ imageDataUri: 'data:image/png;base64,AAAA' });
  assert.equal(image.mode, 'image');
  assert.equal(image.image, 'data:image/png;base64,AAAA');
  assert.equal(image.prompt, undefined, 'an image job must not also carry a prompt');
});

test('the build.nvidia.com demo endpoint is refused rather than called', () => {
  // It only serves NVIDIA's own sample pictures: an upload answers
  // 422 "Expected: example_id, got: base64" and a prompt answers 500 after
  // ninety seconds. Calling it is ninety seconds spent to learn nothing.
  const refused = trellisError(422, '{"detail":"Expected: example_id, got: base64"}', DEMO_ENDPOINT);
  assert.match(refused.error, /demo that only accepts their own sample images/);
  assert.equal(refused.upstreamBroken, true);
});

test("NVIDIA's own broken deployment is reported as theirs, not as the user's fault", () => {
  // Verified live: text mode is accepted (202) and then fails 500 on all three
  // attempts; image mode is refused 422 even with NVIDIA's own documented
  // example image at four different sizes. A user who reads "500" will retry
  // and re-enter their key instead.
  const failed = trellisError(500, 'Internal Server Error', 'https://api.nvcf.nvidia.com/x');
  assert.match(failed.error, /accepted the job and then failed it/);
  assert.equal(failed.upstreamBroken, true);

  const refused = trellisError(422, '{"detail":"Inference error"}', 'https://api.nvcf.nvidia.com/x');
  assert.match(refused.error, /own documented example image is refused the same way/);
  assert.equal(refused.upstreamBroken, true);
});

test('a real auth or routing failure is still reported as one', () => {
  // These are the user's to fix, so they must not be blamed on NVIDIA.
  for (const status of [401, 403]) {
    const r = trellisError(status, '{}', 'https://api.nvcf.nvidia.com/x');
    assert.match(r.error, /rejected the key/);
    assert.ok(!r.upstreamBroken);
  }
  const missing = trellisError(404, '{}', 'http://my-gpu:8000/v1/infer');
  assert.match(missing.error, /does not exist/);
  assert.ok(!missing.upstreamBroken);
});

test('the model is read out of the documented response shape', () => {
  // Object3DResponse: { artifacts: [{ base64, finishReason, seed }] }.
  const glb = Buffer.from('glTF\u0002\u0000\u0000\u0000').toString('base64');
  const ok = modelFrom({ artifacts: [{ base64: glb, finishReason: 'SUCCESS', seed: 0 }] });
  assert.ok(ok.model instanceof Uint8Array);
  assert.deepEqual([...ok.model.slice(0, 4)], [0x67, 0x6c, 0x54, 0x46]);

  assert.match(modelFrom({ artifacts: [{ base64: '', finishReason: 'SUCCESS' }] }).error, /no model/);
  assert.match(modelFrom({ artifacts: [{ base64: 'x', finishReason: 'CONTENT_FILTERED' }] }).error, /filtered/);
  assert.match(modelFrom({}).error, /without a model/);
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
  for (const keys of [{}, { meshy: 'm' }, { tripo: 't' }, { meshy: 'm', tripo: 't', nim: 'n' }]) {
    assert.equal(sourceChain(keys).at(-1), 'built');
  }
  // Whitespace is not a key.
  assert.deepEqual(sourceChain({ meshy: '   ', tripo: '' }), ['built']);
});

test('an NVIDIA key alone puts TRELLIS in the chain', () => {
  // TRELLIS is reachable as a real NVCF function on the NIM key — a self-hosted
  // URL is an override, not a requirement.
  assert.deepEqual(sourceChain({ nim: 'nvapi-x' }), ['trellis', 'built']);
  assert.deepEqual(sourceChain({ nim: 'nvapi-x', trellisUrl: 'http://gpu:8000' }), ['trellis', 'built']);
  // But after the keys the user deliberately pasted.
  assert.deepEqual(sourceChain({ nim: 'n', meshy: 'm', tripo: 't' }), ['meshy', 'tripo', 'trellis', 'built']);
  assert.ok(!sourceChain({ trellisUrl: 'http://gpu:8000' }).includes('trellis'), 'a URL with no key cannot authenticate');
});

test('the reason TRELLIS is unavailable is available to show, not swallowed', () => {
  resetTrellisState();
  assert.match(trellisAvailability({}), /needs an NVIDIA key/);
  assert.equal(trellisAvailability({ nim: 'nvapi-x' }), null);
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
