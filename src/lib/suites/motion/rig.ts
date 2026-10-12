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
  /** Joint limit, in local degrees — a posed or physics-driven angle is clamped into [minAngle, maxAngle] when both are set (e.g. a knee that only bends one way). */
  minAngle?: number;
  maxAngle?: number;
}

/** Clamp a local angle into a bone's joint limits, if it has any. */
export function clampLocalAngle(bone: BoneDef, angle: number): number {
  if (bone.minAngle === undefined || bone.maxAngle === undefined) return angle;
  return Math.max(bone.minAngle, Math.min(bone.maxAngle, angle));
}

/**
 * A bone that has broken off its parent (a thrown weapon, a severed limb) and now flies on its own —
 * closed-form ballistic motion (ballistic position/rotation is a plain function of elapsed time since
 * breaking free), not a stepped simulation, so it stays correct when scrubbing or exporting frames.
 * `ax/ay`/`originAngle` freeze the bone's actual world position/angle at the instant it detached; `vx/vy`
 * are the world-space velocity (px/s) it carries away, `angularVelocity` the spin it keeps (deg/s).
 */
export interface DetachEvent {
  id: string;
  boneId: string;
  t: number;
  ax: number;
  ay: number;
  originAngle: number;
  vx: number;
  vy: number;
  angularVelocity: number;
}

/** Gravity applied to a detached bone's ballistic fall, in stage px/s². */
export const DETACH_GRAVITY = 900;

export interface RigConfig {
  bones: BoneDef[];
  /** Where the root bone(s) start, relative to the layer's own x/y keyframe position. */
  originX: number;
  originY: number;
  /** When true, every bone goes limp under gravity during Play (whole-body ragdoll) instead of only ones individually marked `physics: true`. */
  ragdoll?: boolean;
  /** Bones that have broken off their parent at some point in time (see `DetachEvent`). */
  detachments?: DetachEvent[];
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
  return { bones: STICKMAN_BONES.map((b) => ({ ...b })), originX: 0, originY: 40, ragdoll: false, detachments: [] };
}

/**
 * Forward kinematics: a local angle per bone (falling back to its base pose) → every bone's world pose.
 * `t` and `detachments` are optional — when a bone has an active detach event (`t >= event.t`), it and its
 * whole subtree stop following their parent and fly off on the frozen ballistic trajectory instead (see
 * `DetachEvent`); every other bone poses exactly as before, so passing neither keeps prior behaviour.
 */
export function computeRigPose(rig: RigConfig, angles: Record<string, number> = {}, t = 0, detachments: DetachEvent[] = []): BonePose[] {
  const children = new Map<string | null, BoneDef[]>();
  for (const b of rig.bones) {
    const key = b.parentId;
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(b);
  }
  const detachOf = new Map<string, DetachEvent>();
  for (const d of detachments) if (t >= d.t && (!detachOf.has(d.boneId) || d.t > detachOf.get(d.boneId)!.t)) detachOf.set(d.boneId, d);
  const out = new Map<string, BonePose>();
  const walk = (bone: BoneDef, originX: number, originY: number, parentWorldAngle: number) => {
    const d = detachOf.get(bone.id);
    let startX: number, startY: number, worldAngle: number;
    if (d) {
      const age = t - d.t;
      worldAngle = d.originAngle + d.angularVelocity * age;
      startX = d.ax + d.vx * age;
      startY = d.ay + d.vy * age + 0.5 * DETACH_GRAVITY * age * age;
    } else {
      const local = clampLocalAngle(bone, angles[bone.id] ?? bone.baseAngle);
      worldAngle = bone.parentId === null ? local : parentWorldAngle + local;
      startX = originX;
      startY = originY;
    }
    const rad = (worldAngle * Math.PI) / 180;
    const endX = startX + Math.cos(rad) * bone.length;
    const endY = startY + Math.sin(rad) * bone.length;
    out.set(bone.id, { id: bone.id, x: startX, y: startY, endX, endY, worldAngle });
    for (const child of children.get(bone.id) ?? []) walk(child, endX, endY, worldAngle);
  };
  for (const root of children.get(null) ?? []) walk(root, rig.originX, rig.originY, 0);
  // bones.filter order may not match tree order; return in bones[] order for a stable list
  return rig.bones.map((b) => out.get(b.id)).filter((p): p is BonePose => !!p);
}

/** Bones in root-to-leaf order (every parent appears before its children) — the order a chain reaction (ragdoll) needs to step in. */
export function boneTreeOrder(rig: RigConfig): BoneDef[] {
  const children = new Map<string | null, BoneDef[]>();
  for (const b of rig.bones) {
    const key = b.parentId;
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(b);
  }
  const out: BoneDef[] = [];
  const walk = (bone: BoneDef) => { out.push(bone); for (const c of children.get(bone.id) ?? []) walk(c); };
  for (const root of children.get(null) ?? []) walk(root);
  return out;
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

/**
 * Whole-rig ragdoll: every bone (not just ones individually marked `physics: true`) goes limp and falls
 * under gravity, each pulled toward its own keyframed rest angle like a loose spring, with its parent's
 * fresh angular velocity feeding in as a push — the same damped-pendulum model `stepPhysicsBone` already
 * uses, just run down the whole tree in one step so motion cascades from the root outward. Joint limits
 * (`minAngle`/`maxAngle`) are respected, so a ragdolled knee still only bends the one way it can.
 */
export function stepRagdollAll(
  rig: RigConfig, states: Record<string, PhysicsState>, restAngles: Record<string, number>, dt: number,
  gravity = 420, damping = 3.2, stiffness = 10,
): Record<string, PhysicsState> {
  const byId = new Map(rig.bones.map((b) => [b.id, b]));
  const next: Record<string, PhysicsState> = {};
  for (const bone of boneTreeOrder(rig)) {
    const prev = states[bone.id] ?? { angle: restAngles[bone.id] ?? bone.baseAngle, angularVelocity: 0 };
    const parentVel = bone.parentId ? (next[bone.parentId]?.angularVelocity ?? 0) : 0;
    const stepped = stepPhysicsBone(prev, restAngles[bone.id] ?? bone.baseAngle, parentVel, dt, gravity, damping, stiffness);
    const angle = clampLocalAngle(bone, stepped.angle);
    next[bone.id] = { angle, angularVelocity: angle === stepped.angle ? stepped.angularVelocity : 0 };
  }
  return next;
}
