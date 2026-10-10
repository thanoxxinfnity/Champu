/**
 * The 3D props from Microsoft TRELLIS on NVIDIA NIM: text in, a .glb out. This is the path that needs no GPU
 * of its own, so it is what fills the station while Pixal3D (tools/pixal3d_batch.mjs) waits for a Kaggle account
 * that is allowed a GPU. Either one writes raw models; prep_s9.py turns them into phone-sized game models.
 *
 *   NVIDIA_NIM_API_KEY=nvapi-... node --experimental-strip-types tools/gen_trellis.mjs <raw_dir> [name ...]
 *
 * Skips models that already exist, so it is safe to re-run until everything is there: the hosted service fails
 * at random and succeeds on a retry (see src/lib/suites/godot/trellis.ts). Prompts are short on purpose.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateModel } from '../../../src/lib/suites/godot/trellis.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, 'assets.json'), 'utf8'));
const KEY = process.env.NVIDIA_NIM_API_KEY;
const RAW = process.argv[2];
const only = process.argv.slice(3);
if (!KEY || !RAW) { console.error('usage: NVIDIA_NIM_API_KEY=... gen_trellis.mjs <raw_dir> [name ...]'); process.exit(2); }
mkdirSync(RAW, { recursive: true });

// The hosted filter refuses some words outright; the next wording is tried when that happens.
const WORDINGS = {
  mr_grin: ['a tall yellow plush toy monster with a huge toothy smile and very long thin arms, standing, A-pose', 'a tall smiling yellow stuffed toy creature with long arms, standing, A-pose'],
  mr_grin_b: ['a tall pink stuffed toy rabbit creature with a huge creepy grin and very long arms, standing, A-pose'],
  mr_grin_c: ['a tall orange plush clown monster with a huge smile and long thin arms, standing, A-pose'],
  hollow: ['a tall thin pale creature with very long arms and a glowing lure on its head, standing, A-pose', 'a tall skinny pale alien creature with long arms, standing, A-pose'],
  keycard: 'an orange plastic keycard',
  fuse: 'a large ceramic cartridge fuse',
  battery: 'a large cylindrical battery',
  power_cell: 'a glowing blue energy cell cylinder',
};
const names = (only.length ? only : Object.keys(cfg.assets)).filter((n) => cfg.assets[n] && !existsSync(`${RAW}/${n}.glb`));
console.log(`${names.length} to generate`);
const queue = [...names];
const failed = [];
async function worker(id) {
  while (queue.length) {
    const name = queue.shift();
    const t0 = Date.now();
    let out = { error: 'no prompt' };
    for (const prompt of [].concat(WORDINGS[name] ?? cfg.assets[name])) {
      out = await generateModel({ prompt }, KEY, { rounds: 10, detail: 'standard', onProgress: (n) => console.log(`  .. ${name}: ${n}`) });
      if (out.model || !/filtered/i.test(out.error ?? '')) break;
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    if (out.model) {
      writeFileSync(`${RAW}/${name}.glb`, out.model);
      console.log(`OK   ${name.padEnd(14)} ${(out.model.byteLength / 1e6).toFixed(1)} MB  ${out.attempts} attempts  ${secs}s  [w${id}]`);
    } else {
      failed.push(name);
      console.log(`FAIL ${name.padEnd(14)} ${out.error}  [w${id}]`);
    }
  }
}
await Promise.all(Array.from({ length: Number(process.env.WORKERS || 2) }, (_, i) => worker(i + 1)));
console.log(`done: ${names.length - failed.length} ok, ${failed.length} failed${failed.length ? ' → ' + failed.join(' ') : ''}`);
