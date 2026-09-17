/**
 * Giving an untextured .glb real shading and a real material.
 *
 * Written for the shape a trimesh export actually has: one mesh, one
 * primitive, a POSITION accessor and an index accessor, and nothing else —
 * no NORMAL, no TEXCOORD_0, no material, no image. Godot still loads a file
 * like that, but it renders flat and grey: without normals every triangle
 * gets the same lighting regardless of its angle, and without a material or
 * UVs there is nowhere for a texture to go even if one existed.
 *
 * Three real steps, run in order:
 *
 *   1. Vertex normals, area-weighted from the faces that share each vertex —
 *      the same technique any 3D tool uses when asked to "recalculate
 *      normals", so lighting reads the shape instead of the raw triangles.
 *   2. UVs, by projecting each vertex onto whichever pair of axes its own
 *      normal is *not* aligned with — the "box mapping" every 3D package
 *      offers as a one-click unwrap. It seams visibly where a surface curves
 *      across the boundary between two dominant axes, which is the known
 *      trade-off of box mapping and not a bug; a clean unwrap needs a real
 *      UV-packing algorithm (xatlas and friends) that has no reason to exist
 *      in this codebase yet.
 *   3. A material texture: fetched from a keyless image generator when the
 *      network is reachable, or synthesised in code when it is not. Either
 *      way every model gets a real image rather than staying grey — the same
 *      floor-and-ceiling shape as model generation itself (`buildLocally`
 *      under Meshy/Tripo/Kaggle/TRELLIS).
 *
 * Pure geometry and pure image bytes throughout; the network call is the one
 * function that is not, and it is the one this file's tests skip when there
 * is nothing to reach.
 */

import { ARRAY_BUFFER, assembleGlb, BinaryBuilder, ELEMENT_ARRAY_BUFFER, FLOAT, minMax, UNSIGNED_INT } from './glb.ts';

// ── Reading a plain trimesh-shaped .glb ─────────────────────────────────────

export interface ParsedMesh {
  /** Flat [x0,y0,z0, x1,y1,z1, ...]. */
  positions: Float32Array;
  /** Triangle corners, three per face, indexing into `positions`. */
  indices: Uint32Array;
}

const MAGIC = 0x46546c67; // "glTF"

/**
 * Reads POSITION and the index buffer out of the simplest possible .glb: one
 * buffer, one mesh, one primitive. That is deliberately not "every glTF file"
 * — Chomugiri's own `buildGlb` writes several meshes and JOINTS_0/WEIGHTS_0,
 * and reading those back is a different job with different guarantees. This
 * one exists to undo exactly what a bare trimesh export leaves out.
 */
