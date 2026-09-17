/** node --experimental-strip-types --test scripts/test-retexture.mjs */
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import {
  computeBoxUvs, computeVertexNormals, encodePng, generateModelTexture,
  parseTrimeshGlb, proceduralMaterialTexture, retexturedGlb, retextureGlbFile,
} from '../src/lib/suites/godot/retexture.ts';
import { ARRAY_BUFFER, assembleGlb, BinaryBuilder, ELEMENT_ARRAY_BUFFER, FLOAT, UNSIGNED_INT } from '../src/lib/suites/godot/glb.ts';

/** A bare trimesh .glb: POSITION + indices, nothing else — exactly what a
 *  trimesh export leaves behind, and exactly what this module exists to fix. */
function bareTrimeshGlb(positions, indices) {
  const bin = new BinaryBuilder();
  const positionView = bin.add(new Float32Array(positions), ARRAY_BUFFER);
  const indexView = bin.add(new Uint32Array(indices), ELEMENT_ARRAY_BUFFER);
  const accessors = [
    { bufferView: positionView, componentType: FLOAT, count: positions.length / 3, type: 'VEC3' },
    { bufferView: indexView, componentType: UNSIGNED_INT, count: indices.length, type: 'SCALAR' },
  ];
  const gltf = {
    asset: { version: '2.0', generator: 'trimesh' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors,
    bufferViews: bin.views,
    buffers: [{ byteLength: bin.byteLength }],
  };
  return assembleGlb(gltf, bin);
}

// A pyramid: a square base plus an apex, six triangles, five vertices, so
// there is more than one face angle to test normals and UVs against.
const PYRAMID_POS = [
  -1, 0, -1,  1, 0, -1,  1, 0, 1,  -1, 0, 1, // base, y=0
  0, 2, 0,                                    // apex
];
const PYRAMID_IDX = [
  0, 1, 2, 0, 2, 3, // base (two triangles, facing -Y once wound flat)
  0, 4, 1, 1, 4, 2, 2, 4, 3, 3, 4, 0, // four sides
];

function decodePng(bytes) {
  assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  let p = 8;
  const chunks = {};
  while (p < bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + p);
    const length = view.getUint32(0, false);
    const type = new TextDecoder().decode(bytes.subarray(p + 4, p + 8));
    const data = bytes.subarray(p + 8, p + 8 + length);
    const storedCrc = view.getUint32(8 + length, false);
    // Recompute the CRC exactly the way the PNG spec defines it (over type+data)
    // using the same table-based algorithm, so a corrupted encoder is caught
    // here rather than by a viewer nobody ran.
    let crcTable = decodePng._table;
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
      decodePng._table = crcTable;
    }
    let c = 0xffffffff;
    const body = bytes.subarray(p + 4, p + 8 + length);
    for (let i = 0; i < body.length; i += 1) c = crcTable[(c ^ body[i]) & 0xff] ^ (c >>> 8);
    assert.equal((c ^ 0xffffffff) >>> 0, storedCrc, `${type} chunk CRC mismatch`);
    chunks[type] = data;
    p += 8 + length + 4;
  }
  const width = new DataView(chunks.IHDR.buffer, chunks.IHDR.byteOffset).getUint32(0, false);
  const height = new DataView(chunks.IHDR.buffer, chunks.IHDR.byteOffset).getUint32(4, false);
  const raw = inflateSync(chunks.IDAT);
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const row = raw.subarray(y * (1 + width * 3), (y + 1) * (1 + width * 3));
    assert.equal(row[0], 0, 'every scanline must use filter type "none"');
    rgb.set(row.subarray(1), y * width * 3);
  }
  return { width, height, rgb };
}

test('the geometry a bare trimesh export leaves behind reads back exactly', () => {
  const bytes = bareTrimeshGlb(PYRAMID_POS, PYRAMID_IDX);
  const parsed = parseTrimeshGlb(bytes);
  assert.deepEqual(Array.from(parsed.positions), PYRAMID_POS);
  assert.deepEqual(Array.from(parsed.indices), PYRAMID_IDX);
});

