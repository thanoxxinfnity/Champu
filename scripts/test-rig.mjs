/** node --experimental-strip-types --test scripts/test-rig.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGlb, boxesFromParts } from '../src/lib/suites/godot/glb.ts';
import {
  bipedRig,
  inverseBindMatrix,
  jointIndexFor,
  localTranslation,
  quadrupedRig,
  rigFor,
  validateRig,
} from '../src/lib/suites/godot/rig.ts';

/** Parses a .glb back into its JSON and binary chunk. */
function parseGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 12;
  let json = null;
  let bin = null;
  while (p < bytes.byteLength) {
    const chunkLength = view.getUint32(p, true);
    const chunkType = view.getUint32(p + 4, true);
    const body = bytes.subarray(p + 8, p + 8 + chunkLength);
    if (chunkType === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
    if (chunkType === 0x004e4942) bin = body;
    p += 8 + chunkLength;
  }
  return { json, bin };
}

/** Reads an accessor's values out of the binary chunk. */
function readAccessor(json, bin, index) {
  const accessor = json.accessors[index];
  const bv = json.bufferViews[accessor.bufferView];
  const components = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
  const total = accessor.count * components;
  const start = bin.byteOffset + bv.byteOffset;

  if (accessor.componentType === 5126) return Array.from(new Float32Array(bin.buffer.slice(start, start + total * 4)));
  if (accessor.componentType === 5123) return Array.from(new Uint16Array(bin.buffer.slice(start, start + total * 2)));
  throw new Error(`unhandled component type ${accessor.componentType}`);
}

const BIPED_PARTS = [
  { name: 'body', size: [8, 12, 4], at: [0, 12, 0] },
  { name: 'head', size: [8, 8, 8], at: [0, 24, 0] },
  { name: 'leftArm', size: [4, 12, 4], at: [6, 12, 0] },
  { name: 'rightArm', size: [4, 12, 4], at: [-6, 12, 0] },
  { name: 'leftLeg', size: [4, 12, 4], at: [2, 0, 0] },
  { name: 'rightLeg', size: [4, 12, 4], at: [-2, 0, 0] },
];

// ── The rig itself ──────────────────────────────────────────────────────────

test('the stock rigs are well formed', () => {
  assert.deepEqual(validateRig(bipedRig()), []);
  assert.deepEqual(validateRig(quadrupedRig()), []);
});

test('validateRig catches the skeletons that would import silently broken', () => {
  const duplicate = { bones: [{ name: 'A' }, { name: 'A', parent: 'A' }].map((b) => ({ ...b, head: [0, 0, 0] })), binding: {} };
  assert.match(validateRig(duplicate).join(' '), /Two bones are named "A"/);

  const orphan = { bones: [{ name: 'A', head: [0, 0, 0] }, { name: 'B', parent: 'Ghost', head: [0, 0, 0] }], binding: {} };
  assert.match(validateRig(orphan).join(' '), /"Ghost", which does not exist/);

  const twoRoots = { bones: [{ name: 'A', head: [0, 0, 0] }, { name: 'B', head: [0, 0, 0] }], binding: {} };
  assert.match(validateRig(twoRoots).join(' '), /2 root bones/);

  // Every bone has a parent, so there is no root to start the skin from.
  const cycle = {
    bones: [{ name: 'A', parent: 'B', head: [0, 0, 0] }, { name: 'B', parent: 'A', head: [0, 0, 0] }],
    binding: {},
  };
  assert.match(validateRig(cycle).join(' '), /cycle/);

  const badBinding = { bones: [{ name: 'Root', head: [0, 0, 0] }], binding: { body: 'Ghost' } };
  assert.match(validateRig(badBinding).join(' '), /Box "body" binds to bone "Ghost"/);
});

test('a blob gets no rig, because it has nothing to articulate', () => {
  assert.equal(rigFor('blob'), null);
  assert.ok(rigFor('biped'));
  assert.ok(rigFor('quadruped'));
  // A flying creature is still shoulders-and-hips shaped; the wings hang off the chest.
  assert.ok(rigFor('flying'));
});