export function parseTrimeshGlb(bytes: Uint8Array): ParsedMesh {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== MAGIC) {
    throw new Error('Not a .glb file (bad magic).');
  }
  const jsonLength = view.getUint32(12, true);
  const jsonText = new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength));
  const doc = JSON.parse(jsonText) as {
    meshes?: Array<{ primitives?: Array<{ attributes: Record<string, number>; indices?: number }> }>;
    accessors?: Array<{ bufferView: number; componentType: number; count: number; byteOffset?: number }>;
    bufferViews?: Array<{ byteOffset?: number; byteLength: number }>;
  };

  const binStart = 20 + jsonLength + 8; // JSON chunk header + JSON chunk + BIN chunk header
  const bin = bytes.subarray(binStart);

  const prim = doc.meshes?.[0]?.primitives?.[0];
  if (!prim) throw new Error('The .glb has no mesh primitive to read.');
  const posIndex = prim.attributes.POSITION;
  if (posIndex === undefined) throw new Error('The primitive has no POSITION attribute.');
  if (prim.indices === undefined) throw new Error('The primitive is not indexed.');

  const readFloats = (accessorIndex: number): Float32Array => {
    const acc = doc.accessors![accessorIndex];
    const view2 = doc.bufferViews![acc.bufferView];
    if (acc.componentType !== FLOAT) throw new Error(`Accessor ${accessorIndex} is not FLOAT.`);
    const start = (view2.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    // A copy, not a view over `bin`: `bin` is itself a subarray of `bytes`, and
    // the caller is free to let `bytes` go — a view would keep the whole file
    // alive for one mesh's worth of positions.
    return new Float32Array(bin.buffer, bin.byteOffset + start, acc.count * 3).slice();
  };

  const readIndices = (accessorIndex: number): Uint32Array => {
    const acc = doc.accessors![accessorIndex];
    const view2 = doc.bufferViews![acc.bufferView];
    const start = (view2.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    if (acc.componentType === UNSIGNED_INT) {
      return new Uint32Array(bin.buffer, bin.byteOffset + start, acc.count).slice();
    }
    if (acc.componentType === 5123 /* UNSIGNED_SHORT */) {
      return Uint32Array.from(new Uint16Array(bin.buffer, bin.byteOffset + start, acc.count));
    }
    if (acc.componentType === 5121 /* UNSIGNED_BYTE */) {
      return Uint32Array.from(new Uint8Array(bin.buffer, bin.byteOffset + start, acc.count));
    }
    throw new Error(`Index accessor ${accessorIndex} has an unsupported componentType ${acc.componentType}.`);
  };

  return { positions: readFloats(posIndex), indices: readIndices(prim.indices) };
}

// ── Normals ──────────────────────────────────────────────────────────────

/**
 * Area-weighted vertex normals.
 *
 * Each face contributes `cross(e1, e2)` — not normalised — to every vertex it
 * touches, so a large triangle pulls harder on the shared normal than a
 * sliver does. That is what "recalculate normals" means in any 3D tool; a
 * plain average of unit face normals would let a hundred tiny triangles
 * outvote the one big one that actually describes the surface.
 */
export function computeVertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  const ex = new Float64Array(3);
  const ey = new Float64Array(3);
  const n = new Float64Array(3);

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;

    ex[0] = positions[b] - positions[a]; ex[1] = positions[b + 1] - positions[a + 1]; ex[2] = positions[b + 2] - positions[a + 2];
    ey[0] = positions[c] - positions[a]; ey[1] = positions[c + 1] - positions[a + 1]; ey[2] = positions[c + 2] - positions[a + 2];

    n[0] = ex[1] * ey[2] - ex[2] * ey[1];
    n[1] = ex[2] * ey[0] - ex[0] * ey[2];
    n[2] = ex[0] * ey[1] - ex[1] * ey[0];

    normals[a] += n[0]; normals[a + 1] += n[1]; normals[a + 2] += n[2];
    normals[b] += n[0]; normals[b + 1] += n[1]; normals[b + 2] += n[2];
    normals[c] += n[0]; normals[c + 1] += n[1]; normals[c + 2] += n[2];
  }

  for (let v = 0; v < normals.length; v += 3) {
    const len = Math.hypot(normals[v], normals[v + 1], normals[v + 2]);
    if (len > 1e-12) {
      normals[v] /= len; normals[v + 1] /= len; normals[v + 2] /= len;
    } else {
      // An isolated or degenerate vertex touches no face with any area. It
      // gets an arbitrary but valid unit normal rather than NaN.
      normals[v] = 0; normals[v + 1] = 1; normals[v + 2] = 0;
    }
  }
  return normals;
}

// ── UVs (box / triplanar projection) ────────────────────────────────────

/**
 * One UV per vertex, box-projected from its own normal.
 *
 * For each vertex, the axis its normal points most strongly along is the one
 * *not* used for the projection — a wall facing +Z is flattest when looked at
 * along Z, so it is drawn from its X and Y coordinates. The other two axes are
 * normalised against the mesh's own bounding box, so the texture covers the
 * model once rather than being a speck in the corner of a UV tile sized for
 * something a thousand times smaller.
 *
 * This seams at the boundary between two dominant axes — a shoulder that
 * curves from a +Y-facing top into a +X-facing side gets two different UVs on
 * either side of that curve, because it is two different vertices in an
 * indexed mesh and each only has one normal to decide from. That is what box
 * mapping costs; avoiding it needs a UV *unwrap*, which repacks the mesh into
 * charts and is a different, considerably larger algorithm.
 */
