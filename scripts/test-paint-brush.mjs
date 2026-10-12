/** node --experimental-strip-types --test scripts/test-paint-brush.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRUSH_KINDS, dabsBounds, newBrush, stabilizePoint, strokeToDabs,
} from '../src/lib/suites/motion/brush.ts';

test('every brush kind has sane defaults', () => {
  for (const kind of BRUSH_KINDS) {
    const b = newBrush(kind, '#fff');
    assert.ok(b.size > 0, kind);
    assert.ok(b.opacity > 0 && b.opacity <= 1, kind);
    assert.equal(b.color, '#fff');
  }
});

test('stabilizePoint: the first point of a stroke passes through unchanged', () => {
  const raw = { x: 10, y: 20, pressure: 0.5 };
  assert.deepEqual(stabilizePoint(null, raw, 0.8), raw);
});

test('stabilizePoint: higher stabilizer lags further behind the raw input', () => {
  const prev = { x: 0, y: 0, pressure: 0.5 };
  const raw = { x: 100, y: 0, pressure: 0.5 };
  const light = stabilizePoint(prev, raw, 0.1);
  const heavy = stabilizePoint(prev, raw, 0.9);
  assert.ok(heavy.x < light.x, 'a heavier stabilizer should move less far toward the raw point this step');
});

test('strokeToDabs on a straight line produces evenly spaced dabs covering its length', () => {
  const brush = newBrush('ink', '#000');
  const points = [{ x: 0, y: 0, pressure: 1 }, { x: 200, y: 0, pressure: 1 }];
  const dabs = strokeToDabs(points, brush, 1);
  assert.ok(dabs.length > 3, 'a 200px stroke should produce multiple dabs');
  const bounds = dabsBounds(dabs);
  assert.ok(bounds.x <= 1 && bounds.x + bounds.w >= 199, `dabs should span the stroke, got ${JSON.stringify(bounds)}`);
});

test('strokeToDabs on a single point still produces one dab (a tap/dot)', () => {
  const brush = newBrush('pencil', '#000');
  const dabs = strokeToDabs([{ x: 5, y: 5, pressure: 0.8 }], brush, 1);
  assert.equal(dabs.length, 1);
  assert.equal(dabs[0].x, 5);
});

test('higher pressure makes a wider, more opaque dab when the brush mixes pressure in', () => {
  const brush = newBrush('ink', '#000'); // pressureSizeMix=0.65, pressureOpacityMix=0.1
  const soft = strokeToDabs([{ x: 0, y: 0, pressure: 0.1 }], brush, 1)[0];
  const hard = strokeToDabs([{ x: 0, y: 0, pressure: 1 }], brush, 1)[0];
  assert.ok(hard.radius > soft.radius, `hard press radius ${hard.radius} should exceed soft press ${soft.radius}`);
  assert.ok(hard.opacity >= soft.opacity);
});

test('strokeToDabs is deterministic for the same seed, and charcoal/watercolor jitter differs by seed', () => {
  const brush = newBrush('charcoal', '#333');
  const points = [{ x: 0, y: 0, pressure: 0.7 }, { x: 50, y: 10, pressure: 0.6 }];
  const a = strokeToDabs(points, brush, 7);
  const b = strokeToDabs(points, brush, 7);
  assert.deepEqual(a, b);
  const c = strokeToDabs(points, brush, 99);
  assert.notDeepEqual(a, c);
});

test('clean brushes (ink, airbrush, neon) have zero jitter', () => {
  for (const kind of ['ink', 'airbrush', 'neon']) {
    const brush = newBrush(kind, '#000');
    const dabs = strokeToDabs([{ x: 0, y: 0, pressure: 1 }, { x: 40, y: 0, pressure: 1 }], brush, 1);
    assert.ok(dabs.every((d) => d.jitter === 0), kind);
  }
});

test('dabsBounds returns null for an empty stroke', () => {
  assert.equal(dabsBounds([]), null);
});
