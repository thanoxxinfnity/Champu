/**
 * Does Pixal3D on Kaggle actually produce a mesh?
 *
 * Everything else about this path has been proven — the API, the GPU, the
 * wheel. This is the only question left, and it is the one that matters: an
 * integration that pushes a notebook and polls it correctly and comes back with
 * nothing is not a generator.
 *
 * Uses the real module, the cached wheel from the setup run, and a real image.
 */
import { generateOnKaggle } from '../src/lib/suites/godot/kaggle.ts';
import { bytesToBase64 } from '../src/lib/suites/godot/model-source.ts';
import { writeFileSync } from 'node:fs';

const token = process.argv[2];
if (!token) { console.log('usage: probe-kaggle-glb.mjs <kaggle-token>'); process.exit(1); }

// Pollinations: no key, which is the point — the free path must not need a paid one.
const prompt = 'a weathered red steel oil barrel, single object, centered, plain white background, product photo';
const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=7`;
console.log('image    fetching from Pollinations…');
const res = await fetch(url);
const image = new Uint8Array(await res.arrayBuffer());
console.log('image   ', image.byteLength.toLocaleString(), 'bytes');
writeFileSync('/tmp/kaggle-source.png', image);

const run = await generateOnKaggle(
  token,
  [{ name: 'barrel', image, prompt }],
  {
    toBase64: bytesToBase64,
    label: 'glb probe',
    onStage: (m) => console.log('        ·', m),
    timeoutMs: 40 * 60_000,
  },
);

console.log('');
if (run.models.length) {
  const m = run.models[0];
  writeFileSync('/tmp/kaggle-barrel.glb', m.bytes);
  console.log('PIXAL3D OK —', m.name + '.glb', m.bytes.byteLength.toLocaleString(), 'bytes in', run.seconds + 's');
  console.log('run:', run.url);
} else {
  console.log('PIXAL3D FAILED —', run.error);
  console.log('run:', run.url);
  console.log(run.log.split('\n').filter((l) => l.trim()).slice(-25).join('\n'));
}
