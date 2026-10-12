/**
 * A self-contained GIF89a encoder: palette quantization (median cut) down to 256 colours, one reserved
 * index for transparency, and GIF's own LZW compression — no external library, so "export a looping GIF"
 * does not drag in a multi-megabyte dependency for a feature a person might use once.
 *
 * Each frame goes through `quantizeFrame` once against the *first* frame to build one shared palette (a
 * motion-graphics clip's palette rarely shifts much frame to frame, and a single shared palette keeps the
 * file a great deal smaller than re-quantizing every frame). `encodeGif` then writes the GIF89a container:
 * header, logical screen + global colour table, a Netscape2.0 loop extension, and one
 * graphic-control-extension + image block per frame.
 */

export interface RgbaFrame {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major — exactly what CanvasRenderingContext2D.getImageData gives back. */
  data: Uint8ClampedArray;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Capped so palette-building cost does not grow with frame resolution — a representative sample of a real frame quantizes just as well as scanning every one of its (possibly 500,000+) pixels, for a fraction of the work. */
const PALETTE_SAMPLE_CAP = 12_000;

/** Median-cut quantization down to at most `maxColors` (≤ 255, index 255 is reserved for transparency). */
export function buildPalette(data: Uint8ClampedArray, maxColors = 255): Rgb[] {
  const totalPixels = data.length / 4;
  const stride = Math.max(1, Math.floor(totalPixels / PALETTE_SAMPLE_CAP));
  const pixels: Rgb[] = [];
  for (let p = 0; p < totalPixels; p += stride) {
    const i = p * 4;
    if (data[i + 3]! < 16) continue; // near-fully-transparent pixels don't vote on the palette
    pixels.push({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! });
  }
  if (pixels.length === 0) return [{ r: 0, g: 0, b: 0 }];
  let boxes: Rgb[][] = [pixels];
  while (boxes.length < maxColors) {
    let target = -1, targetRange = -1, targetChannel: keyof Rgb = 'r';
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i]!.length < 2) continue;
      for (const ch of ['r', 'g', 'b'] as const) {
        // A plain loop, not Math.max(...vals) — a box can hold hundreds of thousands of pixels (a full
        // HD-ish frame), and spreading an array that large into a function call overflows the stack.
        let mn = 255, mx = 0;
        for (const p of boxes[i]!) { const v = p[ch]; if (v < mn) mn = v; if (v > mx) mx = v; }
        const range = mx - mn;
        if (range > targetRange) { targetRange = range; target = i; targetChannel = ch; }
      }
    }
    if (target < 0) break;
    const box = boxes[target]!.slice().sort((a, b) => a[targetChannel] - b[targetChannel]);
    const mid = Math.floor(box.length / 2);
    boxes.splice(target, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.filter((b) => b.length > 0).map((box) => {
    const n = box.length;
    const r = Math.round(box.reduce((s, p) => s + p.r, 0) / n);
    const g = Math.round(box.reduce((s, p) => s + p.g, 0) / n);
    const b = Math.round(box.reduce((s, p) => s + p.b, 0) / n);
    return { r, g, b };
  });
}

function nearestIndex(palette: Rgb[], r: number, g: number, b: number): number {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i]!;
    const dr = p.r - r, dg = p.g - g, db = p.b - b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return best;
}

export const TRANSPARENT_INDEX = 255;

/** Map every pixel of a frame to a palette index, index 255 reserved to mean "transparent". */
export function quantizeFrame(frame: RgbaFrame, palette: Rgb[]): Uint8Array {
  const n = frame.width * frame.height;
  const out = new Uint8Array(n);
  // Motion-graphics frames are mostly a handful of flat colours repeated over huge areas (a shape's
  // fill, the background), so caching each exact RGB value's nearest palette index — instead of running
  // the O(paletteSize) search again for every one of possibly 500,000+ pixels — is a large, exact (not
  // approximate) speedup for exactly the content this exports.
  const cache = new Map<number, number>();
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const a = frame.data[i + 3]!;
    if (a < 16) { out[p] = TRANSPARENT_INDEX; continue; }
    const r = frame.data[i]!, g = frame.data[i + 1]!, b = frame.data[i + 2]!;
    const key = (r << 16) | (g << 8) | b;
    let idx = cache.get(key);
    if (idx === undefined) { idx = nearestIndex(palette, r, g, b); cache.set(key, idx); }
    out[p] = idx;
  }
  return out;
}

// ── LZW (GIF's own variant: variable code width, a clear code and an end code) ─────────────────────────

