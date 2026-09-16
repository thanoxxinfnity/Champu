/** node --experimental-strip-types --test scripts/test-city.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { cityJobs, isOpenWorld, openWorldInput, PARKED_CARS } from '../src/lib/suites/godot/openworld.ts';
import { carScript, orbitCameraScript, walkerScript } from '../src/lib/suites/godot/thirdperson.ts';
import { buildProject } from '../src/lib/suites/godot/project.ts';
import { inside, cityBlock } from '../src/lib/suites/godot/layout.ts';
import { verifyProject, shippable } from '../src/lib/suites/godot/verify.ts';
import { inferGenre, inferView } from '../src/lib/suites/godot/plan.ts';

const CITY = { name: 'Chomu City', dimension: '3d', genre: 'open-world', view: 'third-person' };

test('"like GTA" plans an open world, not a lap circuit', () => {
  // It contains a car, and matched as racing it became a race track — which is
  // the one thing GTA is not.
  for (const prompt of ['make a game like gta 5', 'an open world city game', 'free roam sandbox city', 'a game where you drive around a city']) {
    assert.equal(inferGenre(prompt).genre, 'open-world', prompt);
  }
  assert.equal(inferView('like gta', 'open-world').view, 'third-person');
  // And a real racing request still plans a race.
  assert.equal(inferGenre('a kart racing game with laps').genre, 'racing');
});

test('the camera is a spring arm, because a third-person camera clips walls', () => {
  const gd = orbitCameraScript();
  assert.match(gd, /extends SpringArm3D/);
  // Without it, backing into a corner puts the camera inside the building.
  assert.match(gd, /spring_length = distance/);
  // In _physics_process with the body it follows: on different clocks the
  // character shivers against the background.
  assert.match(gd, /func _physics_process/);
  assert.ok(!/func _process\(/.test(gd), 'following in _process makes the character jitter');
  // And the player is excluded, or the arm collides with them and sits on their nose.
  assert.match(gd, /add_excluded_object/);
});

test('walking is relative to the camera, not to the body', () => {
  // "Left" means left on the screen. It is the only thing it can mean when you
  // are looking at your own back.
  const gd = walkerScript();
  assert.match(gd, /_camera\.forward\(\)/);
  assert.match(gd, /_camera\.right\(\)/);
  // lerp_angle, or crossing from +PI to -PI spins the character all the way round.
  assert.match(gd, /lerp_angle/);
});

test('the car is a real vehicle body, not a box that slides', () => {
  const gd = carScript();
  assert.match(gd, /extends VehicleBody3D/);
  assert.match(gd, /VehicleWheel3D\.new\(\)/);
  // Front steers, rear drives. All four doing both spins on every corner.
  assert.match(gd, /use_as_steering/);
  assert.match(gd, /use_as_traction/);
  // The single most common reason a Godot car flips.
  assert.match(gd, /center_of_mass = Vector3\(0\.0, -0\.4, 0\.0\)/);
  // Parked means parked, not rolling down the street.
  assert.match(gd, /if driver == null/);
});

test('the cars are parked on the street, not dropped in a plaza', () => {
  const block = cityBlock();
  for (const car of PARKED_CARS) {
    // A car is 4.2m long and 1.9m wide; 2.5m of clearance is against the kerb
    // rather than inside the brickwork.
    assert.ok(!inside(block, car.at[0], car.at[1], 2.5), `${car.name} at ${car.at} is in a building`);
    assert.ok(Math.abs(car.at[0]) < 31 && Math.abs(car.at[1]) < 31, `${car.name} is outside the wall`);
  }
  assert.ok(PARKED_CARS.length >= 3, 'one car in a city is a cutscene prop');
});

test('the jobs are ones the runner can actually check', () => {
  const jobs = cityJobs('Chomu City');
  assert.ok(jobs.length >= 4);
  for (const job of jobs) {
    for (const o of job.objectives) {
      // No `eliminate`: there is nothing to eliminate with, and a job that
      // cannot be finished is worse than one that does not exist.
      assert.notEqual(o.kind, 'eliminate', `${job.id} asks for kills in a game with no gun`);
      assert.ok(o.target > 0);
      if (o.kind === 'reach' || o.kind === 'defend') {
        assert.ok(Array.isArray(o.at) && o.at.length === 3, `${job.id}: ${o.kind} has nowhere to be`);
        // And somewhere you can actually stand.
        assert.ok(!inside(cityBlock(), o.at[0], o.at[2], 1.0), `${job.id}: ${o.at} is inside a building`);
      }
    }
  }
});

test('it ships the files a city needs and none of the shooter it is not', () => {
  const paths = buildProject(CITY).map((f) => f.path);
  for (const want of ['orbit_camera.gd', 'car.gd', 'car_door.gd', 'player.gd', 'touch.gd', 'hud.gd', 'wiring.gd', 'navigation.gd']) {
    assert.ok(paths.includes(want), `missing ${want}`);
  }
  for (const not of ['weapon.gd', 'enemy.gd', 'director.gd', 'effects.gd', 'joystick.gd']) {
    assert.ok(!paths.includes(not), `${not} has no business in a game with no gun`);
  }
});

test('the HUD is the city\'s own, not the shooter\'s', () => {
  // `$Ammo.text = "…"` on a node that is not there is not a warning — it throws
  // on the first frame and takes the whole HUD with it. Which it did.
  const hud = buildProject(CITY).find((f) => f.path === 'hud.gd').content;
  assert.match(hud, /func set_prompt/);
  for (const absent of ['$Ammo', '$Wave', '$Crosshair', '$Score']) {
    assert.ok(!hud.includes(absent), `the city HUD reaches for ${absent}, which its scene does not have`);
  }
});

test('the scene declares every resource it uses', () => {
  // One undeclared SubResource does not degrade the scene, it refuses to load
  // it at all: "Parse Error: Invalid parameter" and a black window.
  const files = buildProject(CITY);
  const scene = files.find((f) => f.path === 'main.tscn').content;
  const declared = new Set([...scene.matchAll(/^\[sub_resource type="[^"]+" id="([^"]+)"\]/gm)].map((m) => m[1]));
  for (const [, id] of scene.matchAll(/SubResource\("([^"]+)"\)/g)) {
    assert.ok(declared.has(id), `SubResource("${id}") is used and never declared`);
  }
  const extDeclared = new Set([...scene.matchAll(/^\[ext_resource [^\]]*id="([^"]+)"\]/gm)].map((m) => m[1]));
  for (const [, id] of scene.matchAll(/ExtResource\("([^"]+)"\)/g)) {
    assert.ok(extDeclared.has(id), `ExtResource("${id}") is used and never declared`);
  }
  const header = /^\[gd_scene load_steps=(\d+)/.exec(scene);
  assert.equal(Number(header[1]), (scene.match(/^\[(ext_resource|sub_resource)/gm) ?? []).length + 1);
});

test('the city passes the same gate everything else does', () => {
  const problems = verifyProject(buildProject(CITY));
  assert.ok(shippable(problems), problems.filter((p) => p.fatal).map((p) => `${p.file}: ${p.message}`).join('\n'));
});

test('`use` is declared, or getting into a car does nothing', () => {
  const config = buildProject(CITY).find((f) => f.path === 'project.godot').content;
  assert.match(config, /^use=\{/m);
  assert.match(openWorldInput(), /keycode":69/);
  // Landscape, like anything you steer.
  assert.match(config, /window\/handheld\/orientation=4/);
  assert.ok(isOpenWorld(CITY));
  assert.ok(!isOpenWorld({ ...CITY, dimension: '2d' }));
});

test('the city and the shooter are the same city', () => {
  // Extracted so a fix to the streets lands in both rather than in whichever
  // was being edited that day.
  const city = buildProject(CITY).find((f) => f.path === 'main.tscn').content;
  const shooter = buildProject({ name: 'S', dimension: '3d', genre: 'shooter', view: 'first-person' })
    .find((f) => f.path === 'main.tscn').content;
  for (const name of ['Watchtower', 'Warehouse', 'Ramp', 'Rail0', 'Overlook']) {
    assert.ok(city.includes(`name="${name}"`), `the city has no ${name}`);
    assert.ok(shooter.includes(`name="${name}"`), `the shooter has no ${name}`);
  }
});
