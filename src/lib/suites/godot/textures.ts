/**
 * Real textures for a generated game.
 *
 * A generated game looked like flat coloured boxes, because that is what it
 * was. Geometry we can build in code; a *surface* we cannot — an asphalt road,
 * scuffed metal, worn gold — and flat colour is what makes even correct
 * geometry read as a placeholder.
 *
 * So the surfaces are generated. NVIDIA hosts FLUX and it answers in seconds,
 * which matters: a game wants a dozen textures and a generator that takes two
 * minutes each turns one build into half an hour.
 *
 * ── Why not TRELLIS for the meshes too ─────────────────────────────────────
 * Because it does not work. NVIDIA's hosted Microsoft TRELLIS is the only 3D
 * model they run, and its deployment currently fails every job — see
 * `trellis.ts` for the measurements. Textures are what NVIDIA can actually
 * give a game today, and a well-textured box beats an untextured mesh.
 *
 * Pure: prompts and plans in, no network. The caller does the fetching, so this
 * is testable and so a failed texture costs one surface rather than the build.
 */

/** A surface the game needs, and what it is for. */
export interface PlannedTexture {
  /** Path inside the project, e.g. `textures/road_0.jpg`. */
  path: string;
  /** What it covers, for the prompt and for the progress line. */
  subject: string;
  /**
   * `tiling` repeats across a large surface and must not show a seam or a
   * recognisable feature; `object` wraps one prop and may have structure.
   */
  kind: 'tiling' | 'object' | 'sky';
  /** Stable, so regenerating a project does not reshuffle every surface. */
  seed: number;
}

/** The look a stage is going for, in words a model can draw. */
export interface TextureTheme {
  /** Stage name, used only in messages. */
  name: string;
  /** e.g. "warm sunset city", "neon night district". */
  mood: string;
  /** What the ground is made of. */
  ground: string;
  /** What the side barriers are made of. */
  rail: string;
}

/**
 * Wording that decides whether a texture is usable.
 *
 * A tiling texture with a lamp post in it repeats that lamp post every four
 * metres, which is worse than flat colour because it reads as a bug rather
 * than as a style. The negatives are doing most of the work here.
 */
export function texturePrompt(texture: PlannedTexture, theme?: TextureTheme): string {
  const mood = theme ? `${theme.mood}, ` : '';

  if (texture.kind === 'tiling') {
    // "Even diffuse lighting, no shadows" on a pale subject — snow, ice, white
    // panelling — produced a flat white rectangle: technically correct, and it
    // renders as a blank sheet with the geometry invisible on top of it. The
    // detail words are load-bearing, not decoration.
    return (
      `Seamless tileable texture of ${texture.subject}. ${mood}` +
      'Top-down view, high surface detail, visible grain, cracks, scuffs and ' +
      'wear, strong local contrast between light and dark areas. ' +
      'No perspective, no horizon, no objects, no text, no watermark, ' +
      'fills the whole frame edge to edge, photorealistic macro material.'
    );
  }
  if (texture.kind === 'sky') {
    return (
      `Wide panoramic sky, ${texture.subject}. ${mood}` +
      'No ground, no buildings, no birds, no text, no watermark, ' +
      'smooth gradient, suitable as a game skybox.'
    );
  }
  return (
    `Game asset texture for ${texture.subject}. ${mood}` +
    'Flat lay, even lighting, no shadows, no background, no text, no watermark, ' +
    'clean readable material, photorealistic.'
  );
}

/** A stable seed from a path, so the same surface regenerates the same way. */
export function seedFor(path: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i += 1) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // NVIDIA rejects a seed at or above 2^32; keep it comfortably inside.
  return hash % 4_000_000_000;
}

/**
 * Every surface a runner needs, given its stages.
 *
 * Ground and rails are per stage because that is what makes a stage change
 * visible; the props are shared, because five sets of coins is five times the
 * wait and the download for something nobody looks at closely.
 */