function lzwEncode(indices: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dict = new Map<string, number>();
  const resetDict = () => {
    dict = new Map();
    for (let i = 0; i < clearCode; i++) dict.set(String(i), i);
    nextCode = endCode + 1;
    codeSize = minCodeSize + 1;
  };
  resetDict();

  const codes: number[] = [clearCode];
  let w = '';
  for (const byte of indices) {
    const k = String(byte);
    const wk = w === '' ? k : `${w},${k}`;
    if (dict.has(wk)) {
      w = wk;
    } else {
      codes.push(dict.get(w)!);
      if (nextCode < 4096) {
        dict.set(wk, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        codes.push(clearCode);
        resetDict();
      }
      w = k;
    }
  }
  if (w !== '') codes.push(dict.get(w)!);
  codes.push(endCode);

  // Pack variable-width codes into bytes, LSB-first (the GIF bit order).
  const bytes: number[] = [];
  let bitBuf = 0, bitCount = 0;
  let curSize = minCodeSize + 1;
  let curNext = endCode + 1;
  for (const code of codes) {
    bitBuf |= code << bitCount;
    bitCount += curSize;
    while (bitCount >= 8) {
      bytes.push(bitBuf & 0xff);
      bitBuf >>= 8;
      bitCount -= 8;
    }
    if (code === clearCode) {
      curSize = minCodeSize + 1;
      curNext = endCode + 1;
    } else if (code !== endCode) {
      curNext++;
      if (curNext > (1 << curSize) && curSize < 12) curSize++;
      if (curNext >= 4096) { curSize = minCodeSize + 1; curNext = endCode + 1; }
    }
  }
  if (bitCount > 0) bytes.push(bitBuf & 0xff);
  return bytes;
}

function subBlocks(bytes: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

export interface GifFrame {
  indices: Uint8Array;
  width: number;
  height: number;
  /** Hundredths of a second. */
  delayCs: number;
}

/** The full GIF89a byte stream: header, one shared global palette, a loop extension, then every frame. */
export function encodeGif(frames: GifFrame[], palette: Rgb[], loop = true): Uint8Array {
  if (frames.length === 0) throw new Error('encodeGif: no frames');
  const { width, height } = frames[0]!;
  const out: number[] = [];
  const push = (...b: number[]) => out.push(...b);
  // A loop, not out.push(...bigArray) — the compressed image data for one real-sized frame can be
  // hundreds of thousands of bytes, and spreading that into a function call overflows the stack.
  const pushMany = (bytes: number[]) => { for (let i = 0; i < bytes.length; i++) out.push(bytes[i]!); };
  const pushStr = (s: string) => { for (const c of s) out.push(c.charCodeAt(0)); };
  const push16 = (n: number) => push(n & 0xff, (n >> 8) & 0xff);

  pushStr('GIF89a');
  push16(width); push16(height);

  let tableSizeBits = 1;
  while ((1 << tableSizeBits) < palette.length && tableSizeBits < 8) tableSizeBits++;
  const tableSize = 1 << tableSizeBits;
  push(0x80 | ((tableSizeBits - 1) << 4) | (tableSizeBits - 1)); // global colour table present
  push(0); // background colour index
  push(0); // pixel aspect ratio

  for (let i = 0; i < tableSize; i++) {
    const c = palette[i] ?? { r: 0, g: 0, b: 0 };
    push(c.r, c.g, c.b);
  }

  if (loop) {
    push(0x21, 0xff, 0x0b);
    pushStr('NETSCAPE2.0');
    push(3, 1, 0, 0, 0);
  }

  for (const frame of frames) {
    push(0x21, 0xf9, 4);
    push(0b00000001); // transparency flag set, no disposal preference
    push16(frame.delayCs);
    push(TRANSPARENT_INDEX);
    push(0);

    push(0x2c);
    push16(0); push16(0); push16(frame.width); push16(frame.height);
    push(0); // no local colour table, not interlaced

    const minCodeSize = Math.max(2, tableSizeBits);
    push(minCodeSize);
    const lzwBytes = lzwEncode(frame.indices, minCodeSize);
    pushMany(subBlocks(lzwBytes));
  }

  push(0x3b);
  return new Uint8Array(out);
}

/** Build a shared palette from the first frame and encode every frame against it — the common one-call path. */
export function encodeGifFromRgba(rgbaFrames: RgbaFrame[], delayCs: number, loop = true): Uint8Array {
  const palette = buildPalette(rgbaFrames[0]!.data, 255);
  const frames: GifFrame[] = rgbaFrames.map((f) => ({
    width: f.width, height: f.height, delayCs,
    indices: quantizeFrame(f, palette),
  }));
  return encodeGif(frames, palette, loop);
}
