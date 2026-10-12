/** node --experimental-strip-types --test scripts/test-shading-gradient-color.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { autoCelShadow, maskAnd, maskAndNot, shiftMask } from '../src/lib/suites/motion/shading.ts';
import { rasterizeMeshGradient, sampleMeshGradient } from '../src/lib/suites/motion/gradient.ts';
import { hexToHsv, hexToRgb, hsvToHex, hsvToRgb, replaceColorInPlace, rgbToHex, rgbToHsv } from '../src/lib/suites/motion/color.ts';

function filledCircleMask(w, h, cx, cy, r) {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - cx, y - cy) <= r) m[y * w + x] = 1;
  return m;
}
function count(mask) { let n = 0; for (const v of mask) n += v; return n; }

test('shiftMask moves pixels by (dx,dy) and drops anything shifted off-canvas', () => {
  const w = 5, h = 5;
  const m = new Uint8Array(w * h);
  m[2 * w + 2] = 1; // centre
  const shifted = shiftMask(m, w, h, 1, 0);
  assert.equal(shifted[2 * w + 3], 1);
  assert.equal(shifted[2 * w + 2], 0);
});

test('maskAnd/maskAndNot behave like boolean intersection/subtraction', () => {
  const a = new Uint8Array([1, 1, 0, 0]);
  const b = new Uint8Array([1, 0, 1, 0]);
  assert.deepEqual(Array.from(maskAnd(a, b)), [1, 0, 0, 0]);
  assert.deepEqual(Array.from(maskAndNot(a, b)), [0, 1, 0, 0]);
});

test('autoCelShadow stays entirely within the original silhouette', () => {
  const w = 60, h = 60;
  const silhouette = filledCircleMask(w, h, 30, 30, 20);
  const shadow = autoCelShadow(silhouette, w, h, { lightAngleDeg: 0, offsetPx: 8 });
  for (let i = 0; i < shadow.length; i++) assert.ok(!shadow[i] || silhouette[i], 'shadow pixel outside the silhouette');
  assert.ok(count(shadow) > 0, 'a light offset within the shape should produce a non-empty shadow');
});

test('autoCelShadow lands on the side away from the light', () => {
  const w = 60, h = 60;
  const silhouette = filledCircleMask(w, h, 30, 30, 20);
  const shadow = autoCelShadow(silhouette, w, h, { lightAngleDeg: 0, offsetPx: 10 }); // light from the right (+x)
  let leftSum = 0, rightSum = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!shadow[y * w + x]) continue;
    if (x < 30) leftSum++; else rightSum++;
  }
  assert.ok(leftSum > rightSum, `shadow should favour the side away from the light (left=${leftSum}, right=${rightSum})`);
});

test('sampleMeshGradient returns a control point\'s exact colour right on top of it', () => {
  const mesh = { kind: 'mesh', points: [{ x: 0, y: 0, color: '#ff0000' }, { x: 100, y: 100, color: '#0000ff' }] };
  assert.equal(sampleMeshGradient(mesh, 0, 0), '#ff0000');
  assert.equal(sampleMeshGradient(mesh, 100, 100), '#0000ff');
});

test('sampleMeshGradient blends between two points, closer one dominating', () => {
  const mesh = { kind: 'mesh', points: [{ x: 0, y: 0, color: '#ff0000' }, { x: 100, y: 0, color: '#0000ff' }] };
  const nearRed = sampleMeshGradient(mesh, 10, 0);
  const [r, , b] = hexToRgb(nearRed);
  assert.ok(r > b, 'closer to the red point, red channel should dominate');
});

test('rasterizeMeshGradient fills a whole RGBA buffer, opaque', () => {
  const mesh = { kind: 'mesh', points: [{ x: 5, y: 5, color: '#00ff00' }] };
  const buf = rasterizeMeshGradient(mesh, 10, 10);
  assert.equal(buf.length, 10 * 10 * 4);
  assert.equal(buf[3], 255);
});

test('hsv/hex/rgb round-trip for a handful of known colours', () => {
  for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000', '#7f3fae']) {
    const hsv = hexToHsv(hex);
    const back = hsvToHex(hsv.h, hsv.s, hsv.v);
    const [r1, g1, b1] = hexToRgb(hex);
    const [r2, g2, b2] = hexToRgb(back);
    assert.ok(Math.abs(r1 - r2) <= 1 && Math.abs(g1 - g2) <= 1 && Math.abs(b1 - b2) <= 1, `${hex} -> ${back}`);
  }
});

test('rgbToHsv/hsvToRgb: pure red is hue 0, full saturation and value', () => {
  const hsv = rgbToHsv(255, 0, 0);
  assert.equal(hsv.h, 0);
  assert.equal(hsv.s, 1);
  assert.equal(hsv.v, 1);
  assert.deepEqual(hsvToRgb(0, 1, 1).map(Math.round), [255, 0, 0]);
});

test('replaceColorInPlace swaps every matching pixel and leaves others untouched', () => {
  const data = new Uint8ClampedArray([
    255, 0, 0, 255, // red
    0, 255, 0, 255, // green
    250, 5, 5, 255, // near-red
  ]);
  replaceColorInPlace(data, '#ff0000', '#0000ff', 10);
  assert.deepEqual(Array.from(data.slice(0, 4)), [0, 0, 255, 255]);
  assert.deepEqual(Array.from(data.slice(4, 8)), [0, 255, 0, 255]);
  assert.deepEqual(Array.from(data.slice(8, 12)), [0, 0, 255, 255]);
});

test('replaceColorInPlace ignores fully transparent pixels', () => {
  const data = new Uint8ClampedArray([255, 0, 0, 0]);
  replaceColorInPlace(data, '#ff0000', '#00ff00', 10);
  assert.deepEqual(Array.from(data), [255, 0, 0, 0]);
});
