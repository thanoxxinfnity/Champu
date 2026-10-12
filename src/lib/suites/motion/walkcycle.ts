/**
 * A procedural walk/run cycle: a closed-form function of phase (0..1, one full stride) that gives every
 * limb bone a plausible swing, so "walk cycle" is one button instead of hand-keying eight poses. Legs
 * swing a half-cycle apart, the opposite arm leads each leg (natural counter-swing), and the knee only
 * ever bends forward (never past straight). `generateWalkCycle` just samples this at evenly spaced points
 * across one cycle and hands back ordinary pose keyframes — the caller inserts them with the same
 * `setKeyframe` any hand-posed keyframe uses, so everything downstream (scrubbing, IK drag, export) sees
 * no difference from a human having posed them.
 */
import type { RigConfig } from './rig.ts';

export type GaitMode = 'walk' | 'run';

export interface GaitConfig {
  mode: GaitMode;
  /** Seconds for one full stride (both legs through a complete cycle). */
  cycleDuration: number;
}

export function newGaitConfig(mode: GaitMode = 'walk'): GaitConfig {
  return { mode, cycleDuration: mode === 'run' ? 0.5 : 0.9 };
}

interface GaitParams { legSwing: number; armSwing: number; kneeBend: number; bob: number; lean: number }
function paramsFor(mode: GaitMode): GaitParams {
  return mode === 'run'
    ? { legSwing: 38, armSwing: 32, kneeBend: 58, bob: 7, lean: -7 }
    : { legSwing: 22, armSwing: 15, kneeBend: 28, bob: 3, lean: 0 };
}

/** The forward-only knee-bend magnitude at a given leg phase — never negative (a knee doesn't bend backward). */
function kneeBendAt(theta: number, amount: number): number {
  return amount * Math.max(0, Math.sin(theta));
}

/**
 * Every rig bone's local angle (in rig-default degrees, same shape as a keyframe's `pose`) at `phase`
 * (0..1, wraps) through one gait cycle. Bones the rig doesn't have (a custom non-biped rig) are simply
 * left out — this never throws on an unfamiliar bone set.
 */
export function gaitPoseAt(rig: RigConfig, mode: GaitMode, phase: number): Record<string, number> {
  const p = ((phase % 1) + 1) % 1;
  const theta = p * Math.PI * 2;
  const { legSwing, armSwing, kneeBend, bob, lean } = paramsFor(mode);
  const byId = new Map(rig.bones.map((b) => [b.id, b] as const));
  const out: Record<string, number> = {};
  const set = (id: string, delta: number) => { const b = byId.get(id); if (b) out[id] = b.baseAngle + delta; };

  set('legL', legSwing * Math.sin(theta));
  set('legR', legSwing * Math.sin(theta + Math.PI));
  set('shinL', kneeBendAt(theta, kneeBend));
  set('shinR', kneeBendAt(theta + Math.PI, kneeBend));
  // the opposite arm leads each leg: armR tracks legL's phase, armL tracks legR's.
  set('armR', armSwing * Math.sin(theta));
  set('armL', armSwing * Math.sin(theta + Math.PI));
  set('forearmR', armSwing * 0.45 * Math.sin(theta + 0.6));
  set('forearmL', armSwing * 0.45 * Math.sin(theta + Math.PI + 0.6));
  set('spine', lean + bob * Math.sin(theta * 2));
  set('head', -bob * 0.3 * Math.sin(theta * 2));
  return out;
}

/** Samples `gaitPoseAt` into `keysPerCycle` evenly-spaced pose keyframes across one cycle, `t` relative to the cycle's own start (0..cycleDuration) — the caller offsets by the playhead and tiles across however much timeline it wants covered. */
export function generateWalkCycle(rig: RigConfig, mode: GaitMode, cycleDuration: number, keysPerCycle = 8): Array<{ t: number; pose: Record<string, number> }> {
  const n = Math.max(2, Math.round(keysPerCycle));
  const out: Array<{ t: number; pose: Record<string, number> }> = [];
  for (let i = 0; i < n; i++) {
    const phase = i / n;
    out.push({ t: phase * cycleDuration, pose: gaitPoseAt(rig, mode, phase) });
  }
  return out;
}
