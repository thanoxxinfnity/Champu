/**
 * Blockbench / Bedrock geometry engine.
 *
 * Emits `1.16.0` geometry — the format Blockbench writes for "Bedrock Model" and
 * that Minecraft Bedrock loads directly. Cube UVs are packed into a single atlas
 * with a box-UV layout, which is what Bedrock expects for entity models.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Cube {
  /** Model-space origin: the cube's minimum corner. */
  origin: [number, number, number];
  size: [number, number, number];
  uv: [number, number];
  inflate?: number;
  mirror?: boolean;
  /** Degrees, applied about `pivot`. */
  rotation?: [number, number, number];
  pivot?: [number, number, number];
}

export interface Bone {
  name: string;
  parent?: string;
  pivot: [number, number, number];
  rotation?: [number, number, number];
  cubes?: Cube[];
  /** Hides the bone from the render without removing its children. */
  neverRender?: boolean;
  mirror?: boolean;
}

export interface Geometry {
  identifier: string;
  textureWidth: number;
  textureHeight: number;
  visibleBoundsWidth?: number;
  visibleBoundsHeight?: number;
  visibleBoundsOffset?: [number, number, number];
  bones: Bone[];
}

/** Serialise to a Bedrock `.geo.json`. */
export function toGeoJson(geo: Geometry): Record<string, unknown> {
  return {
    format_version: '1.16.0',
    'minecraft:geometry': [
      {
        description: {
          identifier: geo.identifier.startsWith('geometry.') ? geo.identifier : `geometry.${geo.identifier}`,
          texture_width: geo.textureWidth,
          texture_height: geo.textureHeight,
          visible_bounds_width: geo.visibleBoundsWidth ?? 3,
          visible_bounds_height: geo.visibleBoundsHeight ?? 3,
          visible_bounds_offset: geo.visibleBoundsOffset ?? [0, 1.5, 0],
        },
        bones: geo.bones.map((bone) => ({
          name: bone.name,
          ...(bone.parent ? { parent: bone.parent } : {}),
          pivot: bone.pivot,
          ...(bone.rotation ? { rotation: bone.rotation } : {}),
          ...(bone.mirror ? { mirror: true } : {}),
          ...(bone.neverRender ? { never_render: true } : {}),
          ...(bone.cubes?.length
            ? {
                cubes: bone.cubes.map((cube) => ({
                  origin: cube.origin,
                  size: cube.size,
                  uv: cube.uv,
                  ...(cube.inflate ? { inflate: cube.inflate } : {}),
                  ...(cube.mirror ? { mirror: true } : {}),
                  ...(cube.rotation ? { rotation: cube.rotation, pivot: cube.pivot ?? cube.origin } : {}),
                })),
              }
            : {}),
        })),
      },
    ],
  };
}

/** Blockbench project file (`.bbmodel`) so the model opens for hand-editing. */
export function toBBModel(geo: Geometry, name: string): Record<string, unknown> {
  let elementId = 0;
  const elements: Array<Record<string, unknown>> = [];
  const outliner: Array<Record<string, unknown>> = [];

  const byName = new Map<string, Record<string, unknown>>();

  for (const bone of geo.bones) {
    const children: string[] = [];
    for (const cube of bone.cubes ?? []) {
      const id = `el_${elementId++}`;
      elements.push({
        name: `${bone.name}_cube_${children.length}`,
        box_uv: true,
        rescale: false,
        locked: false,
        from: cube.origin,
        to: [cube.origin[0] + cube.size[0], cube.origin[1] + cube.size[1], cube.origin[2] + cube.size[2]],
        autouv: 0,
        color: elementId % 8,
        inflate: cube.inflate ?? 0,
        mirror_uv: cube.mirror ?? false,
        origin: cube.pivot ?? bone.pivot,
        rotation: cube.rotation ?? [0, 0, 0],
        uv_offset: cube.uv,
        faces: boxFaces(cube, geo),
        type: 'cube',
        uuid: id,
      });
      children.push(id);
    }

    const group = {
      name: bone.name,
      origin: bone.pivot,
      rotation: bone.rotation ?? [0, 0, 0],
      color: 0,
      uuid: `grp_${bone.name}`,
      export: true,
      mirror_uv: bone.mirror ?? false,
      isOpen: true,
      visibility: !bone.neverRender,
      children,
    };
    byName.set(bone.name, group);
  }

  // Nest child bones inside their parents so the Blockbench outliner matches.
  for (const bone of geo.bones) {
    const group = byName.get(bone.name)!;
    if (bone.parent && byName.has(bone.parent)) {
      (byName.get(bone.parent)!.children as unknown[]).push(group);
    } else {
      outliner.push(group);
    }
  }

  return {
    meta: {
      format_version: '4.5',
      model_format: 'bedrock',
      box_uv: true,
      creation_time: Math.floor(Date.now() / 1000),
    },
    name,
    model_identifier: geo.identifier.replace(/^geometry\./, ''),
    visible_box: [geo.visibleBoundsWidth ?? 3, geo.visibleBoundsHeight ?? 3, 0],
    resolution: { width: geo.textureWidth, height: geo.textureHeight },
    elements,
    outliner,
    textures: [],
  };
}

