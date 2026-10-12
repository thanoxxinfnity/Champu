/** node --experimental-strip-types --test scripts/test-speedlines-motionblur.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSpeedLines, newSpeedLineConfig } from '../src/lib/suites/motion/speedlines.ts';
import { motionBlurGhosts, velocityAt } from '../src/lib/suites/motion/motionblur.ts';
import { addLayer, emptyProject, setKeyframe } from '../src/lib/suites/motion/project.ts';

test('generateSpeedLines produces `density` lines, deterministic for the same seed', () => {
  const cfg = newSpeedLineConfig('radial', 100, 100, 7);
  const a = generateSpeedLines(cfg, 400);
  const b = generateSpeedLines(cfg, 400);
  assert.equal(a.length, cfg.density);
  assert.deepEqual(a, b);
});

test('radial speed lines emanate outward from the origin in all directions, not clustered', () => {
  const cfg = newSpeedLineConfig('radial', 0, 0, 3);
  const lines = generateSpeedLines(cfg, 300);
  const angles = lines.map((l) => Math.atan2(l.y2 - l.y1, l.x2 - l.x1));
  const minA = Math.min(...angles), maxA = Math.max(...angles);
  assert.ok(maxA - minA > Math.PI, 'radial lines should spread across a wide range of angles, not bunch up');
});

test('linear speed lines are all roughly parallel, near the configured angle', () => {
  const cfg = newSpeedLineConfig('linear', 0, 0, 4);
  const configured = { ...cfg, angleDeg: 30 };
  const lines = generateSpeedLines(configured, 300);
  for (const l of lines) {
    const angleDeg = (Math.atan2(l.y2 - l.y1, l.x2 - l.x1) * 180) / Math.PI;
    assert.ok(Math.abs(angleDeg - 30) < 10, `line angle ${angleDeg} should be close to 30`);
  }
});

test('different seeds give different line layouts', () => {
  const a = generateSpeedLines(newSpeedLineConfig('radial', 0, 0, 1), 300);
  const b = generateSpeedLines(newSpeedLineConfig('radial', 0, 0, 2), 300);
  assert.notDeepEqual(a, b);
});

test('velocityAt is zero for a layer that never moves', () => {
  let p = addLayer(emptyProject(), 'rect');
  const layer = p.layers[0];
  const v = velocityAt(layer, 2);
  assert.equal(v.vx, 0);
  assert.equal(v.vy, 0);
});

test('velocityAt picks up real motion between keyframes', () => {
  let p = addLayer(emptyProject(), 'rect');
  let layer = p.layers[0];
  layer = setKeyframe(layer, 0, { x: 0, y: 0, easing: 'linear' });
  layer = setKeyframe(layer, 1, { x: 100, y: 0 });
  const v = velocityAt(layer, 0.5);
  assert.ok(v.vx > 0, `expected positive x velocity mid-motion, got ${v.vx}`);
});

test('motionBlurGhosts: a still layer (near-zero speed) gets no ghosts', () => {
  assert.deepEqual(motionBlurGhosts(0, 0, 1, 5), []);
  assert.deepEqual(motionBlurGhosts(0.1, 0, 1, 5), []);
});

test('motionBlurGhosts: ghosts trail behind the motion direction and fade out', () => {
  const ghosts = motionBlurGhosts(100, 0, 0.1, 4); // moving in +x
  assert.equal(ghosts.length, 4);
  for (const g of ghosts) assert.ok(g.dx < 0, 'ghosts should trail behind (negative x) when moving in +x');
  for (let i = 1; i < ghosts.length; i++) assert.ok(ghosts[i].opacity < ghosts[i - 1].opacity, 'opacity should fade further back');
});

test('motionBlurGhosts: zero samples or zero strength gives no ghosts', () => {
  assert.deepEqual(motionBlurGhosts(100, 0, 1, 0), []);
  assert.deepEqual(motionBlurGhosts(100, 0, 0, 5), []);
});
