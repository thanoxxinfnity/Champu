/**
 * Lifts every reference picture (tools/ref/<name>.jpg) into a 3D model with Pixal3D on a Kaggle GPU.
 *
 *   KAGGLE_API_TOKEN=KGAT_... node --experimental-strip-types tools/pixal3d_batch.mjs [name ...]
 *
 * One kernel for the whole set, because the weights take far longer to load than a model takes to make
 * (see src/lib/suites/godot/kaggle.ts). Writes tools/raw/<name>.glb; skips the ones already there.
 * Needs a Kaggle account with a verified phone number (otherwise Kaggle gives no GPU and no internet).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateOnKaggle } from '../../../src/lib/suites/godot/kaggle.ts';
import { bytesToBase64 } from '../../../src/lib/suites/godot/model-source.ts';

const here = dirname(fileURLToPath(import.meta.url));
const token = process.env.KAGGLE_API_TOKEN;
if (!token) { console.error('set KAGGLE_API_TOKEN'); process.exit(2); }
const only = process.argv.slice(2);
const raw = join(here, 'raw');
mkdirSync(raw, { recursive: true });

const names = readdirSync(join(here, 'ref')).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4))
  .filter((n) => (!only.length || only.includes(n)) && !existsSync(join(raw, `${n}.glb`)));
if (!names.length) { console.log('nothing to do'); process.exit(0); }

const cfg = JSON.parse(readFileSync(join(here, 'assets.json'), 'utf8'));
const jobs = names.map((name) => ({ name, image: new Uint8Array(readFileSync(join(here, 'ref', `${name}.jpg`))), prompt: cfg.assets[name] }));
console.log(`sending ${jobs.length} pictures to Kaggle:`, names.join(', '));

const run = await generateOnKaggle(token, jobs, {
  toBase64: bytesToBase64,
  label: 'station nine props',
  compileIfMissing: true,
  onStage: (m) => console.log(new Date().toISOString(), m),
});
console.log('run:', run.url);
for (const m of run.models) {
  writeFileSync(join(raw, `${m.name}.glb`), m.bytes);
  console.log('  got', m.name, m.bytes.byteLength.toLocaleString(), 'bytes');
}
if (run.error) console.log('ERROR:', run.error);
console.log(run.log.split('\n').filter((l) => l.trim()).slice(-30).join('\n'));
process.exit(run.models.length ? 0 : 1);
