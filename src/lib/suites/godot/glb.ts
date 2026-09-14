/**
 * Writing a real .glb — binary glTF 2.0 — from box geometry.
 *
 * Godot imports .glb natively: drop one in the project folder and it becomes a
 * usable scene with no conversion step. That makes it the right output format,
 * and it makes this file the floor of the 3D feature: it needs no API key, no
 * network, and no service that might be down or out of credit. A generated
 * model always exists, even offline.
 *
 * Hosted generators (Tripo and friends) sit *above* this as an upgrade for when
 * a user wants something organic rather than boxy — not as the thing the feature
 * depends on.
 *
 * Pure: no DOM, no fetch. Returns bytes, so it can be tested by parsing them
 * back.
 */

/** One axis-aligned box, in the same units the caller is already using. */
export interface Box {
  name: string;
  /** Minimum corner. */
  origin: [number, number, number];
  size: [number, number, number];
  /** 0-1 RGB. Defaults to a mid grey so an untinted model is still visible. */
  color?: [number, number, number];
}

const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"
const BIN_CHUNK = 0x004e4942; // "BIN\0"

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

/** The 8 corners of a box, as 24 vertices — 4 per face, so each face gets flat normals. */
function boxVertices(origin: [number, number, number], size: [number, number, number]) {
  const [x, y, z] = origin;
  const [w, h, d] = size;
  const [X, Y, Z] = [x + w, y + h, z + d];

  // Per face: 4 positions, one shared normal. Winding is counter-clockwise seen
  // from outside, which is what glTF expects for front faces.
  const faces: Array<{ positions: number[][]; normal: [number, number, number] }> = [
    { positions: [[x, y, Z], [X, y, Z], [X, Y, Z], [x, Y, Z]], normal: [0, 0, 1] },   // front
    { positions: [[X, y, z], [x, y, z], [x, Y, z], [X, Y, z]], normal: [0, 0, -1] },  // back
    { positions: [[x, Y, Z], [X, Y, Z], [X, Y, z], [x, Y, z]], normal: [0, 1, 0] },   // top
    { positions: [[x, y, z], [X, y, z], [X, y, Z], [x, y, Z]], normal: [0, -1, 0] },  // bottom
    { positions: [[X, y, Z], [X, y, z], [X, Y, z], [X, Y, Z]], normal: [1, 0, 0] },   // right
    { positions: [[x, y, z], [x, y, Z], [x, Y, Z], [x, Y, z]], normal: [-1, 0, 0] },  // left
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  faces.forEach((face, f) => {
    for (const p of face.positions) {
      positions.push(p[0], p[1], p[2]);
      normals.push(face.normal[0], face.normal[1], face.normal[2]);
    }
    const base = f * 4;
    // Two triangles per quad.
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });

  return { positions, normals, indices };
}

function minMax(values: number[], stride: number): { min: number[]; max: number[] } {
  const min = new Array(stride).fill(Infinity);
  const max = new Array(stride).fill(-Infinity);
  for (let i = 0; i < values.length; i += stride) {
    for (let c = 0; c < stride; c += 1) {
      min[c] = Math.min(min[c], values[i + c]);
      max[c] = Math.max(max[c], values[i + c]);
    }
  }
  return { min, max };
}

/** Pads a byte length up to the 4-byte alignment glTF requires. */
function pad4(n: number): number {
  return (4 - (n % 4)) % 4;
}

/**
 * A .glb containing one mesh per box, each its own node so the parts stay
 * separable in an editor.
 *
 * `scale` divides every coordinate, because the box sizes we generate elsewhere
 * are in pixel-ish units (16 to a block) while Godot works in metres.
 */
export function buildGlb(boxes: Box[], options: { scale?: number; name?: string } = {}): Uint8Array {
  if (!boxes.length) throw new Error('A model needs at least one box.');
  const scale = options.scale ?? 16;

  const positionChunks: Float32Array[] = [];
  const normalChunks: Float32Array[] = [];
  const indexChunks: Uint16Array[] = [];

  const accessors: Record<string, unknown>[] = [];
  const bufferViews: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [];

  let offset = 0;

  boxes.forEach((box, i) => {
    const { positions, normals, indices } = boxVertices(
      [box.origin[0] / scale, box.origin[1] / scale, box.origin[2] / scale],
      [box.size[0] / scale, box.size[1] / scale, box.size[2] / scale],
    );

    const positionData = new Float32Array(positions);
    const normalData = new Float32Array(normals);
    const indexData = new Uint16Array(indices);

    // Positions
    const positionView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: positionData.byteLength, target: ARRAY_BUFFER });
    offset += positionData.byteLength;
    positionChunks.push(positionData);

    // Normals
    const normalView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: normalData.byteLength, target: ARRAY_BUFFER });
    offset += normalData.byteLength;
    normalChunks.push(normalData);

    // Indices — padded, because the next view has to start 4-byte aligned.
    const indexView = bufferViews.length;
    const indexPadding = pad4(indexData.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: indexData.byteLength, target: ELEMENT_ARRAY_BUFFER });
    offset += indexData.byteLength + indexPadding;
    indexChunks.push(indexData);

    const bounds = minMax(positions, 3);
    const positionAccessor = accessors.length;
    accessors.push({
      bufferView: positionView,
      componentType: FLOAT,
      count: positions.length / 3,
      type: 'VEC3',
      // Required on POSITION by the spec, and viewers use it to frame the model.
      min: bounds.min,
      max: bounds.max,
    });

    const normalAccessor = accessors.length;
    accessors.push({ bufferView: normalView, componentType: FLOAT, count: normals.length / 3, type: 'VEC3' });

    const indexAccessor = accessors.length;
    accessors.push({ bufferView: indexView, componentType: UNSIGNED_SHORT, count: indices.length, type: 'SCALAR' });

    const [r, g, b] = box.color ?? [0.62, 0.62, 0.66];
    materials.push({
      name: `${box.name}_mat`,
      pbrMetallicRoughness: { baseColorFactor: [r, g, b, 1], metallicFactor: 0.02, roughnessFactor: 0.72 },
    });

    meshes.push({
      name: box.name,
      primitives: [
        {
          attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
          indices: indexAccessor,
          material: i,
        },
      ],
    });

    nodes.push({ name: box.name, mesh: i });
  });

  const binaryLength = offset;

  const gltf = {
    asset: { version: '2.0', generator: 'Chomugiri' },
    scene: 0,
    scenes: [{ name: options.name ?? 'Scene', nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binaryLength }],
  };

  // ── Assemble the container ────────────────────────────────────────────────
  const jsonText = JSON.stringify(gltf);
  const jsonBytes = new TextEncoder().encode(jsonText);
  // Chunks are padded with spaces (JSON) and zeros (BIN) to a 4-byte boundary.
  const jsonPadding = pad4(jsonBytes.byteLength);
  const jsonChunkLength = jsonBytes.byteLength + jsonPadding;
  const binPadding = pad4(binaryLength);
  const binChunkLength = binaryLength + binPadding;

  const total = 12 + 8 + jsonChunkLength + 8 + binChunkLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let p = 0;

  // Header
  view.setUint32(p, MAGIC, true); p += 4;
  view.setUint32(p, 2, true); p += 4;
  view.setUint32(p, total, true); p += 4;

  // JSON chunk
  view.setUint32(p, jsonChunkLength, true); p += 4;
  view.setUint32(p, JSON_CHUNK, true); p += 4;
  out.set(jsonBytes, p); p += jsonBytes.byteLength;
  for (let i = 0; i < jsonPadding; i += 1) out[p + i] = 0x20; // spaces
  p += jsonPadding;

  // BIN chunk
  view.setUint32(p, binChunkLength, true); p += 4;
  view.setUint32(p, BIN_CHUNK, true); p += 4;

  const binStart = p;
  for (let i = 0; i < boxes.length; i += 1) {
    out.set(new Uint8Array(positionChunks[i].buffer), binStart + (bufferViews[i * 3] as { byteOffset: number }).byteOffset);
    out.set(new Uint8Array(normalChunks[i].buffer), binStart + (bufferViews[i * 3 + 1] as { byteOffset: number }).byteOffset);
    out.set(new Uint8Array(indexChunks[i].buffer), binStart + (bufferViews[i * 3 + 2] as { byteOffset: number }).byteOffset);
  }

  return out;
}

/**
 * The body-plan parts the Minecraft suite already describes, as boxes for a .glb.
 *
 * One description, two outputs: the same plan that becomes Bedrock geometry
 * becomes a Godot-ready mesh. `at` is a footprint centre and a base height,
 * which is how a person describes a part; `originOf` turns that into the
 * minimum corner a mesh needs.
 */
export function boxesFromParts(
  parts: Array<{ name: string; size: [number, number, number]; at: [number, number, number] }>,
  color?: [number, number, number],
): Box[] {
  return parts.map((part) => {
    const [w, , d] = part.size;
    const [cx, baseY, cz] = part.at;
    return {
      name: part.name,
      origin: [cx - w / 2, baseY, cz - d / 2] as [number, number, number],
      size: part.size,
      ...(color ? { color } : {}),
    };
  });
}
