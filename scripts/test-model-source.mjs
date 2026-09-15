/** node --experimental-strip-types --test scripts/test-model-source.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { meshyError, resultFrom, taskIdFrom } from '../src/lib/suites/godot/meshy.ts';
import { SAMPLE_IMAGE, headersFor, modelFrom, requestBody, trellisError } from '../src/lib/suites/godot/trellis.ts';
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

test('the body carries the prompt and nothing else', () => {
  // Measured, and the opposite of the published schema: `seed`, `mode` and
  // `output_format` alongside a prompt do not get a validation error, they get
  // a 500. Every documented field is a field that breaks it.
  const body = JSON.parse(requestBody({ prompt: 'a stone golem' }));
  assert.deepEqual(Object.keys(body), ['prompt']);
  assert.match(body.prompt, /^a stone golem/);
  for (const forbidden of ['seed', 'mode', 'output_format', 'slat_cfg_scale']) {
    assert.equal(body[forbidden], undefined, `${forbidden} makes the service 500`);
  }
});

test('detail is steered through the prompt, because there is no parameter for it', () => {
  const low = JSON.parse(requestBody({ prompt: 'a chest' }, { detail: 'low' }));
  const high = JSON.parse(requestBody({ prompt: 'a chest' }, { detail: 'high' }));
  assert.match(low.prompt, /low poly/);
  assert.match(high.prompt, /detailed/);
  assert.deepEqual(Object.keys(low), ['prompt'], 'still nothing but the prompt');
});

test('the sample image is the only image the deployment takes', () => {
  const body = JSON.parse(requestBody({ sampleImage: true }));
  assert.deepEqual(body, { image: SAMPLE_IMAGE });
  assert.equal(SAMPLE_IMAGE, 'data:image/png;example_id,0');
  assert.equal(body.prompt, undefined, 'an image job must not also carry a prompt');
});

test('the content type carries no charset', () => {
  // With one, NVIDIA answers 415 and names the exact string it wanted:
  // "application/json; charset=utf-8. It must be application/json".
  const h = headersFor('nvapi-x');
  assert.equal(h['Content-Type'], 'application/json');
  assert.ok(!h['Content-Type'].includes('charset'));
  assert.equal(h['NVCF-POLL-SECONDS'], '300');
  assert.equal(h['NVCF-INPUT-ASSET-REFERENCES'], undefined, 'only sent with an upload');
  assert.equal(headersFor('nvapi-x', 'asset-1')['NVCF-INPUT-ASSET-REFERENCES'], 'asset-1');
});

test('a refused upload is reported as NVIDIA refusing it, not as a failed upload', () => {
  // The upload genuinely works — you get an assetId and the PUT succeeds. It is
  // TRELLIS that will not take the result, and a user told "upload failed"
  // would go and check their connection.
  const r = trellisError(422, '{"detail":"Expected: example_id, got: asset_id"}');
  assert.match(r.error, /reached them fine; they refused it/);
  assert.equal(r.upstreamBroken, true);
});

test("NVIDIA's own outage is reported as theirs", () => {
  // FLUX answered 200 in 4.2s on the same key in the same minute, so this is
  // not the key and not the network — and a user who reads "500" will retry
  // and re-enter their credentials instead of knowing that.
  const r = trellisError(500, 'Internal Server Error');
  assert.match(r.error, /FLUX works on the same key/);
  assert.equal(r.upstreamBroken, true);
});

test('a real auth, routing or rate-limit failure is still reported as one', () => {
  for (const status of [401, 403]) {
    const r = trellisError(status, '{}');
    assert.match(r.error, /rejected the key/);
    assert.ok(!r.upstreamBroken);
  }
  assert.match(trellisError(404, '{}').error, /does not exist/);
  assert.match(trellisError(429, '{}').error, /rate limiting/);
  assert.match(trellisError(415, '{}').error, /no charset/);
});

test('the model is read out of the response shape', () => {
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
