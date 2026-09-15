/**
 * Is NVIDIA's TRELLIS working yet?
 *
 *   node --experimental-strip-types scripts/check-trellis.mjs "$NVIDIA_NIM_API_KEY"
 *
 * Exits 0 the moment it produces a real .glb, 1 while it is still broken. Its
 * job is to answer the question without a person having to remember the
 * endpoint, the payload, or which of the two URLs is the real one.
 *
 * It also checks FLUX on the same key, because "TRELLIS failed" and "the key
 * is dead" look identical from one failing call — and that ambiguity is what
 * sends people off re-entering credentials that were never the problem.
 */
import { writeFileSync } from 'node:fs';
import { generateModel } from '../src/lib/suites/godot/trellis.ts';

const KEY = process.argv[2] ?? process.env.NVIDIA_NIM_API_KEY;
const OUT = process.argv[3];
if (!KEY) {
  console.error('Usage: check-trellis.mjs <nvapi-key> [out.glb]');
  process.exit(2);
}

const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

/** Proves the key and the platform are fine, so a TRELLIS failure means TRELLIS. */
async function fluxWorks() {
  try {
    const res = await fetch('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      // 4 steps is schnell's setting; flux.1-dev refuses it, and a false
      // "FLUX is also down" would send the user chasing their key.
      body: JSON.stringify({ prompt: 'a grey cube', width: 1024, height: 1024, steps: 20, seed: 1 }),
      signal: AbortSignal.timeout(120_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const result = await generateModel(
  { prompt: 'a wooden treasure chest' },
  KEY,
  { rounds: 6, onProgress: (n) => console.log(`  ${n}`) },
);

if (result.model) {
  const path = OUT ?? 'trellis-output.glb';
  writeFileSync(path, result.model);
  const magic = String.fromCharCode(...result.model.slice(0, 4));
  console.log(`\n${stamp}  TRELLIS WORKS — ${result.model.byteLength} bytes, magic "${magic}", ${result.attempts} attempt(s) -> ${path}`);
  process.exit(0);
}

const flux = await fluxWorks();
console.log(`\n${stamp}  still broken`);
console.log(`  TRELLIS : ${result.error}`);
console.log(`  attempts: ${result.attempts}`);
console.log(`  FLUX    : ${flux ? 'works on the same key — so this is TRELLIS, not your credentials' : 'ALSO failing — check the key or the network first'}`);
process.exit(1);
