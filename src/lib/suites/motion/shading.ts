/**
 * One-click anime cel shading: shift a character's silhouette away from a light direction and intersect
 * it with the original — what's left (minus a "core light" band right at the edge, so the shadow doesn't
 * touch the rim) is where a shadow belongs. It is an approximation real cel-shading tools use too, not a
 * physically simulated light — anime shading is a stylistic choice, not a lighting calculation.
 */

export interface CelShadeOptions {
  /** Degrees, 0 = light from the right, 90 = light from below, etc. */
  lightAngleDeg: number;
  /** How far the shadow reaches in from the shifted edge, in pixels. */
  offsetPx: number;
}

/** Shift a 0/1 mask by (dx, dy) pixels (no wraparound — pixels shifted off the edge are simply lost). */
export function shiftMask(mask: Uint8Array, width: number, height: number, dx: number, dy: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  const idx = Math.round(dx), idy = Math.round(dy);
  for (let y = 0; y < height; y++) {
    const sy = y - idy;
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < width; x++) {
      const sx = x - idx;
      if (sx < 0 || sx >= width) continue;
      if (mask[sy * width + sx]) out[y * width + x] = 1;
    }
  }
  return out;
}

export function maskAnd(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] && b[i] ? 1 : 0;
  return out;
}
export function maskAndNot(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] && !b[i] ? 1 : 0;
  return out;
}

/**
 * The shadow region for a silhouette: shift the silhouette opposite the light, intersect with the
 * original silhouette (so the shadow never spills outside the character), then shave a thin "core light"
 * band off the lit-side edge so the shadow reads as sitting inside the form, not painted over its rim.
 */
export function autoCelShadow(mask: Uint8Array, width: number, height: number, opts: CelShadeOptions): Uint8Array {
  const rad = ((opts.lightAngleDeg + 180) * Math.PI) / 180; // opposite the light
  const dx = Math.cos(rad) * opts.offsetPx, dy = Math.sin(rad) * opts.offsetPx;
  const shifted = shiftMask(mask, width, height, dx, dy);
  const shadow = maskAnd(mask, shifted);
  const coreLightRad = ((opts.lightAngleDeg) * Math.PI) / 180;
  const litEdge = shiftMask(mask, width, height, Math.cos(coreLightRad) * 2, Math.sin(coreLightRad) * 2);
  const core = maskAndNot(mask, litEdge); // a thin band right at the lit-side rim
  return maskAndNot(shadow, core);
}
