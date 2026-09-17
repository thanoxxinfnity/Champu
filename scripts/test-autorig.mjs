/** node --experimental-strip-types --test scripts/test-autorig.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fitBipedRig, riggedGlb, skinToBipedRig } from '../src/lib/suites/godot/autorig.ts';
import { parseTrimeshGlb } from '../src/lib/suites/godot/retexture.ts';
import { validateRig } from '../src/lib/suites/godot/rig.ts';
import { ARRAY_BUFFER, assembleGlb, BinaryBuilder, ELEMENT_ARRAY_BUFFER, FLOAT, UNSIGNED_INT } from '../src/lib/suites/godot/glb.ts';

/** A crude stick figure: a wider box for the torso plus arm/leg stubs, so
 *  there is a real head-to-foot extent and a real left-right spread to fit a
 *  rig against, without needing a real character mesh in the test suite. */
function stickFigure() {
  const positions = [];
  const push = (x, y, z) => { positions.push(x, y, z); return positions.length / 3 - 1; };

  // Torso corners, y in [0, 1.6] (feet to head), centred at x=z=0.
  const torso = [
    push(-0.2, 0.0, -0.1), push(0.2, 0.0, -0.1), push(0.2, 0.0, 0.1), push(-0.2, 0.0, 0.1),
    push(-0.2, 1.6, -0.1), push(0.2, 1.6, -0.1), push(0.2, 1.6, 0.1), push(-0.2, 1.6, 0.1),
  ];
  // A left-arm vertex well out to the +X side at shoulder height, and a
  // right-arm vertex to -X, so left/right skinning is actually testable.
  const armL = push(0.9, 1.2, 0);
  const armR = push(-0.9, 1.2, 0);
  // Foot vertices near the ground, offset left/right.
  const footL = push(0.1, 0.02, 0);
  const footR = push(-0.1, 0.02, 0);

  // A closed-enough triangle soup: two triangles per torso face is overkill
  // for this test, so just enough faces to make it a valid indexed mesh.
  const indices = [
    torso[0], torso[1], torso[2], torso[0], torso[2], torso[3], // bottom
    torso[4], torso[6], torso[5], torso[4], torso[7], torso[6], // top
    torso[0], torso[4], torso[1], torso[1], torso[4], torso[5], // side
    torso[1], armL, torso[5], // toward the left arm
    torso[0], armR, torso[4], // toward the right arm
    torso[0], footL, torso[1],
    torso[0], footR, torso[3],
  ];
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), armL, armR, footL, footR };
}

function bareGlb(positions, indices) {
  const bin = new BinaryBuilder();
  const positionView = bin.add(positions, ARRAY_BUFFER);
  const indexView = bin.add(indices, ELEMENT_ARRAY_BUFFER);
  const gltf = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: positionView, componentType: FLOAT, count: positions.length / 3, type: 'VEC3' },
      { bufferView: indexView, componentType: UNSIGNED_INT, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: bin.views, buffers: [{ byteLength: bin.byteLength }],
  };
  return assembleGlb(gltf, bin);
}

test('fitBipedRig places the skeleton inside the mesh it was fitted to, not at the origin', () => {
  const { positions } = stickFigure();
  const rig = fitBipedRig(positions);
  assert.deepEqual(problems(rig), []);

  const names = rig.bones.map((b) => b.name);
  assert.deepEqual(names, ['Root', 'Hips', 'Chest', 'Head', 'ArmL', 'ArmR', 'LegL', 'LegR']);

  for (const bone of rig.bones) {
    const [x, y, z] = bone.head;
    assert.ok(y >= -1e-6 && y <= 1.6 + 1e-6, `${bone.name} head.y=${y} is outside the mesh's own height range`);
    assert.ok(Math.abs(x) < 1, `${bone.name} head.x=${x} is outside the mesh's own width range`);
    assert.equal(z, 0, `${bone.name} should sit on the mesh's own centre depth`);
  }

  // Left really is the +X side here, matching how the mesh itself was built.
  const armL = rig.bones.find((b) => b.name === 'ArmL');
  const armR = rig.bones.find((b) => b.name === 'ArmR');
  assert.ok(armL.head[0] > 0);
  assert.ok(armR.head[0] < 0);

  function problems(r) { return validateRig(r); }
});

test('a fitted rig is a valid skinnable skeleton by rig.ts\'s own rules', () => {
  const { positions } = stickFigure();
  assert.deepEqual(validateRig(fitBipedRig(positions)), []);
});

test('skinning sends the left-arm vertex to ArmL and the right-arm vertex to ArmR', () => {
  const { positions, armL, armR, footL, footR } = stickFigure();
  const rig = fitBipedRig(positions);
  const skin = skinToBipedRig(positions, rig);

  const nameOf = (vertexIndex) => rig.bones[skin.joints[vertexIndex * 4]].name;
  assert.equal(nameOf(armL), 'ArmL');
  assert.equal(nameOf(armR), 'ArmR');
  assert.equal(nameOf(footL), 'LegL');
  assert.equal(nameOf(footR), 'LegR');

  // Rigid skinning: exactly one full-weight influence per vertex, not a blend.
  for (let v = 0; v < positions.length / 3; v += 1) {
    assert.equal(skin.weights[v * 4], 1);
    assert.equal(skin.weights[v * 4 + 1], 0);
  }
});

test('riggedGlb writes a skin Godot can actually bind: joints, weights, one root', async () => {
  const { positions, indices } = stickFigure();
  const rig = fitBipedRig(positions);
  const skin = skinToBipedRig(positions, rig);
  const normals = new Float32Array(positions.length).fill(0);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1; // arbitrary but valid unit normals
  const uvs = new Float32Array((positions.length / 3) * 2);

  const image = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]); // not a full PNG; only its presence is checked
  const glb = riggedGlb(positions, indices, normals, uvs, rig, skin, {
    name: 'stick', imageBytes: image, imageMimeType: 'image/png',
  });

  const reparsed = parseTrimeshGlb(glb);
  assert.deepEqual(Array.from(reparsed.positions), Array.from(positions));

  const view = new DataView(glb.buffer, glb.byteOffset);
  const jsonLength = view.getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));

  assert.equal(doc.skins.length, 1);
  assert.equal(doc.skins[0].joints.length, rig.bones.length);
  const attrs = doc.meshes[0].primitives[0].attributes;
  assert.ok('JOINTS_0' in attrs && 'WEIGHTS_0' in attrs);
  assert.equal(doc.accessors[attrs.JOINTS_0].componentType, 5123);
  assert.equal(doc.accessors[attrs.WEIGHTS_0].componentType, 5126);

  // Exactly one node has no parent among the skeleton nodes (the mesh node at
  // index 0 is separate and deliberately not part of that chain).
  const skeletonNodes = doc.nodes.slice(1);
  const referenced = new Set(skeletonNodes.flatMap((n) => n.children ?? []));
  const roots = skeletonNodes.filter((_, i) => !referenced.has(i + 1));
  assert.equal(roots.length, 1, 'exactly one bone should have no parent among the skeleton nodes');
});

test('a mesh with no left-right spread does not throw (degenerate but not divide-by-zero)', () => {
  // A single point repeated: every dimension is zero. minMax's own max(...,1e-6)
  // floor is what keeps fitBipedRig's ratios from becoming NaN here.
  const positions = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const rig = fitBipedRig(positions);
  for (const bone of rig.bones) {
    for (const c of bone.head) assert.ok(Number.isFinite(c), `${bone.name} produced a non-finite coordinate`);
  }
});
