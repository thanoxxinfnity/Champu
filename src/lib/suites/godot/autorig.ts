/**
 * Rigging a mesh nobody built a body plan for.
 *
 * `rig.ts` skins boxes: `jointIndexFor` looks a box up by name in a binding
 * table, because the caller placed every box and knows which one is the left
 * arm. A downloaded model has no such table — it is a pile of triangles with
 * a name and nothing else — so there is nothing to look up.
 *
 * What is still true of a roughly-humanoid mesh is its own bounding box: feet
 * near the bottom, head near the top, arms spread near shoulder height. This
 * fits an eight-bone biped skeleton to that box instead of to a body plan,
 * and skins each vertex to whichever bone's *reach* — a line segment, not a
 * point, so a long limb does not all snap to its own shoulder — passes
 * closest to it.
 *
 * This is not UniRig. It is a bounding-box heuristic, and it inherits the
 * limits of one: it assumes the mesh already reads as upright and roughly
 * symmetric left-to-right, and it will misjudge a mesh in an unusual pose or
 * with limbs tucked in. It is what does not need a GPU, a gated model, or a
 * Python 3.11 environment with `bpy` built for it, none of which are true of
 * UniRig on Kaggle today.
 */

import { ARRAY_BUFFER, assembleGlb, BinaryBuilder, ELEMENT_ARRAY_BUFFER, FLOAT, minMax, UNSIGNED_INT } from './glb.ts';
import { inverseBindMatrix, localTranslation, validateRig, type Bone, type Rig } from './rig.ts';

/**
 * An eight-bone biped fitted to a mesh's own bounding box.
 *
 * Proportions are rough fractions of standing-human height (hips a little
 * past the midpoint, chest at two-thirds, shoulders just under that) rather
 * than measured from the mesh, because there is no cheap way to find an
 * actual hip or shoulder on a triangle soup — the box is the only reliable
 * signal available.
 */
export function fitBipedRig(positions: Float32Array): Rig {
  const bounds = minMax(Array.from(positions), 3);
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  const height = Math.max(maxY - minY, 1e-6);
  const width = Math.max(maxX - minX, 1e-6);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const hipsY = minY + height * 0.5;
  const chestY = minY + height * 0.68;
  const headY = minY + height * 0.85;
  const shoulderY = minY + height * 0.76;
  const shoulderX = width * 0.28;
  const legX = width * 0.11;

  return {
    bones: [
      { name: 'Root', head: [cx, minY, cz] },
      { name: 'Hips', parent: 'Root', head: [cx, hipsY, cz] },
      { name: 'Chest', parent: 'Hips', head: [cx, chestY, cz] },
      { name: 'Head', parent: 'Chest', head: [cx, headY, cz] },
      { name: 'ArmL', parent: 'Chest', head: [cx + shoulderX, shoulderY, cz] },
      { name: 'ArmR', parent: 'Chest', head: [cx - shoulderX, shoulderY, cz] },
      { name: 'LegL', parent: 'Hips', head: [cx + legX, hipsY, cz] },
      { name: 'LegR', parent: 'Hips', head: [cx - legX, hipsY, cz] },
    ],
    // No box names bind here — skinToBoundingBoxRig assigns joints by nearest
    // bone segment instead — but validateRig still checks the skeleton shape,
    // and an empty binding is a valid one.
    binding: {},
  };
}

type Vec3 = [number, number, number];

function closestPointOnSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const abLenSq = abx * abx + aby * aby + abz * abz;
  const t = abLenSq > 1e-12 ? (apx * abx + apy * aby + apz * abz) / abLenSq : 0;
  const clamped = Math.min(1, Math.max(0, t));
  const qx = a[0] + abx * clamped, qy = a[1] + aby * clamped, qz = a[2] + abz * clamped;
  const dx = p[0] - qx, dy = p[1] - qy, dz = p[2] - qz;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * The reach of each bone `fitBipedRig` produces, as a line segment.
 *
 * A bone is a single point in this codebase's `Rig` (a joint, not a
 * stick with a length), so nearest-*point* skinning would make every vertex
 * near a shoulder join the arm regardless of whether it is torso or bicep.
 * Extending each limb bone out toward the mesh's own boundary — the actual
 * side, top or bottom of its bounding box — gives it a reach a point cannot,
 * at the cost of being specific to this exact eight-bone topology rather than
 * a generic children-of-any-rig computation.
 */
function bipedReach(rig: Rig, bounds: { min: number[]; max: number[] }): Map<string, [Vec3, Vec3]> {
  const at = (name: string): Vec3 => rig.bones.find((b) => b.name === name)!.head;
  const [minX, minY] = bounds.min;
  const [maxX, maxY] = bounds.max;
  const chest = at('Chest');
  const legL = at('LegL');
  const legR = at('LegR');
  return new Map<string, [Vec3, Vec3]>([
    ['Root', [at('Root'), at('Hips')]],
    ['Hips', [at('Root'), at('Hips')]],
    ['Chest', [at('Hips'), at('Chest')]],
    ['Head', [chest, [chest[0], maxY, chest[2]]]],
    ['ArmL', [chest, [maxX, at('ArmL')[1], chest[2]]]],
    ['ArmR', [chest, [minX, at('ArmR')[1], chest[2]]]],
    ['LegL', [legL, [legL[0], minY, legL[2]]]],
    ['LegR', [legR, [legR[0], minY, legR[2]]]],
  ]);
}

export interface SkinResult {
  /** One joint index per vertex — rigid skinning, matching `rig.ts`'s box binding: one bone, full weight, no blend. */
  joints: Uint16Array;
  weights: Float32Array;
}

