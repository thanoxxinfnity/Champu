/** node --experimental-strip-types --test scripts/test-tweening.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { cubicBezierEase } from '../src/lib/suites/motion/easing.ts';
import { addLayer, emptyProject, motionPathPoint, setKeyframe, valueAt, addMarker, updateMarker, removeMarker } from '../src/lib/suites/motion/project.ts';
import { newPaintLayerData, addStroke, holdFrame, reverseFrames, pingPongFrames, stretchFrames, insertFrame } from '../src/lib/suites/motion/paint.ts';

// ── custom ease (graph editor) ──────────────────────────────────────────────

test('cubicBezierEase: endpoints are always exactly 0 and 1', () => {
  const ease = cubicBezierEase(0.3, 0.1, 0.7, 0.9);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
});

test('cubicBezierEase: linear control points (0,0)-(1,1) behave like a straight line', () => {
  const ease = cubicBezierEase(0, 0, 1, 1);
  for (let x = 0; x <= 1; x += 0.1) assert.ok(Math.abs(ease(x) - x) < 1e-3, `at x=${x}, expected ~${x}, got ${ease(x)}`);
});

test('cubicBezierEase: an ease-in-style curve (slow start) stays below the diagonal at the midpoint', () => {
  const ease = cubicBezierEase(0.8, 0, 0.9, 0.2); // classic "ease-in" shape, control points pulled toward the x axis
  assert.ok(ease(0.5) < 0.5, `expected a slow start to lag behind linear at x=0.5, got ${ease(0.5)}`);
});

test('cubicBezierEase: monotonically increasing for a well-formed (non-overshoot) curve', () => {
  const ease = cubicBezierEase(0.25, 0.1, 0.75, 0.9);
  let prev = -Infinity;
  for (let x = 0; x <= 1; x += 0.02) {
    const y = ease(x);
    assert.ok(y >= prev - 1e-6, `eased value should not go backward: at x=${x}, y=${y} < prev=${prev}`);
    prev = y;
  }
});

// ── motion paths ─────────────────────────────────────────────────────────

test('motionPathPoint: with no handles at all, behaves exactly like a straight line (linear lerp)', () => {
  for (let p = 0; p <= 1; p += 0.1) {
    const pt = motionPathPoint(0, 0, undefined, 100, 200, undefined, p);
    assert.ok(Math.abs(pt.x - 100 * p) < 1e-9 && Math.abs(pt.y - 200 * p) < 1e-9, `at p=${p}, expected straight line, got (${pt.x},${pt.y})`);
  }
});

test('motionPathPoint: endpoints always land exactly on the keyframes regardless of handles', () => {
  const pt0 = motionPathPoint(10, 20, { dx: 50, dy: -80 }, 300, 400, { dx: -40, dy: 10 }, 0);
  const pt1 = motionPathPoint(10, 20, { dx: 50, dy: -80 }, 300, 400, { dx: -40, dy: 10 }, 1);
  assert.ok(Math.abs(pt0.x - 10) < 1e-9 && Math.abs(pt0.y - 20) < 1e-9);
  assert.ok(Math.abs(pt1.x - 300) < 1e-9 && Math.abs(pt1.y - 400) < 1e-9);
});

test('motionPathPoint: a curved handle bows the path away from the straight line at the midpoint', () => {
  // a big handle pulling straight up (negative dy) at the start should bow the path upward at p=0.5
  const straightMidY = (0 + 0) / 2; // a=(0,0), b=(200,0): straight-line y is 0 throughout
  const curved = motionPathPoint(0, 0, { dx: 100, dy: -300 }, 200, 0, undefined, 0.5);
  assert.ok(curved.y < straightMidY - 10, `expected the path to bow upward (negative y) at the midpoint, got y=${curved.y}`);
});

test('valueAt: a layer with path handles follows the curved path, not a straight line, mid-segment', () => {
  let layer = addLayer(emptyProject(), 'rect').layers[0];
  layer = setKeyframe(layer, 0, { x: 0, y: 0, easing: 'linear', pathOut: { dx: 0, dy: -200 } });
  layer = setKeyframe(layer, 1, { x: 200, y: 0 });
  const mid = valueAt(layer, 0.5);
  assert.ok(mid.y < -10, `expected the curved path to pull y negative at the midpoint, got y=${mid.y}`);
});

test('valueAt: a layer with no path handles still moves in a straight line (unaffected by the new field)', () => {
  let layer = addLayer(emptyProject(), 'rect').layers[0];
  layer = setKeyframe(layer, 0, { x: 0, y: 0, easing: 'linear' });
  layer = setKeyframe(layer, 1, { x: 200, y: 100 });
  const mid = valueAt(layer, 0.5);
  assert.ok(Math.abs(mid.x - 100) < 1e-6 && Math.abs(mid.y - 50) < 1e-6);
});

test('valueAt: a layer with a customEase uses it instead of the named easing', () => {
  let layer = addLayer(emptyProject(), 'rect').layers[0];
  layer = setKeyframe(layer, 0, { x: 0, easing: 'linear', customEase: { x1: 0.9, y1: 0, x2: 0.9, y2: 0.1 } }); // very slow start
  layer = setKeyframe(layer, 1, { x: 100 });
  const mid = valueAt(layer, 0.5);
  assert.ok(mid.x < 50, `expected the custom slow-start ease to lag behind linear's 50, got ${mid.x}`);
});

// ── timeline markers ─────────────────────────────────────────────────────

test('addMarker/updateMarker/removeMarker: basic CRUD, kept sorted by time', () => {
  let p = emptyProject();
  p = addMarker(p, 2, 'Second');
  p = addMarker(p, 1, 'First');
  assert.equal(p.markers.length, 2);
  assert.equal(p.markers[0].label, 'First');
  assert.equal(p.markers[1].label, 'Second');
  const id = p.markers[0].id;
  p = updateMarker(p, id, { label: 'Renamed', color: '#ff0000' });
  assert.equal(p.markers.find((m) => m.id === id).label, 'Renamed');
  p = removeMarker(p, id);
  assert.equal(p.markers.length, 1);
});

// ── frame operations (paint layers) ─────────────────────────────────────

function makeFrames(n) {
  let paint = newPaintLayerData(12);
  for (let i = 1; i < n; i++) paint = insertFrame(paint, i - 1);
  // tag each frame with a distinguishable stroke so we can track identity through the operations
  for (let i = 0; i < n; i++) {
    paint = addStroke(paint, i, { id: `tag${i}`, brush: { kind: 'pencil', size: 2, opacity: 1, color: '#fff', stabilizer: 0, pressureSizeMix: 0, pressureOpacityMix: 0 }, nodes: [], mode: 'draw' });
  }
  return paint;
}

test('holdFrame: inserts N repeated copies right after the held frame', () => {
  const paint = makeFrames(3); // tags: 0,1,2
  const held = holdFrame(paint, 1, 2);
  assert.equal(held.frames.length, 5);
  const tags = held.frames.map((f) => f.strokes[0].id);
  assert.equal(tags[0], 'tag0');
  assert.equal(tags[1], 'tag1');
  assert.ok(tags[2].startsWith('tag1_hold_'));
  assert.ok(tags[3].startsWith('tag1_hold_'));
  assert.equal(tags[4], 'tag2');
});

test('reverseFrames: plays back to front', () => {
  const paint = makeFrames(4); // tags 0,1,2,3
  const rev = reverseFrames(paint);
  assert.deepEqual(rev.frames.map((f) => f.strokes[0].id), ['tag3', 'tag2', 'tag1', 'tag0']);
});

test('pingPongFrames: forward then backward without doubling the two end frames', () => {
  const paint = makeFrames(4); // 0,1,2,3
  const pp = pingPongFrames(paint);
  assert.deepEqual(pp.frames.map((f) => f.strokes[0].id), ['tag0', 'tag1', 'tag2', 'tag3', 'tag2', 'tag1']);
});

test('pingPongFrames: a 2-frame (or fewer) sequence just appends the reverse', () => {
  const paint = makeFrames(2);
  const pp = pingPongFrames(paint);
  assert.deepEqual(pp.frames.map((f) => f.strokes[0].id), ['tag0', 'tag1', 'tag1', 'tag0']);
});

test('stretchFrames: produces exactly the requested count', () => {
  const paint = makeFrames(4);
  const longer = stretchFrames(paint, 8);
  assert.equal(longer.frames.length, 8);
  const shorter = stretchFrames(paint, 2);
  assert.equal(shorter.frames.length, 2);
});

test('stretchFrames: stretching out still starts with the first frame and ends with the last', () => {
  const paint = makeFrames(4); // 0,1,2,3
  const longer = stretchFrames(paint, 8);
  assert.ok(longer.frames[0].strokes[0].id.startsWith('tag0'));
  assert.ok(longer.frames[7].strokes[0].id.startsWith('tag3'));
});

test('stretchFrames: never produces zero frames even for a tiny target', () => {
  const paint = makeFrames(5);
  const tiny = stretchFrames(paint, 0);
  assert.ok(tiny.frames.length >= 1);
});