export function computeBoxUvs(positions: Float32Array, normals: Float32Array): Float32Array {
  const uvs = new Float32Array((positions.length / 3) * 2);
  const bounds = minMax(Array.from(positions), 3);
  const size = bounds.max.map((m, i) => Math.max(m - bounds.min[i], 1e-6));

  for (let v = 0; v < positions.length / 3; v += 1) {
    const p = v * 3;
    const x = positions[p], y = positions[p + 1], z = positions[p + 2];
    const nx = Math.abs(normals[p]), ny = Math.abs(normals[p + 1]), nz = Math.abs(normals[p + 2]);

    let u: number, w: number;
    if (nx >= ny && nx >= nz) {
      // Dominant axis X: project onto Z, Y.
      u = (z - bounds.min[2]) / size[2];
      w = (y - bounds.min[1]) / size[1];
    } else if (ny >= nx && ny >= nz) {
      // Dominant axis Y: project onto X, Z.
      u = (x - bounds.min[0]) / size[0];
      w = (z - bounds.min[2]) / size[2];
    } else {
      // Dominant axis Z: project onto X, Y.
      u = (x - bounds.min[0]) / size[0];
      w = (y - bounds.min[1]) / size[1];
    }
    uvs[v * 2] = u;
    uvs[v * 2 + 1] = w;
  }
  return uvs;
}

// ── A minimal PNG encoder, for the texture that needs no network ───────────

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  new TextEncoder().encodeInto(type, body);
  body.set(data, 4);
  const out = new Uint8Array(4 + body.length + 4);
  new DataView(out.buffer).setUint32(0, data.length, false);
  out.set(body, 4);
  new DataView(out.buffer).setUint32(4 + body.length, crc32(body), false);
  return out;
}

/**
 * The 8-byte-signature, three-chunk PNG that every decoder accepts: IHDR,
 * one IDAT holding every scanline (each prefixed with filter type 0, "none"),
 * IEND. No dependency beyond `zlib`, which already ships with Node and
 * produces the zlib-wrapped deflate stream IDAT requires — so there is no
 * Adler32 or deflate implementation to get subtly wrong here.
 */
export async function encodePng(width: number, height: number, rgb: Uint8Array): Promise<Uint8Array> {
  if (rgb.length !== width * height * 3) throw new Error('rgb buffer does not match width*height*3.');
  const { deflateSync } = await import('node:zlib');

  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter: none
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), rowStart + 1);
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour, no alpha
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ── The procedural fallback texture ─────────────────────────────────────

