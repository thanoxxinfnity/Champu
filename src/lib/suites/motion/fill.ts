/**
 * Smart bucket fill: anime line art is rarely a perfectly closed shape by the time you want to colour it
 * — a one- or two-pixel gap in the ink is normal. A naive flood fill leaks through that gap and colours
 * the whole canvas. The fix (the same one real paint programs use): dilate the line mask by a few pixels
 * first, so small gaps close, flood-fill *that*, then the result still respects the original line
 * positions because the dilation only ever shrinks the fillable area, never moves a line.
 *
 * Every fill here is iterative with an explicit stack/queue — never recursive. A real canvas can be
 * 500,000+ pixels, and recursion over that many cells overflows the call stack exactly the way an
 * earlier bug in this codebase's GIF encoder did (see gif.ts's header) for the same underlying reason.
 */

export interface Bitmap {
  width: number;
  height: number;
}

/** 1 = "ink" (part of the line art), 0 = empty — built from a layer's alpha channel. */
export function alphaToLineMask(alpha: Uint8ClampedArray, width: number, height: number, threshold = 16): Uint8Array {
  const n = width * height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = alpha[i]! >= threshold ? 1 : 0;
  return out;
}

/** Grow the 1s by `radiusPx` pixels (4-connected, one ring per iteration) — closes small gaps in line art. */
export function dilateMask(mask: Uint8Array, width: number, height: number, radiusPx: number): Uint8Array {
  let current = mask;
  for (let r = 0; r < radiusPx; r++) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (current[i]) { next[i] = 1; continue; }
        const left = x > 0 && current[i - 1];
        const right = x < width - 1 && current[i + 1];
        const up = y > 0 && current[i - width];
        const down = y < height - 1 && current[i + width];
        next[i] = left || right || up || down ? 1 : 0;
      }
    }
    current = next;
  }
  return current;
}

/** Iterative 4-connected flood fill of the 0-region containing `(seedX,seedY)` in a 0/1 mask. Returns a 1=fill mask. */
export function floodFillMask(blocked: Uint8Array, width: number, height: number, seedX: number, seedY: number): Uint8Array {
  const n = width * height;
  const result = new Uint8Array(n);
  if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) return result;
  const seedI = seedY * width + seedX;
  if (blocked[seedI]) return result; // clicked on a line itself — nothing to fill

  const stack = new Int32Array(n);
  let top = 0;
  stack[top++] = seedI;
  result[seedI] = 1;
  while (top > 0) {
    const i = stack[--top]!;
    const x = i % width, y = (i / width) | 0;
    if (x > 0) { const j = i - 1; if (!blocked[j] && !result[j]) { result[j] = 1; stack[top++] = j; } }
    if (x < width - 1) { const j = i + 1; if (!blocked[j] && !result[j]) { result[j] = 1; stack[top++] = j; } }
    if (y > 0) { const j = i - width; if (!blocked[j] && !result[j]) { result[j] = 1; stack[top++] = j; } }
    if (y < height - 1) { const j = i + width; if (!blocked[j] && !result[j]) { result[j] = 1; stack[top++] = j; } }
  }
  return result;
}

export interface GapCloseOptions {
  /** Alpha ≥ this counts as a line pixel. */
  lineThreshold?: number;
  /** How many pixels of gap this will close. 0 disables gap closing (a strict, literal fill). */
  gapClosePx?: number;
}

/** The whole "smart bucket" pipeline: line art's alpha → the region a click should colour, gaps closed. */
export function floodFillWithGapClosing(
  alpha: Uint8ClampedArray, width: number, height: number, seedX: number, seedY: number, opts: GapCloseOptions = {},
): Uint8Array {
  const lineMask = alphaToLineMask(alpha, width, height, opts.lineThreshold ?? 16);
  const dilated = opts.gapClosePx && opts.gapClosePx > 0 ? dilateMask(lineMask, width, height, opts.gapClosePx) : lineMask;
  return floodFillMask(dilated, width, height, seedX, seedY);
}

/**
 * Connected-component labelling of every enclosed region at once (gap-closed the same way) — the basis
 * for one-click auto-flat-colouring: every region gets its own label, then its own colour.
 */
export function labelAllRegions(
  alpha: Uint8ClampedArray, width: number, height: number, opts: GapCloseOptions = {},
): { labels: Int32Array; count: number } {
  const lineMask = alphaToLineMask(alpha, width, height, opts.lineThreshold ?? 16);
  const blocked = opts.gapClosePx && opts.gapClosePx > 0 ? dilateMask(lineMask, width, height, opts.gapClosePx) : lineMask;
  const n = width * height;
  const labels = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let nextLabel = 0;
  for (let start = 0; start < n; start++) {
    if (blocked[start] || labels[start] !== -1) continue;
    let top = 0;
    stack[top++] = start;
    labels[start] = nextLabel;
    while (top > 0) {
      const i = stack[--top]!;
      const x = i % width, y = (i / width) | 0;
      const neigh = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
      for (const j of neigh) {
        if (j >= 0 && !blocked[j] && labels[j] === -1) { labels[j] = nextLabel; stack[top++] = j; }
      }
    }
    nextLabel++;
  }
  return { labels, count: nextLabel };
}

/** One click: every enclosed region of the line art gets its own flat colour, cycling through `palette`. */
export function autoFlatColor(
  alpha: Uint8ClampedArray, width: number, height: number, palette: string[], opts: GapCloseOptions = {},
): { labels: Int32Array; colorOf: string[] } {
  const { labels, count } = labelAllRegions(alpha, width, height, opts);
  const safePalette = palette.length > 0 ? palette : ['#cccccc'];
  const colorOf = Array.from({ length: count }, (_, i) => safePalette[i % safePalette.length]!);
  return { labels, colorOf };
}