/**
 * Bedrock box-UV layout. For a cube of size (w, h, d) at atlas offset (u, v):
 *
 *        [d][w][d][w]      ← top row: down, up faces at x = u+d
 *   rows: v      → v+d     ← top/bottom
 *         v+d    → v+d+h   ← east, north, west, south
 */
function boxFaces(cube: Cube, geo: Geometry): Record<string, { uv: number[]; texture: number }> {
  const [w, h, d] = cube.size.map(Math.round);
  const [u, v] = cube.uv;
  const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max));
  const cw = (n: number) => clamp(n, geo.textureWidth);
  const ch = (n: number) => clamp(n, geo.textureHeight);

  return {
    north: { uv: [cw(u + d), ch(v + d), cw(u + d + w), ch(v + d + h)], texture: 0 },
    east: { uv: [cw(u), ch(v + d), cw(u + d), ch(v + d + h)], texture: 0 },
    south: { uv: [cw(u + d + w + d), ch(v + d), cw(u + d + w + d + w), ch(v + d + h)], texture: 0 },
    west: { uv: [cw(u + d + w), ch(v + d), cw(u + d + w + d), ch(v + d + h)], texture: 0 },
    up: { uv: [cw(u + d), ch(v), cw(u + d + w), ch(v + d)], texture: 0 },
    down: { uv: [cw(u + d + w), ch(v + d), cw(u + d + w + w), ch(v)], texture: 0 },
  };
}

/**
 * Auto-pack cube UVs into the atlas.
 * Bedrock box-UV needs each cube to occupy a (2d + 2w) × (d + h) rectangle; this
 * shelf-packs them left to right, wrapping to a new row when the width runs out.
 */
export function packUVs(bones: Bone[], textureWidth = 64): { bones: Bone[]; textureHeight: number } {
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  const packed = bones.map((bone) => ({
    ...bone,
    cubes: bone.cubes?.map((cube) => {
      const [w, h, d] = cube.size.map((n) => Math.max(1, Math.ceil(n)));
      const boxW = 2 * d + 2 * w;
      const boxH = d + h;

      if (cursorX + boxW > textureWidth) {
        cursorX = 0;
        cursorY += rowHeight;
        rowHeight = 0;
      }

      const uv: [number, number] = [cursorX, cursorY];
      cursorX += boxW;
      rowHeight = Math.max(rowHeight, boxH);

      return { ...cube, uv };
    }),
  }));

  // Bedrock wants power-of-two atlases.
  const needed = cursorY + rowHeight;
  const textureHeight = Math.max(32, 2 ** Math.ceil(Math.log2(Math.max(needed, 1))));
  return { bones: packed, textureHeight };
}

// ── Procedural starters ─────────────────────────────────────────────────────

/** A humanoid rig with the standard Bedrock bone names, so vanilla animations apply. */
export function humanoidGeometry(identifier: string): Geometry {
  const bones: Bone[] = [
    {
      name: 'body',
      pivot: [0, 24, 0],
      cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] }],
    },
    {
      name: 'head',
      parent: 'body',
      pivot: [0, 24, 0],
      cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] }],
    },
    {
      name: 'hat',
      parent: 'head',
      pivot: [0, 24, 0],
      cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [32, 0], inflate: 0.5 }],
    },
    { name: 'rightArm', parent: 'body', pivot: [-5, 22, 0], cubes: [{ origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 16] }] },
    { name: 'leftArm', parent: 'body', pivot: [5, 22, 0], mirror: true, cubes: [{ origin: [4, 12, -2], size: [4, 12, 4], uv: [40, 16], mirror: true }] },
    { name: 'rightLeg', parent: 'body', pivot: [-2, 12, 0], cubes: [{ origin: [-4, 0, -2], size: [4, 12, 4], uv: [0, 16] }] },
    { name: 'leftLeg', parent: 'body', pivot: [2, 12, 0], mirror: true, cubes: [{ origin: [0, 0, -2], size: [4, 12, 4], uv: [0, 16], mirror: true }] },
  ];

  // Bedrock animation controllers reference arm0/arm1/leg0/leg1 by convention.
  const aliases: Bone[] = [
    { name: 'arm0', parent: 'body', pivot: [-5, 22, 0], neverRender: true },
    { name: 'arm1', parent: 'body', pivot: [5, 22, 0], neverRender: true },
    { name: 'leg0', parent: 'body', pivot: [-2, 12, 0], neverRender: true },
    { name: 'leg1', parent: 'body', pivot: [2, 12, 0], neverRender: true },
  ];

  return {
    identifier: identifier.startsWith('geometry.') ? identifier : `geometry.${identifier}`,
    textureWidth: 64,
    textureHeight: 64,
    visibleBoundsWidth: 2,
    visibleBoundsHeight: 3,
    visibleBoundsOffset: [0, 1.5, 0],
    bones: [...bones, ...aliases],
  };
}

