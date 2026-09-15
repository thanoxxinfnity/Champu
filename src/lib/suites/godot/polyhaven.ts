/**
 * Poly Haven: real props, CC0, no key at all.
 *
 * The arena was made of boxes because boxes are what code can draw. Poly Haven
 * has a few hundred scanned and modelled props under CC0 — barrels, crates,
 * furniture, machinery — with real textures, and its API needs no credential of
 * any kind. For everything that is not a character, that beats both generating
 * one and drawing a cube.
 *
 * ── The shape of a download ─────────────────────────────────────────────────
 *
 * Measured on 2026-09-15. Unlike Sketchfab there is no single-file .glb: an
 * asset is a `.gltf` plus a `.bin` plus its textures, and the API hands back an
 * `include` map whose **keys are the paths those files must be written to**,
 * relative to the .gltf. Godot imports that directly, as long as the layout is
 * preserved — so the keys are used verbatim rather than being flattened, which
 * is what would silently drop every texture.
 *
 * ── Licensing ───────────────────────────────────────────────────────────────
 *
 * Everything on Poly Haven is CC0: no attribution is required and there is
 * nothing to comply with. Credit is written anyway, because the people who
 * scanned these deserve it and it costs one line in a file.
 */

export const POLYHAVEN_API = 'https://api.polyhaven.com';

/** 1k is the right default: a 4k texture set is tens of megabytes per prop. */
export type Resolution = '1k' | '2k' | '4k';

export interface PolyHavenAsset {
  id: string;
  name: string;
  /** Who made it, for the credit line CC0 does not demand. */
  authors: string[];
  categories: string[];
  tags: string[];
  /** Triangles. A phone will not thank you for a 30,000-poly coffee cart. */
  polycount: number;
  thumbnail: string;
}

export interface AssetFile {
  /** Where it goes, relative to the project — the API's own key, unflattened. */
  path: string;
  bytes: Uint8Array;
}

