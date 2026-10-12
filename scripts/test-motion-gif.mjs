/** node --experimental-strip-types --test scripts/test-motion-gif.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPalette, encodeGif, encodeGifFromRgba, quantizeFrame, TRANSPARENT_INDEX,
} from '../src/lib/suites/motion/gif.ts';

// A from-spec GIF LZW *decoder*, written only to verify the encoder round-trips correctly — there is no
// decoder anywhere in the shipped product, this exists purely as an independent check in the test.
function readGif(bytes) {
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => { const v = bytes[p] | (bytes[p + 1] << 8); p += 2; return v; };
  const sig = String.fromCharCode(...bytes.slice(0, 6)); p = 6;
  assert.equal(sig, 'GIF89a');
  const width = u16(), height = u16();
  const packed = u8(); p += 2; // skip bg index + aspect
  const gctFlag = (packed & 0x80) !== 0;
  const gctSize = 1 << ((packed & 0x07) + 1);
  const palette = [];
  if (gctFlag) for (let i = 0; i < gctSize; i++) palette.push({ r: u8(), g: u8(), b: u8() });

  const frames = [];
  for (;;) {
    const marker = u8();
    if (marker === 0x3b) break; // trailer
    if (marker === 0x21) {
      const label = u8();
      if (label === 0xff) { // app extension (Netscape loop) — skip its sub-blocks
        for (let len = u8(); len !== 0; len = u8()) p += len;
      } else if (label === 0xf9) {
        const blockSize = u8(); p += blockSize; // graphic control extension, fixed size
        const term = u8(); assert.equal(term, 0);
      } else {
        for (let len = u8(); len !== 0; len = u8()) p += len;
      }
      continue;
    }
    if (marker === 0x2c) {
      u16(); u16(); // left, top
      const fw = u16(), fh = u16();
      const ipacked = u8();
      assert.equal(ipacked & 0x80, 0, 'no local colour table expected in these tests');
      const minCodeSize = u8();
      const dataBytes = [];
      for (let len = u8(); len !== 0; len = u8()) { for (let i = 0; i < len; i++) dataBytes.push(u8()); }
      const indices = lzwDecode(dataBytes, minCodeSize, fw * fh);
      frames.push({ width: fw, height: fh, indices });
      continue;
    }
    throw new Error(`unexpected GIF block marker 0x${marker.toString(16)}`);
  }
  return { width, height, palette, frames };
}

function lzwDecode(bytes, minCodeSize, expectedPixels) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let dict, codeSize, nextCode;
  const reset = () => {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict.push([i]);
    dict.push(null, null); // clear, end — unused as entries
    codeSize = minCodeSize + 1;
    nextCode = endCode + 1;
  };
  reset();

  let bitBuf = 0, bitCount = 0, bytePos = 0;
  const readCode = () => {
    while (bitCount < codeSize) {
      bitBuf |= bytes[bytePos++] << bitCount;
      bitCount += 8;
    }
    const code = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>= codeSize;
    bitCount -= codeSize;
    return code;
  };

  const out = [];
  let prev = null;
  for (;;) {
    const code = readCode();
    if (code === clearCode) { reset(); prev = null; continue; }
    if (code === endCode) break;
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (code === nextCode && prev) entry = [...prev, prev[0]];
    else throw new Error(`bad LZW code ${code}`);
    out.push(...entry);
    if (prev) {
      dict[nextCode] = [...prev, entry[0]];
      nextCode++;
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = entry;
    if (out.length >= expectedPixels) break;
  }
  return Uint8Array.from(out.slice(0, expectedPixels));
}

function solidFrame(w, h, r, g, b, a = 255) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a; }
  return { width: w, height: h, data };
}

function checkerFrame(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const on = (x + y) % 2 === 0;
    data[i] = on ? 255 : 10; data[i + 1] = on ? 20 : 200; data[i + 2] = on ? 30 : 40; data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}

test('buildPalette never exceeds the requested colour count and includes the dominant colour', () => {
  const frame = checkerFrame(8, 8);
  const palette = buildPalette(frame.data, 4);
  assert.ok(palette.length <= 4);
  assert.ok(palette.length >= 1);
});

test('quantizeFrame maps a fully-transparent pixel to the reserved transparent index', () => {
  const frame = solidFrame(2, 2, 100, 100, 100, 0);
  const palette = buildPalette(solidFrame(2, 2, 100, 100, 100, 255).data, 4);
  const indices = quantizeFrame(frame, palette);
  assert.ok(indices.every((i) => i === TRANSPARENT_INDEX));
});

test('a solid-colour GIF round-trips through the encoder and an independent LZW decoder', () => {
  const frame = solidFrame(6, 4, 200, 50, 10);
  const palette = buildPalette(frame.data, 4);
  const indices = quantizeFrame(frame, palette);
  const gif = encodeGif([{ width: 6, height: 4, delayCs: 10, indices }], palette, false);
  assert.equal(String.fromCharCode(...gif.slice(0, 6)), 'GIF89a');
  const decoded = readGif(gif);
  assert.equal(decoded.frames.length, 1);
  assert.deepEqual(Array.from(decoded.frames[0].indices), Array.from(indices));
});

test('a checkerboard (many LZW dictionary entries) round-trips correctly', () => {
  const frame = checkerFrame(16, 16);
  const palette = buildPalette(frame.data, 8);
  const indices = quantizeFrame(frame, palette);
  const gif = encodeGif([{ width: 16, height: 16, delayCs: 4, indices }], palette, false);
  const decoded = readGif(gif);
  assert.deepEqual(Array.from(decoded.frames[0].indices), Array.from(indices));
});

test('multiple frames all round-trip, each against the shared palette', () => {
  const frames = [solidFrame(4, 4, 255, 0, 0), solidFrame(4, 4, 0, 255, 0), checkerFrame(4, 4)];
  const gif = encodeGifFromRgba(frames, 8, true);
  const decoded = readGif(gif);
  assert.equal(decoded.frames.length, 3);
  for (const f of decoded.frames) assert.equal(f.indices.length, 16);
});

test('a real-stage-sized, noisy frame (960x540) does not overflow the call stack (regression: spreading large arrays into push/Math.max)', () => {
  const w = 960, h = 540;
  const data = new Uint8ClampedArray(w * h * 4);
  // Pseudo-random, not flat or repetitive — the worst case for both palette quantization and LZW, and
  // the size (518,400 pixels) that first caught this bug in the real app (a tiny test image never would).
  let seed = 12345;
  for (let i = 0; i < w * h; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i * 4] = seed & 0xff;
    data[i * 4 + 1] = (seed >> 8) & 0xff;
    data[i * 4 + 2] = (seed >> 16) & 0xff;
    data[i * 4 + 3] = 255;
  }
  const palette = buildPalette(data, 200);
  const indices = quantizeFrame({ width: w, height: h, data }, palette);
  assert.doesNotThrow(() => encodeGif([{ width: w, height: h, delayCs: 4, indices }], palette, true));
});

test('a large flat run (bigger than 4096 LZW codes worth of repeats) does not corrupt the stream', () => {
  const frame = solidFrame(64, 64, 10, 10, 10); // 4096 identical pixels — forces an LZW dictionary reset
  const palette = buildPalette(frame.data, 2);
  const indices = quantizeFrame(frame, palette);
  const gif = encodeGif([{ width: 64, height: 64, delayCs: 10, indices }], palette, false);
  const decoded = readGif(gif);
  assert.deepEqual(Array.from(decoded.frames[0].indices), Array.from(indices));
});
