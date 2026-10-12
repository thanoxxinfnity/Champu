/**
 * Gradient fills. Linear and radial map to the browser's native CanvasGradient (render.ts uses that
 * directly — no reason to re-implement what the canvas already does well). A free-form *mesh* gradient —
 * a scatter of colour control points blended between — has no native canvas equivalent, so
 * `sampleMeshGradient` is a real, used, per-pixel function, not a decorative one.
 */

export interface GradientStop {
  offset: number; // 0..1
  color: string;
}
export interface LinearGradientFill {
  kind: 'linear';
  x0: number; y0: number; x1: number; y1: number;
  stops: GradientStop[];
}
export interface RadialGradientFill {
  kind: 'radial';
  cx: number; cy: number; r: number;
  stops: GradientStop[];
}
export interface MeshPoint {
  x: number; y: number; color: string;
}
export interface MeshGradientFill {
  kind: 'mesh';
  points: MeshPoint[];
}
export type GradientFill = LinearGradientFill | RadialGradientFill | MeshGradientFill;

function parseHex(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}
function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Inverse-distance-weighted blend of every control point's colour — closer points dominate, like a heat-map interpolation. */
export function sampleMeshGradient(mesh: MeshGradientFill, x: number, y: number, power = 2): string {
  if (mesh.points.length === 0) return '#000000';
  let wSum = 0, r = 0, g = 0, b = 0;
  for (const p of mesh.points) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < 1e-6) return p.color; // exactly on a control point
    const w = 1 / d ** power;
    const [pr, pg, pb] = parseHex(p.color);
    wSum += w; r += pr * w; g += pg * w; b += pb * w;
  }
  return toHex(r / wSum, g / wSum, b / wSum);
}

/** Render a mesh gradient into an RGBA buffer (used when baking it onto a layer — there's no live canvas equivalent to draw it lazily with). */
export function rasterizeMeshGradient(mesh: MeshGradientFill, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const hex = sampleMeshGradient(mesh, x, y);
      const [r, g, b] = parseHex(hex);
      const i = (y * width + x) * 4;
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
    }
  }
  return out;
}
