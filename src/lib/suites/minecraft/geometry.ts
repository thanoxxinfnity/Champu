/**
 * Building real Bedrock geometry.
 *
 * Entities were shipping without models: the pack named a geometry and no
 * .geo.json defined it, so the mob imported and then drew nothing. Asking the
 * language model to write geometry by hand does not fix that reliably — the
 * format has several ways to be silently wrong (an origin read as a centre, a
 * pivot left at 0,0,0 so a limb rotates about the world origin, UVs off the
 * texture) and every one of them produces a model that parses and renders
 * incorrectly.
 *
 * So the model describes *parts*, and this compiles them. A part is a box with
 * a size and a place to put it; everything the format is fussy about — the
 * origin corner, pivot placement, UV packing, bone parenting — is derived here
 * where it can be tested.
 *
 * Units are Minecraft's: 1 unit is one pixel of texture, and a full block is 16.
 */

export interface PartSpec {
  /** Bone name. Unique within the model. */
  name: string;
  /** Box size in units: [width (x), height (y), depth (z)]. */
  size: [number, number, number];
  /**
   * Where the box sits, as the centre of its footprint and its base height:
   * [x, y, z] with y measured from the ground. Far easier to describe than a
   * minimum corner, and converted to one below.
   */
  at: [number, number, number];
  /** Bone this part hangs from, so the two move together. */
  parent?: string;
  /**
   * Where the part rotates about. Defaults to the top centre of the box, which
   * is right for a limb hanging from a body — the common case, and the one that
   * looks most obviously broken when it is wrong.
   */
  pivot?: [number, number, number];
  /** Grows the box evenly without moving it. Used for hats, fur, armour. */
  inflate?: number;
  /** Renders both faces. Needed for flat parts like wings or leaves. */
  twoSided?: boolean;
}

export interface ModelSpec {
  identifier: string;
  textureWidth?: number;
  textureHeight?: number;
  parts: PartSpec[];
}

export interface Cube {
  origin: [number, number, number];
  size: [number, number, number];
  uv: [number, number];
  inflate?: number;
  mirror?: boolean;
}

export interface Bone {
  name: string;
  parent?: string;
  pivot: [number, number, number];
  cubes?: Cube[];
}

export interface Geometry {
  format_version: string;
  'minecraft:geometry': Array<{
    description: {
      identifier: string;
      texture_width: number;
      texture_height: number;
      visible_bounds_width: number;
      visible_bounds_height: number;
      visible_bounds_offset: [number, number, number];
    };
    bones: Bone[];
  }>;
}

/**
 * A box's unwrapped footprint on the texture.
 *
 * Minecraft lays a cube out as a cross: the width of the strip is
 * 2*(depth+width) and its height is depth+height. Getting this wrong is what
 * makes a model sample the wrong part of its texture.
 */
export function uvFootprint(size: [number, number, number]): { w: number; h: number } {
  const [x, y, z] = size;
  return { w: 2 * (z + x), h: z + y };
}

/**
 * Packs every part's UV island into the texture without overlap.
 *
 * A shelf packer, not a perfect one: it fills a row until the next island will
 * not fit, then starts a new row. Overlapping islands are the failure that
 * matters — two parts sharing pixels means painting one repaints the other —
 * and a shelf packer cannot produce them.
 */
export function packUVs(parts: PartSpec[], textureWidth: number): { uvs: Array<[number, number]>; height: number } {
  const uvs: Array<[number, number]> = [];
  let cursorX = 0;
  let rowY = 0;
  let rowHeight = 0;

  for (const part of parts) {
    const { w, h } = uvFootprint(part.size);

    if (cursorX + w > textureWidth && cursorX > 0) {
      rowY += rowHeight;
      cursorX = 0;
      rowHeight = 0;
    }

    uvs.push([cursorX, rowY]);
    cursorX += w;
    rowHeight = Math.max(rowHeight, h);
  }

  return { uvs, height: rowY + rowHeight };
}

