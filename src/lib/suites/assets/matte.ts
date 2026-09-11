/**
 * Background removal.
 *
 * There is no hosted matting model on NVIDIA NIM — verified against the live
 * catalogue, which has no SAM, RMBG or segmentation NIM of any kind. So rather
 * than pretend, this takes the approach that actually produces clean alpha for
 * the job at hand: **control the background, then key it out**.
 *
 * For generated assets the prompt places the subject on a flat chroma field we
 * chose, which makes removal exact rather than approximate. For uploaded images
 * the same flood fill works whenever the background is flat or near-flat, and
 * the UI says plainly that it is not general-purpose matting.
 *
 * Pipeline: seed from the border → tolerance flood fill → feather the boundary
 * → despill the key colour out of edge pixels → auto-crop to content.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface MatteOptions {
  /** 0–100. Higher removes more of the background and more of the subject. */
  tolerance?: number;
  /** Pixels of soft edge. 0 gives a hard cut-out. */
  feather?: number;
  /** Pull the key colour out of semi-transparent edge pixels. */
  despill?: boolean;
  /** Trim fully transparent margins. */
  autoCrop?: boolean;
  /** Transparent padding kept around the subject after cropping, in pixels. */
  padding?: number;
  /** Override the detected background colour. */
  keyColor?: RGB;
}

export interface MatteResult {
  canvas: HTMLCanvasElement;
  /** Background colour the flood fill actually used. */
  keyColor: RGB;
  /** Share of pixels made fully transparent. */
  removedRatio: number;
  /** Content box within the original image, before cropping. */
  bounds: { x: number; y: number; width: number; height: number };
  warnings: string[];
}

/**
 * The chroma field generated assets are placed on.
 * Magenta is chosen deliberately: it is far from skin tones, foliage, sky and
 * most UI palettes, so keying it out rarely eats into the subject the way green
 * does on anything with a green component.
 */
export const KEY_MAGENTA: RGB = { r: 255, g: 0, b: 255 };