/** Reads one entry of the assets index, which is keyed by id rather than a list. */
export function assetFrom(id: string, raw: unknown): PolyHavenAsset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string') return null;
  return {
    id,
    name: r.name,
    authors: Object.keys((r.authors as Record<string, string>) ?? {}),
    categories: Array.isArray(r.categories) ? (r.categories as string[]) : [],
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    polycount: typeof r.polycount === 'number' ? r.polycount : 0,
    thumbnail: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256`,
  };
}

/**
 * How well an asset answers a search.
 *
 * Scored rather than filtered, because a prompt for "a barrel" should still
 * return something when nothing is named barrel — the arena needs *a* prop, and
 * an oil drum is closer to right than no prop at all.
 */
export function scoreAsset(asset: PolyHavenAsset, terms: string[]): number {
  let score = 0;
  const name = asset.name.toLowerCase();
  for (const term of terms) {
    if (!term) continue;
    if (name.includes(term)) score += 5;
    if (asset.tags.some((t) => t.toLowerCase() === term)) score += 4;
    if (asset.tags.some((t) => t.toLowerCase().includes(term))) score += 2;
    if (asset.categories.some((c) => c.toLowerCase().includes(term))) score += 2;
  }
  return score;
}

export interface SearchOptions {
  /** Triangle budget. A phone renders a handful of these at once, not hundreds. */
  maxPolys?: number;
  count?: number;
  signal?: AbortSignal;
}

/**
 * Finds props matching a description.
 *
 * The whole index comes back in one request — a few hundred entries — so this
 * fetches once and ranks locally rather than making the caller paginate.
 */
export async function searchAssets(
  query: string,
  options: SearchOptions = {},
): Promise<{ assets: PolyHavenAsset[]; error?: string }> {
  let response: Response;
  try {
    response = await fetch(`${POLYHAVEN_API}/assets?type=models`, {
      headers: { Accept: 'application/json' },
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    return { assets: [], error: `Could not reach Poly Haven: ${(err as Error).message}` };
  }
  if (!response.ok) return { assets: [], error: `Poly Haven returned ${response.status}.` };

  const index = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!index) return { assets: [], error: 'Poly Haven sent something that is not an asset index.' };

  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);

  const maxPolys = options.maxPolys ?? 40_000;
  const ranked = Object.entries(index)
    .map(([id, raw]) => assetFrom(id, raw))
    .filter((a): a is PolyHavenAsset => a !== null)
    .filter((a) => a.polycount === 0 || a.polycount <= maxPolys)
    .map((asset) => ({ asset, score: scoreAsset(asset, terms) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.asset.polycount - b.asset.polycount);

  if (!ranked.length) {
    return { assets: [], error: `Poly Haven has no model matching "${query}".` };
  }
  return { assets: ranked.slice(0, options.count ?? 6).map((r) => r.asset) };
}

/** Reads the file list for one asset at one resolution. */
export function filesFrom(raw: unknown, resolution: Resolution): { url?: string; include: Record<string, string>; error?: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const gltf = (r.gltf ?? {}) as Record<string, unknown>;
  // Fall back down the resolutions rather than failing: not every asset is
  // published at every size, and a 2k prop is better than no prop.
  const order: Resolution[] = [resolution, '1k', '2k', '4k'];
  for (const size of order) {
    const entry = ((gltf[size] ?? {}) as Record<string, unknown>).gltf as Record<string, unknown> | undefined;
    if (!entry || typeof entry.url !== 'string') continue;
    const include: Record<string, string> = {};
    for (const [path, meta] of Object.entries((entry.include ?? {}) as Record<string, { url?: string }>)) {
      if (meta?.url) include[path] = meta.url;
    }
    return { url: entry.url, include };
  }
  return { include: {}, error: 'Poly Haven has no glTF for that asset.' };
}

/**
 * Downloads an asset as the set of files it has to become.
 *
 * Returns them at the paths the API named, under `dir`. Flattening them is what
 * would leave the model textureless: a .gltf refers to `textures/x.jpg` by that
 * exact relative path, and Godot resolves it from where the .gltf sits.
 */
export async function fetchAsset(
  id: string,
  options: { dir?: string; resolution?: Resolution; signal?: AbortSignal } = {},
): Promise<{
  files: AssetFile[];
  scenePath?: string;
  /** Metres, read from the model. Null when the glTF carried no bounds. */
  bounds?: { size: [number, number, number]; baseY: number } | null;
  error?: string;
}> {
  let listing: Response;
  try {
    listing = await fetch(`${POLYHAVEN_API}/files/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json' },
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    return { files: [], error: `Could not reach Poly Haven: ${(err as Error).message}` };
  }
  if (!listing.ok) return { files: [], error: `Poly Haven returned ${listing.status} for "${id}".` };

  const { url, include, error } = filesFrom(await listing.json().catch(() => null), options.resolution ?? '1k');
  if (!url) return { files: [], error: error ?? 'Poly Haven listed no files for that asset.' };

  const dir = options.dir ?? `assets/${id}`;
  const wanted: Array<{ path: string; url: string }> = [
    { path: `${dir}/${id}.gltf`, url },
    ...Object.entries(include).map(([path, from]) => ({ path: `${dir}/${path}`, from }))
      .map(({ path, from }) => ({ path, url: from })),
  ];

  const files: AssetFile[] = [];
  for (const item of wanted) {
    let response: Response;
    try {
      response = await fetch(item.url, { ...(options.signal ? { signal: options.signal } : {}) });
    } catch (err) {
      return { files: [], error: `Downloading ${item.path} failed: ${(err as Error).message}` };
    }
    if (!response.ok) return { files: [], error: `Poly Haven's CDN returned ${response.status} for ${item.path}.` };
    files.push({ path: item.path, bytes: new Uint8Array(await response.arrayBuffer()) });
  }

  // Read from the .gltf that was just downloaded rather than fetched again.
  let bounds: ReturnType<typeof boundsFrom> = null;
  try {
    bounds = boundsFrom(JSON.parse(new TextDecoder().decode(files[0].bytes)));
  } catch {
    // A .gltf that will not parse is a broken download; the caller finds out
    // when Godot refuses to import it, which is a clearer message than any
    // guess made here.
  }

  return { files, scenePath: `res://${dir}/${id}.gltf`, bounds };
}

/**
 * How big the model is, in metres, read from the glTF itself.
 *
 * Without this a prop is placed against a guess. Measured: Poly Haven's barrel
 * is 0.63 x 0.93 x 0.64 with its origin on its base, so the -1.2 drop that
 * suited a 2.4m cover box sank it a metre into the floor, and scaling it to
 * that box left the player hiding behind air. Both are visible in a render and
 * neither is visible in the file list.
 *
 * glTF stores POSITION accessor bounds as required min/max triples, so this is
 * exact rather than estimated — no mesh data has to be decoded.
 */