/** Deterministic 0..1 pseudo-random from an integer seed — same input, same output, so a texture is reproducible without storing it. */
function hash01(seed: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Cheap 2D value noise: bilinear interpolation between a lattice of hashed values. Not Perlin — no gradients, so it has a faint grid bias at low frequency — but it is a few lines and needs no library. */
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const at = (ix: number, iy: number) => hash01(seed + ix * 374761393 + iy * 668265263);
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * A material colour guessed from the model's own name.
 *
 * A short list of keywords rather than one colour per model, because the 40
 * names in one downloaded pack already sort into a handful of materials —
 * flesh, wood, metal, stone, foliage — and guessing from the name is the only
 * signal available for a file that carries no other metadata.
 */
const PALETTE: Array<{ match: RegExp; rgb: [number, number, number] }> = [
  { match: /zombie|ghoul|skeleton|crawler|screamer|bloated|corpse|walker|doll/i, rgb: [126, 138, 104] },
  { match: /wood|crate|pallet|fence|barricade|shack|coffin|scarecrow/i, rgb: [107, 78, 52] },
  { match: /metal|barrel|chainsaw|cage|hook|jeep|car/i, rgb: [96, 101, 108] },
  { match: /brick|house/i, rgb: [128, 70, 56] },
  { match: /stone|boulder|headstone|altar|gate/i, rgb: [110, 108, 102] },
  { match: /tree|candle|lantern|crow/i, rgb: [61, 74, 48] },
];

function baseColorFor(name: string): [number, number, number] {
  return PALETTE.find((p) => p.match.test(name))?.rgb ?? [120, 112, 100];
}

/**
 * A material texture that needs no network: a base colour guessed from the
 * model's name, broken up with two octaves of value noise so it reads as a
 * surface rather than a flat swatch.
 *
 * This is the floor, not the ceiling — a generated photograph of the actual
 * material looks considerably better and is what `generateModelTexture`
 * reaches for first. This exists so a network failure costs texture quality,
 * not the texture.
 */
export async function proceduralMaterialTexture(name: string, size = 512): Promise<Uint8Array> {
  const [r, g, b] = baseColorFor(name);
  const rgb = new Uint8Array(size * size * 3);
  const seed = Array.from(name).reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const n1 = valueNoise(x / 24, y / 24, seed);
      const n2 = valueNoise(x / 6, y / 6, seed ^ 0x5bd1e995);
      // 0.75..1.15 around 1.0: enough variation to break up flatness without
      // drifting the colour into something the name no longer describes.
      const shade = 0.75 + n1 * 0.28 + n2 * 0.12;
      const i = (y * size + x) * 3;
      rgb[i] = Math.min(255, Math.round(r * shade));
      rgb[i + 1] = Math.min(255, Math.round(g * shade));
      rgb[i + 2] = Math.min(255, Math.round(b * shade));
    }
  }
  return encodePng(size, size, rgb);
}

/**
 * What kind of image bytes actually are, read off the bytes rather than
 * trusted from a header. A `Content-Type` can be missing, generic, or simply
 * wrong; the first few bytes of the file cannot be.
 */
function sniffImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  throw new Error('Response bytes are neither a PNG nor a JPEG.');
}

/**
 * The real texture: a photo-ish material image from a keyless generator.
 *
 * Pollinations needs no key, which matters here specifically: retexturing a
 * downloaded pack is not gated behind whether the user pasted a paid key, the
 * same reasoning `buildLocally` and the reference-image step of the Kaggle
 * path already follow. Falls back to the procedural texture on any failure —
 * a timeout, a non-200, a body that is not image bytes — rather than leaving
 * the model untextured or throwing partway through a batch of forty.
 */
