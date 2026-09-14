/** node --experimental-strip-types --test scripts/test-godot-export.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  archiveName,
  buildGodotExport,
  completeProject,
  detectGodotProject,
  payload,
  referencedResources,
} from '../src/lib/suites/godot/export.ts';
import { planGame } from '../src/lib/suites/godot/plan.ts';

const MINIMAL = [
  { path: 'project.godot', content: 'config_version=5\nrun/main_scene="res://main.tscn"\n' },
  { path: 'main.tscn', content: '[gd_scene load_steps=2 format=3 uid="uid://x"]\n\n[ext_resource type="Script" path="res://player.gd" id="1_p"]\n\n[node name="Main" type="Node3D"]\n' },
];

test('a project is recognised by project.godot, wrapper folder or not', () => {
  assert.equal(detectGodotProject(MINIMAL).root, '');
  const nested = MINIMAL.map((f) => ({ ...f, path: `my_game/${f.path}` }));
  assert.equal(detectGodotProject(nested).root, 'my_game');
  assert.equal(detectGodotProject([{ path: 'notes.md', content: 'hi' }]), null);
});

test('every res:// the scene mentions is found, so a missing one can be caught', () => {
  // A referenced file that is not in the archive opens as a missing node, with
  // no error anywhere that says which file.
  assert.deepEqual(referencedResources(MINIMAL, ''), ['main.tscn', 'player.gd']);
});

test('a missing referenced script is filled in rather than left to fail silently', () => {
  const { files, filledIn } = completeProject(MINIMAL, { name: 'Test' });
  assert.ok(filledIn.includes('player.gd'), `player.gd should be filled in: ${filledIn.join(', ')}`);
  assert.ok(files.some((f) => f.path === 'player.gd'));
});

test('a file the model wrote is never replaced by the scaffolding', () => {
  // The model knows what this game needs; the scaffolding does not.
  const own = [...MINIMAL, { path: 'player.gd', content: 'extends CharacterBody3D\n## mine\n' }];
  const { files, filledIn } = completeProject(own, { name: 'Test' });
  assert.ok(!filledIn.includes('player.gd'));
  assert.match(files.find((f) => f.path === 'player.gd').content, /## mine/);
});

test('scaffolding nobody asked for is not added', () => {
  // An unreferenced joystick.gd in a project that wrote its own is just litter.
  const { filledIn } = completeProject(MINIMAL, { name: 'Test' });
  assert.ok(!filledIn.includes('joystick.gd'), `joystick.gd was not referenced: ${filledIn.join(', ')}`);
});

test('the archive contains a folder, because Godot imports a folder', () => {
  // A zip of loose files extracts into whatever directory the user was in, and
  // the import screen then shows nothing.
  const exported = buildGodotExport(MINIMAL, planGame('a platformer called Sky Dash'));
  assert.equal(exported.filename, 'sky-dash.zip');
  assert.ok(exported.entries.every((e) => e.path.startsWith('sky-dash/')), exported.entries.map((e) => e.path).join(', '));
});

test('a wrapper folder in the workspace does not become a folder inside a folder', () => {
  const nested = MINIMAL.map((f) => ({ ...f, path: `my_game/${f.path}` }));
  const exported = buildGodotExport(nested, null, 'My Game');
  assert.ok(exported.entries.some((e) => e.path === 'my-game/project.godot'), exported.entries.map((e) => e.path).join(', '));
});

test('a referenced model that was never generated is reported, not shipped broken', () => {
  const withModel = [
    MINIMAL[0],
    { path: 'main.tscn', content: '[gd_scene load_steps=2 format=3 uid="uid://x"]\n\n[ext_resource type="PackedScene" path="res://hero.glb" id="1_h"]\n\n[node name="Main" type="Node3D"]\n' },
  ];
  const exported = buildGodotExport(withModel, null);
  assert.ok(exported.problems.some((p) => p.includes('hero.glb')), exported.problems.join(' | '));
});

test('a binary file survives the round trip as bytes', () => {
  // The .glb travels as a data URL through the file map; if the zip builder got
  // the string instead, the model would be a text file named .glb.
  const bytes = payload('data:model/gltf-binary;base64,Z2xURgIAAAA=');
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual([...bytes.slice(0, 4)], [0x67, 0x6c, 0x54, 0x46], 'the glTF magic survived');
  assert.equal(payload('plain text'), 'plain text');
});

test('the filename is safe for a file manager', () => {
  assert.equal(archiveName('Sky Dash!! 2000'), 'sky-dash-2000.zip');
  assert.equal(archiveName(''), 'chomugiri-game.zip');
});

test('no project means no offer, rather than an empty zip', () => {
  assert.equal(buildGodotExport([{ path: 'readme.md', content: 'hi' }], null), null);
});