test('a bone translation is relative to its parent, not the world', () => {
  const rig = bipedRig();
  const chest = rig.bones.find((b) => b.name === 'Chest');
  const hips = rig.bones.find((b) => b.name === 'Hips');

  // Chest sits at y=18 in the world and Hips at y=12, so the offset is 6.
  assert.deepEqual(localTranslation(chest, rig), [0, 6, 0]);
  // The root has no parent, so its local translation is its world position.
  assert.deepEqual(localTranslation(rig.bones[0], rig), [0, 0, 0]);
  assert.deepEqual(localTranslation(hips, rig), [0, 12, 0]);
});

test('the inverse bind matrix is column-major, with the translation in the last column', () => {
  const bone = { name: 'Head', head: [0, 24, 0] };
  const m = inverseBindMatrix(bone, 16);

  assert.equal(m.length, 16);
  // glTF stores matrices column-major, so translation lives at 12..14 — not 3..11,
  // which is where a row-major write would put it.
  assert.deepEqual(m.slice(12, 16), [-0, -1.5, -0, 1]);
  assert.deepEqual(m.slice(0, 12), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
});

test('a box with no binding falls back to the root rather than collapsing', () => {
  const rig = bipedRig();
  // An unbound vertex in a skinned mesh snaps to the origin, which reads as the
  // model exploding — the root is wrong-ish but stays where it was put.
  assert.equal(jointIndexFor({ name: 'antenna', origin: [0, 0, 0], size: [1, 1, 1] }, rig), 0);
  assert.equal(rig.bones[jointIndexFor({ name: 'head', origin: [0, 0, 0], size: [1, 1, 1] }, rig)].name, 'Head');
});

// ── The skinned .glb ────────────────────────────────────────────────────────

test('without a rig nothing changes: no skin, no joint nodes', () => {
  const { json } = parseGlb(buildGlb(boxesFromParts(BIPED_PARTS)));
  assert.equal(json.skins, undefined);
  assert.equal(json.nodes.length, BIPED_PARTS.length);
  assert.ok(json.nodes.every((n) => n.skin === undefined));
  assert.ok(json.meshes.every((m) => m.primitives[0].attributes.JOINTS_0 === undefined));
});

test('with a rig the file carries a skin every mesh node uses', () => {
  const rig = bipedRig();
  const { json } = parseGlb(buildGlb(boxesFromParts(BIPED_PARTS), { rig }));

  assert.equal(json.skins.length, 1);
  assert.equal(json.skins[0].joints.length, rig.bones.length);
  // Godot only builds a Skeleton3D for nodes that actually reference the skin.
  const meshNodes = json.nodes.filter((n) => n.mesh !== undefined);
  assert.equal(meshNodes.length, BIPED_PARTS.length);
  assert.ok(meshNodes.every((n) => n.skin === 0), 'every mesh node is skinned');
});

test('a skinned mesh node is never a child of a joint, which the spec forbids', () => {
  const { json } = parseGlb(buildGlb(boxesFromParts(BIPED_PARTS), { rig: bipedRig() }));
  const jointSet = new Set(json.skins[0].joints);

  for (const joint of json.skins[0].joints) {
    for (const child of json.nodes[joint].children ?? []) {
      assert.ok(jointSet.has(child), `joint ${joint} has a non-joint child ${child}`);
    }
  }
  // The mesh nodes and the skeleton root sit side by side at the scene root.
  const sceneNodes = json.scenes[0].nodes;
  assert.ok(sceneNodes.includes(json.skins[0].skeleton), 'the skeleton root is in the scene');
  assert.equal(sceneNodes.length, BIPED_PARTS.length + 1);
});

test('every skinned vertex is bound to exactly one joint at full weight', () => {
  const { json, bin } = parseGlb(buildGlb(boxesFromParts(BIPED_PARTS), { rig: bipedRig() }));

  for (const mesh of json.meshes) {
    const attributes = mesh.primitives[0].attributes;
    const joints = readAccessor(json, bin, attributes.JOINTS_0);
    const weights = readAccessor(json, bin, attributes.WEIGHTS_0);
    assert.equal(joints.length, 24 * 4, `${mesh.name} binds all 24 vertices`);

    for (let v = 0; v < 24; v += 1) {
      const sum = weights.slice(v * 4, v * 4 + 4).reduce((a, b) => a + b, 0);
      // Weights that do not sum to 1 shrink or blow up the mesh at import.
      assert.equal(sum, 1, `${mesh.name} vertex ${v} weights sum to 1`);
      assert.equal(weights[v * 4], 1, 'rigid skinning: the first weight carries everything');
      assert.deepEqual(joints.slice(v * 4 + 1, v * 4 + 4), [0, 0, 0], 'unused joint slots are zeroed');
    }
  }
});

test('each part binds to the bone that should move it', () => {
  const rig = bipedRig();
  const { json, bin } = parseGlb(buildGlb(boxesFromParts(BIPED_PARTS), { rig }));
  const boneOfJointNode = (node) => json.nodes[node].name;

  for (const mesh of json.meshes) {
    const joints = readAccessor(json, bin, mesh.primitives[0].attributes.JOINTS_0);
    const boneName = boneOfJointNode(json.skins[0].joints[joints[0]]);
    assert.equal(boneName, rig.binding[mesh.name], `${mesh.name} is driven by ${rig.binding[mesh.name]}`);
  }
});

test('the joint tree and the bind matrices agree, so the model does not explode at import', () => {
  // This is the assertion that matters. A joint's world transform composed with
  // its inverse bind matrix must be the identity in the bind pose — if the node
  // translations and the matrices disagree by even one parent offset, every
  // vertex of that limb lands somewhere else and the character tears apart.
  const rig = bipedRig();
  const scale = 16;
  const { json, bin } = parseGlb(buildGlb(boxesFromParts(BIPED_PARTS), { rig, scale }));

  const matrices = readAccessor(json, bin, json.skins[0].inverseBindMatrices);
  assert.equal(json.accessors[json.skins[0].inverseBindMatrices].type, 'MAT4');
  assert.equal(matrices.length, rig.bones.length * 16);

  // Walk the node tree from the skeleton root, accumulating translations.
  const world = new Map();
  const walk = (nodeIndex, parent) => {
    const node = json.nodes[nodeIndex];
    const t = node.translation ?? [0, 0, 0];
    const here = [parent[0] + t[0], parent[1] + t[1], parent[2] + t[2]];
    world.set(nodeIndex, here);
    for (const child of node.children ?? []) walk(child, here);
  };
  walk(json.skins[0].skeleton, [0, 0, 0]);

  assert.equal(world.size, rig.bones.length, 'every joint is reachable from the root');

  json.skins[0].joints.forEach((nodeIndex, j) => {
    const here = world.get(nodeIndex);
    const ibm = matrices.slice(j * 16, j * 16 + 16);
    for (let axis = 0; axis < 3; axis += 1) {
      const composed = here[axis] + ibm[12 + axis];
      assert.ok(
        Math.abs(composed) < 1e-6,
        `${json.nodes[nodeIndex].name} axis ${axis}: world ${here[axis]} + bind ${ibm[12 + axis]} should cancel`,
      );
    }
  });
});

test('joint positions are scaled the same way the vertices are', () => {
  const rig = bipedRig();
  const { json } = parseGlb(buildGlb(boxesFromParts(BIPED_PARTS), { rig, scale: 16 }));
  const head = json.nodes.find((n) => n.name === 'Head');
  // Head sits 6 units above the chest in box units, so 6/16 metres above it.
  assert.deepEqual(head.translation, [0, 6 / 16, 0]);
});

test('a rig that would not skin is refused before it reaches a file', () => {
  const broken = { bones: [{ name: 'A', head: [0, 0, 0] }, { name: 'B', head: [0, 0, 0] }], binding: {} };
  assert.throws(() => buildGlb(boxesFromParts(BIPED_PARTS), { rig: broken }), /will not skin/);
});

test('a rigged file is still 4-byte aligned, with the extra streams in it', () => {
  const glb = buildGlb(boxesFromParts(BIPED_PARTS), { rig: bipedRig() });
  assert.equal(glb.byteLength % 4, 0);
  const { json, bin } = parseGlb(glb);
  for (const bv of json.bufferViews) assert.equal(bv.byteOffset % 4, 0);
  const needed = json.bufferViews.reduce((max, bv) => Math.max(max, bv.byteOffset + bv.byteLength), 0);
  assert.ok(bin.byteLength >= needed, 'the binary chunk covers every view');
});
