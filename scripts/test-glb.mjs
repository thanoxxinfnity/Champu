/** node --experimental-strip-types --test scripts/test-glb.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGlb } from '../src/lib/suites/godot/glb.ts';

/** Parses a .glb back into its header, JSON and binary chunk. */
function parseGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const length = view.getUint32(8, true);

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
  return { magic, version, length, json, bin, consumed: p };
}

const CUBE = [{ name: 'body', origin: [-4, 0, -4], size: [8, 8, 8] }];

test('the container is a valid glb: magic, version, and a length that matches', () => {
  const glb = buildGlb(CUBE);
  const { magic, version, length, consumed } = parseGlb(glb);

  assert.equal(magic, 0x46546c67, 'magic is "glTF"');
  assert.equal(version, 2);
  // A length that disagrees with the real byte count is the single most common
  // way a .glb loads in one viewer and fails in another.
  assert.equal(length, glb.byteLength);
  assert.equal(consumed, glb.byteLength, 'every byte belongs to a chunk');
});

test('every chunk and buffer view is 4-byte aligned, which the spec requires', () => {
  // Godot rejects a misaligned file outright, and the padding is easy to get
  // wrong for any box count that is not a multiple of four.
  for (const count of [1, 2, 3, 5]) {
    const boxes = Array.from({ length: count }, (_, i) => ({
      name: `part${i}`,
      origin: [i, 0, 0],
      size: [1 + i, 2, 3],
    }));
    const glb = buildGlb(boxes);
    assert.equal(glb.byteLength % 4, 0, `total length aligned for ${count} boxes`);

    const { json } = parseGlb(glb);
    for (const bv of json.bufferViews) {
      assert.equal(bv.byteOffset % 4, 0, `buffer view offset aligned for ${count} boxes`);
    }
  }
});

test('the geometry is really there: 24 vertices and 36 indices per box', () => {
  const { json, bin } = parseGlb(buildGlb(CUBE));

  const position = json.accessors[0];
  assert.equal(position.type, 'VEC3');
  assert.equal(position.count, 24, 'four vertices per face, so each face can have a flat normal');

  const index = json.accessors[2];
  assert.equal(index.count, 36, 'two triangles per face');

  // The binary chunk must actually hold what the accessors promise.
  const needed = json.bufferViews.reduce((max, bv) => Math.max(max, bv.byteOffset + bv.byteLength), 0);
  assert.ok(bin.byteLength >= needed, 'binary chunk covers every buffer view');
});

test('POSITION carries min and max, and they match the box', () => {
  // Required by the spec on POSITION, and viewers use it to frame the model —
  // a missing or wrong one makes the import look empty.
  const { json } = parseGlb(buildGlb([{ name: 'b', origin: [-8, 0, -8], size: [16, 16, 16] }], { scale: 16 }));
  const position = json.accessors[0];
  assert.deepEqual(position.min, [-0.5, 0, -0.5]);
  assert.deepEqual(position.max, [0.5, 1, 0.5]);
});

test('scale converts pixel units to metres, because Godot works in metres', () => {
  const big = parseGlb(buildGlb(CUBE, { scale: 1 })).json.accessors[0];
  const small = parseGlb(buildGlb(CUBE, { scale: 16 })).json.accessors[0];
  assert.deepEqual(big.max, [4, 8, 4]);
  assert.deepEqual(small.max, [0.25, 0.5, 0.25]);
});

test('each box stays its own node and mesh, so parts remain separable', () => {
  const { json } = parseGlb(buildGlb([
    { name: 'head', origin: [0, 8, 0], size: [8, 8, 8] },
    { name: 'body', origin: [0, 0, 0], size: [8, 8, 4] },
  ]));

  assert.deepEqual(json.nodes.map((n) => n.name), ['head', 'body']);
  assert.equal(json.meshes.length, 2);
  assert.deepEqual(json.scenes[0].nodes, [0, 1]);
});

test('a colour reaches the material, and an uncoloured box still gets one', () => {
  const { json } = parseGlb(buildGlb([{ name: 'ruby', origin: [0, 0, 0], size: [2, 2, 2], color: [1, 0, 0] }]));
  assert.deepEqual(json.materials[0].pbrMetallicRoughness.baseColorFactor, [1, 0, 0, 1]);

  const plain = parseGlb(buildGlb(CUBE)).json.materials[0];
  assert.ok(plain.pbrMetallicRoughness.baseColorFactor, 'an untinted model is still visible');
});

test('an empty model is refused rather than written as a broken file', () => {
  assert.throws(() => buildGlb([]), /at least one box/);
});