test('a 16-bit index buffer is upgraded, not silently truncated', () => {
  const bin = new BinaryBuilder();
  const positionView = bin.add(new Float32Array(PYRAMID_POS), ARRAY_BUFFER);
  const indexView = bin.add(new Uint16Array(PYRAMID_IDX), ELEMENT_ARRAY_BUFFER);
  const gltf = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: positionView, componentType: FLOAT, count: 5, type: 'VEC3' },
      { bufferView: indexView, componentType: 5123, count: PYRAMID_IDX.length, type: 'SCALAR' },
    ],
    bufferViews: bin.views, buffers: [{ byteLength: bin.byteLength }],
  };
  const parsed = parseTrimeshGlb(assembleGlb(gltf, bin));
  assert.deepEqual(Array.from(parsed.indices), PYRAMID_IDX);
});

test('flat faces get one consistent normal, not an average pulled toward zero', () => {
  const { positions, indices } = parseTrimeshGlb(bareTrimeshGlb(PYRAMID_POS, PYRAMID_IDX));
  const normals = computeVertexNormals(positions, indices);
  // Every normal must actually be a unit vector — the degenerate-vertex branch
  // must never leak into a face that has real area.
  for (let v = 0; v < normals.length; v += 3) {
    const len = Math.hypot(normals[v], normals[v + 1], normals[v + 2]);
    assert.ok(Math.abs(len - 1) < 1e-5, `vertex ${v / 3} normal is not unit length: ${len}`);
  }
  // Vertex 0, a base corner, touches the flat base *and* two sloped sides —
  // an asymmetric mix, unlike the apex (whose four side faces are symmetric
  // enough that their horizontal components cancel and the sum ends up
  // pointing straight up anyway). The corner's blended normal must not.
  const v0len = Math.hypot(normals[1], normals[2]);
  assert.ok(v0len > 0.01, `vertex 0 normal should lean off the Y axis, tilt was ${v0len}`);
});

test('UVs land inside the unit square and follow the dominant axis', () => {
  const { positions, indices } = parseTrimeshGlb(bareTrimeshGlb(PYRAMID_POS, PYRAMID_IDX));
  const normals = computeVertexNormals(positions, indices);
  const uvs = computeBoxUvs(positions, normals);
  assert.equal(uvs.length, (positions.length / 3) * 2);
  for (let i = 0; i < uvs.length; i += 1) {
    assert.ok(uvs[i] >= -1e-6 && uvs[i] <= 1 + 1e-6, `uv[${i}] = ${uvs[i]} is outside [0,1]`);
  }
});

test('the PNG encoder writes bytes a real decoder accepts', async () => {
  const rgb = new Uint8Array(4 * 3);
  // Four distinct pixels, so a filter or channel-order bug shows up as a
  // specific wrong pixel rather than a uniform (and easy to miss) wrong image.
  rgb.set([255, 0, 0,  0, 255, 0,  0, 0, 255,  10, 20, 30]);
  const png = await encodePng(2, 2, rgb);
  const decoded = decodePng(png);
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 2);
  assert.deepEqual(Array.from(decoded.rgb), Array.from(rgb));
});

test('the procedural texture is deterministic and actually varies by name', async () => {
  const a1 = await proceduralMaterialTexture('zombie_walker', 32);
  const a2 = await proceduralMaterialTexture('zombie_walker', 32);
  assert.deepEqual(Array.from(a1), Array.from(a2), 'same name must give the same texture');

  const b = await proceduralMaterialTexture('wooden_crate', 32);
  assert.notDeepEqual(Array.from(a1), Array.from(b), 'different names must not collide');

  const decoded = decodePng(a1);
  assert.equal(decoded.width, 32);
  // Not a flat swatch: at least two distinct pixel values somewhere in it.
  const distinct = new Set();
  for (let i = 0; i < decoded.rgb.length; i += 3) distinct.add(decoded.rgb[i]);
  assert.ok(distinct.size > 1, 'the noise pass produced a perfectly flat texture');
});

