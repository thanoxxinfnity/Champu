/** node --experimental-strip-types --test scripts/test-polyhaven.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assetFrom, attribution, boundsFrom, filesFrom, scoreAsset } from '../src/lib/suites/godot/polyhaven.ts';
import { buildProject } from '../src/lib/suites/godot/project.ts';
import { verifyProject, shippable } from '../src/lib/suites/godot/verify.ts';

// A real index entry, trimmed. Kept verbatim so the reader is tested against
// the shape the API sends rather than the one I expected.
const ENTRY = {
  name: 'Barrel 03',
  categories: ['props', 'industrial'],
  tags: ['barrel', 'metal', 'oil', 'drum', 'rusty'],
  authors: { 'Rico Cilliers': 'All' },
  polycount: 1473,
};

test('an index entry is read into something placeable', () => {
  const asset = assetFrom('barrel_03', ENTRY);
  assert.equal(asset.id, 'barrel_03');
  assert.equal(asset.name, 'Barrel 03');
  assert.deepEqual(asset.authors, ['Rico Cilliers']);
  assert.equal(asset.polycount, 1473);
  assert.match(asset.thumbnail, /barrel_03/);
  assert.equal(assetFrom('x', { categories: [] }), null);
});

test('a name match outranks a tag match', () => {
  const barrel = assetFrom('barrel_03', ENTRY);
  const chair = assetFrom('chair_01', { name: 'Arm Chair 01', tags: ['metal'], categories: ['furniture'] });
  assert.ok(scoreAsset(barrel, ['barrel']) > scoreAsset(chair, ['barrel']));
  assert.equal(scoreAsset(chair, ['barrel']), 0);
});

test('bounds come from the glTF, not from a guess', () => {
  // Measured against the real files: the barrel is 0.63 x 0.93 x 0.64 with its
  // origin on its base. A fixed -1.2 drop that suited a 2.4m cube put it most
  // of a metre underground, which is visible in a render and in nothing else.
  const gltf = {
    accessors: [
      { min: [-0.317, 0, -0.319], max: [0.317, 0.93, 0.319] },
      { min: [0, 0], max: [1, 1] },
    ],
  };
  const bounds = boundsFrom(gltf);
  assert.equal(bounds.size[1].toFixed(2), '0.93');
  assert.equal(bounds.baseY, 0);
  // Several meshes: the union, not the first one.
  const wide = boundsFrom({
    accessors: [
      { min: [-1, 0, -1], max: [1, 2, 1] },
      { min: [-3, -0.5, -1], max: [0, 1, 4] },
    ],
  });
  assert.deepEqual(wide.size.map((v) => Number(v.toFixed(2))), [4, 2.5, 5]);
  assert.equal(wide.baseY, -0.5);
  assert.equal(boundsFrom({ accessors: [{ min: [0, 0], max: [1, 1] }] }), null);
  assert.equal(boundsFrom(null), null);
});

test('the download list falls back through the resolutions', () => {
  // Not every asset is published at every size, and a 2k prop beats no prop.
  const files = {
    gltf: {
      '2k': { gltf: { url: 'https://cdn/a_2k.gltf', include: { 'a.bin': { url: 'https://cdn/a.bin' } } } },
    },
  };
  const picked = filesFrom(files, '1k');
  assert.equal(picked.url, 'https://cdn/a_2k.gltf');
  assert.deepEqual(picked.include, { 'a.bin': 'https://cdn/a.bin' });
  assert.match(filesFrom({}, '1k').error, /no glTF/);
});

test('the include map keys are paths, and flattening them loses every texture', () => {
  // A .gltf refers to `textures/x.jpg` by that exact relative path, and Godot
  // resolves it from where the .gltf sits.
  const picked = filesFrom(
    {
      gltf: {
        '1k': {
          gltf: {
            url: 'https://cdn/c.gltf',
            include: { 'textures/c_diff_1k.jpg': { url: 'https://cdn/t.jpg' }, 'c.bin': { url: 'https://cdn/c.bin' } },
          },
        },
      },
    },
    '1k',
  );
  assert.ok(Object.keys(picked.include).includes('textures/c_diff_1k.jpg'));
});

test('CC0 is credited even though it does not have to be', () => {
  const line = attribution(assetFrom('barrel_03', ENTRY));
  assert.match(line, /Barrel 03/);
  assert.match(line, /Rico Cilliers/);
  assert.match(line, /CC0/);
  assert.match(line, /polyhaven\.com\/a\/barrel_03/);
});

// ── How a prop lands in the scene ───────────────────────────────────────────

const SHOOTER = { name: 'Chomu Game', dimension: '3d', genre: 'shooter', view: 'first-person' };
const BARREL = { path: 'res://assets/barrel_03/barrel_03.gltf', size: [0.63, 0.93, 0.64], baseY: 0, scale: 1.34 };

test('a prop stands on the floor rather than inside it', () => {
  const scene = buildProject({ ...SHOOTER, props: [BARREL] }).find((f) => f.path === 'main.tscn').content;
  // The body sits on the ground slab's top face, and the art is not dropped.
  assert.match(scene, /\[node name="Crate0"[^\]]*\]\ntransform = Transform3D\(1, 0, 0, 0, 1, 0, 0, 0, 1, -6\.5, 0\.25, -22\)/);
  assert.match(scene, /\[node name="Art" parent="Navigation\/Arena\/Crate0" instance=ExtResource\("[^"]+"\)\]/);
});

test("the collision box is cut to the prop, not the prop scaled to the box", () => {
  // Hiding behind a barrel half the size of the thing stopping the bullets is
  // the most obvious way cover feels broken.
  const scene = buildProject({ ...SHOOTER, props: [BARREL] }).find((f) => f.path === 'main.tscn').content;
  const shape = /\[sub_resource type="BoxShape3D" id="BoxShape3D_prop0"\]\nsize = Vector3\(([\d.]+), ([\d.]+), ([\d.]+)\)/.exec(scene);
  assert.ok(shape, 'no collision shape was made for the prop');
  assert.equal(Number(shape[2]).toFixed(2), (0.93 * 1.34).toFixed(2));
});

test('a model whose origin is not on its base is lifted by what the glTF said', () => {
  const sunk = { ...BARREL, baseY: -0.034, scale: 2 };
  const scene = buildProject({ ...SHOOTER, props: [sunk] }).find((f) => f.path === 'main.tscn').content;
  // -(-0.034) * 2
  assert.match(scene, /0, 0\.068, 0\)/);
});

test('one ext_resource per prop, however many positions use it', () => {
  // Sixteen ext_resources pointing at one file is sixteen imports of the same
  // textures.
  const scene = buildProject({ ...SHOOTER, props: [BARREL] }).find((f) => f.path === 'main.tscn').content;
  assert.equal((scene.match(/barrel_03\.gltf/g) ?? []).length, 1);
  assert.ok((scene.match(/name="Crate\d+"/g) ?? []).length > 4, 'the props should be placed at several positions');
});

test('with no props the boxes stay, because a box beats a hole', () => {
  const scene = buildProject(SHOOTER).find((f) => f.path === 'main.tscn').content;
  assert.match(scene, /mesh = SubResource\("BoxMesh_crate"\)/);
});

test('a project with props still passes its own gate', () => {
  // load_steps has to count the per-prop shapes, and every ExtResource has to
  // be declared — both are silent failures that open to a scene with holes.
  const files = buildProject({ ...SHOOTER, props: [BARREL] });
  const problems = verifyProject(files).filter((p) => !/barrel_03\.gltf/.test(p.message));
  assert.ok(shippable(problems), problems.map((p) => p.message).join('\n'));

  const header = /^\[gd_scene load_steps=(\d+) format=3/.exec(files.find((f) => f.path === 'main.tscn').content);
  const scene = files.find((f) => f.path === 'main.tscn').content;
  const resources = (scene.match(/^\[(ext_resource|sub_resource)/gm) ?? []).length;
  assert.equal(Number(header[1]), resources + 1);
});
