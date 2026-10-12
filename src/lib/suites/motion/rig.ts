/**
 * A stickman skeleton: bones parented to each other, posed by angle instead of being redrawn every
 * frame. `computeRigPose` is forward kinematics (FK) — it walks the tree from each root bone, turning a
 * per-bone local angle into a world-space start/end point. `solveIK2` goes the other way for a two-bone
 * chain (shoulder→elbow→wrist, hip→knee→ankle): drag the wrist, and the two joint angles that reach it
 * are solved analytically (law of cosines), which is what "drag a joint to pose it" needs.
 *
 * `physics` on a bone (e.g. a cape, ponytail, or a loose limb) is secondary motion — a light pendulum
 * that lags behind its parent — and it is deliberately NOT part of `computeRigPose`. A rig pose must be a
 * pure function of t so the timeline can be scrubbed and exported frame-by-frame; a lagging pendulum
 * depends on recent velocity, which only exists during real playback. `stepPhysicsBone` is that stepped
 * simulation, driven frame-by-frame by the UI's play loop, same as a real 2D animation tool's dynamics.
 */

export interface BoneDef {
  id: string;
  name: string;
  parentId: string | null;
  /** Length in stage pixels. */
  length: number;
  /** Local angle in degrees, relative to the parent's world angle (0 = parent's own direction). */
  baseAngle: number;
  /** Marks this bone as secondary motion (see file header) rather than a directly-posed FK bone. */
  physics?: boolean;
}

export interface RigConfig {
  bones: BoneDef[];
  /** Where the root bone(s) start, relative to the layer's own x/y keyframe position. */
  originX: number;
  originY: number;
}

export interface BonePose {
  id: string;
  /** World-space start point. */
  x: number;
  y: number;
  /** World-space end point (the joint a child bone, or a dragged IK target, attaches to). */
  endX: number;
  endY: number;
  /** World-space angle in degrees. */
  worldAngle: number;
}

const STICKMAN_BONES: BoneDef[] = [
  { id: 'spine', name: 'Spine', parentId: null, length: 46, baseAngle: -90 },
  { id: 'head', name: 'Head', parentId: 'spine', length: 20, baseAngle: 0 },
  { id: 'armL', name: 'Arm L (upper)', parentId: 'spine', length: 26, baseAngle: -150 },
  { id: 'forearmL', name: 'Arm L (fore)', parentId: 'armL', length: 24, baseAngle: -10 },
  { id: 'armR', name: 'Arm R (upper)', parentId: 'spine', length: 26, baseAngle: -30 },
  { id: 'forearmR', name: 'Arm R (fore)', parentId: 'armR', length: 24, baseAngle: 10 },
  { id: 'legL', name: 'Leg L (thigh)', parentId: null, length: 30, baseAngle: 100 },
  { id: 'shinL', name: 'Leg L (shin)', parentId: 'legL', length: 28, baseAngle: 5 },
  { id: 'legR', name: 'Leg R (thigh)', parentId: null, length: 30, baseAngle: 80 },
  { id: 'shinR', name: 'Leg R (shin)', parentId: 'legR', length: 28, baseAngle: -5 },
];

export function newRig(): RigConfig {
  return { bones: STICKMAN_BONES.map((b) => ({ ...b })), originX: 0, originY: 40 };
}

/** Forward kinematics: a local angle per bone (falling back to its base pose) → every bone's world pose. */
export function computeRigPose(rig: RigConfig, angles: Record<string, number> = {}): BonePose[] {
  const children = new Map<string | null, BoneDef[]>();
  for (const b of rig.bones) {
    const key = b.parentId;
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(b);
  }
  const out = new Map<string, BonePose>();
  const walk = (bone: BoneDef, originX: number, originY: number, parentWorldAngle: number) => {
    const local = angles[bone.id] ?? bone.baseAngle;
    const worldAngle = bone.parentId === null ? local : parentWorldAngle + local;
    const rad = (worldAngle * Math.PI) / 180;
    const endX = originX + Math.cos(rad) * bone.length;
    const endY = originY + Math.sin(rad) * bone.length;
    out.set(bone.id, { id: bone.id, x: originX, y: originY, endX, endY, worldAngle });
    for (const child of children.get(bone.id) ?? []) walk(child, endX, endY, worldAngle);
  };
  for (const root of children.get(null) ?? []) walk(root, rig.originX, rig.originY, 0);
  // bones.filter order may not match tree order; return in bones[] order for a stable list
  return rig.bones.map((b) => out.get(b.id)).filter((p): p is BonePose => !!p);
}

