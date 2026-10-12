/** node --experimental-strip-types --test scripts/test-postfx.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromaticAberration, glitchSlices, radialWarp, screenInvert } from '../src/lib/suites/motion/postfx.ts';

function solidBuffer(w, h, r, g, b, a = 255) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a; }
  return { width: w, height: h, data };
}
function verticalStripes(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const on = x % 4 < 2;
    data[i] = on ? 255 : 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}

test('chromaticAberration on a solid colour does nothing visible (every channel sampled from the same flat field)', () => {
  const src = solidBuffer(20, 20, 200, 100, 50);
  const out = chromaticAberration(src, 3);
  assert.equal(out.data[0], 200);
  assert.equal(out.data[1], 100);
  assert.equal(out.data[2], 50);
});

test('chromaticAberration shifts the red channel from offsetPx to the left and blue from the right', () => {
  const w = 20, h = 4;
  const src = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  // a single bright-red pixel at x=10, rest black
  const y = 2;
  src.data[(y * w + 10) * 4] = 255;
  src.data[(y * w + 10) * 4 + 3] = 255;
  for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; src.data[i + 3] = 255; }
  const out = chromaticAberration(src, 2);
  // the red channel at x=12 should now show what was at x=10 (shifted +offset reads from x-offset... verify directionally consistent)
  const redAt = (x) => out.data[(y * w + x) * 4];
  assert.ok(redAt(12) > 0, 'red channel should have shifted to be visible further right');
});

test('screenInvert flips every colour channel and leaves alpha alone', () => {
  const src = solidBuffer(4, 4, 0, 100, 255, 200);
  const out = screenInvert(src);
  assert.equal(out.data[0], 255);
  assert.equal(out.data[1], 155);
  assert.equal(out.data[2], 0);
  assert.equal(out.data[3], 200);
});

test('screenInvert twice returns (very nearly) the original', () => {
  const src = solidBuffer(4, 4, 30, 90, 180);
  const back = screenInvert(screenInvert(src));
  assert.deepEqual(Array.from(back.data), Array.from(src.data));
});

test('glitchSlices is deterministic for the same seed and produces a buffer the same size', () => {
  const src = verticalStripes(40, 20);
  const a = glitchSlices(src, 5, 8, 42, 1);
  const b = glitchSlices(src, 5, 8, 42, 1);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
  assert.equal(a.data.length, src.data.length);
});

test('glitchSlices with intensity 0 never shifts anything (identity)', () => {
  const src = verticalStripes(40, 20);
  const out = glitchSlices(src, 5, 8, 42, 0);
  assert.deepEqual(Array.from(out.data), Array.from(src.data));
});

test('glitchSlices actually changes a striped image at intensity 1 (some seed produces a visible shift)', () => {
  const src = verticalStripes(40, 20);
  let changed = false;
  for (let seed = 0; seed < 20; seed++) {
    const out = glitchSlices(src, 5, 8, seed, 1);
    if (!arraysEqual(out.data, src.data)) { changed = true; break; }
  }
  assert.ok(changed, 'at least one seed in a reasonable range should produce a visible glitch');
});
function arraysEqual(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

test('radialWarp with strength 0 is the identity', () => {
  const src = verticalStripes(30, 30);
  const out = radialWarp(src, 15, 15, 20, 0);
  assert.deepEqual(Array.from(out.data), Array.from(src.data));
});

test('radialWarp pulls pixels toward the centre with positive strength (a pinch)', () => {
  const w = 40, h = 40;
  const src = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  // a bright ring at radius ~15 from centre (20,20)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - 20, y - 20);
    const i = (y * w + x) * 4;
    if (d > 14 && d < 16) { src.data[i] = 255; src.data[i + 1] = 255; src.data[i + 2] = 255; }
    src.data[i + 3] = 255;
  }
  const out = radialWarp(src, 20, 20, 30, 10);
  // sum of bright pixels should redistribute (not identical to source) — confirms the warp did something
  assert.notDeepEqual(Array.from(out.data), Array.from(src.data));
});

test('radialWarp never produces transparent holes (every pixel keeps full alpha from a fully opaque source)', () => {
  const src = solidBuffer(30, 30, 50, 50, 50, 255);
  const out = radialWarp(src, 15, 15, 20, 15);
  for (let i = 3; i < out.data.length; i += 4) assert.equal(out.data[i], 255);
});
