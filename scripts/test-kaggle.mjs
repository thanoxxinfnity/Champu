/** node --experimental-strip-types --test scripts/test-kaggle.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENV_KERNEL, PIXAL3D, looksLikeToken, pixal3dNotebook, readLog, resultFromLog, setupNotebook, slugFor, unavailable,
} from '../src/lib/suites/godot/kaggle.ts';
import { bytesToBase64, pipelineStatement, sourceChain } from '../src/lib/suites/godot/model-source.ts';

const b64 = (bytes) => bytesToBase64(bytes);
const IMAGE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

test('both shapes of Kaggle token are accepted, and nothing else', () => {
  // The newer API tokens and the legacy kaggle.json key go in the same field.
  assert.ok(looksLikeToken('KGAT_0f594895990fb98ef6d3635c628b1798'));
  assert.ok(looksLikeToken('0f594895990fb98ef6d3635c628b1798'));
  assert.ok(!looksLikeToken('hello'));
  assert.ok(!looksLikeToken(''));
  // Caught in settings rather than as a 401 ten minutes into a build.
  assert.match(unavailable('nonsense'), /start with/);
  assert.match(unavailable(''), /kaggle\.com\/settings/);
  assert.equal(unavailable('KGAT_0f594895990fb98ef6d3635c628b1798'), null);
});

test('the notebook runs the documented command, not an imagined API', () => {
  // The first version of this called a `Pixal3DPipeline` class that does not
  // exist. It is a CLI script, and every argument here is off the README.
  const nb = pixal3dNotebook([{ name: 'zombie', image: IMAGE, prompt: 'a zombie' }], b64);
  assert.match(nb, /python inference\.py/);
  assert.match(nb, /--image/);
  assert.match(nb, /--output/);
  assert.match(nb, /--low_vram/);
  assert.match(nb, /--resolution 1024/);
  // sdpa, because flash_attn is another CUDA build and torch already has one.
  assert.match(nb, /ATTN_BACKEND=sdpa/);
  // master, because main is a 404.
  assert.match(nb, /-b master/);
  assert.equal(PIXAL3D.branch, 'master');
});

test('one model that fails does not lose the others', () => {
  const nb = pixal3dNotebook(
    [{ name: 'a', image: IMAGE }, { name: 'b', image: IMAGE }],
    b64,
  );
  // Each job is tried in turn and its failure recorded, never raised.
  assert.match(nb, /results\["failed"\]\.append/);
  assert.ok(!/raise\b/.test(nb), 'a raise in the loop loses every model after it');
  assert.match(nb, /CHOMUGIRI_RESULT/);
});

test('every image reaches the notebook', () => {
  const nb = pixal3dNotebook([{ name: 'crate', image: IMAGE }, { name: 'barrel', image: IMAGE }], b64);
  const jobs = JSON.parse(JSON.parse(/JOBS = json\.loads\((".*?")\)\n/.exec(nb)[1]));
  assert.deepEqual(jobs.map((j) => j.name), ['crate', 'barrel']);
  assert.equal(jobs[0].b64, b64(IMAGE));
});

test('a cached wheel is used when one is attached, and built when it is not', () => {
  // natten compiles CUDA kernels, and that is nearly all of the setup time.
  const cold = pixal3dNotebook([{ name: 'a', image: IMAGE }], b64);
  assert.match(cold, /pip install -q natten==0\.21\.0 --no-build-isolation/);

  const warm = pixal3dNotebook([{ name: 'a', image: IMAGE }], b64, { cachedWheel: true });
  assert.match(warm, /glob\.glob\("\/kaggle\/input\/\*\*\/natten-\*\.whl"/);
  // And still compiles if the attachment is missing, rather than failing.
  assert.match(warm, /no cached wheel/);

  // The setup run builds a wheel rather than installing, because the wheel is
  // the artifact later runs attach.
  assert.match(setupNotebook(), /pip wheel natten==0\.21\.0/);
  assert.equal(ENV_KERNEL, 'chomugiri-pixal3d-env');
});

test('the T4 architecture is named, or the build takes an hour', () => {
  // Left unset, natten builds for every architecture. Kaggle's GPU is a T4.
  assert.equal(PIXAL3D.cudaArch, '7.5');
  assert.match(setupNotebook(), /NATTEN_CUDA_ARCH='7\.5'/);
});

test("Kaggle's log is unwrapped into what the kernel actually printed", () => {
  const raw = JSON.stringify([
    { stream_name: 'stdout', time: 1, data: 'hello\n' },
    { stream_name: 'stderr', time: 2, data: 'oh no\n' },
  ]);
  assert.equal(readLog(raw), 'hello\noh no\n');
  // Anything that is not that shape is passed through rather than swallowed.
  assert.equal(readLog('plain text'), 'plain text');
  assert.equal(readLog(''), '');
});

test('the result line is read back out of the log', () => {
  const log = 'noise\nCHOMUGIRI_RESULT {"models":[{"name":"zombie","bytes":120}],"failed":[]}\nmore noise';
  assert.deepEqual(resultFromLog(log).models, [{ name: 'zombie', bytes: 120 }]);
  assert.equal(resultFromLog('nothing here'), null);
});

test('each run gets its own slug, even in the same millisecond', () => {
  assert.match(slugFor('Chomu Game'), /^chomugiri-chomu-game-[a-z0-9]+$/);
  // A timestamp alone collides for two runs started together, and a collision
  // does not error: it pushes a new version over the other run's notebook, so
  // one build quietly gets the other's models.
  const many = new Set(Array.from({ length: 500 }, () => slugFor('x')));
  assert.equal(many.size, 500);
  // Kaggle slugs are lowercase and dashed.
  assert.match(slugFor('The "Yard" !!'), /^chomugiri-the-yard-/);
  for (const slug of many) assert.match(slug, /^[a-z0-9-]+$/);
});

// ── Where it sits in the chain ─────────────────────────────────────────────

test('a pasted Kaggle token beats the default nobody asked for', () => {
  // Same reasoning the file already applies to Meshy and Tripo: a credential
  // someone went and pasted is a deliberate choice.
  assert.deepEqual(sourceChain({ kaggle: 'KGAT_x', nim: 'nv' }), ['kaggle', 'trellis', 'built']);
  assert.deepEqual(sourceChain({ nim: 'nv' }), ['trellis', 'built']);
  assert.deepEqual(sourceChain({ kaggle: 'KGAT_x' }), ['kaggle', 'built']);
  // And the paid, rigging ones still go first for a character.
  assert.deepEqual(
    sourceChain({ kaggle: 'KGAT_x', meshy: 'm' }, 'character'),
    ['meshy', 'kaggle', 'built'],
  );
});

test('the pipeline line names Kaggle when it is what will be used', () => {
  const line = pipelineStatement({ kaggle: 'KGAT_x' });
  assert.match(line, /Pixal3D on a Kaggle GPU/);
  assert.match(line, /free/);
  // And does not claim it when no token is set.
  assert.ok(!pipelineStatement({}).includes('Kaggle'));
});

test('base64 survives an image big enough to blow the stack', () => {
  // String.fromCharCode(...bytes) on a real image is 200,000 arguments.
  const big = new Uint8Array(300_000).fill(65);
  const encoded = bytesToBase64(big);
  assert.equal(encoded.length, Math.ceil(300_000 / 3) * 4);
  assert.equal(atob(encoded).length, 300_000);
});

test('the token actually reaches the chain from both places that build a game', async () => {
  // The source can be in the chain and still be unreachable: the runtime used
  // to build its key object field by field, and a field left out is a
  // generator that is configured, listed, and never called.
  const { readFileSync } = await import('node:fs');
  for (const file of ['../src/lib/agent/runtime.ts', '../src/components/suites/GameStudio.tsx']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(src, /kaggle: keys\.kaggle/, `${file} never passes the Kaggle token`);
    // And the image half, or the source skips itself every time.
    assert.match(src, /renderImage: referenceImage/, `${file} has no way to make the reference image`);
  }
});

test('the reference image falls back to the provider that needs no key', async () => {
  // A user whose only credential is a Kaggle token must still get meshes.
  // Requiring NVIDIA for the image would make the free path depend on a paid one.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/lib/agent/runtime.ts', import.meta.url), 'utf8');
  const fn = /async function referenceImage[\s\S]*?\n}/.exec(src)[0];
  assert.ok(fn.indexOf("'nim'") < fn.indexOf("'pollinations'"), 'the keyless provider should be the fallback, not the first try');
  assert.match(fn, /return null/, 'it has to be able to say it could not');
  // Bigger than a plausible error page rendered as an image.
  assert.match(fn, /byteLength > 1024/);
});

test('the settings pane offers the field, and clearing keys clears it too', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/components/Settings.tsx', import.meta.url), 'utf8');
  assert.match(src, /Kaggle token \(optional\)/);
  assert.match(src, /setKaggle\(keys\.kaggle\)/, 'the field would show empty on every open');
  // "Clear all" that leaves one credential behind is worse than no button.
  assert.match(src, /saveKeys\(\{[^}]*kaggle: ''/);
});

test('the APK knows about the token too', async () => {
  // A credential the browser build has and the APK does not is a feature that
  // works right up until it is installed.
  const { readFileSync } = await import('node:fs');
  const kt = readFileSync(new URL('../android/app/src/main/java/com/chomugiri/workspace/server/ApiRouter.kt', import.meta.url), 'utf8');
  assert.match(kt, /var kaggleToken: String/);
  assert.match(kt, /secrets\.get\("kaggle_token"\)/);
  assert.match(kt, /if \(body\.has\("kaggleToken"\)\)/, 'it would never be saved');
  assert.match(kt, /\.put\("kaggleToken", kaggleToken\)/, 'it would never be read back');
});
