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

import { inverseBindMatrix, jointIndexFor, localTranslation, validateRig, type Rig } from './rig.ts';

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

/** Four vertices per face, six faces: the vertex count of one box. */
const VERTS_PER_BOX = 24;

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
 * Accumulates the BIN chunk while recording a bufferView for each piece.
 *
 * The offsets and the bytes have to agree exactly, and computing them in two
 * places is how they stop agreeing the moment a new stream (joints, weights,
 * bind matrices) is added. One writer keeps them in step.
 */
class BinaryBuilder {
  readonly views: Record<string, unknown>[] = [];
  private readonly parts: Uint8Array[] = [];
  private offset = 0;

  /** Appends a typed array and returns the index of its bufferView. */
  add(data: ArrayBufferView, target?: number): number {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const index = this.views.length;
    this.views.push({
      buffer: 0,
      byteOffset: this.offset,
      byteLength: bytes.byteLength,
      ...(target ? { target } : {}),
    });
    this.parts.push(bytes);
    this.offset += bytes.byteLength;

    // Every view must start 4-byte aligned; the pad belongs to no view.
    const padding = pad4(bytes.byteLength);
    if (padding) {
      this.parts.push(new Uint8Array(padding));
      this.offset += padding;
    }
    return index;
  }

  get byteLength(): number {
    return this.offset;
  }

  /** Copies every recorded part into `out` starting at `at`. */
  writeInto(out: Uint8Array, at: number): void {
    let p = at;
    for (const part of this.parts) {
      out.set(part, p);
      p += part.byteLength;
    }
  }
}

export interface GlbOptions {
  /** Divides every coordinate. Our box units are 16-to-a-block; Godot uses metres. */
  scale?: number;
  name?: string;
  /**
   * A skeleton to bind the boxes to. With one, the output is a skinned mesh
   * Godot imports as a Skeleton3D and an AnimationPlayer can drive. Without
   * one, the boxes are plain static nodes.
   */
  rig?: Rig;
}

/**
 * A .glb containing one mesh per box, each its own node so the parts stay
 * separable in an editor.
 *
 * With `options.rig`, each box is additionally bound to one joint at full
 * weight and every mesh node carries the skin — rigid skinning, which is what a
 * blocky character wants: an arm swings from the shoulder as a solid piece
 * instead of bending like rubber.
 */
export function buildGlb(boxes: Box[], options: GlbOptions = {}): Uint8Array {
  if (!boxes.length) throw new Error('A model needs at least one box.');
  const scale = options.scale ?? 16;
  const rig = options.rig;

  if (rig) {
    const problems = validateRig(rig);
    if (problems.length) throw new Error(`The rig will not skin: ${problems.join(' ')}`);
    if (rig.bones.length > 255) {
      // JOINTS_0 is written as unsigned short, so the ceiling is far higher than
      // this — but a skeleton this size is a bug in the caller, not a model.
      throw new Error(`${rig.bones.length} bones is more than a generated character should have.`);
    }
  }

  const bin = new BinaryBuilder();
  const accessors: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [];

  boxes.forEach((box, i) => {
    const { positions, normals, indices } = boxVertices(
      [box.origin[0] / scale, box.origin[1] / scale, box.origin[2] / scale],
      [box.size[0] / scale, box.size[1] / scale, box.size[2] / scale],
    );

    const positionView = bin.add(new Float32Array(positions), ARRAY_BUFFER);
    const normalView = bin.add(new Float32Array(normals), ARRAY_BUFFER);
    const indexView = bin.add(new Uint16Array(indices), ELEMENT_ARRAY_BUFFER);

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

    const attributes: Record<string, number> = { POSITION: positionAccessor, NORMAL: normalAccessor };

    if (rig) {
      // One joint per vertex at weight 1: the whole box moves with its bone.
      const joint = jointIndexFor(box, rig);
      const joints = new Uint16Array(VERTS_PER_BOX * 4);
      const weights = new Float32Array(VERTS_PER_BOX * 4);
      for (let v = 0; v < VERTS_PER_BOX; v += 1) {
        joints[v * 4] = joint;
        weights[v * 4] = 1;
      }

      const jointsView = bin.add(joints, ARRAY_BUFFER);
      const weightsView = bin.add(weights, ARRAY_BUFFER);

      attributes.JOINTS_0 = accessors.length;
      accessors.push({ bufferView: jointsView, componentType: UNSIGNED_SHORT, count: VERTS_PER_BOX, type: 'VEC4' });

      attributes.WEIGHTS_0 = accessors.length;
      accessors.push({ bufferView: weightsView, componentType: FLOAT, count: VERTS_PER_BOX, type: 'VEC4' });
    }

    const [r, g, b] = box.color ?? [0.62, 0.62, 0.66];
    materials.push({
      name: `${box.name}_mat`,
      pbrMetallicRoughness: { baseColorFactor: [r, g, b, 1], metallicFactor: 0.02, roughnessFactor: 0.72 },
    });

    meshes.push({
      name: box.name,
      primitives: [{ attributes, indices: indexAccessor, material: i }],
    });

    // A skinned mesh node must not sit under a joint, so these stay at the
    // scene root alongside the skeleton rather than inside it.
    nodes.push({ name: box.name, mesh: i, ...(rig ? { skin: 0 } : {}) });
  });

  const sceneNodes = nodes.map((_, i) => i);
  let skins: Record<string, unknown>[] | undefined;

  if (rig) {
    const jointBase = nodes.length;
    const childrenOf = new Map<string, number[]>();

    rig.bones.forEach((bone, i) => {
      if (!bone.parent) return;
      const list = childrenOf.get(bone.parent) ?? [];
      list.push(jointBase + i);
      childrenOf.set(bone.parent, list);
    });

    for (const bone of rig.bones) {
      const [tx, ty, tz] = localTranslation(bone, rig);
      const children = childrenOf.get(bone.name);
      nodes.push({
        name: bone.name,
        translation: [tx / scale, ty / scale, tz / scale],
        ...(children?.length ? { children } : {}),
      });
    }

    const matrices = new Float32Array(rig.bones.length * 16);
    rig.bones.forEach((bone, i) => matrices.set(inverseBindMatrix(bone, scale), i * 16));
    const matrixView = bin.add(matrices);

    const matrixAccessor = accessors.length;
    accessors.push({ bufferView: matrixView, componentType: FLOAT, count: rig.bones.length, type: 'MAT4' });

    const rootIndex = jointBase + rig.bones.findIndex((b) => !b.parent);
    skins = [
      {
        name: `${options.name ?? 'Scene'}_skin`,
        inverseBindMatrices: matrixAccessor,
        skeleton: rootIndex,
        joints: rig.bones.map((_, i) => jointBase + i),
      },
    ];
    // Only the root joint goes in the scene; the rest hang off it as children.
    sceneNodes.push(rootIndex);
  }

  const binaryLength = bin.byteLength;

  const gltf = {
    asset: { version: '2.0', generator: 'Chomugiri' },
    scene: 0,
    scenes: [{ name: options.name ?? 'Scene', nodes: sceneNodes }],
    nodes,
    meshes,
    materials,
    ...(skins ? { skins } : {}),
    accessors,
    bufferViews: bin.views,
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
  bin.writeInto(out, p);

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