export function boundsFrom(gltf: unknown): { size: [number, number, number]; baseY: number } | null {
  const doc = (gltf ?? {}) as { accessors?: Array<{ min?: number[]; max?: number[]; type?: string }> };
  const spans = (doc.accessors ?? []).filter(
    (a) => Array.isArray(a.min) && Array.isArray(a.max) && a.min.length === 3 && a.max.length === 3,
  );
  if (!spans.length) return null;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const accessor of spans) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], accessor.min![axis]);
      max[axis] = Math.max(max[axis], accessor.max![axis]);
    }
  }
  if (!Number.isFinite(min[1]) || !Number.isFinite(max[1])) return null;

  return {
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    // Where the model's own floor is relative to its origin. Usually 0 — but
    // "usually" is what put a barrel through the ground.
    baseY: min[1],
  };
}

/** The credit CC0 does not require, written because it costs one line. */
export function attribution(asset: PolyHavenAsset): string {
  const who = asset.authors.length ? asset.authors.join(', ') : 'Poly Haven';
  return `"${asset.name}" (https://polyhaven.com/a/${asset.id}) by ${who}, CC0 — no attribution required, credited anyway.`;
}

/**
 * What separates cover from decoration.
 *
 * All three are in metres and all three came from looking at a render: below
 * these a prop is something the player runs past rather than hides behind, and
 * above the scale cap it stops looking like the thing it is.
 */
const MIN_PROP_FOOTPRINT = 0.35;
const MIN_PROP_HEIGHT = 0.7;
const MAX_PROP_SCALE = 2;

/** A prop, downloaded and measured, ready for the scene to place. */
export interface CoverProp {
  files: AssetFile[];
  scenePath: string;
  /** Metres, before `scale`. */
  size: [number, number, number];
  baseY: number;
  scale: number;
  credit: string;
  asset: PolyHavenAsset;
}

/**
 * Picks props that can actually be hidden behind.
 *
 * Two things go wrong without this, and both were visible in a render before
 * they were visible anywhere else:
 *
 *   - **Search matches nonsense.** "concrete barrier wall" returned a 0.15m
 *     concrete cat statue, which scored well on "concrete" and is not cover.
 *     So the bounds decide, not the name.
 *   - **Scale is a guess.** A barrel is 0.93m and a crate is 0.47m. Placing
 *     both at the same scale gives one useful piece of cover and one doormat,
 *     so each is scaled to a height a crouching player can use.
 */
export async function coverProps(
  queries: string[],
  options: { targetHeight?: number; resolution?: Resolution; maxPolys?: number; signal?: AbortSignal } = {},
): Promise<{ props: CoverProp[]; notes: string[] }> {
  const target = options.targetHeight ?? 1.25;
  const props: CoverProp[] = [];
  const notes: string[] = [];
  const taken = new Set<string>();

  for (const query of queries) {
    const found = await searchAssets(query, {
      count: 4,
      maxPolys: options.maxPolys ?? 12_000,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!found.assets.length) {
      notes.push(found.error ?? `Nothing on Poly Haven for "${query}".`);
      continue;
    }

    let placed = false;
    for (const asset of found.assets) {
      if (taken.has(asset.id)) continue;
      const got = await fetchAsset(asset.id, {
        resolution: options.resolution ?? '1k',
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (got.error || !got.scenePath || !got.bounds) {
        notes.push(got.error ?? `"${asset.name}" carried no bounds, so it cannot be placed safely.`);
        continue;
      }

      const [w, h, d] = got.bounds.size;
      const footprint = Math.max(w, d);

      // Scaled towards a useful height, but capped: a barrel blown up four
      // times reads as a bad texture rather than as a big barrel, and a crate
      // stretched to 3m is a wall with crate pictures on it.
      const scale = Math.min(MAX_PROP_SCALE, Math.max(0.8, target / h));
      const standing = h * scale;

      // Measured, not matched on words. "concrete barrier" scored a 0.15m
      // concrete cat statue very highly, and a cat is not cover.
      if (footprint < MIN_PROP_FOOTPRINT || standing < MIN_PROP_HEIGHT) {
        notes.push(
          `Skipped "${asset.name}" — ${footprint.toFixed(2)}m across and ${standing.toFixed(2)}m tall even scaled up, which is an ornament rather than cover.`,
        );
        continue;
      }
      taken.add(asset.id);
      props.push({
        files: got.files,
        scenePath: got.scenePath,
        size: got.bounds.size,
        baseY: got.bounds.baseY,
        scale,
        credit: attribution(asset),
        asset,
      });
      placed = true;
      break;
    }
    if (!placed) notes.push(`Nothing usable for "${query}".`);
  }

  return { props, notes };
}
