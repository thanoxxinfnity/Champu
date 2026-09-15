/** node --experimental-strip-types --test scripts/test-godot.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProject,
  mainScene,
  projectConfig,
  projectFolder,
  sceneUid,
  validateProject,
} from '../src/lib/suites/godot/project.ts';
import { GODOT_ADDENDUM } from '../src/lib/agent/system-prompt.ts';

const SPEC = { name: 'Space Runner', dimension: '3d' };

test('a generated project passes its own validation', () => {
  assert.deepEqual(validateProject(buildProject(SPEC)), []);
});

test('load_steps matches the resource count, or the scene loads with nodes missing', () => {
  // The classic hand-written .tscn bug, and the reason validation exists.
  for (const models of [[], [{ path: 'res://hero.glb', node: 'Hero' }], [
    { path: 'res://a.glb', node: 'A' },
    { path: 'res://b.glb', node: 'B', at: [2, 0, 1] },
  ]]) {
    const scene = mainScene({ ...SPEC, models });
    const declared = Number(/load_steps=(\d+)/.exec(scene)[1]);
    const resources = (scene.match(/^\[(ext_resource|sub_resource)/gm) ?? []).length;
    assert.equal(declared, resources + 1, `${models.length} models`);
  }
});

test('validation catches a wrong load_steps rather than shipping it', () => {
  const files = buildProject(SPEC);
  const scene = files.find((f) => f.path === 'main.tscn');
  scene.content = scene.content.replace(/load_steps=\d+/, 'load_steps=2');
  assert.match(validateProject(files).join(' '), /load_steps is 2 but the scene has/);
});

test('every referenced resource id is declared', () => {
  const scene = mainScene({ ...SPEC, models: [{ path: 'res://hero.glb', node: 'Hero' }] });
  const declaredExt = new Set([...scene.matchAll(/^\[ext_resource[^\]]*id="([^"]+)"/gm)].map((m) => m[1]));
  for (const m of scene.matchAll(/ExtResource\("([^"]+)"\)/g)) {
    assert.ok(declaredExt.has(m[1]), `${m[1]} declared`);
  }
  const declaredSub = new Set([...scene.matchAll(/^\[sub_resource[^\]]*id="([^"]+)"/gm)].map((m) => m[1]));
  for (const m of scene.matchAll(/SubResource\("([^"]+)"\)/g)) {
    assert.ok(declaredSub.has(m[1]), `${m[1]} declared`);
  }
});

test('validation catches a main scene that is not in the project', () => {
  const files = buildProject(SPEC).filter((f) => f.path !== 'main.tscn');
  assert.match(validateProject(files).join(' '), /Main scene "main.tscn" is referenced but not in the project/);
});

test('validation catches a script reference with no script', () => {
  const files = buildProject(SPEC).filter((f) => f.path !== 'player.gd');
  assert.match(validateProject(files).join(' '), /points at script "player.gd"/);
});

test('the renderer is set for a phone, because that is where this opens', () => {
  // Godot's Forward+ default does not run on most phones, and the editor this
  // is imported into is itself a phone.
  const config = projectConfig(SPEC);
  assert.match(config, /renderer\/rendering_method="mobile"/);
  assert.match(config, /renderer\/rendering_method\.mobile="gl_compatibility"/);
  assert.match(config, /^config_version=5$/m);
});

test('the project name reaches the config, quotes and all', () => {
  assert.match(projectConfig({ name: 'He said "go"' }), /config\/name="He said \\"go\\""/);
});

test('folder names are safe, and never empty', () => {
  assert.equal(projectFolder('Space Runner!'), 'space_runner');
  assert.equal(projectFolder('  ***  '), 'chomugiri_game');
  assert.ok(projectFolder('x'.repeat(200)).length <= 48);
});

test('scene uids are stable per name and distinct across names', () => {
  // Stable, so regenerating does not churn; distinct, because a shared uid
  // makes Godot drop the second scene.
  assert.equal(sceneUid('Space Runner'), sceneUid('Space Runner'));
  assert.notEqual(sceneUid('Space Runner'), sceneUid('Cave Diver'));
  assert.match(sceneUid('x'), /^uid:\/\/c[0-9a-z]+$/);
});

test('a model is instanced into the scene at its position', () => {
  const scene = mainScene({ ...SPEC, models: [{ path: 'res://hero.glb', node: 'Hero', at: [1, 2, 3] }] });
  assert.match(scene, /\[ext_resource type="PackedScene" path="res:\/\/hero\.glb"/);
  assert.match(scene, /\[node name="Hero" parent="\." instance=ExtResource\("3_model0"\)\]/);
  assert.match(scene, /Transform3D\(1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 2, 3\)/);
});

test('the touch stick is wired to the player, not just present', () => {
  // A joystick that emits into nothing is the kind of thing that looks done
  // and does nothing.
  assert.match(mainScene(SPEC), /\[connection signal="moved" from="UI\/Joystick" to="Player" method="_on_joystick_moved"\]/);
  assert.match(buildProject(SPEC).find((f) => f.path === 'player.gd').content, /func _on_joystick_moved/);
});

// ── The contract the model is given ─────────────────────────────────────────

const { buildSystemPrompt } = await import('../src/lib/agent/system-prompt.ts');

test('the Godot suite gets its own contract, and only it does', () => {
  const godot = buildSystemPrompt({ lane: 'B', suite: 'godot' });
  assert.ok(godot.includes('SUITE: GODOT GAME'));
  assert.ok(!buildSystemPrompt({ lane: 'B', suite: 'minecraft' }).includes('SUITE: GODOT GAME'));
});

test('the contract renders backticks, not escaped ones', () => {
  // This escaping has broken twice; a literal backslash here ships to the model.
  const prompt = buildSystemPrompt({ lane: 'B', suite: 'godot' });
  assert.ok(prompt.includes('`project.godot`'), 'backticks render');
  assert.ok(!prompt.includes('\\`'), 'no escaped backticks leak through');
});

test('the contract states the rules that actually decide whether a project runs', () => {
  const prompt = buildSystemPrompt({ lane: 'B', suite: 'godot' });
  for (const rule of ['load_steps', 'renderer/rendering_method="mobile"', 'config_version=5', 'CharacterBody3D', '.glb']) {
    assert.ok(prompt.includes(rule), `mentions ${rule}`);
  }
});

test('GDScript avoids := where Godot cannot infer the type', () => {
  // The real Godot 4.3 parser rejected `var offset := event.position - _centre`
  // with "Cannot infer the type of 'offset'". A validator cannot catch this —
  // only running the engine did — so the shape is pinned here.
  const files = buildProject(SPEC);
  const joystick = files.find((f) => f.path === 'joystick.gd').content;

  assert.ok(joystick.includes('var offset: Vector2 ='), 'the offset is typed explicitly');
  assert.ok(!/var\s+\w+\s*:=\s*event\./.test(joystick), 'nothing infers a type through an event property');
});

test('scripts use Godot 4 node types and calls, not Godot 3 ones', () => {
  // KinematicBody and move_and_slide(velocity) are Godot 3 and do not parse.
  const player = buildProject(SPEC).find((f) => f.path === 'player.gd').content;
  assert.ok(player.includes('extends CharacterBody3D'));
  assert.ok(!player.includes('KinematicBody'));
  assert.match(player, /move_and_slide\(\)/);
  assert.ok(!/move_and_slide\(\s*velocity/.test(player), 'Godot 4 takes no argument');
});

test('GDScript is indented with tabs, which the parser requires', () => {
  for (const path of ['player.gd', 'joystick.gd']) {
    const body = buildProject(SPEC).find((f) => f.path === path).content;
    const indented = body.split('\n').filter((l) => /^\s+\S/.test(l));
    assert.ok(indented.length > 0, `${path} has indented lines`);
    assert.ok(indented.every((l) => l.startsWith('\t')), `${path} indents with tabs`);
  }
});

// ── Rigged characters ───────────────────────────────────────────────────────

const RIGGED = {
  name: 'Rig Runner',
  models: [
    { path: 'res://hero.glb', node: 'Hero', rigged: true },
    { path: 'res://rock.glb', node: 'Rock', at: [4, 0, -2] },
  ],
};

test('a rigged model hangs off the player, and scenery stays in the world', () => {
  // A rigged character is the player's body. Left in the world it stands next
  // to the player rather than being them, which is the bug this pins.
  const scene = mainScene(RIGGED);
  assert.match(scene, /\[node name="Hero" parent="Player" instance=/);
  assert.match(scene, /\[node name="Rock" parent="\." instance=/);
});

test('the animation script ships only when something is rigged', () => {
  // An ext_resource pointing at a file the project does not contain stops the
  // whole scene loading, so the two have to agree.
  const withRig = buildProject(RIGGED);
  assert.ok(withRig.some((f) => f.path === 'character.gd'));
  assert.match(mainScene(RIGGED), /path="res:\/\/character\.gd"/);

  const without = buildProject({ ...SPEC, models: [{ path: 'res://rock.glb', node: 'Rock' }] });
  assert.ok(!without.some((f) => f.path === 'character.gd'));
  assert.ok(!mainScene({ ...SPEC, models: [{ path: 'res://rock.glb', node: 'Rock' }] }).includes('character.gd'));
});

test('a rigged project passes validation, ids and all', () => {
  // character.gd adds an ext_resource, which shifts every model id after it —
  // the kind of off-by-one that loads a scene with its models missing.
  assert.deepEqual(validateProject(buildProject(RIGGED)), []);
  assert.deepEqual(validateProject(buildProject({ name: 'Solo', models: [{ path: 'res://a.glb', node: 'A', rigged: true }] })), []);
});

test('the animation script degrades instead of crashing on an unrigged model', () => {
  // Tripo and Meshy return meshes that may have no skeleton at all, and a
  // hard reference would take the whole game down on load.
  const character = buildProject(RIGGED).find((f) => f.path === 'character.gd').content;
  assert.match(character, /if _skeleton == null:/);
  assert.match(character, /set_physics_process\(false\)/);
  assert.match(character, /if index < 0:\n\t\treturn/, 'a missing bone is skipped, not posed');
});

test('the character script is indented with tabs like the rest', () => {
  const body = buildProject(RIGGED).find((f) => f.path === 'character.gd').content;
  const indented = body.split('\n').filter((l) => /^\s+\S/.test(l));
  assert.ok(indented.length > 0);
  assert.ok(indented.every((l) => l.startsWith('\t')));
});

test('the suite warns about the GDScript inference rule that breaks whole scripts', () => {
  // Hit three separate times while building a real game: `:=` through an
  // untyped value is a parse error, not a warning, and the script does not
  // load at all. The model writes GDScript, so it needs the rule.
  assert.match(GODOT_ADDENDUM, /:=` only where the type is already known/);
  assert.match(GODOT_ADDENDUM, /parse errors\*, not warnings/);
});

test('the suite carries the lessons that separate a game from a demo', () => {
  // Each of these was a real defect found by playing the generated game, not a
  // style preference: an unwinnable wall, coins nobody ever collects, a level
  // that leaks memory, and a camera that hides the obstacle ahead of you.
  for (const rule of [
    /Never block every lane/,
    /Collectables go in lines/,
    /Recycle, do not spawn and free/,
    /Do not parent the camera to the player/,
  ]) {
    assert.match(GODOT_ADDENDUM, rule);
  }
});

test('a generated project ships music unless it is turned off', () => {
  // Silence is the loudest sign a generated game is a tech demo, and it is the
  // one gap the model cannot fill because it cannot emit a binary.
  assert.ok(buildProject(SPEC).some((f) => f.path === 'audio.gd'));
  assert.ok(!buildProject({ ...SPEC, music: false }).some((f) => f.path === 'audio.gd'));
});

test('the audio script survives files that are not there', () => {
  // Godot loads by path; a project whose soundtrack failed to generate must
  // still run rather than crash on a null stream.
  const audio = buildProject(SPEC).find((f) => f.path === 'audio.gd').content;
  assert.match(audio, /if stream == null:/);
  assert.match(audio, /if s != null:/);
  assert.match(audio, /if not _effects\.has\(effect\):/);
});

test('the audio script uses two players, not one per zone', () => {
  // One each holds every stream in memory on a phone; one swapped mid-bar cuts.
  const audio = buildProject(SPEC).find((f) => f.path === 'audio.gd').content;
  assert.match(audio, /\$MusicA/);
  assert.match(audio, /\$MusicB/);
  assert.match(audio, /_fade/);
});
