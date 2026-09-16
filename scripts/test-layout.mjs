/** node --experimental-strip-types --test scripts/test-layout.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { cityBlock, describeBlock, inside, overlaps, rampEnds, tiltedBasis } from '../src/lib/suites/godot/layout.ts';
import { buildProject, orientationFor, viewportFor } from '../src/lib/suites/godot/project.ts';
import { verifyProject, shippable } from '../src/lib/suites/godot/verify.ts';

const BLOCK = cityBlock();
const SHOOTER = { name: 'Chomu Game', dimension: '3d', genre: 'shooter', view: 'first-person' };

test('no two buildings occupy the same ground', () => {
  // Two boxes in the same place is a wall you can see through from one side, and
  // it is invisible in every test that only reads the file.
  for (let i = 0; i < BLOCK.buildings.length; i += 1) {
    for (let j = i + 1; j < BLOCK.buildings.length; j += 1) {
      assert.ok(
        !overlaps(BLOCK.buildings[i], BLOCK.buildings[j]),
        `${BLOCK.buildings[i].name} overlaps ${BLOCK.buildings[j].name}`,
      );
    }
  }
});

test('the streets are actually clear', () => {
  // Twelve metres wide, crossing at the plaza. A building that creeps into one
  // turns the through-route into a dead end, and a dead end is where a player
  // decides the game is broken.
  for (let n = -31; n <= 31; n += 1) {
    assert.ok(!inside(BLOCK, 0, n), `the north-south street is blocked at z=${n}`);
    assert.ok(!inside(BLOCK, n, 0), `the east-west street is blocked at x=${n}`);
  }
  // And the service road around the outside, so the block can be circled.
  for (let n = -29; n <= 29; n += 1) {
    for (const [x, z] of [[n, -29], [n, 29], [-29, n], [29, n]]) {
      assert.ok(!inside(BLOCK, x, z), `the service road is blocked at ${x},${z}`);
    }
  }
});

test('the player does not start inside a wall', () => {
  assert.ok(!inside(BLOCK, 0, 0, 1.0));
  // Nor do the two places a mission sends them.
  assert.ok(!inside(BLOCK, 0, 30, 1.0), 'the gate is inside a building');
  assert.ok(!inside(BLOCK, 0, 0, 1.0), 'the generator is inside a building');
});

test('nothing spawns inside a building', () => {
  // The bug this prevents is quiet: a zombie inside a wall stands still, is
  // unreachable, and the wave never clears, so the game simply stops.
  for (const [x, z] of BLOCK.spawns) {
    assert.ok(!inside(BLOCK, x, z, 0.6), `a spawn at ${x},${z} is inside a building`);
    assert.ok(Math.abs(x) < BLOCK.extent - 0.5 && Math.abs(z) < BLOCK.extent - 0.5, `${x},${z} is outside the wall`);
  }
  assert.ok(BLOCK.spawns.length >= 12, 'too few mouths: the horde arrives from the same corner every time');
});

test('cover stands somewhere a person would have left it', () => {
  for (const [x, z] of BLOCK.cover) {
    // 1.3m: half a 2.4m crate plus a hand's width. Cover that clips a wall is
    // a wall with a hole in it.
    assert.ok(!inside(BLOCK, x, z, 1.3), `cover at ${x},${z} clips a building`);
    // Against something, not adrift in the open: within three metres of a wall,
    // or in the street where a line of cover belongs.
    // Within four metres of a face counts as against it — that is close enough
    // to be something someone put there rather than something that fell.
    const nearWall = BLOCK.buildings.some(
      (b) =>
        Math.abs(x - b.at[0]) < b.size[0] / 2 + 4 && Math.abs(z - b.at[1]) < b.size[2] / 2 + 4,
    );
    const inStreet = Math.abs(x) <= 8 || Math.abs(z) <= 8;
    assert.ok(nearWall || inStreet, `cover at ${x},${z} is floating in the open`);
  }
});

test('the long run has a slalom rather than a barricade', () => {
  // Three pieces in a line across a street is a wall. Alternating sides is a
  // route with a decision in it.
  const run = BLOCK.cover.filter(([x, z]) => z > 8 && Math.abs(x) <= 6).sort((a, b) => a[1] - b[1]);
  assert.ok(run.length >= 3);
  for (let i = 1; i < run.length; i += 1) {
    assert.ok(Math.sign(run[i][0]) !== Math.sign(run[i - 1][0]), 'the run to the gate is a barricade, not a slalom');
  }
});

test('one thing is taller than everything else', () => {
  const heights = BLOCK.buildings.map((b) => b.size[1]).sort((a, b) => b - a);
  assert.ok(heights[0] >= heights[1] * 1.4, 'no landmark: four similar quadrants are a maze');
});

test('the ramp is walkable, not a wall with a slope painted on it', () => {
  // A CharacterBody3D walks up anything under floor_max_angle, which defaults
  // to 45 degrees, and stops dead at anything over it.
  assert.ok(BLOCK.ramp.tilt < Math.PI / 4, `${((BLOCK.ramp.tilt * 180) / Math.PI).toFixed(1)}deg is too steep to walk up`);
  assert.ok(BLOCK.ramp.tilt > 0.15, 'that is not a ramp, it is a floor');
});

test('the ramp arrives at the roof it is pointing at', () => {
  // Off by a metre and the climb ends in mid-air: the player walks up the whole
  // ramp, steps off the top, falls, and lands jammed against the front of the
  // roof they were trying to reach. Which is what it did.
  const { top } = rampEnds(BLOCK);
  const deckTop = BLOCK.overlook.at[1] + BLOCK.overlook.size[1] / 2;
  assert.ok(Math.abs(top[1] - deckTop) < 0.12, `ramp ends at ${top[1].toFixed(2)}m, the deck is at ${deckTop.toFixed(2)}m`);
  const deckNear = BLOCK.overlook.at[2] + BLOCK.overlook.size[2] / 2;
  assert.ok(Math.abs(top[0] - deckNear) < 0.12, `ramp ends at z=${top[0].toFixed(2)}, the deck starts at z=${deckNear.toFixed(2)}`);
  // And the deck still reaches the building it leans on.
  assert.ok(Math.abs(BLOCK.overlook.at[2] - BLOCK.overlook.size[2] / 2 - -8) < 0.12);
});

test('the ramp starts on the ground, not on a ledge', () => {
  // A lip at the foot of a ramp is not a ramp. A CharacterBody3D does not step
  // up anything on its own, so the only way onto it would be a jump — and a
  // player who has to jump onto a ramp concludes the ramp is not for them.
  const { foot } = rampEnds(BLOCK);
  assert.ok(Math.abs(foot[1] - 0.25) < 0.12, `the ramp starts ${foot[1].toFixed(2)}m up; the ground is at 0.25m`);
  // And its foot is in the street, reachable without climbing anything else.
  assert.ok(!inside(BLOCK, BLOCK.ramp.at[0], foot[0], 0.5), 'the foot of the ramp is inside a building');
});

test('the tilt is written the way a .tscn is read, which is by rows', () => {
  // The twelve-float Transform3D form is row-major. Emitting columns gives the
  // transpose, which is still a valid rotation — so nothing errors, the ramp
  // just leans the other way and the player walks into its end cap forever.
  const m = tiltedBasis(0.4636).split(', ').map(Number);
  assert.deepEqual(m.slice(0, 3), [1, 0, 0]);
  // Read as rows, the columns are the axes: Y should tilt toward +z.
  const yAxis = [m[1], m[4], m[7]];
  const zAxis = [m[2], m[5], m[8]];
  assert.ok(yAxis[1] > 0.89 && yAxis[2] > 0.44, `up is ${yAxis}, which does not lean along the slope`);
  assert.ok(zAxis[1] < -0.44 && zAxis[2] > 0.89, `forward is ${zAxis}`);
  // And it is a rotation, not a squash: every axis unit length.
  for (const axis of [yAxis, zAxis]) {
    assert.ok(Math.abs(Math.hypot(...axis) - 1) < 1e-3);
  }
});

// ── How the block lands in the scene ────────────────────────────────────────

test('every building reaches the scene with a mesh and a shape', () => {
  const scene = buildProject(SHOOTER).find((f) => f.path === 'main.tscn').content;
  for (const building of BLOCK.buildings) {
    assert.ok(scene.includes(`[node name="${building.name}" type="StaticBody3D"`), `${building.name} is missing`);
    assert.ok(scene.includes(`id="BoxShape3D_${building.name}"`), `${building.name} has no collision`);
  }
  assert.match(scene, /\[node name="Ramp" type="StaticBody3D"/);
  assert.match(scene, /\[node name="Overlook" type="StaticBody3D"/);
});

test('the director is given the street mouths', () => {
  const scene = buildProject(SHOOTER).find((f) => f.path === 'main.tscn').content;
  const declared = /spawn_points = PackedVector3Array\(([^)]*)\)/.exec(scene);
  assert.ok(declared, 'the director still spawns on a blind ring');
  assert.equal(declared[1].split(',').length, BLOCK.spawns.length * 3);
});

test('a block with buildings still passes the gate', () => {
  const files = buildProject(SHOOTER);
  const problems = verifyProject(files);
  assert.ok(shippable(problems), problems.filter((p) => p.fatal).map((p) => `${p.file}: ${p.message}`).join('\n'));

  const scene = files.find((f) => f.path === 'main.tscn').content;
  const declared = Number(/^\[gd_scene load_steps=(\d+)/.exec(scene)[1]);
  assert.equal(declared, (scene.match(/^\[(ext_resource|sub_resource)/gm) ?? []).length + 1);
});

// ── Which way up the phone is held ──────────────────────────────────────────

test('a shooter is landscape and a runner is not', () => {
  // Godot's enum is Landscape, Portrait, Reverse Landscape, Reverse Portrait,
  // Sensor Landscape, Sensor Portrait, Sensor — so 1, which every project this
  // suite made used to ship, is *portrait*.
  assert.equal(orientationFor(SHOOTER), 'landscape');
  assert.equal(orientationFor({ name: 'S', dimension: '3d', genre: 'endless-runner' }), 'portrait');
  assert.equal(orientationFor({ name: 'S', dimension: '3d', view: 'third-person' }), 'landscape');
  assert.equal(orientationFor({ name: 'S', dimension: '2d', genre: 'puzzle' }), 'portrait');
  assert.deepEqual(viewportFor('landscape'), [1152, 648]);
  assert.deepEqual(viewportFor('portrait'), [648, 1152]);
});

test('the project file says landscape, in the enum Godot actually uses', () => {
  const config = buildProject(SHOOTER).find((f) => f.path === 'project.godot').content;
  // 4 is Sensor Landscape: the axis is fixed, which way round is not.
  assert.match(config, /window\/handheld\/orientation=4/);
  assert.match(config, /viewport_width=1152/);
  assert.match(config, /viewport_height=648/);

  const portrait = buildProject({ name: 'R', dimension: '3d', genre: 'runner' }).find((f) => f.path === 'project.godot').content;
  assert.match(portrait, /window\/handheld\/orientation=5/);
  assert.match(portrait, /viewport_width=648/);
});

test('the block is described to whoever opens the project', () => {
  const described = describeBlock(BLOCK);
  assert.match(described, /Watchtower/);
  assert.match(described, /alley/);
});

// ── What the model is told before it builds anything ────────────────────────

test('the prompt decides the camera before it writes code', async () => {
  const { buildSystemPrompt, GAME_DESIGN_ADDENDUM } = await import('../src/lib/agent/system-prompt.ts');
  const prompt = buildSystemPrompt({ lane: 'B', suite: 'godot' });
  assert.ok(prompt.includes(GAME_DESIGN_ADDENDUM), 'a game suite without the design doctrine builds tech demos');

  // The four things that shipped broken, each named so the model cannot repeat
  // them by omission.
  assert.match(GAME_DESIGN_ADDENDUM, /0 is landscape and 1 is portrait/);
  assert.match(GAME_DESIGN_ADDENDUM, /One node owns every finger/);
  assert.match(GAME_DESIGN_ADDENDUM, /row-major/);
  assert.match(GAME_DESIGN_ADDENDUM, /Nothing is a dead end/);
  // And a genre table that covers more than shooters.
  for (const genre of ['runner', 'Racing', 'Platformer', 'Top-down', 'Puzzle', 'Third-person']) {
    assert.ok(GAME_DESIGN_ADDENDUM.includes(genre), `the camera table says nothing about ${genre}`);
  }
});

test('a non-game answer is not made to carry the doctrine', async () => {
  const { buildSystemPrompt, GAME_DESIGN_ADDENDUM } = await import('../src/lib/agent/system-prompt.ts');
  assert.ok(!buildSystemPrompt({ lane: 'B', suite: 'minecraft' }).includes(GAME_DESIGN_ADDENDUM));
  assert.ok(!buildSystemPrompt({ lane: 'A' }).includes(GAME_DESIGN_ADDENDUM));
});
