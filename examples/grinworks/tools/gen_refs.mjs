/**
 * The reference picture of every Grinworks prop, made with FLUX on NVIDIA NIM.
 *
 *   NVIDIA_NIM_API_KEY=nvapi-... node tools/gen_refs.mjs [name ...]
 *
 * One picture per prop in tools/ref/<name>.jpg. Pixal3D lifts each into a mesh
 * (tools/pixal3d_batch.mjs). Skips pictures that exist, so it is safe to re-run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, 'assets.json'), 'utf8'));
const KEY = process.env.NVIDIA_NIM_API_KEY;
if (!KEY) { console.error('set NVIDIA_NIM_API_KEY'); process.exit(2); }
const only = process.argv.slice(2);
mkdirSync(join(here, 'ref'), { recursive: true });

async function make(name, subject) {
  const out = join(here, 'ref', `${name}.jpg`);
  if (existsSync(out)) return 'have';
  const prompt = name === 'hollow' ? `${subject}, plain white background` : `${subject}, ${cfg.style}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ prompt, width: 1024, height: 1024, steps: 30, seed: 11 + attempt }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 80)}`);
      const j = await res.json();
      const b64 = j.artifacts?.[0]?.base64 ?? j.image;
      if (!b64) throw new Error('no image');
      writeFileSync(out, Buffer.from(b64, 'base64'));
      return `ok (try ${attempt})`;
    } catch (e) {
      console.log(`  ${name}: try ${attempt} failed — ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  return 'FAILED';
}

const names = Object.keys(cfg.assets).filter((n) => !only.length || only.includes(n));
const queue = [...names];
await Promise.all(Array.from({ length: 3 }, async () => {
  for (let n = queue.shift(); n; n = queue.shift()) console.log(n.padEnd(14), await make(n, cfg.assets[n]));
}));
