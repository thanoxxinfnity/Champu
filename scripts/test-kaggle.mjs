/** node --experimental-strip-types --test scripts/test-kaggle.mjs */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import test from 'node:test';
import {
  ENV_ARCHIVE, ENV_KERNEL, PIXAL3D, looksLikeToken, pixal3dNotebook, readLog, resultFromLog, setupNotebook, slugFor, unavailable,
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
  // The *loop*, not the whole notebook: the BiRefNet stub raises on purpose, to
  // say loudly that it was called when it never should be.
  const loop = nb.slice(nb.indexOf('for job in JOBS'), nb.indexOf('results["seconds"]'));
  assert.ok(!/^\s*raise\b/m.test(loop), 'a raise in the loop loses every model after it');
  assert.match(nb, /CHOMUGIRI_RESULT/);
});

test('every image reaches the notebook', () => {
  const nb = pixal3dNotebook([{ name: 'crate', image: IMAGE }, { name: 'barrel', image: IMAGE }], b64);
  const jobs = JSON.parse(JSON.parse(/JOBS = json\.loads\((".*?")\)\n/.exec(nb)[1]));
  assert.deepEqual(jobs.map((j) => j.name), ['crate', 'barrel']);
  assert.equal(jobs[0].b64, b64(IMAGE));
});

test('a compiled environment is restored when one is attached, and built when not', () => {
  // TRELLIS.2's setup compiles five CUDA extensions and natten compiles a
  // sixth. That is the better part of an hour, and it is the same hour every
  // run unless the result is kept.
  const cold = pixal3dNotebook([{ name: 'a', image: IMAGE }], b64);
  assert.match(cold, /setup\.sh --basic --nvdiffrast --cumesh --o-voxel --flexgemm/);

  const warm = pixal3dNotebook([{ name: 'a', image: IMAGE }], b64, { cached: true });
  assert.ok(warm.includes(ENV_ARCHIVE), 'the cached environment is never looked for');
  assert.match(warm, /tar -xzf/);
  // gzip, because zstd is not on Kaggle's image: `tar -I zstd` answers
  // "Cannot exec: No such file or directory" and writes nothing, on both ends.
  assert.ok(!warm.includes('zstd'), 'zstd is not installed there');
  // And a restore that fails must fall back rather than carry on: a silent one
  // surfaces later as a ModuleNotFoundError that looks nothing like a cache bug.
  assert.match(warm, /would not unpack/);
  // And still compiles if the attachment is missing, rather than failing.
  assert.match(warm, /no cached environment/);

  // The setup run packs whatever the compile added, by diffing site-packages —
  // naming the packages by hand goes stale the moment TRELLIS.2 adds a sixth.
  const setup = setupNotebook();
  assert.match(setup, /added = sorted\(after - before\)/);
  assert.ok(!setup.includes("-I 'zstd"), 'zstd is not installed on the image');
  // tar's exit code is checked, unlike Godot's. tar means it.
  assert.match(setup, /tar exited/);
  assert.ok(setup.includes(ENV_ARCHIVE));
  assert.equal(ENV_KERNEL, 'chomugiri-pixal3d-env');
});