/** The next power of two at or above n, with a sensible floor. */
function texturePow2(n: number, min = 16): number {
  let size = min;
  while (size < n) size *= 2;
  return size;
}

/**
 * The minimum corner of a box described by its footprint centre and base.
 *
 * `origin` in Bedrock is the corner with the smallest coordinate on every axis,
 * not the centre — the single most common mistake in hand-written geometry, and
 * one that puts the model half a body-width off with no error anywhere.
 */
export function originOf(part: PartSpec): [number, number, number] {
  const [w, , d] = part.size;
  const [cx, baseY, cz] = part.at;
  return [cx - w / 2, baseY, cz - d / 2];
}

/** Top centre of the box: where a limb hanging from a body should rotate. */
export function defaultPivot(part: PartSpec): [number, number, number] {
  const [, h] = part.size;
  const [cx, baseY, cz] = part.at;
  return [cx, baseY + h, cz];
}

/** Compiles a described model into geometry Minecraft and Blockbench both read. */
export function buildGeometry(spec: ModelSpec): Geometry {
  if (!spec.parts.length) {
    throw new Error('A model needs at least one part; an empty geometry renders nothing.');
  }

  const names = new Set<string>();
  for (const part of spec.parts) {
    if (names.has(part.name)) throw new Error(`Two parts are both called "${part.name}"; bone names must be unique.`);
    names.add(part.name);
  }
  for (const part of spec.parts) {
    if (part.parent && !names.has(part.parent)) {
      throw new Error(`Part "${part.name}" hangs from "${part.parent}", which does not exist.`);
    }
  }

  const width = spec.textureWidth ?? texturePow2(Math.max(...spec.parts.map((p) => uvFootprint(p.size).w)), 64);
  const packed = packUVs(spec.parts, width);
  const height = spec.textureHeight ?? texturePow2(packed.height);

  const bones: Bone[] = spec.parts.map((part, i) => ({
    name: part.name,
    ...(part.parent ? { parent: part.parent } : {}),
    pivot: part.pivot ?? defaultPivot(part),
    cubes: [
      {
        origin: originOf(part),
        size: part.size,
        uv: packed.uvs[i],
        ...(part.inflate ? { inflate: part.inflate } : {}),
        ...(part.twoSided ? { mirror: true } : {}),
      },
    ],
  }));

  // The bounds tell the renderer when the mob is off-screen. Too small and it
  // pops out of view while still visible.
  const maxY = Math.max(...spec.parts.map((p) => p.at[1] + p.size[1]));
  const maxXZ = Math.max(...spec.parts.flatMap((p) => [Math.abs(p.at[0]) + p.size[0] / 2, Math.abs(p.at[2]) + p.size[2] / 2]));

  return {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: {
          identifier: spec.identifier,
          texture_width: width,
          texture_height: height,
          visible_bounds_width: Math.max(1, Math.ceil((maxXZ * 2) / 16) + 1),
          visible_bounds_height: Math.max(1, Math.ceil(maxY / 16) + 1),
          visible_bounds_offset: [0, Math.round(maxY / 32) || 1, 0],
        },
        bones,
      },
    ],
  };
}

/**
 * Stock body plans.
 *
 * Most requests are "a creature shaped roughly like X". Starting from a plan
 * that already has its pivots in the right places produces something that
 * animates correctly, which a pile of free-floating boxes does not.
 */
export type BodyPlan = 'biped' | 'quadruped' | 'blob' | 'flying';

