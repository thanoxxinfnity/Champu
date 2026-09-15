/** node --experimental-strip-types --test scripts/test-verify.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeProblems, shippable, verifyProject } from '../src/lib/suites/godot/verify.ts';
import { buildProject } from '../src/lib/suites/godot/project.ts';
import { apkName, exportCommand, exportFailure, exportPresets, packageNameFor } from '../src/lib/suites/godot/apk.ts';

const CONFIG = { path: 'project.godot', content: 'config_version=5\nfire={\n"deadzone": 0.2\n}\n' };
const only = (content, path = 'a.gd') => verifyProject([CONFIG, { path, content }]);

// ── The verifier ────────────────────────────────────────────────────────────

test('what the suite itself generates passes its own gate', () => {
  // Checked against a real Godot 4.3 and 4.7.2 run, which both load these
  // projects. A verifier that reports working code as broken is worse than no
  // verifier — people learn to ignore it, including for the real failures.
  for (const spec of [
    { name: 'Chomu Game', dimension: '3d', genre: 'shooter', view: 'first-person' },
    { name: 'Runner', dimension: '3d' },
    { name: 'Rigged', dimension: '3d', models: [{ path: 'res://a.glb', node: 'A', rigged: true }] },
  ]) {
    const files = buildProject(spec).filter((f) => !f.path.endsWith('.glb'));
    // The .glb is added by the caller, so the reference to it is expected here.
    const problems = verifyProject(files).filter((p) => !/res:\/\/a\.glb/.test(p.message));
    assert.ok(shippable(problems), `${spec.name}: ${describeProblems(problems)}`);
  }
});

test('the three := parse errors this project actually hit are caught', () => {
  // Each one is a parse error, not a warning: the script fails to load whole,
  // and the node it was on silently does nothing.
  for (const line of ['var n := node.get_node("Coins")', 'var v := lanes[i]', '\tvar ok := a.score > b']) {
    assert.ok(
      only(line).some((p) => p.fatal && /Inferred type/.test(p.message)),
      `missed: ${line.trim()}`,
    );
  }
});

test('a := with the type in plain sight is left alone', () => {
  for (const line of [
    'var art := _enemy_scene.instantiate()',
    'var label := _over.get_node("Text") as Label',
    'var speed: float = node.speed',
    'var t := 1.0',
    'var v := Vector3(1, 2, 3)',
  ]) {
    assert.ok(!only(line).some((p) => /Inferred type/.test(p.message)), `false positive: ${line.trim()}`);
  }
});

test('a node addressed at a path its scene does not have is fatal', () => {
  // How the muzzle flash survived a reparent: the weapon moved under the
  // camera, its mesh and grip moved with it, the light stayed at the old path.
  // Nothing complained until `$Flash` came back null and the error threw out of
  // fire() before the raycast — the gun did nothing at all.
  const scene = `[gd_scene load_steps=1 format=3]

[node name="Main" type="Node3D"]

[node name="Player" type="CharacterBody3D" parent="."]

[node name="Camera" type="Camera3D" parent="Player"]

[node name="Weapon" type="Node3D" parent="Player/Camera"]

[node name="Flash" type="OmniLight3D" parent="Player/Weapon"]
`;
  const problems = verifyProject([CONFIG, { path: 'main.tscn', content: scene }]);
  assert.ok(problems.some((p) => p.fatal && /"Flash" hangs off "Player\/Weapon"/.test(p.message)));
  assert.equal(shippable(problems), false);
});

test('an input action nothing declares is fatal, because Godot says nothing', () => {
  assert.ok(only('func _p():\n\tInput.is_action_pressed("reload")').some((p) => p.fatal && /reload/.test(p.message)));
  // Declared in project.godot, so fine.
  assert.ok(!only('func _p():\n\tInput.is_action_pressed("fire")').some((p) => /never declares/.test(p.message)));
  // Godot's own built-ins are never in project.godot and always work.
  assert.ok(!only('func _p():\n\tInput.is_action_pressed("ui_accept")').some((p) => /never declares/.test(p.message)));
  // get_vector names count too.
  assert.ok(
    only('func _p():\n\tInput.get_vector("move_left", "move_right", "move_forward", "move_back")').some((p) => p.fatal),
  );
});

test('a node built in code is a warning, not a refusal', () => {
  // The spawner and the audio player both create their nodes at runtime, so a
  // scene that does not contain them is correct, not broken.
  const problems = only('func _r():\n\t$MusicA.play()');
  assert.ok(problems.some((p) => /MusicA/.test(p.message)));
  assert.equal(shippable(problems), true);
});

test('a resource the project does not contain is fatal', () => {
  const scene = '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://gone.gd" id="1"]\n\n[node name="Main" type="Node3D"]\n';
  assert.ok(verifyProject([CONFIG, { path: 'main.tscn', content: scene }]).some((p) => p.fatal && /gone\.gd/.test(p.message)));
});

test('a tab followed by spaces is fatal, because Godot rejects the mix', () => {
  assert.ok(only('func _r():\n\t  var x = 1').some((p) => p.fatal && /tab then spaces/.test(p.message)));
});

test('the description separates what blocks from what is worth a look', () => {
  const text = describeProblems([
    { file: 'a.gd', line: 3, message: 'fatal thing', fatal: true },
    { file: 'b.gd', message: 'minor thing', fatal: false },
  ]);
  assert.match(text, /1 thing would stop this running/);
  assert.match(text, /a\.gd:3/);
  assert.match(text, /Worth a look/);
  assert.equal(describeProblems([]), '');
});

// ── The APK ─────────────────────────────────────────────────────────────────

test('the package name is one Android will accept', () => {
  assert.equal(packageNameFor('Chomu Game'), 'com.chomugiri.chomugame');
  // A segment starting with a digit is rejected by the build tools.
  assert.match(packageNameFor('2048'), /^com\.chomugiri\.game2048$/);
  assert.match(packageNameFor('!!!'), /^com\.chomugiri\.game$/);
});

test('the preset names the platform Godot matches on', () => {
  const cfg = exportPresets({ name: 'Chomu Game', versionName: '1.0' });
  // --export-release matches preset name, not platform, so both must be right.
  assert.match(cfg, /^name="Android"$/m);
  assert.match(cfg, /^platform="Android"$/m);
  assert.match(cfg, /package\/unique_name="com\.chomugiri\.chomugame"/);
  assert.match(cfg, /version\/name="1\.0"/);
  // arm64 alone covers every phone sold for years and halves the APK.
  assert.match(cfg, /architectures\/arm64-v8a=true/);
  assert.match(cfg, /architectures\/armeabi-v7a=false/);
});

test('a release preset carries the keystore, a debug one does not', () => {
  const release = exportPresets({ name: 'G', release: true, keystore: { path: '/k.keystore', user: 'me', password: 'pw' } });
  assert.match(release, /keystore\/release="\/k\.keystore"/);
  assert.ok(!exportPresets({ name: 'G' }).includes('keystore/release="/k.keystore"'));
});

test('the export command is argv, so a path with a space stays one argument', () => {
  const argv = exportCommand('/bin/godot', '/tmp/My Game', '/out/g.apk');
  assert.deepEqual(argv, ['/bin/godot', '--headless', '--path', '/tmp/My Game', '--export-debug', 'Android', '/out/g.apk']);
  assert.equal(exportCommand('g', 'p', 'o', { release: true })[4], '--export-release');
});

test('a missing template is reported as one, not as success', () => {
  // Godot exits 0 when the templates are missing and writes no file, so the
  // exit code is not the check — the file is.
  assert.match(exportFailure('No export template found for this version', false, 0), /export templates/i);
  assert.match(exportFailure('Could not find preset "Android"', false, 0), /export_presets\.cfg/);
  assert.match(exportFailure('Please set the ANDROID_HOME', false, 0), /Android SDK/);
  assert.match(exportFailure('keystore was not found', false, 0), /keystore/);
  assert.match(exportFailure('nothing useful', true, 400), /only 400 bytes/);
  // A real APK is not a failure.
  assert.equal(exportFailure('ADDING: everything\nSigned', true, 28_309_587), null);
});

test('the apk filename says which build it is', () => {
  assert.equal(apkName('Chomu Game', '1.0'), 'ChomuGame-1.0.apk');
  assert.equal(apkName('!!!'), 'Game-1.0.apk');
});