test('the install is the one the repository documents, not the one I assumed', () => {
  // The first attempt skipped TRELLIS.2 entirely and got all the way to
  // `import cumesh` before a ModuleNotFoundError. Pixal3D's README step one is
  // "follow the TRELLIS.2 installation", and that is not a pip install.
  const nb = pixal3dNotebook([{ name: 'a', image: IMAGE }], b64);
  assert.match(nb, /TRELLIS\.2\.git/);
  assert.match(nb, /--recursive/);
  // The command line itself, not the whole notebook: the comment above it
  // *names* the flags it leaves out, and a blunt `includes` reads the
  // explanation as the thing it explains.
  // Anchored on `./setup.sh`, which only the command has — the comment above it
  // says "setup.sh" too, and matching that read the explanation as the thing
  // it explains. Twice now.
  const cmd = /\.\/setup\.sh ([^"\n]*)/.exec(nb)[1];
  // No --new-env: Kaggle already is the environment.
  assert.ok(!cmd.includes('--new-env'), cmd);
  // No --flash-attn: another long CUDA build, and torch has SDPA.
  assert.ok(!cmd.includes('--flash-attn'), cmd);
  // No --nvdiffrec: its wheel does not build on Kaggle's image, inference does
  // not import it, and asking for it makes setup.sh return non-zero — hiding
  // every other extension's success behind one failure that does not matter.
  assert.ok(!cmd.includes('--nvdiffrec'), cmd);
  assert.match(cmd, /--cumesh/);
  assert.match(cmd, /--o-voxel/);
  assert.match(cmd, /--flexgemm/);
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

test('the run is polled at the slug Kaggle made, not the one it was asked for', async () => {
  // Kaggle derives the slug from `newTitle`, so `chomugiri-glb-run-m2x8q4k1`
  // went up as plain `chomugiri-glb-run`. Every poll afterwards asked about a
  // notebook that does not exist, got `unknown`, and waited the full forty
  // minutes for a run that had finished in one.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/lib/suites/godot/kaggle.ts', import.meta.url), 'utf8');
  assert.match(src, /const live = pushed\.slug \?\? slug/);
  assert.match(src, /kernelStatus\(token, me\.user, live/);
  assert.match(src, /kernelOutput\(token, me\.user, live/);

  // And the push URL is used as given: it is already absolute, and prefixing it
  // produced https://www.kaggle.comhttps://www.kaggle.com/…
  assert.ok(!src.includes('`https://www.kaggle.com${json.url}`'));
});

test('an unrecognised run gives up instead of waiting out the timeout', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/lib/suites/godot/kaggle.ts', import.meta.url), 'utf8');
  // No amount of further waiting turns a wrong slug into a right one.
  assert.match(src, /unknowns >= 3/);
  assert.match(src, /does not recognise the run/);
});

test('the title carries the unique part, because the title is what is slugified', async () => {
  // A unique slug under a reused title asks for a notebook that does not exist
  // while the title points at one that does: 409, after the setup has already
  // been paid for.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/lib/suites/godot/kaggle.ts', import.meta.url), 'utf8');
  assert.match(src, /title: slug\.replace/);
  assert.ok(!/title: `Chomugiri — \$\{options\.label/.test(src));
});

test('a run does not rely on a cache nobody built', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/lib/suites/godot/kaggle.ts', import.meta.url), 'utf8');
  // Attaching a kernel that does not exist is not harmless: the notebook falls
  // through to compiling — the better part of an hour — on top of everything a
  // cached run already has to do.
  assert.match(src, /kernelStatus\(token, me\.user, ENV_KERNEL/);
  assert.match(src, /has not been built on this Kaggle account yet/);
  // And the uncached deadline leaves room for that compile on top of the rest.
  const [, cached, cold] = src.match(/haveCache \? (\d+) : (\d+)\) \* 60_000/);
  assert.ok(Number(cold) - Number(cached) >= 45, `a compile needs more than ${Number(cold) - Number(cached)}m`);
});

test('the image is cut out here, so the gated model is never reached', () => {
  // Pixal3D's preprocess reads: RGBA with any non-opaque pixel → use as is;
  // otherwise → briaai/RMBG-2.0, which is **gated on HuggingFace**. Without a
  // token whose account accepted the licence, the run dies with "You are trying
  // to access a gated repo" five minutes into a GPU booking.
  const nb = pixal3dNotebook([{ name: 'a', image: IMAGE }], b64);
  assert.match(nb, /def cut_out/);
  assert.match(nb, /floodfill/);
  // Flood-filled from the corners, not thresholded: a brightness threshold also
  // erases every white part *of the object*, and a white barrel comes back as
  // a hoop.
  assert.match(nb, /img\.width - 1, 0/);
  assert.ok(!/pixels\[:, :, 0\] > 2[0-9][0-9]/.test(nb), 'that is a threshold, not a fill');
  // A fill that swallowed the image means the object matches its background —
  // better to fail honestly than to send an empty picture and get an empty mesh.
  assert.match(nb, /> 0\.92/);
  // And it never throws: without alpha the run reaches the gated model and
  // fails there, which is a clearer error than this one.
  assert.match(nb, /could not cut out/);
});

test('the notebook is valid Python before a GPU is booked for it', () => {
  // A syntax error here costs a queue, a boot and an install before anything
  // says so. Python is on this machine; asking it is free.
  const { execFileSync } = require('node:child_process');
  const { writeFileSync, mkdtempSync } = require('node:fs');
  const { join } = require('node:path');
  const { tmpdir } = require('node:os');

  const dir = mkdtempSync(join(tmpdir(), 'nb-'));
  for (const [name, source] of [
    ['generate.py', pixal3dNotebook([{ name: 'a', image: IMAGE, prompt: 'x' }], b64)],
    ['generate-cached.py', pixal3dNotebook([{ name: 'a', image: IMAGE }], b64, { cached: true })],
    ['setup.py', setupNotebook()],
  ]) {
    const path = join(dir, name);
    writeFileSync(path, source);
    execFileSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', path]);
  }
});

test('the gated background remover is replaced, not just avoided', () => {
  // Cutting the image out is not enough on its own: BiRefNet is constructed
  // *eagerly* in Pipeline.from_pretrained, so the run dies loading a model it
  // was never going to use. Both halves are needed.
  const nb = pixal3dNotebook([{ name: 'a', image: IMAGE }], b64);
  assert.match(nb, /class BiRefNet/);
  assert.match(nb, /rembg\/__init__\.py/);
  assert.match(nb, /fh\.write\(SHIM\)/);
  // The stub has the surface the pipeline touches: constructed, moved to a
  // device, and never called.
  assert.match(nb, /def to\(self, \*args, \*\*kwargs\)/);
  assert.match(nb, /raise RuntimeError/);
  // And it is written before anything imports it.
  assert.ok(nb.indexOf('fh.write(SHIM)') < nb.indexOf('_compile()'));
});

test('the timeout it reports is the timeout it actually waited', async () => {
  // A cold run gets 75 minutes and a cached one 30. The message used to compute
  // its own number from a different default, so a cold run that waited 75
  // minutes told the user it had waited 30 — and the obvious next move,
  // "give it longer", was already what it had done.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/lib/suites/godot/kaggle.ts', import.meta.url), 'utf8');
  assert.match(src, /const budgetMs = options\.timeoutMs \?\? \(haveCache \? 90 : 150\) \* 60_000;/);
  // A cached run reached the attention stage at 57 minutes, so any cached
  // budget at or under an hour is a timeout reported for a working run.
  const [, cached] = src.match(/haveCache \? (\d+) : \d+\) \* 60_000/);
  assert.ok(Number(cached) > 60, `cached budget ${cached}m is under the 57m a run has taken`);
  assert.match(src, /const deadline = Date\.now\(\) \+ budgetMs;/);
  assert.match(src, /did not finish within \$\{Math\.round\(budgetMs \/ 60_000\)\} minutes/);
  // And no second, independently-guessed budget anywhere in the wait path.
  assert.ok(!/options\.timeoutMs \?\? 30 \* 60_000/.test(src));
});

test('the attention that ran the T4 out of memory is replaced, and the patch is loud', async () => {
  // Pixal3D ran for 57 minutes, downloaded the weights and got three stages in
  // before torch's math backend asked for a 7.17 GiB score matrix on a 14.56 GiB
  // card. The fix is a shim; a shim that silently fails to apply costs the same
  // hour and then fails the same way, so the install raises instead.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/lib/suites/godot/kaggle.ts', import.meta.url), 'utf8');
  assert.match(src, /from chomugiri_sdpa import chunked_sdpa as _sdpa/);
  assert.match(src, /PIXAL3D_UNAVAILABLE: the sdpa import moved/);
  // The allocator hint the out-of-memory error itself asks for.
  assert.match(src, /PYTORCH_ALLOC_CONF=expandable_segments:True/);
});

test('the shim is real Python and returns the same numbers torch does', async () => {
  const { pixal3dNotebook } = await import('../src/lib/suites/godot/kaggle.ts');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const dir = mkdtempSync(join(tmpdir(), 'chomu-sdpa-'));
  const book = join(dir, 'notebook.py');
  writeFileSync(book, pixal3dNotebook(
    [{ name: 'barrel', image: new Uint8Array([1, 2, 3, 4]), prompt: 'a barrel' }],
    (bytes) => Buffer.from(bytes).toString('base64'),
    { cached: false },
  ));

  const script = new URL('./check-sdpa-shim.py', import.meta.url).pathname;
  let out = '';
  try {
    out = execFileSync('python3', [script, book], { encoding: 'utf8' });
  } catch (err) {
    const said = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    // No torch on this machine is not a failing shim; anything else is.
    if (/torch is not installed/.test(said)) {
      assert.match(said, /shim compiles/);
      return;
    }
    throw new Error(said || String(err));
  }
  assert.match(out, /shim compiles/);
  assert.match(out, /chunked SDPA matches torch/);
});

test('the NAF upsample is cut to a size the T4 can hold', async () => {
  // With the attention fixed the run reached the texture stage and died there:
  // NAF was asked for a 1024x1024 map of DINOv3's 1024 channels, and
  // 1024*1024*1024 floats is 4.29 GiB — the 4.00 GiB allocation in the trace.
  //
  // Halving it is safe because proj_grid samples the map with grid_sample at
  // normalised coordinates, so what comes out is [B, grid_res^3, D] whatever
  // resolution went in. Pixal3D's own shape stage already runs at 512.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/lib/suites/godot/kaggle.ts', import.meta.url), 'utf8');
  const [, size] = src.match(/nafTargetSize: (\d+),/);
  assert.ok(Number(size) <= 512, `${size} still needs ${(size ** 2 * 1024 * 4) / 2 ** 30} GiB`);
  assert.match(src, /PIXAL3D_UNAVAILABLE: the NAF target size moved/);

  // The notebook must carry the substitution, with the named size in it.
  const nb = pixal3dNotebook([{ name: 'a', image: IMAGE }], b64);
  assert.match(nb, /"naf_target_size": 1024,/);
  assert.ok(nb.includes(`"naf_target_size": ${size},`));
});

test('the mesh comes back at game size, not film size', async () => {
  // The first barrel Pixal3D produced was real and it was unusable: 943,904
  // triangles, a 4096 texture, 37 MB for one prop. Twenty of those is a 700 MB
  // game on top of a 27 MB engine.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/lib/suites/godot/kaggle.ts', import.meta.url), 'utf8');
  const [, tris] = src.match(/decimationTarget: (\d+),/);
  const [, tex] = src.match(/textureSize: (\d+),/);
  assert.ok(Number(tris) <= 20000, `${tris} triangles is not a mobile prop`);
  assert.ok(Number(tex) <= 2048, `a ${tex} texture is not a mobile prop`);
  assert.match(src, /PIXAL3D_UNAVAILABLE: the GLB extraction settings moved/);

  const nb = pixal3dNotebook([{ name: 'a', image: IMAGE }], b64);
  assert.match(nb, /decimation_target=1000000, texture_size=4096,/);
  assert.ok(nb.includes(`decimation_target=${tris}, texture_size=${tex},`));
});

test('the weights are built once per process, not once per call', async () => {
  // 230 minutes end to end, of which 28 were the sampling stages and the GLB
  // extraction. The rest was init_pipeline: the Pixal3D checkpoints, four
  // DINOv3 ViT-L extractors, NAF and MoGe, constructed from nothing. Nothing
  // upstream caches that, so a server answering two requests would pay it
  // twice and be no faster than two separate runs.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/lib/suites/godot/kaggle.ts', import.meta.url), 'utf8');
  assert.match(src, /MEMO_SHIM = /);
  assert.match(src, /_CHOMUGIRI_CACHE = \{\}/);
  assert.match(src, /so every request would have/);

  const nb = pixal3dNotebook([{ name: 'a', image: IMAGE }], b64);
  assert.match(nb, /_chomugiri_init_pipeline\(model_path, device, low_vram\)/);
  assert.match(nb, /_chomugiri_load_moge_model\(device, model_name\)/);
  // MoGe is moved back to the GPU on a cache hit: run_inference sends it to the
  // CPU after the camera pass, and the cached object is the same object.
  assert.match(nb, /return _CHOMUGIRI_CACHE\[key\]\.to\(device\)/);
});

test('every edit lands on the Pixal3D that actually ships', async () => {
  // The anchors are lines in someone else's repository. Checking them against a
  // real checkout is the only way to know they are still there — and the check
  // runs the notebook's own patch_inference rather than a copy of it, because a
  // copy passed twice while the notebook would not even parse.
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync, mkdtempSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { pixal3dNotebook } = await import('../src/lib/suites/godot/kaggle.ts');

  const checkout = process.env.PIXAL3D_CHECKOUT ?? '/tmp/px';
  if (!existsSync(join(checkout, 'inference.py'))) {
    // Cloning inside a unit test would make the suite need the network and a
    // minute; saying so beats a green tick that checked nothing.
    console.log(`    (no Pixal3D checkout at ${checkout} — anchors not verified against upstream)`);
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), 'chomu-patch-'));
  const book = join(dir, 'notebook.py');
  writeFileSync(book, pixal3dNotebook(
    [{ name: 'barrel', image: new Uint8Array([1, 2, 3, 4]) }],
    (bytes) => Buffer.from(bytes).toString('base64'),
    { cached: false },
  ));

  const script = new URL('./check-pixal3d-patches.py', import.meta.url).pathname;
  let out = '';
  try {
    out = execFileSync('python3', [script, book, join(checkout, 'inference.py')], { encoding: 'utf8' });
  } catch (err) {
    throw new Error(`${err.stdout ?? ''}${err.stderr ?? ''}` || String(err));
  }
  assert.match(out, /ALL PIXAL3D PATCHES APPLY/);
});