export async function generateModelTexture(
  name: string,
  options: { size?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ bytes: Uint8Array; source: 'pollinations' | 'procedural'; mimeType: 'image/png' | 'image/jpeg' }> {
  const size = options.size ?? 768;
  const prompt = `${name.replace(/_/g, ' ')}, seamless material texture, video game asset, no text, no watermark`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${size}&height=${size}&nologo=true&seed=${hashSeed(name)}`;

  const timer = new AbortController();
  const timeout = setTimeout(() => timer.abort(), options.timeoutMs ?? 45_000);
  const onAbort = () => timer.abort();
  options.signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { signal: timer.signal });
    if (!res.ok) throw new Error(`Pollinations answered ${res.status}.`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A real image is thousands of bytes; anything smaller is an error page
    // Pollinations served with a 200 status, which has happened before.
    if (bytes.byteLength < 2048) throw new Error('The response was too small to be an image.');
    // Pollinations serves JPEG regardless of what the URL asks for — sniffed
    // rather than assumed, because a .glb whose `images[].mimeType` disagrees
    // with the actual bytes fails to import in Godot with no useful error
    // ("Image index '0' couldn't be loaded"), which is exactly what shipping
    // JPEG bytes labelled image/png did the first time this ran for real.
    const mimeType = sniffImageMime(bytes);
    return { bytes, source: 'pollinations', mimeType };
  } catch {
    return { bytes: await proceduralMaterialTexture(name, size), source: 'procedural', mimeType: 'image/png' };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

function hashSeed(name: string): number {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 1_000_000;
}

// ── Writing the retextured .glb ─────────────────────────────────────────

export interface RetextureOptions {
  name?: string;
  /** The base colour map's encoded bytes. */
  imageBytes: Uint8Array;
  /**
   * What `imageBytes` actually is. Must match the real bytes, not a
   * convenient default — glTF viewers decode strictly by this field, and
   * JPEG bytes labelled image/png fail to import with an error that names
   * neither the mismatch nor which of the two is wrong.
   */
  imageMimeType: 'image/png' | 'image/jpeg';
}

/**
 * Rebuilds a trimesh-shaped .glb with NORMAL, TEXCOORD_0, a material and its
 * image — everything the source file was missing. The geometry itself
 * (positions, winding, indices) is untouched.
 */
export function retexturedGlb(
  positions: Float32Array,
  indices: Uint32Array,
  normals: Float32Array,
  uvs: Float32Array,
  options: RetextureOptions,
): Uint8Array {
  const vertexCount = positions.length / 3;
  if (normals.length !== positions.length) throw new Error('normals must have one Vector3 per vertex.');
  if (uvs.length !== vertexCount * 2) throw new Error('uvs must have one Vector2 per vertex.');

  const bin = new BinaryBuilder();
  const positionView = bin.add(positions, ARRAY_BUFFER);
  const normalView = bin.add(normals, ARRAY_BUFFER);
  const uvView = bin.add(uvs, ARRAY_BUFFER);
  // UNSIGNED_INT unconditionally: these meshes routinely pass the 65,535
  // vertices UNSIGNED_SHORT can address (the zombie above is 455,304), and a
  // retexture step is the wrong place to also be deciding whether to split
  // the mesh into UNSIGNED_SHORT-sized pieces.
  const indexView = bin.add(indices, ELEMENT_ARRAY_BUFFER);
  const imageView = bin.add(options.imageBytes);

  const bounds = minMax(Array.from(positions), 3);

  const accessors: Record<string, unknown>[] = [
    { bufferView: positionView, componentType: FLOAT, count: vertexCount, type: 'VEC3', min: bounds.min, max: bounds.max },
    { bufferView: normalView, componentType: FLOAT, count: vertexCount, type: 'VEC3' },
    { bufferView: uvView, componentType: FLOAT, count: vertexCount, type: 'VEC2' },
    { bufferView: indexView, componentType: UNSIGNED_INT, count: indices.length, type: 'SCALAR' },
  ];

  const gltf = {
    asset: { version: '2.0', generator: 'Chomugiri' },
    scene: 0,
    scenes: [{ name: options.name ?? 'Scene', nodes: [0] }],
    nodes: [{ name: options.name ?? 'model', mesh: 0 }],
    meshes: [{
      name: options.name ?? 'model',
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
        indices: 3,
        material: 0,
      }],
    }],
    materials: [{
      name: `${options.name ?? 'model'}_mat`,
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.02, roughnessFactor: 0.85 },
    }],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ bufferView: imageView, mimeType: options.imageMimeType }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    accessors,
    bufferViews: bin.views,
    buffers: [{ byteLength: bin.byteLength }],
  };

  return assembleGlb(gltf, bin);
}

/**
 * The whole job, for one file: read it, light it, unwrap it, texture it.
 */
export async function retextureGlbFile(
  bytes: Uint8Array,
  name: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ glb: Uint8Array; textureSource: 'pollinations' | 'procedural' }> {
  const { positions, indices } = parseTrimeshGlb(bytes);
  const normals = computeVertexNormals(positions, indices);
  const uvs = computeBoxUvs(positions, normals);
  const texture = await generateModelTexture(name, { timeoutMs: options.timeoutMs, signal: options.signal });
  const glb = retexturedGlb(positions, indices, normals, uvs, {
    name, imageBytes: texture.bytes, imageMimeType: texture.mimeType,
  });
  return { glb, textureSource: texture.source };
}