test('a model gets a real texture either from the network or the fallback', async () => {
  // No network mock: whichever path actually runs, the result must be a valid,
  // correctly-sized PNG — that is the contract callers depend on, not which
  // source served it.
  const { bytes, source } = await generateModelTexture('rusty metal barrel', { size: 64, timeoutMs: 10_000 });
  assert.ok(source === 'pollinations' || source === 'procedural');
  const decoded = decodePng(bytes);
  assert.equal(decoded.width, 64);
  assert.equal(decoded.height, 64);
});

test('retexturedGlb adds NORMAL, TEXCOORD_0, a material and an embedded image', async () => {
  const { positions, indices } = parseTrimeshGlb(bareTrimeshGlb(PYRAMID_POS, PYRAMID_IDX));
  const normals = computeVertexNormals(positions, indices);
  const uvs = computeBoxUvs(positions, normals);
  const image = await proceduralMaterialTexture('test prop', 16);

  const glb = retexturedGlb(positions, indices, normals, uvs, {
    name: 'pyramid', imageBytes: image, imageMimeType: 'image/png',
  });

  // Geometry survives the round trip.
  const reparsed = parseTrimeshGlb(glb);
  assert.deepEqual(Array.from(reparsed.positions), Array.from(positions));
  assert.deepEqual(Array.from(reparsed.indices), Array.from(indices));

  // And the JSON chunk actually carries what was promised, not just geometry.
  const view = new DataView(glb.buffer, glb.byteOffset);
  const jsonLength = view.getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
  const attrs = doc.meshes[0].primitives[0].attributes;
  assert.ok('NORMAL' in attrs && 'TEXCOORD_0' in attrs);
  assert.equal(doc.materials.length, 1);
  assert.equal(doc.images.length, 1);
  assert.equal(doc.images[0].mimeType, 'image/png');

  // The mimeType is not a fixed default: it must be whatever the caller
  // actually handed in, because Godot decodes strictly by this field.
  const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const asJpeg = retexturedGlb(positions, indices, normals, uvs, {
    name: 'pyramid', imageBytes: jpegBytes, imageMimeType: 'image/jpeg',
  });
  const jview = new DataView(asJpeg.buffer, asJpeg.byteOffset);
  const jlen = jview.getUint32(12, true);
  const jdoc = JSON.parse(new TextDecoder().decode(asJpeg.subarray(20, 20 + jlen)));
  assert.equal(jdoc.images[0].mimeType, 'image/jpeg');
  assert.equal(doc.accessors[doc.meshes[0].primitives[0].indices].componentType, 5125, 'indices must stay UNSIGNED_INT');
});

test('retextureGlbFile runs parse, normals, UVs and texturing as one job', async () => {
  const source = bareTrimeshGlb(PYRAMID_POS, PYRAMID_IDX);
  // A timeout this short forces the procedural path deterministically, so the
  // test is about the orchestration, not about whether Pollinations answers.
  const { glb, textureSource } = await retextureGlbFile(source, 'a wooden crate', { timeoutMs: 1 });
  assert.equal(textureSource, 'procedural');
  const view = new DataView(glb.buffer, glb.byteOffset);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  const reparsed = parseTrimeshGlb(glb);
  assert.equal(reparsed.positions.length, PYRAMID_POS.length);
});

test('the mime type generateModelTexture reports matches the actual bytes', async () => {
  // Pollinations serves JPEG regardless of what the URL implies. The mismatch
  // between that and a hardcoded 'image/png' is exactly the bug that made a
  // real retextured model fail to import in Godot with no clear error.
  //
  // sniffImageMime is not exported (it is an implementation detail of
  // generateModelTexture), so this checks the observable contract instead:
  // a real call's reported mimeType must match what its own bytes start
  // with, whichever path actually ran.
  const { bytes, mimeType } = await generateModelTexture('a rusty steel barrel', { size: 64, timeoutMs: 10_000 });
  if (mimeType === 'image/jpeg') {
    assert.deepEqual(Array.from(bytes.subarray(0, 3)), [0xff, 0xd8, 0xff]);
  } else {
    assert.equal(mimeType, 'image/png');
    assert.deepEqual(Array.from(bytes.subarray(0, 4)), [0x89, 0x50, 0x4e, 0x47]);
  }
});
