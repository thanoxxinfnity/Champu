/** node --experimental-strip-types --test scripts/test-paint-layer.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addStroke, deleteFrame, duplicateFrame, insertFrame, newPaintLayerData,
  paintFrameAt, paintFrameIndexAt, removeStroke, updateStroke,
} from '../src/lib/suites/motion/paint.ts';
import { newBrush } from '../src/lib/suites/motion/brush.ts';

function stroke(id) {
  return { id, brush: newBrush('ink', '#000'), nodes: [{ id: 'n1', x: 0, y: 0, inX: null, inY: null, outX: null, outY: null, pressure: 1 }], mode: 'draw' };
}

test('a fresh paint layer has exactly one empty frame', () => {
  const p = newPaintLayerData(12);
  assert.equal(p.frames.length, 1);
  assert.equal(p.frames[0].strokes.length, 0);
  assert.equal(p.fps, 12);
});

test('paintFrameIndexAt advances with fps and holds at the last frame', () => {
  let p = newPaintLayerData(10); // 0.1s per frame
  p = insertFrame(p); p = insertFrame(p); // 3 frames total
  assert.equal(paintFrameIndexAt(p, 0), 0);
  assert.equal(paintFrameIndexAt(p, 0.15), 1);
  assert.equal(paintFrameIndexAt(p, 0.25), 2);
  assert.equal(paintFrameIndexAt(p, 999), 2, 'holds at the last frame past the end');
  assert.equal(paintFrameIndexAt(p, -5), 0, 'clamps before the start');
});

test('addStroke/removeStroke/updateStroke only touch the targeted frame', () => {
  let p = newPaintLayerData(12);
  p = insertFrame(p); // frames: [0, 1]
  p = addStroke(p, 0, stroke('s1'));
  p = addStroke(p, 1, stroke('s2'));
  assert.equal(p.frames[0].strokes.length, 1);
  assert.equal(p.frames[1].strokes.length, 1);
  p = updateStroke(p, 0, 's1', { mode: 'erase' });
  assert.equal(p.frames[0].strokes[0].mode, 'erase');
  assert.equal(p.frames[1].strokes[0].mode, 'draw', 'frame 1 untouched');
  p = removeStroke(p, 0, 's1');
  assert.equal(p.frames[0].strokes.length, 0);
  assert.equal(p.frames[1].strokes.length, 1, 'frame 1 still untouched');
});

test('insertFrame inserts right after the given index, or appends with none given', () => {
  let p = newPaintLayerData(12); // [f0]
  p = addStroke(p, 0, stroke('s0'));
  p = insertFrame(p, 0); // [f0(s0), new]
  assert.equal(p.frames.length, 2);
  assert.equal(p.frames[0].strokes.length, 1);
  assert.equal(p.frames[1].strokes.length, 0);
  p = insertFrame(p); // appended at the end
  assert.equal(p.frames.length, 3);
});

test('duplicateFrame copies the strokes with fresh ids, not shared references', () => {
  let p = newPaintLayerData(12);
  p = addStroke(p, 0, stroke('s1'));
  p = duplicateFrame(p, 0);
  assert.equal(p.frames.length, 2);
  assert.equal(p.frames[1].strokes.length, 1);
  assert.notEqual(p.frames[1].strokes[0].id, p.frames[0].strokes[0].id);
});

test('deleteFrame refuses to empty the layer entirely', () => {
  let p = newPaintLayerData(12);
  p = deleteFrame(p, 0);
  assert.equal(p.frames.length, 1, 'a paint layer must always have at least one frame');
  p = insertFrame(p);
  p = deleteFrame(p, 1);
  assert.equal(p.frames.length, 1);
});

test('paintFrameAt returns the actual frame object at that index', () => {
  let p = newPaintLayerData(12);
  p = addStroke(p, 0, stroke('only'));
  assert.equal(paintFrameAt(p, 0).strokes[0].id, 'only');
});
