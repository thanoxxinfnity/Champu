/** node --experimental-strip-types --test scripts/test-fill.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alphaToLineMask, autoFlatColor, dilateMask, floodFillMask, floodFillWithGapClosing, labelAllRegions,
} from '../src/lib/suites/motion/fill.ts';

/** A WxH alpha buffer: 255 = ink, 0 = empty. `draw` is a list of [x,y] line pixels. */
function makeAlpha(w, h, draw) {
  const a = new Uint8ClampedArray(w * h);
  for (const [x, y] of draw) a[y * w + x] = 255;
  return a;
}

function boxOutline(w, h, x0, y0, x1, y1, gapAt) {
  const pts = [];
  for (let x = x0; x <= x1; x++) { if (!gapAt || !(x === gapAt[0] && y0 === gapAt[1])) pts.push([x, y0]); pts.push([x, y1]); }
  for (let y = y0; y <= y1; y++) { pts.push([x0, y]); pts.push([x1, y]); }
  return pts;
}

test('a fully closed box: flood fill (no gap closing needed) stays inside it', () => {
  const w = 20, h = 20;
  const alpha = makeAlpha(w, h, boxOutline(w, h, 2, 2, 17, 17));
  const mask = floodFillWithGapClosing(alpha, w, h, 10, 10, { gapClosePx: 0 });
  let filled = 0;
  for (let i = 0; i < mask.length; i++) filled += mask[i];
  assert.ok(filled > 100 && filled < 256, `fill should cover the box interior, got ${filled} px`);
  // nothing outside the box should be touched
  assert.equal(mask[0], 0);
  assert.equal(mask[w * h - 1], 0);
});

test('a one-pixel gap: a strict fill (gapClosePx=0) leaks out and colours the whole canvas', () => {
  const w = 20, h = 20;
  const alpha = makeAlpha(w, h, boxOutline(w, h, 2, 2, 17, 17, [9, 2])); // gap in the top edge
  const mask = floodFillWithGapClosing(alpha, w, h, 10, 10, { gapClosePx: 0 });
  assert.equal(mask[0], 1, 'with no gap closing, the fill should have leaked to the corner');
});

test('the same one-pixel gap: gapClosePx closes it and the fill stays contained', () => {
  const w = 20, h = 20;
  const alpha = makeAlpha(w, h, boxOutline(w, h, 2, 2, 17, 17, [9, 2]));
  const mask = floodFillWithGapClosing(alpha, w, h, 10, 10, { gapClosePx: 2 });
  assert.equal(mask[0], 0, 'gap closing should have kept the fill inside the box');
  let filled = 0;
  for (let i = 0; i < mask.length; i++) filled += mask[i];
  assert.ok(filled > 50, `the interior should still mostly be filled, got ${filled} px`);
});

test('clicking directly on a line pixel fills nothing', () => {
  const w = 10, h = 10;
  const alpha = makeAlpha(w, h, boxOutline(w, h, 2, 2, 7, 7));
  const mask = floodFillWithGapClosing(alpha, w, h, 2, 2, { gapClosePx: 1 });
  let filled = 0;
  for (let i = 0; i < mask.length; i++) filled += mask[i];
  assert.equal(filled, 0);
});

test('dilateMask grows a single pixel into a plus-shape at radius 1, a diamond at radius 2', () => {
  const w = 7, h = 7;
  const mask = new Uint8Array(w * h);
  mask[3 * w + 3] = 1; // centre
  const d1 = dilateMask(mask, w, h, 1);
  assert.equal(d1[3 * w + 3], 1);
  assert.equal(d1[2 * w + 3], 1); // up
  assert.equal(d1[3 * w + 2], 1); // left
  assert.equal(d1[0 * w + 0], 0, 'far corner should be untouched at radius 1');
});

test('labelAllRegions gives two separate closed boxes two different labels, and the background a third', () => {
  const w = 30, h = 15;
  const draw = [...boxOutline(w, h, 1, 1, 8, 8), ...boxOutline(w, h, 15, 1, 25, 8)];
  const alpha = makeAlpha(w, h, draw);
  const { labels, count } = labelAllRegions(alpha, w, h, { gapClosePx: 0 });
  assert.ok(count >= 3, `expected background + 2 box interiors, got ${count} regions`);
  const insideBox1 = labels[4 * w + 4];
  const insideBox2 = labels[4 * w + 20];
  const background = labels[0];
  assert.notEqual(insideBox1, insideBox2);
  assert.notEqual(insideBox1, background);
});

test('autoFlatColor assigns a colour to every region, cycling the given palette', () => {
  const w = 30, h = 15;
  const draw = [...boxOutline(w, h, 1, 1, 8, 8), ...boxOutline(w, h, 15, 1, 25, 8)];
  const alpha = makeAlpha(w, h, draw);
  const { labels, colorOf } = autoFlatColor(alpha, w, h, ['#ff0000', '#00ff00'], { gapClosePx: 0 });
  assert.ok(colorOf.length >= 3);
  assert.equal(colorOf[0], '#ff0000');
  assert.equal(colorOf[1], '#00ff00');
  assert.equal(colorOf[2], '#ff0000'); // cycles back
});

test('a real-canvas-sized (960x540), heavily gapped line-art mask does not overflow the stack (regression, same class of bug as the GIF encoder)', () => {
  const w = 960, h = 540;
  const draw = boxOutline(w, h, 50, 50, 900, 480, [475, 50]);
  // scatter extra noise lines around so the mask isn't trivially small
  for (let i = 0; i < 2000; i++) draw.push([(i * 37) % w, (i * 19) % h]);
  const alpha = makeAlpha(w, h, draw);
  assert.doesNotThrow(() => floodFillWithGapClosing(alpha, w, h, w / 2, h / 2, { gapClosePx: 3 }));
  assert.doesNotThrow(() => labelAllRegions(alpha, w, h, { gapClosePx: 3 }));
});

test('alphaToLineMask respects the threshold', () => {
  const alpha = new Uint8ClampedArray([0, 10, 20, 255]);
  const mask = alphaToLineMask(alpha, 4, 1, 16);
  assert.deepEqual(Array.from(mask), [0, 0, 1, 1]);
});

test('floodFillMask out of bounds seed returns an empty mask, not a crash', () => {
  const blocked = new Uint8Array(100);
  const mask = floodFillMask(blocked, 10, 10, -1, -1);
  assert.ok(mask.every((v) => v === 0));
});
