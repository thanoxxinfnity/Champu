/**
 * Generates the 3D models of Project OVERRIDE with Microsoft TRELLIS (NVIDIA NIM).
 *
 *   source /root/.chomu/env.sh; node --experimental-strip-types examples/override/tools/gen_trellis.mjs <raw_dir> [name ...]
 *
 * Skips models already in <raw_dir>; re-run until everything is there (the hosted service fails at random).
 * Prompts stay SHORT (long ones stall) and avoid words the content filter refuses.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { generateModel } from '../../../src/lib/suites/godot/trellis.ts';

const KEY = process.env.NVIDIA_NIM_API_KEY;
const RAW = process.argv[2];
const only = process.argv.slice(3);
if (!KEY || !RAW) { console.error('usage: NVIDIA_NIM_API_KEY=... gen_trellis.mjs <raw_dir> [name ...]'); process.exit(2); }
mkdirSync(RAW, { recursive: true });

const P = 'standing full body, A-pose';
const ASSETS = {
  // -- creatures --
  warden: `a giant half broken security robot with glowing red eyes and heavy armor, ${P}`,
  crawler: `a broken humanoid robot with torn metal plating and exposed wires, ${P}`,
  hunter: `a blind humanoid robot with a smooth blank faceplate and long thin arms, ${P}`,
  skeleton: `a human skeleton in a torn white lab coat, ${P}`,
  // -- parts and gadgets --
  wiring: 'a coil of colored electrical wire',
  timer: 'a digital countdown timer device with wires',
  fuse2: 'a large industrial cartridge fuse, a glass tube with metal end caps and a glowing yellow filament',
  wiring2: 'a thick coil of insulated red electrical cable with exposed copper ends',
  shield: 'a handheld sci-fi energy shield generator, a round metal disc with a glowing blue core',
  medkit: 'a white first aid medical kit box with a red cross',
  hush: 'a pair of black stealth sneakers with soft rubber soles',
  beeper: 'a small round alarm beeper device with a red flashing light and a short antenna',
  charger: 'a sci-fi charging dock station, a tall metal post with a glowing blue charging port',
  cable: 'a coiled thick blue electrical power cable with a plug',
  scrap: 'a lump of twisted scrap metal with bolts',
  gel: 'a glowing green canister of explosive gel',
  detonator: 'a detonator device with a red button',
  emp_stunner: 'a handheld sci-fi stun gun device',
  mega_bomb: 'a bomb made of a metal case with a digital timer and green canisters strapped together',
  // -- set pieces --
  cryo_pod: 'a futuristic cryogenic sleep pod',
  server_rack: 'a tall black server rack with green blinking lights',
  conveyor: 'an industrial conveyor belt with rollers on a metal frame',
  reactor_core: 'a glowing blue nuclear reactor core with metal rings',
  ceiling_pipe: 'a long rusty metal pipe',
  monitor: 'an old computer monitor',
  lab_table: 'a metal laboratory table with equipment',
  forklift: 'a small abandoned forklift',
};

const names = only.length ? only : Object.keys(ASSETS);
const queue = names.filter((n) => ASSETS[n] && !existsSync(`${RAW}/${n}.glb`));
console.log(`${names.length} requested, ${queue.length} to generate`);
const results = {};
async function worker(id) {
  while (queue.length) {
    const name = queue.shift();
    const t0 = Date.now();
    let out = { error: 'no prompt' };
    for (const prompt of [].concat(ASSETS[name])) {
      out = await generateModel({ prompt }, KEY, { rounds: 10, detail: 'standard', onProgress: (n) => console.log(`  .. ${name}: ${n}`) });
      if (out.model || !/filtered/i.test(out.error ?? '')) break;
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    if (out.model) {
      writeFileSync(`${RAW}/${name}.glb`, out.model);
      results[name] = { ok: true };
      console.log(`OK   ${name.padEnd(14)} ${(out.model.byteLength / 1e6).toFixed(1)} MB ${out.attempts} attempts ${secs}s [w${id}]`);
    } else {
      results[name] = { ok: false };
      console.log(`FAIL ${name.padEnd(14)} ${out.error} [w${id}]`);
    }
  }
}
await Promise.all(Array.from({ length: Number(process.env.WORKERS || 2) }, (_, i) => i + 1).map(worker));
const failed = Object.entries(results).filter(([, r]) => !r.ok).map(([n]) => n);
console.log(`done: ${Object.keys(results).length - failed.length} ok, ${failed.length} failed${failed.length ? ' -> ' + failed.join(' ') : ''}`);
