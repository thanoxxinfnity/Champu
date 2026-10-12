/** node --experimental-strip-types --test scripts/test-motion-presets.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { jjkShowcaseProject } from '../src/lib/suites/motion/presets.ts';
import { exportCss, exportGsap, exportHtml } from '../src/lib/suites/motion/project.ts';
import { cameraAt } from '../src/lib/suites/motion/camera.ts';
import { particlesAt } from '../src/lib/suites/motion/particles.ts';
import { computeRigPose, poseAt } from '../src/lib/suites/motion/rig.ts';
import { easeFn } from '../src/lib/suites/motion/easing.ts';

test('the JJK showcase preset builds a valid project with a rig layer, a particle layer, camera motion, a shake, an impact and a speed ramp', () => {
  const p = jjkShowcaseProject();
  assert.equal(p.layers.length, 2);
  assert.ok(p.layers.some((l) => l.kind === 'rig'));
  assert.ok(p.layers.some((l) => l.kind === 'particles'));
  assert.ok(p.camera.length >= 2);
  assert.equal(p.shakes.length, 1);
  assert.equal(p.impacts.length, 1);
  assert.equal(p.speedRamps.length, 1);
});

test('every piece of the preset evaluates without throwing across the whole duration', () => {
  const p = jjkShowcaseProject();
  const rig = p.layers.find((l) => l.kind === 'rig');
  const particles = p.layers.find((l) => l.kind === 'particles');
  for (let t = 0; t <= p.duration; t += 0.05) {
    cameraAt(p.camera, t);
    particlesAt(particles.particles, t);
    const angles = poseAt(rig.rig, rig.keyframes, t, easeFn('linear'));
    computeRigPose(rig.rig, angles);
  }
});

test('the preset still exports through the three code exporters without throwing (particles/rig layers are skipped, not crashed on)', () => {
  const p = jjkShowcaseProject();
  assert.doesNotThrow(() => exportCss(p));
  assert.doesNotThrow(() => exportGsap(p));
  assert.doesNotThrow(() => exportHtml(p));
});
