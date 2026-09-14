/** node --experimental-strip-types --test scripts/test-tripo.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { resultFrom, taskIdFrom, tripoError } from '../src/lib/suites/godot/tripo.ts';

test('a bad key is named as a bad key, not repeated as jargon', () => {
  // The exact body the live API returns without a key.
  const real = '{"code":1002,"message":"Authentication failed","suggestion":"Check if your credentials is valid, and ensure you set it correctly"}';
  const message = tripoError(401, real);
  assert.match(message, /rejected the API key/);
  assert.match(message, /platform\.tripo3d\.ai/);
});

test('other Tripo errors are passed through with their suggestion', () => {
  assert.match(
    tripoError(400, '{"code":2004,"message":"Insufficient balance","suggestion":"Top up your account"}'),
    /Insufficient balance.*Top up/s,
  );
  // A non-JSON body must not throw.
  assert.match(tripoError(502, '<html>gateway</html>'), /returned 502/);
});

test('the task id is read out of the create response', () => {
  assert.equal(taskIdFrom({ code: 0, data: { task_id: 'abc-123' } }), 'abc-123');
  assert.equal(taskIdFrom({ code: 0, data: {} }), null);
  assert.equal(taskIdFrom(null), null);
});

test('a queued job is queued, not a failure', () => {
  // Treating "not ready yet" as an error is how an async API gets misread as
  // a broken one.
  assert.deepEqual(resultFrom({ data: { status: 'queued', progress: 0 } }), { status: 'queued', progress: 0 });
  assert.deepEqual(resultFrom({ data: { status: 'running', progress: 42 } }), { status: 'running', progress: 42 });
});

test('a finished job yields the model URL, whichever key it arrives under', () => {
  // Tripo has moved this between `pbr_model` and `model` across versions.
  assert.deepEqual(
    resultFrom({ data: { status: 'success', output: { pbr_model: 'https://x/model.glb' } } }),
    { status: 'done', modelUrl: 'https://x/model.glb', progress: 100 },
  );
  assert.equal(resultFrom({ data: { status: 'success', output: { model: 'https://x/m.glb' } } }).modelUrl, 'https://x/m.glb');
});

test('success with no model is a failure, not a silent empty result', () => {
  const result = resultFrom({ data: { status: 'success', output: {} } });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /no model URL/);
});

test('every terminal failure state is reported as failed', () => {
  for (const status of ['failed', 'cancelled', 'banned']) {
    assert.equal(resultFrom({ data: { status } }).status, 'failed');
  }
});

test('a malformed response does not throw', () => {
  assert.equal(resultFrom(null).status, 'failed');
  assert.equal(resultFrom({}).status, 'failed');
});