/**
 * Assigns every vertex to whichever bone's reach segment is nearest.
 *
 * Rigid, not smooth: each vertex gets exactly one joint at weight 1, the same
 * choice `rig.ts` makes for boxes and for the same reason — a limb that is
 * meant to swing as a solid piece should not visibly bend where two bones'
 * influence crosses over.
 */
export function skinToBipedRig(positions: Float32Array, rig: Rig): SkinResult {
  const bounds = minMax(Array.from(positions), 3);
  const reach = bipedReach(rig, bounds);
  const names = rig.bones.map((b) => b.name);
  const segments = names.map((name) => reach.get(name)!);

  const vertexCount = positions.length / 3;
  const joints = new Uint16Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);

  for (let v = 0; v < vertexCount; v += 1) {
    const p: Vec3 = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    let best = 0;
    let bestDist = Infinity;
    for (let b = 0; b < segments.length; b += 1) {
      const [a, c] = segments[b];
      const d = closestPointOnSegment(p, a, c);
      if (d < bestDist) { bestDist = d; best = b; }
    }
    joints[v * 4] = best;
    weights[v * 4] = 1;
  }
  return { joints, weights };
}

export interface AutoRigOptions {
  name?: string;
  imageBytes: Uint8Array;
  imageMimeType: 'image/png' | 'image/jpeg';
}

/**
 * Writes a skinned .glb: the retextured mesh's attributes plus JOINTS_0,
 * WEIGHTS_0 and a skin, so Godot imports it as a Skeleton3D an
 * AnimationPlayer can actually drive.
 *
 * Shares its bind-matrix and parent-relative-translation math with the
 * box-model writer (`inverseBindMatrix`, `localTranslation`) rather than
 * recomputing it, since a skeleton built from world-space joint positions
 * needs exactly the same conversion regardless of what generated the mesh.
 */
export function riggedGlb(
  positions: Float32Array,
  indices: Uint32Array,
  normals: Float32Array,
  uvs: Float32Array,
  rig: Rig,
  skin: SkinResult,
  options: AutoRigOptions,
): Uint8Array {
  const problems = validateRig(rig);
  if (problems.length) throw new Error(`The rig will not skin: ${problems.join(' ')}`);

  const vertexCount = positions.length / 3;
  const bin = new BinaryBuilder();
  const positionView = bin.add(positions, ARRAY_BUFFER);
  const normalView = bin.add(normals, ARRAY_BUFFER);
  const uvView = bin.add(uvs, ARRAY_BUFFER);
  const jointsView = bin.add(skin.joints, ARRAY_BUFFER);
  const weightsView = bin.add(skin.weights, ARRAY_BUFFER);
  const indexView = bin.add(indices, ELEMENT_ARRAY_BUFFER);
  const imageView = bin.add(options.imageBytes);

  const bounds = minMax(Array.from(positions), 3);

  const accessors: Record<string, unknown>[] = [
    { bufferView: positionView, componentType: FLOAT, count: vertexCount, type: 'VEC3', min: bounds.min, max: bounds.max },
    { bufferView: normalView, componentType: FLOAT, count: vertexCount, type: 'VEC3' },
    { bufferView: uvView, componentType: FLOAT, count: vertexCount, type: 'VEC2' },
    { bufferView: jointsView, componentType: 5123 /* UNSIGNED_SHORT */, count: vertexCount, type: 'VEC4' },
    { bufferView: weightsView, componentType: FLOAT, count: vertexCount, type: 'VEC4' },
    { bufferView: indexView, componentType: UNSIGNED_INT, count: indices.length, type: 'SCALAR' },
  ];

  // 1:1 with rig.bones — jointBase offsets every skeleton node past the one
  // mesh node, the same layout buildGlb uses for a skinned box model.
  const jointBase = 1;
  const childrenOf = new Map<string, number[]>();
  rig.bones.forEach((bone, i) => {
    if (!bone.parent) return;
    const list = childrenOf.get(bone.parent) ?? [];
    list.push(jointBase + i);
    childrenOf.set(bone.parent, list);
  });

  const skeletonNodes = rig.bones.map((bone, i) => ({
    name: bone.name,
    translation: localTranslation(bone, rig),
    ...(childrenOf.get(bone.name)?.length ? { children: childrenOf.get(bone.name) } : {}),
  }));

  const matrices = new Float32Array(rig.bones.length * 16);
  rig.bones.forEach((bone: Bone, i) => matrices.set(inverseBindMatrix(bone, 1), i * 16));
  const matrixView = bin.add(matrices);
  const matrixAccessor = accessors.length;
  accessors.push({ bufferView: matrixView, componentType: FLOAT, count: rig.bones.length, type: 'MAT4' });

  const rootIndex = jointBase + rig.bones.findIndex((b) => !b.parent);

  const gltf = {
    asset: { version: '2.0', generator: 'Chomugiri' },
    scene: 0,
    scenes: [{ name: options.name ?? 'Scene', nodes: [0, rootIndex] }],
    nodes: [{ name: options.name ?? 'model', mesh: 0, skin: 0 }, ...skeletonNodes],
    meshes: [{
      name: options.name ?? 'model',
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, JOINTS_0: 3, WEIGHTS_0: 4 },
        indices: 5,
        material: 0,
      }],
    }],
    materials: [{
      name: `${options.name ?? 'model'}_mat`,
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.02, roughnessFactor: 0.85 },
    }],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ bufferView: imageView, mimeType: options.imageMimeType }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    skins: [{
      name: `${options.name ?? 'model'}_skin`,
      inverseBindMatrices: matrixAccessor,
      skeleton: rootIndex,
      joints: rig.bones.map((_, i) => jointBase + i),
    }],
    accessors,
    bufferViews: bin.views,
    buffers: [{ byteLength: bin.byteLength }],
  };

  return assembleGlb(gltf, bin);
}