export function keyColorPrompt(color: RGB = KEY_MAGENTA): string {
  const hex = `#${[color.r, color.g, color.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  return (
    `isolated on a completely flat solid ${hex} magenta chroma background, ` +
    'no gradient, no shadow cast on the background, no vignette, ' +
    'subject fully inside frame with clear margins, sharp clean edges, product shot lighting'
  );
}

/** Perceptual-ish distance. Weighted for how the eye actually judges colour. */
function distance(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db);
}

/**
 * The modal border colour.
 * A plain average smears across a two-tone border; bucketing and taking the
 * heaviest bucket finds the real background even when a corner is occupied.
 */
export function detectKeyColor(data: Uint8ClampedArray, width: number, height: number): RGB {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  const sample = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // 5-bit-per-channel buckets tolerate JPEG noise without merging distinct colours.
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const entry = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    entry.count++;
    entry.r += r;
    entry.g += g;
    entry.b += b;
    buckets.set(key, entry);
  };

  for (let x = 0; x < width; x++) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    sample(0, y);
    sample(width - 1, y);
  }

  let best = { count: 0, r: 0, g: 0, b: 0 };
  for (const entry of buckets.values()) if (entry.count > best.count) best = entry;

  return best.count
    ? { r: Math.round(best.r / best.count), g: Math.round(best.g / best.count), b: Math.round(best.b / best.count) }
    : { r: 255, g: 255, b: 255 };
}

/**
 * Flood fill inward from every border pixel.
 *
 * Deliberately *not* a global colour-range delete: that also punches holes in
 * any part of the subject that happens to match the background. Only the region
 * connected to the frame edge is background.
 */
function floodFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  key: RGB,
  threshold: number,
): Uint8Array {
  const total = width * height;
  const background = new Uint8Array(total);
  // A ring buffer beats an array `shift()` by orders of magnitude at 1M pixels.
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const push = (index: number) => {
    if (background[index]) return;
    const p = index * 4;
    if (distance({ r: data[p], g: data[p + 1], b: data[p + 2] }, key) > threshold) return;
    background[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index / width) | 0;
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }

  return background;
}

/**
 * Soften the cut edge.
 *
 * Alpha is set from how far each near-edge pixel sits between the key colour and
 * the subject, which follows the real boundary rather than blurring a hard mask
 * and smearing colour across it.
 */
function featherEdges(
  data: Uint8ClampedArray,
  background: Uint8Array,
  width: number,
  height: number,
  key: RGB,
  threshold: number,
  radius: number,
): void {
  if (radius <= 0) return;

  const total = width * height;
  const edge = new Uint8Array(total);

  for (let index = 0; index < total; index++) {
    if (background[index]) continue;
    const x = index % width;
    const y = (index / width) | 0;
    const touchesBackground =
      (x > 0 && background[index - 1]) ||
      (x < width - 1 && background[index + 1]) ||
      (y > 0 && background[index - width]) ||
      (y < height - 1 && background[index + width]);
    if (touchesBackground) edge[index] = 1;
  }

  const band = threshold * (1 + radius * 0.35);
  for (let index = 0; index < total; index++) {
    if (!edge[index]) continue;
    const p = index * 4;
    const d = distance({ r: data[p], g: data[p + 1], b: data[p + 2] }, key);
    // At the key colour → transparent; a full band away → opaque.
    const alpha = Math.max(0, Math.min(1, (d - threshold * 0.35) / Math.max(band - threshold * 0.35, 1)));
    data[p + 3] = Math.round(data[p + 3] * alpha);
  }
}

/**
 * Remove the key colour's contribution from semi-transparent pixels.
 * Without this a magenta key leaves a pink rim that is obvious the moment the
 * asset is placed on a dark surface.
 */
function despillEdges(data: Uint8ClampedArray, width: number, height: number, key: RGB): void {
  const total = width * height;
  const keyIsMagenta = key.r > 180 && key.b > 180 && key.g < 90;
  const keyIsGreen = key.g > 180 && key.r < 120 && key.b < 120;

  for (let index = 0; index < total; index++) {
    const p = index * 4;
    const alpha = data[p + 3];
    if (alpha === 0 || alpha === 255) continue;

    if (keyIsMagenta) {
      // Pull red and blue down toward green, which the key barely contains.
      const ceiling = data[p + 1] + 24;
      if (data[p] > ceiling) data[p] = ceiling;
      if (data[p + 2] > ceiling) data[p + 2] = ceiling;
    } else if (keyIsGreen) {
      const ceiling = Math.max(data[p], data[p + 2]) + 18;
      if (data[p + 1] > ceiling) data[p + 1] = ceiling;
    }
  }
}

function contentBounds(background: Uint8Array, data: Uint8ClampedArray, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < width * height; index++) {
    if (background[index] || data[index * 4 + 3] < 8) continue;
    const x = index % width;
    const y = (index / width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (maxX < 0) return { x: 0, y: 0, width, height };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode that image.'));
    img.src = src;
  });
}

/** Run the full pipeline. Browser-only — it needs a real 2D canvas. */
export interface MatteCore {
  keyColor: RGB;
  removedRatio: number;
  bounds: { x: number; y: number; width: number; height: number };
  warnings: string[];
}

/**
 * The whole pipeline over raw pixels, mutating `data` in place.
 * Separated from the canvas wrapper so it is testable without a DOM — a matte
 * that quietly eats the subject is the failure mode worth catching in CI.
 */
export function matteImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: MatteOptions = {},
): MatteCore {
  const warnings: string[] = [];
  const key = options.keyColor ?? detectKeyColor(data, width, height);
  const threshold = ((options.tolerance ?? 28) / 100) * 255 * 0.62;

  const background = floodFill(data, width, height, key, threshold);

  let removed = 0;
  for (let i = 0; i < background.length; i++) {
    if (background[i]) {
      data[i * 4 + 3] = 0;
      removed++;
    }
  }

  featherEdges(data, background, width, height, key, threshold, options.feather ?? 1.5);
  if (options.despill !== false) despillEdges(data, width, height, key);

  const removedRatio = removed / (width * height);
  if (removedRatio < 0.04) {
    warnings.push(
      'Almost nothing was removed. The background is probably not flat — raise the tolerance, or pick the background colour manually by tapping it.',
    );
  } else if (removedRatio > 0.97) {
    warnings.push('Nearly the whole image was removed. Lower the tolerance — the subject is too close in colour to the background.');
  }

  return { keyColor: key, removedRatio, bounds: contentBounds(background, data, width, height), warnings };
}

export async function removeBackground(source: string | HTMLImageElement, options: MatteOptions = {}): Promise<MatteResult> {
  const image = typeof source === 'string' ? await loadImage(source) : source;
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');

  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);

  const { keyColor: key, removedRatio, bounds, warnings } = matteImageData(imageData.data, width, height, options);
  ctx.putImageData(imageData, 0, 0);

  if (options.autoCrop !== false && bounds.width > 0 && bounds.width < width) {
    const pad = options.padding ?? 0;
    const cropped = document.createElement('canvas');
    cropped.width = bounds.width + pad * 2;
    cropped.height = bounds.height + pad * 2;
    const cropCtx = cropped.getContext('2d');
    if (cropCtx) {
      cropCtx.drawImage(canvas, bounds.x, bounds.y, bounds.width, bounds.height, pad, pad, bounds.width, bounds.height);
      return { canvas: cropped, keyColor: key, removedRatio, bounds, warnings };
    }
  }

  return { canvas, keyColor: key, removedRatio, bounds, warnings };
}

/** Sample the colour under a tap, for manual key selection. */
export function pickColorAt(canvas: HTMLCanvasElement, x: number, y: number): RGB | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const [r, g, b] = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
  return { r, g, b };
}

export function toHex({ r, g, b }: RGB): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

export function canvasToBytes(canvas: HTMLCanvasElement, type = 'image/png'): Uint8Array {
  const dataUrl = canvas.toDataURL(type);
  const binary = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Resize with a square canvas and `contain` fit, preserving alpha. */
export function resizeSquare(source: HTMLCanvasElement, size: number, inset = 0): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');
  if (!ctx) return out;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const usable = size * (1 - inset * 2);
  const scale = Math.min(usable / source.width, usable / source.height);
  const w = source.width * scale;
  const h = source.height * scale;
  ctx.drawImage(source, (size - w) / 2, (size - h) / 2, w, h);
  return out;
}