export function plannedTextures(themes: TextureTheme[]): PlannedTexture[] {
  const out: PlannedTexture[] = [];

  themes.forEach((theme, i) => {
    for (const [slot, subject] of [['road', theme.ground], ['rail', theme.rail]] as const) {
      const path = `textures/${slot}_${i}.jpg`;
      out.push({ path, subject, kind: 'tiling', seed: seedFor(path) });
    }
  });

  const props: Array<[string, string, PlannedTexture['kind']]> = [
    ['textures/obstacle.jpg', 'a scuffed steel shipping container side, riveted panels', 'tiling'],
    ['textures/barrier.jpg', 'a red and white striped hazard barrier, worn paint', 'tiling'],
    ['textures/coin.jpg', 'a polished gold coin face, radial shine', 'object'],
    // The character is the thing on screen the whole time, so it is the last
    // surface anyone should leave flat.
    ['textures/hero_skin.jpg', 'weathered tan leather, fine grain', 'tiling'],
    ['textures/hero_cloth.jpg', 'blue technical sportswear fabric, woven weave', 'tiling'],
  ];
  for (const [path, subject, kind] of props) out.push({ path, subject, kind, seed: seedFor(path) });

  return out;
}

/** The five stages the runner template ships with. */
export const RUNNER_THEMES: TextureTheme[] = [
  { name: 'Sunset Yard', mood: 'warm golden sunset', ground: 'weathered grey asphalt', rail: 'rusted orange painted steel' },
  { name: 'Neon District', mood: 'neon magenta night', ground: 'wet dark city asphalt', rail: 'glowing magenta acrylic' },
  { name: 'Frost Line', mood: 'bright cold daylight', ground: 'packed snow and pale ice', rail: 'pale blue frosted steel' },
  { name: 'Ember Deep', mood: 'volcanic red glow', ground: 'cracked dark basalt with glowing embers', rail: 'molten orange hot metal' },
  { name: 'The Void', mood: 'deep black space', ground: 'matte black panelling with faint cyan seams', rail: 'glowing cyan light strip' },
];

/**
 * Godot's import settings for a texture used on a repeating surface.
 *
 * Written explicitly because Godot's default for an imported image does not
 * repeat: a tiling texture with repeat off stretches once across the whole
 * mesh, which looks like a low-resolution smear rather than a surface.
 */
export function importFile(path: string, tiling: boolean): string {
  const id = seedFor(path).toString(36);
  return `[remap]

importer="texture"
type="CompressedTexture2D"
uid="uid://c${id}"
path="res://.godot/imported/${path.split('/').pop()}-${id}.ctex"
metadata={
"vram_texture": false
}

[deps]

source_file="res://${path}"
dest_files=["res://.godot/imported/${path.split('/').pop()}-${id}.ctex"]

[params]

compress/mode=0
mipmaps/generate=true
process/fix_alpha_border=true
`;
}


/**
 * Whether a generated texture came back featureless.
 *
 * A flat texture is worse than no texture: the surface renders as a blank
 * sheet and the geometry standing on it disappears. JPEG size is a blunt but
 * honest proxy — an image with grain, cracks and wear does not compress to
 * nothing, and one that does had none of them.
 *
 * The threshold is per megapixel, so it does not silently change meaning when
 * the resolution does.
 */
export function looksFlat(bytes: number, width = 1024, height = 1024): boolean {
  const megapixels = (width * height) / 1_048_576;
  return bytes / Math.max(megapixels, 0.01) < 60_000;
}

/** A retry prompt for a surface that came back flat. */
export function insistOnDetail(texture: PlannedTexture, theme?: TextureTheme): string {
  return (
    `${texturePrompt(texture, theme)} ` +
    'Extreme close-up macro photography, heavy texture, deep crevices, ' +
    'pitted and irregular surface, dramatic contrast, never smooth, never plain.'
  );
}
