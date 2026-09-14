/**
 * A skeleton, so a generated model can be animated.
 *
 * An unrigged mesh is scenery: it can be placed in a level and nothing more.
 * Rigging it turns it into a character — Godot imports a skinned .glb as a
 * Skeleton3D with real bones, and an AnimationPlayer can drive them.
 *
 * The binding here is rigid: one joint per vertex at full weight, no blending.
 * That is not a shortcut, it is what a blocky character wants — a Minecraft-ish
 * arm should pivot at the shoulder as a solid piece, and smooth weights would
 * make it bend like rubber.
 *
 * Pure: takes boxes and a bone map, returns the glTF pieces `glb.ts` needs.
 */

import type { Box } from './glb.ts';

export interface Bone {
  name: string;
  /** Parent bone name; absent for the root. */
  parent?: string;
  /** Joint position in the same units as the boxes, before scaling. */
  head: [number, number, number];
}

/** Which bone drives which box. A box with no entry binds to the root. */
export type BoneBinding = Record<string, string>;

export interface Rig {
  bones: Bone[];
  binding: BoneBinding;
}

/**
 * A humanoid skeleton matching the biped body plan.
 *
 * Joints sit where a limb actually pivots — the shoulder, not the middle of the
 * arm — because a bone placed at a box's centre makes the limb swing from its
 * own belly, which looks broken the moment anything animates.
 */
export function bipedRig(scale = 1): Rig {
  const s = scale;
  return {
    bones: [
      { name: 'Root', head: [0, 0, 0] },
      { name: 'Hips', parent: 'Root', head: [0, 12 * s, 0] },
      { name: 'Chest', parent: 'Hips', head: [0, 18 * s, 0] },
      { name: 'Head', parent: 'Chest', head: [0, 24 * s, 0] },
      // Shoulders, not mid-arm: this is where an arm swings from.
      { name: 'ArmL', parent: 'Chest', head: [6 * s, 22 * s, 0] },
      { name: 'ArmR', parent: 'Chest', head: [-6 * s, 22 * s, 0] },
      // Hips height, so a leg rotates at the joint rather than the knee.
      { name: 'LegL', parent: 'Hips', head: [2 * s, 12 * s, 0] },
      { name: 'LegR', parent: 'Hips', head: [-2 * s, 12 * s, 0] },
    ],
    binding: {
      body: 'Chest',
      head: 'Head',
      leftArm: 'ArmL',
      rightArm: 'ArmR',
      leftLeg: 'LegL',
      rightLeg: 'LegR',
    },
  };
}

/** A quadruped skeleton: spine plus four legs. */
export function quadrupedRig(scale = 1): Rig {
  const s = scale;
  return {
    bones: [
      { name: 'Root', head: [0, 0, 0] },
      { name: 'Spine', parent: 'Root', head: [0, 10 * s, 0] },
      { name: 'Neck', parent: 'Spine', head: [0, 12 * s, 8 * s] },
      { name: 'Head', parent: 'Neck', head: [0, 13 * s, 11 * s] },
      { name: 'LegFL', parent: 'Spine', head: [3 * s, 8 * s, 5 * s] },
      { name: 'LegFR', parent: 'Spine', head: [-3 * s, 8 * s, 5 * s] },
      { name: 'LegBL', parent: 'Spine', head: [3 * s, 8 * s, -5 * s] },
      { name: 'LegBR', parent: 'Spine', head: [-3 * s, 8 * s, -5 * s] },
    ],
    binding: {
      body: 'Spine',
      head: 'Head',
      frontLeftLeg: 'LegFL',
      frontRightLeg: 'LegFR',
      backLeftLeg: 'LegBL',
      backRightLeg: 'LegBR',
    },
  };
}

/** The rig a body plan implies. */
export function rigFor(plan: 'biped' | 'quadruped' | 'blob' | 'flying', scale = 1): Rig | null {
  if (plan === 'biped' || plan === 'flying') return bipedRig(scale);
  if (plan === 'quadruped') return quadrupedRig(scale);
  // A blob has nothing to articulate; rigging it would add bones that never move.
  return null;
}

/**
 * The joint index each box binds to.
 *
 * Falls back to the root rather than dropping the box: an unbound vertex in a
 * skinned mesh collapses to the origin, which looks like the model exploded.
 */
export function jointIndexFor(box: Box, rig: Rig): number {
  const boneName = rig.binding[box.name];
  const index = rig.bones.findIndex((b) => b.name === boneName);
  return index >= 0 ? index : 0;
}

/**
 * A bone's translation relative to its parent, which is what glTF stores.
 *
 * `head` is a world position, but a glTF node's transform is relative to its
 * parent. Writing the world position straight into the node stacks every
 * ancestor's offset a second time and scatters the skeleton, so subtract.
 */
export function localTranslation(bone: Bone, rig: Rig): [number, number, number] {
  if (!bone.parent) return bone.head;
  const parent = rig.bones.find((b) => b.name === bone.parent);
  if (!parent) return bone.head;
  return [bone.head[0] - parent.head[0], bone.head[1] - parent.head[1], bone.head[2] - parent.head[2]];
}

/**
 * The inverse bind matrix for a joint: the transform that moves a vertex from
 * model space into the joint's space.
 *
 * For a skeleton built only from translations this is simply a translation by
 * the negated world position — but it has to be written column-major, which is
 * the order glTF (and OpenGL) use and the order that is easy to get wrong.
 */
export function inverseBindMatrix(bone: Bone, scale: number): number[] {
  const [x, y, z] = bone.head;
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    -x / scale, -y / scale, -z / scale, 1,
  ];
}

/** Validates a rig before it reaches a file, where the failure is silent. */
export function validateRig(rig: Rig): string[] {
  const problems: string[] = [];
  const names = new Set<string>();

  for (const bone of rig.bones) {
    if (names.has(bone.name)) problems.push(`Two bones are named "${bone.name}"; Godot keeps only one.`);
    names.add(bone.name);
  }

  const roots = rig.bones.filter((b) => !b.parent);
  if (roots.length === 0) problems.push('No root bone: every bone has a parent, which is a cycle.');
  if (roots.length > 1) problems.push(`${roots.length} root bones; a skin needs exactly one.`);

  for (const bone of rig.bones) {
    if (bone.parent && !names.has(bone.parent)) {
      problems.push(`Bone "${bone.name}" hangs from "${bone.parent}", which does not exist.`);
    }
  }

  // A parent declared after its child is legal in our data but must still
  // resolve; a cycle is not.
  for (const bone of rig.bones) {
    const seen = new Set<string>([bone.name]);
    let current = bone.parent;
    while (current) {
      if (seen.has(current)) {
        problems.push(`Bone "${bone.name}" is in a parent cycle.`);
        break;
      }
      seen.add(current);
      current = rig.bones.find((b) => b.name === current)?.parent;
    }
  }

  for (const [box, bone] of Object.entries(rig.binding)) {
    if (!names.has(bone)) problems.push(`Box "${box}" binds to bone "${bone}", which does not exist.`);
  }

  return problems;
}
