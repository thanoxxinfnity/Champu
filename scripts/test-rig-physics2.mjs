/** node --experimental-strip-types --test scripts/test-rig-physics2.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { boneTreeOrder, checkBoneLengths, clampLocalAngle, computeRigPose, newRig, stepRagdollAll } from '../src/lib/suites/motion/rig.ts';
import { gaitPoseAt, generateWalkCycle, newGaitConfig } from '../src/lib/suites/motion/walkcycle.ts';

test('clampLocalAngle: no-op when a bone has no limits', () => {
  assert.equal(clampLocalAngle({ id: 'x', name: 'x', parentId: null, length: 1, baseAngle: 0 }, 999), 999);
});

test('clampLocalAngle: clamps into [minAngle, maxAngle] when both are set', () => {
  const b = { id: 'knee', name: 'knee', parentId: 'leg', length: 10, baseAngle: 0, minAngle: -10, maxAngle: 80 };
  assert.equal(clampLocalAngle(b, 200), 80);
  assert.equal(clampLocalAngle(b, -999), -10);
  assert.equal(clampLocalAngle(b, 40), 40);
});

test('computeRigPose respects a bone joint limit', () => {
  const rig = newRig();
  rig.bones = rig.bones.map((b) => (b.id === 'shinL' ? { ...b, minAngle: 0, maxAngle: 30 } : b));
  const pose = computeRigPose(rig, { shinL: 999 });
  const shin = pose.find((p) => p.id === 'shinL');
  const leg = pose.find((p) => p.id === 'legL');
  const expectedAngle = leg.worldAngle + 30; // clamped local (30) added to parent's world angle
  assert.ok(Math.abs(shin.worldAngle - expectedAngle) < 1e-9);
});

test('boneTreeOrder: every bone appears after its parent', () => {
  const rig = newRig();
  const order = boneTreeOrder(rig);
  const indexOf = new Map(order.map((b, i) => [b.id, i]));
  for (const b of rig.bones) {
    if (b.parentId) assert.ok(indexOf.get(b.parentId) < indexOf.get(b.id), `${b.id} should come after its parent ${b.parentId}`);
  }
  assert.equal(order.length, rig.bones.length);
});

test('stepRagdollAll: a bone with no incoming state starts at rest and gravity pulls it over time', () => {
  const rig = newRig();
  const rest = {};
  for (const b of rig.bones) rest[b.id] = b.baseAngle;
  let states = {};
  for (let i = 0; i < 30; i++) states = stepRagdollAll(rig, states, rest, 1 / 60);
  // every bone should have picked up some angular velocity (gravity acting on the whole tree, not just one bone)
  const spine = states['spine'];
  const legL = states['legL'];
  assert.ok(Number.isFinite(spine.angle) && Number.isFinite(legL.angle));
  assert.ok(Math.abs(spine.angularVelocity) > 0 || Math.abs(legL.angularVelocity) > 0, 'ragdoll should be moving after 0.5s of falling');
});

test('stepRagdollAll: a child bone is pushed by its parent\'s motion (coupled chain, not independent pendulums)', () => {
  const rig = newRig();
  const rest = {};
  for (const b of rig.bones) rest[b.id] = b.baseAngle;
  // give the spine (root, parent of arms/head) a big angular velocity head start
  let states = {
    spine: { angle: rest['spine'], angularVelocity: 400 },
  };
  states = stepRagdollAll(rig, states, rest, 1 / 60);
  // armL/armR (children of spine) should have been driven by the spine's velocity, i.e. nonzero already on step 1
  assert.notEqual(states['armL'].angularVelocity, 0);
});

test('stepRagdollAll: respects a bone\'s joint limit even under heavy simulated motion', () => {
  const rig = newRig();
  rig.bones = rig.bones.map((b) => (b.id === 'shinL' ? { ...b, minAngle: -5, maxAngle: 5 } : b));
  const rest = {};
  for (const b of rig.bones) rest[b.id] = b.baseAngle;
  let states = {};
  for (let i = 0; i < 120; i++) states = stepRagdollAll(rig, states, rest, 1 / 60, 2000, 1, 0); // strong gravity, weak damping/stiffness to stress the clamp
  assert.ok(states['shinL'].angle >= -5 - 1e-6 && states['shinL'].angle <= 5 + 1e-6, `shinL should stay clamped, got ${states['shinL'].angle}`);
});

test('computeRigPose: a detached bone ignores its parent and follows ballistic motion', () => {
  const rig = newRig();
  const detach = { id: 'd1', boneId: 'forearmR', t: 1, ax: 100, ay: 200, originAngle: 0, vx: 300, vy: -400, angularVelocity: 180 };
  const poseBefore = computeRigPose(rig, {}, 0.5, [detach]);
  const poseAtDetach = computeRigPose(rig, {}, 1, [detach]);
  const poseAfter = computeRigPose(rig, {}, 1.5, [detach]);
  const forearmAtDetach = poseAtDetach.find((p) => p.id === 'forearmR');
  assert.ok(Math.abs(forearmAtDetach.x - 100) < 1e-6 && Math.abs(forearmAtDetach.y - 200) < 1e-6, 'at the moment of detach, the bone should be exactly at its frozen anchor point');
  const forearmAfter = poseAfter.find((p) => p.id === 'forearmR');
  const expectedX = 100 + 300 * 0.5;
  const expectedY = 200 + -400 * 0.5 + 0.5 * 900 * 0.25;
  assert.ok(Math.abs(forearmAfter.x - expectedX) < 1e-6, `expected ballistic x ${expectedX}, got ${forearmAfter.x}`);
  assert.ok(Math.abs(forearmAfter.y - expectedY) < 1e-6, `expected ballistic y ${expectedY}, got ${forearmAfter.y}`);
  // before the detach, it should behave exactly like the un-detached rig
  const normalBefore = computeRigPose(rig, {}, 0.5);
  const forearmBefore = poseBefore.find((p) => p.id === 'forearmR');
  const normalForearm = normalBefore.find((p) => p.id === 'forearmR');
  assert.ok(Math.abs(forearmBefore.x - normalForearm.x) < 1e-6 && Math.abs(forearmBefore.y - normalForearm.y) < 1e-6);
});

test('computeRigPose: a detached bone\'s children (its subtree) still parent off it at its new position', () => {
  const rig = newRig();
  const detach = { id: 'd1', boneId: 'armR', t: 0, ax: 0, ay: 0, originAngle: 0, vx: 0, vy: 0, angularVelocity: 0 };
  const pose = computeRigPose(rig, {}, 2, [detach]);
  const armR = pose.find((p) => p.id === 'armR');
  const forearmR = pose.find((p) => p.id === 'forearmR');
  assert.ok(Math.abs(forearmR.x - armR.endX) < 1e-6 && Math.abs(forearmR.y - armR.endY) < 1e-6, 'forearmR should still attach to armR\'s (new, detached) end point');
});

test('computeRigPose: never stretches a bone, even with clamps and detachments active', () => {
  const rig = newRig();
  rig.bones = rig.bones.map((b) => (b.id === 'shinL' ? { ...b, minAngle: 0, maxAngle: 20 } : b));
  const detach = { id: 'd1', boneId: 'forearmL', t: 0, ax: 10, ay: 10, originAngle: 45, vx: 50, vy: -50, angularVelocity: 90 };
  const pose = computeRigPose(rig, { shinL: 500 }, 1, [detach]);
  assert.ok(checkBoneLengths(rig, pose));
});

// ── walk/run cycle ──────────────────────────────────────────────────────────

test('newGaitConfig: run is faster (shorter cycle) than walk', () => {
  assert.ok(newGaitConfig('run').cycleDuration < newGaitConfig('walk').cycleDuration);
});

test('gaitPoseAt: legL and legR swing opposite directions at the same instant (half a cycle out of phase)', () => {
  const rig = newRig();
  const baseL = rig.bones.find((b) => b.id === 'legL').baseAngle;
  const baseR = rig.bones.find((b) => b.id === 'legR').baseAngle;
  for (let phase = 0; phase < 1; phase += 0.07) {
    const pose = gaitPoseAt(rig, 'walk', phase);
    const deltaL = pose['legL'] - baseL;
    const deltaR = pose['legR'] - baseR;
    assert.ok(Math.abs(deltaL + deltaR) < 1e-9, `at phase ${phase}, legL's swing (${deltaL}) should be the exact opposite of legR's (${deltaR})`);
  }
});

test('gaitPoseAt: the knee never bends backward past its rest angle', () => {
  const rig = newRig();
  const restShinL = rig.bones.find((b) => b.id === 'shinL').baseAngle;
  for (let phase = 0; phase < 1; phase += 0.03) {
    const pose = gaitPoseAt(rig, 'walk', phase);
    assert.ok(pose['shinL'] >= restShinL - 1e-9, `shinL at phase ${phase} should never go below its rest angle`);
  }
});

test('gaitPoseAt: run swings the legs further than walk', () => {
  const rig = newRig();
  const walk = gaitPoseAt(rig, 'walk', 0.25);
  const run = gaitPoseAt(rig, 'run', 0.25);
  const base = rig.bones.find((b) => b.id === 'legL').baseAngle;
  assert.ok(Math.abs(run['legL'] - base) > Math.abs(walk['legL'] - base));
});

test('gaitPoseAt: is periodic — phase 0 and phase 1 give the same pose', () => {
  const rig = newRig();
  const a = gaitPoseAt(rig, 'walk', 0);
  const b = gaitPoseAt(rig, 'walk', 1);
  for (const id of Object.keys(a)) assert.ok(Math.abs(a[id] - b[id]) < 1e-9);
});

test('gaitPoseAt: a rig missing a bone id is simply skipped, never throws', () => {
  const rig = { bones: [{ id: 'spine', name: 'Spine', parentId: null, length: 10, baseAngle: -90 }], originX: 0, originY: 0 };
  const pose = gaitPoseAt(rig, 'walk', 0.3);
  assert.deepEqual(Object.keys(pose), ['spine']);
});

test('generateWalkCycle: produces the requested number of evenly-spaced keyframes covering one cycle', () => {
  const rig = newRig();
  const frames = generateWalkCycle(rig, 'walk', 0.8, 8);
  assert.equal(frames.length, 8);
  assert.equal(frames[0].t, 0);
  assert.ok(Math.abs(frames[1].t - 0.1) < 1e-9);
  assert.ok(frames[frames.length - 1].t < 0.8);
});
