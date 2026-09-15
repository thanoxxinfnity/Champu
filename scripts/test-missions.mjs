/** node --experimental-strip-types --test scripts/test-missions.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { campaign, describeMissions, missionData, missionRunner, missionSelect } from '../src/lib/suites/godot/missions.ts';
import { animatorScript, effectsScript, pickupScript } from '../src/lib/suites/godot/effects.ts';
import { buildProject } from '../src/lib/suites/godot/project.ts';
import { verifyProject, shippable } from '../src/lib/suites/godot/verify.ts';

const SHOOTER = { name: 'Chomu Game', dimension: '3d', genre: 'shooter', view: 'first-person' };
const MISSIONS = campaign('Chomu Game');

test('the campaign teaches one thing at a time', () => {
  // A difficulty curve is a teaching order, not a multiplier. The first mission
  // is only shooting; each one after adds exactly one demand.
  assert.equal(MISSIONS.length, 5);
  assert.deepEqual(MISSIONS[0].objectives.map((o) => o.kind), ['eliminate']);
  assert.deepEqual(MISSIONS[1].objectives.map((o) => o.kind), ['survive']);
  assert.ok(MISSIONS[2].objectives.some((o) => o.kind === 'collect'));
  assert.ok(MISSIONS[3].objectives.some((o) => o.kind === 'defend'));

  // And it gets harder, monotonically, or the order is not a curve.
  for (let i = 1; i < MISSIONS.length; i += 1) {
    assert.ok(MISSIONS[i].difficulty > MISSIONS[i - 1].difficulty, `mission ${i + 1} is not harder than ${i}`);
    assert.ok(MISSIONS[i].firstWave >= MISSIONS[i - 1].firstWave);
  }
});

test('an objective that needs a place has one', () => {
  // `reach` and `defend` are checked against a position each frame. Without one
  // they measure the distance to the world origin, which is a bug that looks
  // like a mission completing itself.
  for (const mission of MISSIONS) {
    for (const objective of mission.objectives) {
      if (objective.kind === 'reach' || objective.kind === 'defend') {
        assert.ok(Array.isArray(objective.at), `${mission.id}: ${objective.kind} has nowhere to be`);
        assert.equal(objective.at.length, 3);
      }
      assert.ok(objective.target > 0, `${mission.id}: an objective with no target completes instantly`);
      assert.ok(objective.text.length > 4);
    }
  }
});

test('the campaign is data, so a mission cannot have a bug of its own', () => {
  const gd = missionData(MISSIONS);
  assert.match(gd, /const MISSIONS: Array = \[/);
  // Every mission reaches the table.
  for (const mission of MISSIONS) assert.ok(gd.includes(`"id": "${mission.id}"`), `${mission.id} is missing`);
  // And nothing in it is a script: no funcs inside the data.
  const table = gd.slice(gd.indexOf('const MISSIONS'), gd.indexOf('func count'));
  assert.ok(!table.includes('func '), 'a mission grew logic of its own');
});

test('a name with a quote in it does not end the GDScript string', () => {
  const gd = missionData([{ ...MISSIONS[0], name: 'The "Yard"', brief: 'He said "run".\nSo run.' }]);
  assert.match(gd, /"name": "The \\"Yard\\""/);
  // And the newline in the brief is escaped rather than breaking the line.
  assert.ok(!/"brief": "[^"]*\n/.test(gd));
});

test('progress is only unlocked forwards', () => {
  const gd = missionData(MISSIONS);
  // Replaying mission one must not lock missions two through five again.
  assert.match(gd, /if index <= unlocked\(\):\s*\n\s*return/);
  assert.match(gd, /clampi\(reached, 0, MISSIONS\.size\(\) - 1\)/);
});

test('every value read out of a Dictionary or ConfigFile is typed', () => {
  // `:=` through a Variant is a parse error, not a warning: the script fails to
  // load whole and the node it is on silently does nothing.
  for (const script of [missionData(MISSIONS), missionRunner(), missionSelect('G'), effectsScript(), animatorScript(), pickupScript()]) {
    for (const line of script.split('\n')) {
      if (!/^\s*var\s+\w+\s*:=/.test(line)) continue;
      assert.ok(
        !/(get_value|\.get\(|\[[^\]]+\])/.test(line) || /\bas\s+[A-Z]/.test(line),
        `inferred through an untyped value: ${line.trim()}`,
      );
    }
  }
});

test('a one-shot particle system is restarted, not just switched on', () => {
  // A one-shot GPUParticles3D already emitting ignores `emitting = true`, so
  // every shot after the first produces nothing — invisible until you hold the
  // trigger, which is exactly when you need it.
  const gd = effectsScript();
  assert.match(gd, /particles\.emitting = false\s*\n\s*particles\.restart\(\)\s*\n\s*particles\.emitting = true/);
});

test('particle gravity is set, because the default is a leak', () => {
  // ParticleProcessMaterial defaults gravity to -9.8 on Y. Sparks that should
  // fly outward fall straight down.
  assert.match(effectsScript(), /material\.gravity = Vector3\(/);
});

test('effects are pooled rather than created per hit', () => {
  const gd = effectsScript();
  assert.match(gd, /const POOL/);
  assert.ok(!/GPUParticles3D\.new\(\)[\s\S]{0,400}queue_free/.test(gd), 'an emitter per hit is a stutter at wave ten');
});

test('a hit on the world and a hit on something alive look different', () => {
  // Telling the two apart is most of what makes a hit read as a hit.
  const gd = effectsScript();
  assert.match(gd, /func impact\(/);
  assert.match(gd, /func hit\(/);
});

test('the animator matches a walk by shape, not by an exact name', () => {
  // The same clip is "Walk", "walking", "mixamo.com" and "Armature|Walk"
  // depending on who exported it.
  const gd = animatorScript();
  assert.match(gd, /lower\.contains\("walk"\)/);
  assert.match(gd, /lower\.contains\("run"\)/);
  // And a model with no clips still moves rather than sliding in a T-pose.
  assert.match(gd, /_find_skeleton/);
  assert.match(gd, /_swing_bone/);
});

test('a pickup only answers to the player', () => {
  // A zombie walking over the ammo should not collect it.
  assert.match(pickupScript(), /body\.has_method\("take_damage"\)/);
  assert.match(pickupScript(), /body\.has_method\("is_dead"\)/);
});

// ── How it all lands in the project ─────────────────────────────────────────

test('a shooter ships its missions, effects and animator', () => {
  const paths = buildProject(SHOOTER).map((f) => f.path);
  for (const path of ['missions.gd', 'mission_runner.gd', 'mission_select.gd', 'mission_select.tscn', 'effects.gd', 'animator.gd', 'pickup.gd']) {
    assert.ok(paths.includes(path), `missing ${path}`);
  }
  // And a runner gets none of it.
  assert.ok(!buildProject({ name: 'R', dimension: '3d' }).some((f) => f.path === 'missions.gd'));
});

test('the game opens on the mission list, not on a horde', () => {
  const config = buildProject(SHOOTER).find((f) => f.path === 'project.godot').content;
  assert.match(config, /run\/main_scene="res:\/\/mission_select\.tscn"/);
  // A non-shooter still opens straight into its scene.
  assert.match(
    buildProject({ name: 'R', dimension: '3d' }).find((f) => f.path === 'project.godot').content,
    /run\/main_scene="res:\/\/main\.tscn"/,
  );
});

test('the mission project still passes its own gate', () => {
  const files = buildProject(SHOOTER);
  const problems = verifyProject(files);
  assert.ok(shippable(problems), problems.filter((p) => p.fatal).map((p) => `${p.file}: ${p.message}`).join('\n'));

  // Both scenes' load_steps have to match, not just main.tscn's.
  for (const scene of files.filter((f) => f.path.endsWith('.tscn'))) {
    const declared = Number(/^\[gd_scene load_steps=(\d+)/.exec(scene.content)[1]);
    const resources = (scene.content.match(/^\[(ext_resource|sub_resource)/gm) ?? []).length;
    assert.equal(declared, resources + 1, `${scene.path}: load_steps is wrong`);
  }
});

test('the missions read as a list someone would want to play', () => {
  const described = describeMissions(MISSIONS);
  assert.match(described, /1\. \*\*First Night\*\*/);
  assert.equal(described.split('\n').length, MISSIONS.length);
});
