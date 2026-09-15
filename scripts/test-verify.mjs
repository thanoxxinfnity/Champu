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

// ── What the review found ───────────────────────────────────────────────────

test('a binary asset counts as a file the project has, not a missing one', () => {
  // Models travel through a workspace with no filesystem as data: URLs.
  // Filtering them out before verifying made `res://character.glb` read as
  // missing, and refused every build that actually generated a model.
  const files = [
    { path: 'project.godot', content: 'config_version=5\nrun/main_scene="res://main.tscn"' },
    { path: 'main.tscn', content: '[gd_scene load_steps=2 format=3]\n[ext_resource path="res://character.glb" id="1"]\n[node name="Main" type="Node3D"]' },
    { path: 'character.glb', content: 'data:model/gltf-binary;base64,Z2xURg==' },
  ];
  assert.ok(shippable(verifyProject(files)));
  // And one that genuinely is not there is still caught.
  assert.equal(shippable(verifyProject(files.slice(0, 2))), false);
});

test('a cast followed by a comment is still a cast', () => {
  const line = 'var label := panel.get_node("Text") as Label # the score';
  assert.ok(!only(line).some((p) => /Inferred type/.test(p.message)));
});

test('a project nested in its own folder verifies against the right root', async () => {
  // buildGodotExport strips the wrapper before checking. Verifying the raw
  // workspace paths instead made a nested project read as having no
  // project.godot at all, so every input action and every res:// was fatal.
  const { buildGodotExport } = await import('../src/lib/suites/godot/export.ts');
  const { planGame } = await import('../src/lib/suites/godot/plan.ts');
  const plan = planGame('zombie survival shooter, first person, name Chomu Game');
  const base = buildProject({
    name: plan.name,
    dimension: plan.dimension,
    genre: plan.genre,
    view: plan.view,
    models: [{ path: 'res://character.glb', node: 'C', rigged: true }],
  }).map((f) => ({ path: f.path, content: f.content }));
  base.push({ path: 'character.glb', content: 'data:model/gltf-binary;base64,Z2xURg==' });

  for (const files of [base, base.map((f) => ({ path: `my_game/${f.path}`, content: f.content }))]) {
    const exported = buildGodotExport(files, plan);
    assert.deepEqual(exported.problems, [], 'a project the suite generated must ship');
    // The runtime warnings still come through, separately from the refusals.
    assert.ok(exported.warnings.length > 0);
    assert.ok(exported.warnings.every((w) => !w.fatal));
  }
});

test('a Java keyword is not a package segment', () => {
  // aapt refuses it: the manifest package becomes a Java identifier.
  assert.equal(packageNameFor('Class'), 'com.chomugiri.gameclass');
  assert.equal(packageNameFor('Native'), 'com.chomugiri.gamenative');
  assert.equal(packageNameFor('Package'), 'com.chomugiri.gamepackage');
  // And a name that is fine stays untouched.
  assert.equal(packageNameFor('Chomu Game'), 'com.chomugiri.chomugame');
  assert.match(exportFailure('is not a valid Java package name', false, 0), /Java keyword/);
});

test('a quote in a keystore password does not end the string early', () => {
  // export_presets.cfg has no escape syntax worth trusting: an unescaped quote
  // truncates the password, Godot signs with the short one, and it fails at
  // install time with a message about the certificate.
  const cfg = exportPresets({
    name: 'My "Game"',
    release: true,
    keystore: { path: 'C:\\keys\\a.keystore', user: 'me', password: 'pa"ss' },
  });
  assert.match(cfg, /keystore\/release_password="pa\\"ss"/);
  assert.match(cfg, /package\/name="My \\"Game\\""/);
  assert.match(cfg, /keystore\/release="C:\\\\keys\\\\a\.keystore"/);
});

test('a release export with no keystore is refused, not downgraded', () => {
  // Writing debug keys for a release preset produces an APK Android will not
  // install, and the reason only shows up on the phone.
  assert.throws(() => exportPresets({ name: 'G', release: true }), /needs a keystore/);
  assert.doesNotThrow(() => exportPresets({ name: 'G' }));
  assert.doesNotThrow(() =>
    exportPresets({ name: 'G', release: true, keystore: { path: '/k', user: 'u', password: 'p' } }),
  );
});
