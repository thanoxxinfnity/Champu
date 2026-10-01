/**
 * Generates every 3D model of Chomu Dead with Microsoft TRELLIS (NVIDIA NIM).
 *
 *   NVIDIA_NIM_API_KEY=nvapi-... node --experimental-strip-types \
 *     examples/chomu-dead/tools/gen_trellis.mjs <raw_dir> [name ...]
 *
 * Skips models that already exist in <raw_dir>, so it is safe to re-run until
 * everything is there: the hosted service fails at random, and succeeds on a
 * retry (see src/lib/suites/godot/trellis.ts).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { generateModel } from '../../../src/lib/suites/godot/trellis.ts';

const KEY = process.env.NVIDIA_NIM_API_KEY;
const RAW = process.argv[2];
const only = process.argv.slice(3);
if (!KEY || !RAW) {
  console.error('usage: NVIDIA_NIM_API_KEY=... gen_trellis.mjs <raw_dir> [name ...]');
  process.exit(2);
}
mkdirSync(RAW, { recursive: true });

// Prompts are kept SHORT on purpose. Measured against the live API: a short
// prompt answers in ~11 s, while the same subject wrapped in "photorealistic,
// PBR materials, game-ready ..." stalls until the attempt times out. People are
// asked for in an A-pose so the walk cycle can be driven from the mesh itself
// (see shaders/puppet.gdshader). The word "zombie" is refused outright by
// NVIDIA's content filter (instant CONTENT_FILTERED), so the undead are ghouls.
const P = 'standing full body, A-pose';

const ASSETS = {
  // -- people --
  player: `a survivor man in an olive jacket and jeans with a backpack, ${P}`,
  zombie_walker: `ghoul, grey skin, torn clothes, ${P}`,
  zombie_runner: `an emaciated ghoul in a grey tracksuit, ${P}`,
  zombie_cop: `a ghoul in a torn dirty blue police uniform, ${P}`,
  zombie_nurse: `a ghoul in torn dirty medical scrubs, ${P}`,
  zombie_bloater: `a huge fat bloated ghoul with boils, ${P}`,
  boss_warden: `a giant muscular ghoul with chains on his arms and an orange prison jumpsuit, ${P}`,
  // -- guns --
  gun_pistol: 'a pistol handgun',
  gun_shotgun: ['a pump-action hunting gun with a wooden stock', 'a long wooden hunting gun', 'an old pump action firearm'],
  gun_smg: 'a submachine gun with a long magazine',
  gun_rifle: ['a long rifle with a wooden handguard and a curved magazine', 'a long rifle', 'a military carbine'],
  // -- pickups and small props --
  medkit: 'a white first aid kit with a red cross',
  ammo_box: 'a green military ammo box',
  barrel: 'a rusty oil drum barrel',
  crate: 'a weathered wooden supply crate',
  wheelchair: 'a rusty hospital wheelchair',
  hospital_bed: 'a rusty hospital bed with a stained mattress',
  bodybag: 'a black body bag lying on the ground',
  // -- street dressing --
  streetlamp: 'an old rusty street lamp post',
  barrier: 'a red and white road barrier',
  sandbags: 'a stack of sandbags',
  dumpster: 'a green dented dumpster',
  fence: 'a short section of rusty chain link fence',
  tombstone_cross: 'a weathered stone cross tombstone',
  tombstone_slab: 'a weathered mossy stone tombstone',
  deadtree: 'a dead leafless tree',
  // -- vehicles and buildings --
  car_wreck: 'an abandoned rusty wrecked sedan car',
  police_car: 'an abandoned police car',
  ambulance: 'an abandoned ambulance',
  van: 'a rusty abandoned white van',
  helicopter: 'a small rescue helicopter',
  house: 'a small abandoned two story house',
  clinic: 'an abandoned hospital building',
  church: 'a small old stone church with a bell tower',
  gas_station: 'an abandoned roadside gas station with a canopy',
};

const names = only.length ? only : Object.keys(ASSETS);
const queue = names.filter((n) => ASSETS[n] && !existsSync(`${RAW}/${n}.glb`));
console.log(`${names.length} requested, ${queue.length} to generate`);

const results = {};
async function worker(id) {
  while (queue.length) {
    const name = queue.shift();
    const t0 = Date.now();
    // Several wordings can be listed for one asset: NVIDIA's filter refuses some
    // gun words outright, and the next wording is tried when that happens.
    let out = { error: 'no prompt' };
    for (const prompt of [].concat(ASSETS[name])) {
      out = await generateModel({ prompt }, KEY, { rounds: 10, detail: 'standard', onProgress: (n) => console.log(`  .. ${name}: ${n}`) });
      if (out.model || !/filtered/i.test(out.error ?? '')) break;
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    if (out.model) {
      writeFileSync(`${RAW}/${name}.glb`, out.model);
      results[name] = { ok: true, bytes: out.model.byteLength, attempts: out.attempts, secs };
      console.log(`OK   ${name.padEnd(16)} ${(out.model.byteLength / 1e6).toFixed(1)} MB  ${out.attempts} attempts  ${secs}s  [w${id}]`);
    } else {
      results[name] = { ok: false, error: out.error, attempts: out.attempts, secs };
      console.log(`FAIL ${name.padEnd(16)} ${out.error}  [w${id}]`);
    }
  }
}
const WORKERS = Number(process.env.WORKERS || 2);
await Promise.all(Array.from({ length: WORKERS }, (_, i) => i + 1).map(worker));
const failed = Object.entries(results).filter(([, r]) => !r.ok).map(([n]) => n);
console.log(`done: ${Object.keys(results).length - failed.length} ok, ${failed.length} failed${failed.length ? ' → ' + failed.join(' ') : ''}`);
