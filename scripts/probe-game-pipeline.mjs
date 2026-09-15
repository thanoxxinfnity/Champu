/**
 * Does Chomugiri's own pipeline build a game, or does it only look like it?
 *
 * Runs the real modules — the ones the app calls — on a real prompt, with no
 * hand-written game anywhere in the path.
 */
import { classifyLocal } from '../src/lib/agent/router.ts';
import { planGame, planSummary, planBrief, playerParts } from '../src/lib/suites/godot/plan.ts';
import { buildSystemPrompt } from '../src/lib/agent/system-prompt.ts';
import { generateModel } from '../src/lib/suites/godot/model-source.ts';
import { buildGodotExport, detectGodotProject } from '../src/lib/suites/godot/export.ts';
import { buildProject } from '../src/lib/suites/godot/project.ts';

const PROMPT = process.argv[2] ?? 'a zombie survival shooter called Chomu Game where you fight zombies';

console.log('PROMPT:', PROMPT, '\n');

// 1 — does it even route to the game suite?
const c = classifyLocal(PROMPT);
console.log('1. routing      suite =', c.suite ?? '(none)', ' lane =', c.lane);
if (c.suite !== 'godot') { console.log('   FAIL: never reaches the game suite'); process.exit(1); }

// 2 — does it read the prompt into a plan?
const plan = planGame(PROMPT);
console.log('2. plan         ', plan.name, '|', plan.genre, '|', plan.view, '|', plan.dimension);
console.log('   player       ', plan.player.description, `(${plan.player.body})`);
console.log('   entities     ', plan.entities.map((e) => `${e.name}:${e.role}`).join(', ') || '(none)');
console.log('   mechanics    ', plan.mechanics.length, ' controls', plan.controls.length);
console.log('   assumptions  ', plan.assumptions.length);

// 3 — is the plan actually handed to the model?
const sys = buildSystemPrompt({ lane: 'B', suite: 'godot', gamePlan: planBrief(plan) });
console.log('3. prompt       ', sys.length, 'chars; carries the plan:', sys.includes(`Name: ${plan.name}`));
console.log('   tells it to build the plan:', /Do not substitute a different genre/.test(sys));

// 4 — does a model actually come out?
const t0 = Date.now();
const outcome = await generateModel(
  { prompt: `${plan.player.description}, ${plan.genre} game character`, plan: plan.player.body, parts: playerParts(plan) },
  {},  // no keys: this is the floor everyone gets
  {},
);
console.log('4. model        source =', outcome.source, ' rigged =', outcome.rigged,
  ' bytes =', outcome.bytes?.byteLength ?? 0, ` (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const magic = outcome.bytes ? String.fromCharCode(...outcome.bytes.slice(0, 4)) : '';
console.log('   real glTF:   ', magic === 'glTF');

// 5 — do the project files exist, and would Godot open them?
const files = buildProject({ name: plan.name, dimension: plan.dimension, genre: plan.genre, view: plan.view,
  models: [{ path: 'res://hero.glb', node: 'Hero', rigged: true }] })
  .map((f) => ({ path: f.path, content: f.content }));
// The generated model goes in as a workspace file, the way the runtime adds it:
// a data URL, so it travels the same path as every text file.
if (outcome.bytes) {
  let bin = '';
  for (let i = 0; i < outcome.bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...outcome.bytes.subarray(i, i + 0x8000));
  }
  files.push({ path: 'hero.glb', content: `data:model/gltf-binary;base64,${btoa(bin)}` });
}
console.log('5. project      ', files.length, 'files:', files.map((f) => f.path).join(', '));

// 6 — does it package?
const exported = buildGodotExport(files, plan);
console.log('6. export       ', exported ? exported.filename : '(none)',
  exported ? `${exported.entries.length} entries` : '');
console.log('   problems:    ', exported?.problems.length ? exported.problems : 'none');

const ok = c.suite === 'godot' && plan.entities.length > 0 && magic === 'glTF'
  && files.length >= 6 && exported && exported.problems.length === 0;
console.log('\nRESULT:', ok ? 'the pipeline produces a game' : 'SOMETHING IS MISSING');
process.exit(ok ? 0 : 1);
