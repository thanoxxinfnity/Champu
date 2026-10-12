/** node --experimental-strip-types --test scripts/test-motion-camera.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cameraAt, defaultCamera, effectiveRate, impactAt, removeCameraKeyframe, setCameraKeyframe, shakeOffsetAt,
} from '../src/lib/suites/motion/camera.ts';

test('defaultCamera is centred/neutral: no pan, no zoom change, no rotation', () => {
  const t = cameraAt(defaultCamera(), 0);
  assert.deepEqual(t, { x: 0, y: 0, zoom: 1, rotation: 0 });
});

test('cameraAt holds the first keyframe before it and the last after it, same shape as a layer', () => {
  const kfs = [
    { id: 'a', t: 1, x: 0, y: 0, zoom: 1, rotation: 0, easing: 'linear' },
    { id: 'b', t: 3, x: 200, y: -50, zoom: 2, rotation: 15, easing: 'linear' },
  ];
  assert.deepEqual(cameraAt(kfs, -5), { x: 0, y: 0, zoom: 1, rotation: 0 });
  assert.deepEqual(cameraAt(kfs, 999), { x: 200, y: -50, zoom: 2, rotation: 15 });
  const mid = cameraAt(kfs, 2);
  assert.equal(mid.x, 100);
  assert.equal(mid.zoom, 1.5);
});

test('shakeOffsetAt is zero outside every shake window', () => {
  const shakes = [{ id: 's1', t: 1, duration: 0.3, magnitude: 20, seed: 5 }];
  assert.deepEqual(shakeOffsetAt(shakes, 0.5), { x: 0, y: 0, rotation: 0 });
  assert.deepEqual(shakeOffsetAt(shakes, 2), { x: 0, y: 0, rotation: 0 });
});

test('shakeOffsetAt is a deterministic function of t, and decays toward the end of its window', () => {
  const shakes = [{ id: 's1', t: 1, duration: 0.5, magnitude: 30, seed: 5 }];
  const a = shakeOffsetAt(shakes, 1.1);
  const b = shakeOffsetAt(shakes, 1.1);
  assert.deepEqual(a, b, 'same t must give the same jitter every time');
  const early = Math.hypot(shakeOffsetAt(shakes, 1.02).x, shakeOffsetAt(shakes, 1.02).y);
  const late = Math.hypot(shakeOffsetAt(shakes, 1.48).x, shakeOffsetAt(shakes, 1.48).y);
  assert.ok(late < early, `late-window jitter (${late}) should be smaller than early (${early})`);
});

test('two overlapping shakes add together', () => {
  const s1 = [{ id: 'a', t: 0, duration: 1, magnitude: 10, seed: 1 }];
  const s2 = [{ id: 'b', t: 0, duration: 1, magnitude: 10, seed: 2 }];
  const combined = [...s1, ...s2];
  const single = shakeOffsetAt(s1, 0.2);
  const both = shakeOffsetAt(combined, 0.2);
  assert.notDeepEqual(single, both);
});

test('impactAt finds the frame covering t, or null when none covers it', () => {
  const impacts = [{ id: 'i1', t: 1, duration: 0.1, style: 'flash' }];
  assert.equal(impactAt(impacts, 0.5), null);
  assert.equal(impactAt(impacts, 1.05).id, 'i1');
  assert.equal(impactAt(impacts, 1.2), null);
});

test('setCameraKeyframe inserts in time order and replaces one at (nearly) the same instant', () => {
  let kfs = defaultCamera();
  kfs = setCameraKeyframe(kfs, 2, { x: 500, zoom: 2 });
  kfs = setCameraKeyframe(kfs, 1, { x: 250 });
  assert.deepEqual(kfs.map((k) => k.t), [0, 1, 2]);
  kfs = setCameraKeyframe(kfs, 1.002, { x: 999 });
  assert.equal(kfs.length, 3, 'did not add a fourth keyframe');
  assert.equal(kfs.find((k) => Math.abs(k.t - 1) < 0.01).x, 999);
});

test('removeCameraKeyframe refuses to empty the camera track', () => {
  let kfs = defaultCamera();
  kfs = removeCameraKeyframe(kfs, kfs[0].id);
  assert.equal(kfs.length, 1, 'refused to empty the track');
  kfs = setCameraKeyframe(kfs, 2, { x: 10 });
  kfs = removeCameraKeyframe(kfs, kfs[1].id);
  assert.equal(kfs.length, 1);
});

test('effectiveRate is 1 outside every ramp, and the ramp rate inside its [t0,t1) window', () => {
  const ramps = [{ id: 'r1', t0: 1, t1: 2, rate: 0.25 }];
  assert.equal(effectiveRate(ramps, 0.5), 1);
  assert.equal(effectiveRate(ramps, 1.5), 0.25);
  assert.equal(effectiveRate(ramps, 2), 1, 't1 itself is exclusive — back to normal speed');
});