export function bodyPlan(plan: BodyPlan, scale = 1): PartSpec[] {
  const u = (n: number) => Math.max(1, Math.round(n * scale));

  switch (plan) {
    case 'biped':
      return [
        { name: 'body', size: [u(8), u(12), u(4)], at: [0, u(12), 0] },
        { name: 'head', size: [u(8), u(8), u(8)], at: [0, u(24), 0], parent: 'body', pivot: [0, u(24), 0] },
        { name: 'leftArm', size: [u(4), u(12), u(4)], at: [u(6), u(12), 0], parent: 'body', pivot: [u(5), u(22), 0] },
        { name: 'rightArm', size: [u(4), u(12), u(4)], at: [-u(6), u(12), 0], parent: 'body', pivot: [-u(5), u(22), 0] },
        { name: 'leftLeg', size: [u(4), u(12), u(4)], at: [u(2), 0, 0], parent: 'body', pivot: [u(2), u(12), 0] },
        { name: 'rightLeg', size: [u(4), u(12), u(4)], at: [-u(2), 0, 0], parent: 'body', pivot: [-u(2), u(12), 0] },
      ];

    case 'quadruped':
      return [
        { name: 'body', size: [u(10), u(10), u(16)], at: [0, u(10), 0] },
        { name: 'head', size: [u(8), u(8), u(8)], at: [0, u(12), -u(10)], parent: 'body', pivot: [0, u(16), -u(8)] },
        { name: 'legFrontLeft', size: [u(4), u(10), u(4)], at: [u(3), 0, -u(6)], parent: 'body', pivot: [u(3), u(10), -u(6)] },
        { name: 'legFrontRight', size: [u(4), u(10), u(4)], at: [-u(3), 0, -u(6)], parent: 'body', pivot: [-u(3), u(10), -u(6)] },
        { name: 'legBackLeft', size: [u(4), u(10), u(4)], at: [u(3), 0, u(6)], parent: 'body', pivot: [u(3), u(10), u(6)] },
        { name: 'legBackRight', size: [u(4), u(10), u(4)], at: [-u(3), 0, u(6)], parent: 'body', pivot: [-u(3), u(10), u(6)] },
      ];

    case 'flying':
      return [
        { name: 'body', size: [u(6), u(6), u(8)], at: [0, u(8), 0] },
        { name: 'head', size: [u(6), u(6), u(6)], at: [0, u(14), -u(4)], parent: 'body', pivot: [0, u(14), -u(2)] },
        { name: 'leftWing', size: [u(10), u(1), u(8)], at: [u(8), u(11), 0], parent: 'body', pivot: [u(3), u(11), 0], twoSided: true },
        { name: 'rightWing', size: [u(10), u(1), u(8)], at: [-u(8), u(11), 0], parent: 'body', pivot: [-u(3), u(11), 0], twoSided: true },
      ];

    case 'blob':
    default:
      return [
        { name: 'body', size: [u(8), u(8), u(8)], at: [0, 0, 0] },
        { name: 'eyeLine', size: [u(8), u(2), u(1)], at: [0, u(5), -u(4)], parent: 'body', pivot: [0, u(5), -u(4)], inflate: 0.01 },
      ];
  }
}

/**
 * Picks a body plan from how the creature was described.
 *
 * A guess, and a cheap one — but a wrong plan produces a model that is merely
 * the wrong shape, which the user can open in Blockbench and fix. No model at
 * all produces an invisible mob, which they cannot fix without knowing the
 * format. The trade is worth it.
 */
export function inferPlan(description: string): BodyPlan {
  const text = description.toLowerCase();

  if (/\b(bird|bat|wing|fly|flying|moth|dragonfly|fairy|angel|butterfly)\b/.test(text)) return 'flying';
  if (/\b(wolf|dog|cat|horse|cow|pig|sheep|deer|fox|bear|beast|quadruped|lizard|crawl)\b/.test(text)) return 'quadruped';
  if (/\b(slime|blob|cube|orb|ball|gel|ooze|crystal|golem block|floating)\b/.test(text)) return 'blob';
  // Humanoid is the safest default: most custom mobs are people-shaped, and a
  // biped rig animates acceptably even when the shape is not quite right.
  return 'biped';
}

/** A geometry identifier the entity's client file will match. */
export function geometryIdentifier(entityIdentifier: string): string {
  const bare = entityIdentifier.replace(/^[a-z0-9_]+:/i, '').replace(/[^a-z0-9_]+/gi, '_');
  const namespace = entityIdentifier.includes(':') ? entityIdentifier.split(':')[0] : 'chomu';
  return `geometry.${namespace}.${bare}`;
}