/**
 * Two-bone analytic IK (law of cosines): given a fixed shoulder/hip point and two bone lengths, the local
 * angle for the upper bone and the forearm/shin's local angle that together reach `target`. Returns null
 * if the target is further than the chain can physically reach (the caller should then just point at it).
 */
export function solveIK2(
  originX: number, originY: number, lenA: number, lenB: number, targetX: number, targetY: number,
): { angleA: number; angleB: number } | null {
  const dx = targetX - originX, dy = targetY - originY;
  const dist = Math.hypot(dx, dy);
  const maxReach = lenA + lenB;
  const minReach = Math.abs(lenA - lenB);
  if (dist > maxReach || dist < minReach || dist === 0) return null;
  const baseAngle = Math.atan2(dy, dx);
  const cosA = (lenA * lenA + dist * dist - lenB * lenB) / (2 * lenA * dist);
  const angleToTarget = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const angleA = baseAngle - angleToTarget;
  const cosB = (lenA * lenA + lenB * lenB - dist * dist) / (2 * lenA * lenB);
  const innerAngle = Math.acos(Math.max(-1, Math.min(1, cosB)));
  const angleB = Math.PI - innerAngle;
  return { angleA: (angleA * 180) / Math.PI, angleB: (angleB * 180) / Math.PI };
}

/** True if every bone's start→end distance still equals its defined `length` (a pose never stretches a bone). */
export function checkBoneLengths(rig: RigConfig, pose: BonePose[]): boolean {
  const byId = new Map(rig.bones.map((b) => [b.id, b]));
  return pose.every((p) => {
    const def = byId.get(p.id);
    if (!def) return false;
    const actual = Math.hypot(p.endX - p.x, p.endY - p.y);
    return Math.abs(actual - def.length) < 1e-6;
  });
}

/** Per-bone angle at time `t`, from a rig layer's keyframed `pose` maps — same two-point hold/interpolate shape as valueAt(). */
export function poseAt(
  rig: RigConfig,
  keyframes: Array<{ t: number; pose?: Record<string, number> }>,
  t: number,
  easeOf: (p: number) => number,
): Record<string, number> {
  const base: Record<string, number> = {};
  for (const b of rig.bones) base[b.id] = b.baseAngle;
  if (keyframes.length === 0) return base;
  const at = (i: number) => ({ ...base, ...(keyframes[i]!.pose ?? {}) });
  if (t <= keyframes[0]!.t) return at(0);
  if (t >= keyframes[keyframes.length - 1]!.t) return at(keyframes.length - 1);
  let i = 0;
  while (i < keyframes.length - 1 && keyframes[i + 1]!.t <= t) i++;
  const a = at(i), b = at(i + 1);
  const span = keyframes[i + 1]!.t - keyframes[i]!.t;
  const raw = span <= 0 ? 1 : (t - keyframes[i]!.t) / span;
  const p = easeOf(raw);
  const out: Record<string, number> = {};
  for (const id of Object.keys(base)) out[id] = a[id]! + (b[id]! - a[id]!) * p;
  return out;
}

// ── secondary motion (physics bones) ────────────────────────────────────────────

export interface PhysicsState {
  /** Current world angle in degrees. */
  angle: number;
  /** Angular velocity in degrees/second. */
  angularVelocity: number;
}

/**
 * One damped-pendulum step for a `physics: true` bone: gravity pulls its angle toward straight down
 * (90°), parent motion since the last frame gives it a push, and velocity decays so it settles. Call this
 * every rendered frame during Play with the previous frame's state; it is intentionally not pure in t
 * alone (see file header) — scrubbing or exporting a physics bone holds it at its last-simulated pose.
 */
export function stepPhysicsBone(
  state: PhysicsState, baseAngle: number, parentAngularVelocity: number, dt: number,
  gravity = 420, damping = 3.2, stiffness = 18,
): PhysicsState {
  if (dt <= 0) return state;
  const rad = (state.angle * Math.PI) / 180;
  const gravityTorque = gravity * Math.cos(rad - Math.PI / 2);
  const springTorque = -(state.angle - baseAngle) * stiffness;
  const drive = parentAngularVelocity * 0.5;
  const angularAccel = gravityTorque + springTorque + drive - state.angularVelocity * damping;
  const angularVelocity = state.angularVelocity + angularAccel * dt;
  const angle = state.angle + angularVelocity * dt;
  return { angle, angularVelocity };
}