/** A quadruped rig (cow/pig topology). */
export function quadrupedGeometry(identifier: string): Geometry {
  return {
    identifier: identifier.startsWith('geometry.') ? identifier : `geometry.${identifier}`,
    textureWidth: 64,
    textureHeight: 32,
    visibleBoundsWidth: 2,
    visibleBoundsHeight: 2,
    visibleBoundsOffset: [0, 1, 0],
    bones: [
      { name: 'body', pivot: [0, 12, 0], rotation: [90, 0, 0], cubes: [{ origin: [-6, 7, -8], size: [12, 18, 10], uv: [18, 4] }] },
      { name: 'head', pivot: [0, 20, -6], cubes: [{ origin: [-4, 16, -14], size: [8, 8, 8], uv: [0, 0] }] },
      { name: 'leg0', pivot: [-3, 12, 7], cubes: [{ origin: [-5, 0, 5], size: [4, 12, 4], uv: [0, 16] }] },
      { name: 'leg1', pivot: [3, 12, 7], cubes: [{ origin: [1, 0, 5], size: [4, 12, 4], uv: [0, 16] }] },
      { name: 'leg2', pivot: [-3, 12, -6], cubes: [{ origin: [-5, 0, -7], size: [4, 12, 4], uv: [0, 16] }] },
      { name: 'leg3', pivot: [3, 12, -6], cubes: [{ origin: [1, 0, -7], size: [4, 12, 4], uv: [0, 16] }] },
    ],
  };
}

/** A single cube — the starting point for block-shaped entities. */
export function cubeGeometry(identifier: string, size: [number, number, number] = [16, 16, 16]): Geometry {
  const [w, h, d] = size;
  return {
    identifier: identifier.startsWith('geometry.') ? identifier : `geometry.${identifier}`,
    textureWidth: 2 * (w + d),
    textureHeight: h + d,
    bones: [
      {
        name: 'root',
        pivot: [0, 0, 0],
        cubes: [{ origin: [-w / 2, 0, -d / 2], size, uv: [0, 0] }],
      },
    ],
  };
}

// ── Texture template ────────────────────────────────────────────────────────

/**
 * Render a UV guide PNG for the geometry so the user has a correctly-laid-out
 * canvas to paint on instead of guessing the atlas packing.
 * Browser-only (uses OffscreenCanvas/canvas).
 */
export function textureTemplate(geo: Geometry): string | null {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = geo.textureWidth;
  canvas.height = geo.textureHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const palette = ['#3f4a5f', '#4a5f3f', '#5f4a3f', '#5f3f5a', '#3f5f5a', '#5f5a3f'];
  let colorIndex = 0;

  for (const bone of geo.bones) {
    for (const cube of bone.cubes ?? []) {
      const [w, h, d] = cube.size.map((n) => Math.max(1, Math.ceil(n)));
      const [u, v] = cube.uv;
      const color = palette[colorIndex++ % palette.length];

      // The six faces, in Bedrock box-UV order.
      const faces: Array<[number, number, number, number, string]> = [
        [u + d, v, w, d, 'up'],
        [u + d + w, v, w, d, 'down'],
        [u, v + d, d, h, 'E'],
        [u + d, v + d, w, h, 'N'],
        [u + d + w, v + d, d, h, 'W'],
        [u + d + w + d, v + d, w, h, 'S'],
      ];

      for (const [x, y, fw, fh, label] of faces) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, fw, fh);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, fw - 1, fh - 1);

        if (fw >= 6 && fh >= 6) {
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.font = '4px monospace';
          ctx.fillText(label, x + 1, y + 5);
        }
      }
    }
  }

  return canvas.toDataURL('image/png');
}

// ── Validation ──────────────────────────────────────────────────────────────

export function validateGeometry(geo: Geometry): string[] {
  const issues: string[] = [];
  const names = new Set<string>();

  if (!/^geometry\.[a-z0-9_.]+$/.test(geo.identifier)) {
    issues.push(`Identifier "${geo.identifier}" must match geometry.<lowercase_name>.`);
  }
  if (geo.textureWidth <= 0 || geo.textureHeight <= 0) {
    issues.push('Texture dimensions must be positive.');
  }

  for (const bone of geo.bones) {
    if (names.has(bone.name)) issues.push(`Duplicate bone name "${bone.name}".`);
    names.add(bone.name);

    for (const cube of bone.cubes ?? []) {
      const [w, h, d] = cube.size;
      const [u, v] = cube.uv;
      if (w <= 0 || h <= 0 || d <= 0) {
        issues.push(`Bone "${bone.name}" has a cube with a non-positive dimension.`);
      }
      if (u + 2 * (w + d) > geo.textureWidth || v + d + h > geo.textureHeight) {
        issues.push(
          `Bone "${bone.name}": cube UV at [${u}, ${v}] overflows the ${geo.textureWidth}×${geo.textureHeight} atlas. Re-pack the UVs.`,
        );
      }
    }
  }

  for (const bone of geo.bones) {
    if (bone.parent && !names.has(bone.parent)) {
      issues.push(`Bone "${bone.name}" references a missing parent "${bone.parent}".`);
    }
  }

  return issues;
}
