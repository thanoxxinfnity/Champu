/**
 * node --experimental-strip-types --test scripts/test-game-kit.mjs
 * The game kit is GDScript, so the only honest test is Godot: build a project from the kit and the reference game exactly as the
 * app would, open it headless, press Play, drive for a few seconds, end the run, retry — and require that Godot says nothing is wrong.
 * Skipped when there is no `godot` on the PATH.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GAME_KIT_FILES, GAME_KIT_REFERENCE } from '../src/lib/suites/godot/kit/data.ts';
import { KIT_AUTOLOADS, kitFor, withKitAutoloads } from '../src/lib/suites/godot/kit.ts';
import { checkGameQuality, qualityRepairPrompt } from '../src/lib/suites/godot/quality.ts';
import { EFFECT_KINDS, effect, toWav } from '../src/lib/suites/godot/audio.ts';

const haveGodot = spawnSync('godot', ['--version']).status === 0;
const KIT_DIR = new URL('../src/lib/suites/godot/kit/', import.meta.url);

test('the packed kit is the .gd files in the folder (run scripts/build-game-kit.mjs after editing them)', () => {
  for (const f of GAME_KIT_FILES) assert.equal(f.content, readFileSync(new URL(path.basename(f.path), KIT_DIR), 'utf8'), `${f.path} is stale`);
  assert.equal(GAME_KIT_REFERENCE.main_gd, readFileSync(new URL('reference/main.gd', KIT_DIR), 'utf8'));
  for (const [, res] of KIT_AUTOLOADS) assert.ok(GAME_KIT_FILES.some((f) => `res://${f.path}` === res), `${res} is not packed`);
});

test('autoloads are added once, ahead of the project\'s own, and nothing is duplicated', () => {
  const bare = withKitAutoloads('config_version=5\n\n[application]\nconfig/name="X"\n');
  assert.match(bare, /\[autoload\]\n\nSave="\*res:\/\/kit\/save\.gd"/);
  assert.equal(withKitAutoloads(bare), bare);
  const mixed = withKitAutoloads('config_version=5\n\n[autoload]\nMine="*res://mine.gd"\n');
  assert.ok(mixed.indexOf('Save=') < mixed.indexOf('Mine='));
  assert.equal((mixed.match(/\[autoload\]/g) ?? []).length, 1);
});

test('kitFor adds only what is missing and patches project.godot', () => {
  const files = [{ path: 'proj/project.godot', content: 'config_version=5\n' }, { path: 'proj/kit/save.gd', content: 'extends Node\n' }];
  const { add, projectGodot } = kitFor(files, 'proj');
  assert.ok(add.every((f) => f.path.startsWith('proj/kit/')));
  assert.ok(!add.some((f) => f.path === 'proj/kit/save.gd'), 'a kit file the project already has is left alone');
  assert.match(projectGodot.content, /\[autoload\]/);
});

test('Godot opens the kit with the reference game and plays it through without a single error', { skip: !haveGodot && 'godot is not installed', timeout: 240_000 }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kit-'));
  try {
    mkdirSync(path.join(dir, 'kit'), { recursive: true });
    for (const f of GAME_KIT_FILES) writeFileSync(path.join(dir, f.path), f.content);
    writeFileSync(path.join(dir, 'main.gd'), GAME_KIT_REFERENCE.main_gd);
    writeFileSync(path.join(dir, 'main.tscn'), GAME_KIT_REFERENCE.main_tscn);
    mkdirSync(path.join(dir, 'audio'), { recursive: true });
    for (const kind of EFFECT_KINDS) writeFileSync(path.join(dir, `audio/sfx_${kind}.wav`), toWav(effect(kind)));
    writeFileSync(path.join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>');
    writeFileSync(path.join(dir, 'bot.gd'), `extends Node
var t := 0.0
var step := 0
func _btn(n: Node, text: String) -> Button:
	if n is Button and (n as Button).text == text: return n
	for c in n.get_children():
		var r := _btn(c, text)
		if r: return r
	return null
func _process(d: float) -> void:
	t += d
	var m := get_tree().current_scene
	if m == null: return
	if t > 0.5 and step == 0:
		step = 1
		_btn(get_tree().root, "PLAY").pressed.emit()
	if t > 4.0 and step == 1:
		step = 2
		Input.action_press("accelerate")
	if t > 6.0 and step == 2:
		step = 3
		m.finish(7, "BOT RUN", ["checked"], true)
	if t > 8.5 and step == 3:
		step = 4
		var r := _btn(get_tree().root, "RETRY")
		print("BOT_RESULTS_SHOWN=", r != null)
		if r: r.pressed.emit()
	if t > 12.0 and step == 4:
		step = 5
		print("BOT_SFX coin=", Sfx.has_sound("coin"), " win=", Sfx.has_sound("win"), " nope=", Sfx.has_sound("nothing_here"))
	if t > 13.0 and step == 5:
		print("BOT_DONE state=", get_tree().current_scene.state, " best=", Save.best("coins"))
		get_tree().quit()
`);
    const project = withKitAutoloads(`config_version=5

[application]
config/name="Kit Test"
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.7", "Mobile")
config/icon="res://icon.svg"
`) + 'Bot="*res://bot.gd"\n';
    writeFileSync(path.join(dir, 'project.godot'), project);
    const imp = spawnSync('godot', ['--headless', '--path', dir, '--import'], { encoding: 'utf8', timeout: 120_000 });
    const run = spawnSync('godot', ['--headless', '--path', dir, '--quit-after', '2400'], { encoding: 'utf8', timeout: 150_000 });
    const log = `${imp.stdout}${imp.stderr}${run.stdout}${run.stderr}`;
    const problems = log.split('\n').filter((l) => /SCRIPT ERROR|Parse Error|^ERROR:|Failed to (load|create)|Invalid (call|access|get|set)|Cannot (call|infer)/i.test(l));
    assert.deepEqual(problems, [], `Godot reported problems:\n${problems.join('\n')}\n--- full log tail ---\n${log.split('\n').slice(-25).join('\n')}`);
    assert.match(log, /BOT_RESULTS_SHOWN=true/, 'the results screen never appeared after the run ended');
    assert.match(log, /BOT_DONE state=playing/, 'retry did not restart the run');
    assert.match(log, /BOT_SFX coin=true win=true nope=false/, 'sounds in res://audio/ were not found by name');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the reference game clears the quality gate it teaches', () => {
  const files = [{ path: 'main.gd', content: GAME_KIT_REFERENCE.main_gd }, { path: 'main.tscn', content: GAME_KIT_REFERENCE.main_tscn }];
  assert.deepEqual(checkGameQuality(files).problems, []);
});

test('a prototype is named for what it lacks, and sent back with exactly that', () => {
  const proto = [{ path: 'game.gd', content: 'extends Node3D\nfunc _ready():\n\tvar m := MeshInstance3D.new()\n\tadd_child(m)\n\tadd_child(Camera3D.new())\n' }];
  const shell = checkGameQuality(proto).problems;
  assert.equal(shell.length, 1);
  assert.match(shell[0], /game_shell\.gd/);

  const half = [{ path: 'main.gd', content: 'extends "res://kit/game_shell.gd"\nfunc _build_world():\n\tadd_child(MeshInstance3D.new())\nfunc _update(d):\n\tfinish(1)\n' }];
  const problems = checkGameQuality(half).problems.join('\n');
  assert.match(problems, /no sounds/);
  assert.match(problems, /feedback/);
  assert.match(problems, /Stage\.environment/);
  assert.match(problems, /bare boxes/);
  assert.match(problems, /touch controls/);
  assert.ok(!/finish/.test(problems));
  assert.match(qualityRepairPrompt(['x']), /Rewrite main\.gd in full/);
});

test('a hand-built car and camera are steered to the kit versions', () => {
  const hand = [{ path: 'main.gd', content: 'extends "res://kit/game_shell.gd"\nfunc _build_world():\n\tvar c := VehicleBody3D.new()\n\tvar cam := Camera3D.new()\n\tStage.environment(self)\n\tProps.tree()\n\tPad.add(self, [])\n\tfinish(1)\n\tSfx.play("a")\n\tSfx.play("b")\n\tSfx.play("c")\n\tFeel.shake()\n\tFx.burst(self, Vector3.ZERO)\n' }];
  const p = checkGameQuality(hand).problems.join('\n');
  assert.match(p, /Vehicle\.create/);
  assert.match(p, /Stage\.chase_camera/);
});

test('a project file gets the settings a phone export needs: ETC2/ASTC and its icon', async () => {
  const { withIcon, withMobileSettings } = await import('../src/lib/suites/godot/export.ts');
  const bare = 'config_version=5\n\n[application]\nconfig/name="X"\n';
  const out = withIcon(withMobileSettings(bare), true);
  assert.match(out, /config\/icon="res:\/\/icon\.svg"/);
  assert.match(out, /import_etc2_astc=true/);
  assert.equal(withIcon(out, true), out);
  assert.equal(withIcon(bare, false), bare);
});
