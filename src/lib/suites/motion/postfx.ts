/**
 * Whole-screen post effects: chromatic aberration (RGB channel split), a glitch (horizontally sliced and
 * shifted), a screen invert, and a radial space-bend warp — the "black flash" / "domain expansion" register
 * this upgrade's brief asked for. Every one of these is a pure function over a plain RGBA pixel buffer
 * (the same shape `CanvasRenderingContext2D.getImageData()` returns), so each is tested here in Node
 * without a browser; render.ts calls them on the canvas's actual pixels after everything else is drawn.
 */

export interface RgbaBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function clampIdx(v: number, max: number): number {
  return Math.max(0, Math.min(max - 1, v));
}

/** Shift the red channel one way and the blue channel the other — the classic chromatic-aberration look. */
export function chromaticAberration(src: RgbaBuffer, offsetPx: number): RgbaBuffer {
  const { width, height, data } = src;
  const out = new Uint8ClampedArray(data.length);
  const off = Math.round(offsetPx);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const rx = clampIdx(x - off, width), bx = clampIdx(x + off, width);
      const ri = (y * width + rx) * 4, bi = (y * width + bx) * 4;
      out[i] = data[ri]!;
      out[i + 1] = data[i + 1]!;
      out[i + 2] = data[bi + 2]!;
      out[i + 3] = data[i + 3]!;
    }
  }
  return { width, height, data: out };
}

/** 255 minus every colour channel — alpha untouched. */
export function screenInvert(src: RgbaBuffer): RgbaBuffer {
  const out = new Uint8ClampedArray(src.data.length);
  for (let i = 0; i < src.data.length; i += 4) {
    out[i] = 255 - src.data[i]!;
    out[i + 1] = 255 - src.data[i + 1]!;
    out[i + 2] = 255 - src.data[i + 2]!;
    out[i + 3] = src.data[i + 3]!;
  }
  return { width: src.width, height: src.height, data: out };
}

/**
 * Cut the frame into horizontal slices and shift each one sideways by a deterministic (seeded) random
 * amount — a digital-glitch look. `intensity` 0..1 scales both how many slices move and how far.
 */
export function glitchSlices(src: RgbaBuffer, sliceCount: number, maxShiftPx: number, seed: number, intensity = 1): RgbaBuffer {
  const { width, height, data } = src;
  const out = new Uint8ClampedArray(data.length);
  const sliceH = Math.max(1, Math.ceil(height / Math.max(1, sliceCount)));
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let sliceStart = 0; sliceStart < height; sliceStart += sliceH) {
    const r1 = rand(), r2 = rand();
    const active = r1 < 0.5 * intensity;
    const shift = active ? Math.round((r2 * 2 - 1) * maxShiftPx * intensity) : 0;
    const sliceEnd = Math.min(height, sliceStart + sliceH);
    for (let y = sliceStart; y < sliceEnd; y++) {
      for (let x = 0; x < width; x++) {
        const sx = clampIdx(x - shift, width);
        const si = (y * width + sx) * 4, di = (y * width + x) * 4;
        out[di] = data[si]!; out[di + 1] = data[si + 1]!; out[di + 2] = data[si + 2]!; out[di + 3] = data[si + 3]!;
      }
    }
  }
  return { width, height, data: out };
}

/**
 * A radial "space bend": pixels are pulled toward (strength > 0) or pushed away from (strength < 0) a
 * centre point, falling off with distance — a cheap, convincing stand-in for a domain-expansion-style
 * warp. Implemented as an inverse sample (each output pixel reads from a displaced source position), so
 * there are never holes in the result.
 */
export function radialWarp(src: RgbaBuffer, cx: number, cy: number, radius: number, strength: number): RgbaBuffer {
  const { width, height, data } = src;
  const out = new Uint8ClampedArray(data);
  const radiusSq = radius * radius;
  // Only the bounding box around the circle can possibly move — the rest is already a plain copy above.
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(height - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const distSq = dx * dx + dy * dy;
      if (distSq >= radiusSq || distSq < 1e-6) continue; // outside the effect, or the centre itself — already a plain copy
      const dist = Math.sqrt(distSq);
      const p = 1 - dist / radius;
      const pull = strength * p * p;
      const factor = 1 - pull / dist;
      const sxi = clampIdx(Math.round(cx + dx * factor), width);
      const syi = clampIdx(Math.round(cy + dy * factor), height);
      const si = (syi * width + sxi) * 4, di = (y * width + x) * 4;
      out[di] = data[si]!; out[di + 1] = data[si + 1]!; out[di + 2] = data[si + 2]!; out[di + 3] = data[si + 3]!;
    }
  }
  return { width, height, data: out };
}
