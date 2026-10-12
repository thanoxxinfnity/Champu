/** node --experimental-strip-types --test scripts/test-motion-rig.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkBoneLengths, computeRigPose, newRig, poseAt, solveIK2, stepPhysicsBone,
} from '../src/lib/suites/motion/rig.ts';

test('a fresh stickman rig has bones and FK produces one pose per bone', () => {
  const rig = newRig();
  assert.ok(rig.bones.length > 0);
  const pose = computeRigPose(rig);
  assert.equal(pose.length, rig.bones.length);
});

test('FK never stretches a bone: start-to-end distance always equals its defined length', () => {
  const rig = newRig();
  const pose = computeRigPose(rig);
  assert.ok(checkBoneLengths(rig, pose));
});

test('a child bone starts exactly where its parent ends', () => {
  const rig = newRig();
  const pose = computeRigPose(rig);
  const byId = new Map(pose.map((p) => [p.id, p]));
  const spine = byId.get('spine');
  const head = byId.get('head');
  assert.ok(Math.abs(head.x - spine.endX) < 1e-9);
  assert.ok(Math.abs(head.y - spine.endY) < 1e-9);
});

test('a custom angle rotates a bone away from its base pose, and its children follow', () => {
  const rig = newRig();
  const straight = computeRigPose(rig);
  const bent = computeRigPose(rig, { armR: -90 });
  const a = new Map(straight.map((p) => [p.id, p]));
  const b = new Map(bent.map((p) => [p.id, p]));
  assert.notEqual(a.get('armR').endX.toFixed(2), b.get('armR').endX.toFixed(2));
  // forearmR has no override, so it is still parented to armR's new end point
  assert.ok(Math.abs(b.get('forearmR').x - b.get('armR').endX) < 1e-9);
});

test('solveIK2 reaches a target within range, and the solved chain actually lands on it', () => {
  const lenA = 26, lenB = 24;
  const target = { x: 30, y: 20 };
  const sol = solveIK2(0, 0, lenA, lenB, target.x, target.y);
  assert.ok(sol);
  const radA = (sol.angleA * Math.PI) / 180;
  const elbowX = Math.cos(radA) * lenA, elbowY = Math.sin(radA) * lenA;
  const worldB = sol.angleA + sol.angleB;
  const radB = (worldB * Math.PI) / 180;
  const handX = elbowX + Math.cos(radB) * lenB, handY = elbowY + Math.sin(radB) * lenB;
  assert.ok(Math.abs(handX - target.x) < 1e-6, `x: ${handX} vs ${target.x}`);
  assert.ok(Math.abs(handY - target.y) < 1e-6, `y: ${handY} vs ${target.y}`);
});

test('solveIK2 refuses a target further than the chain can reach', () => {
  assert.equal(solveIK2(0, 0, 10, 10, 1000, 0), null);
});

test('poseAt holds the first/last keyframe pose outside the range, and interpolates between two', () => {
  const rig = newRig();
  const kfs = [
    { t: 0, pose: { armR: 0 } },
    { t: 2, pose: { armR: 100 } },
  ];
  const linear = (p) => p;
  assert.equal(poseAt(rig, kfs, -5, linear).armR, 0);
  assert.equal(poseAt(rig, kfs, 99, linear).armR, 100);
  assert.equal(poseAt(rig, kfs, 1, linear).armR, 50);
  // a bone never mentioned in either keyframe's pose still holds its rig base angle
  const spineDefault = rig.bones.find((b) => b.id === 'spine').baseAngle;
  assert.equal(poseAt(rig, kfs, 1, linear).spine, spineDefault);
});

test('stepPhysicsBone settles to a stable equilibrium, damped rather than runaway', () => {
  let state = { angle: 160, angularVelocity: 0 }; // starts far from base
  const base = 90;
  for (let i = 0; i < 400; i++) state = stepPhysicsBone(state, base, 0, 1 / 60);
  assert.ok(Number.isFinite(state.angle) && Number.isFinite(state.angularVelocity), 'must not blow up');
  assert.ok(Math.abs(state.angularVelocity) < 1, `should have stopped swinging, velocity=${state.angularVelocity}`);
  // one more step barely moves it — a real equilibrium, not still in flight
  const next = stepPhysicsBone(state, base, 0, 1 / 60);
  assert.ok(Math.abs(next.angle - state.angle) < 0.5, 'angle should have stopped changing by now');
});

test('stepPhysicsBone with dt=0 is a no-op', () => {
  const state = { angle: 12, angularVelocity: 3 };
  assert.deepEqual(stepPhysicsBone(state, 90, 0, 0), state);
});
