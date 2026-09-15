/**
 * Sketchfab: finding a model somebody already made.
 *
 * Generating a zombie takes minutes and gives you a zombie-shaped thing.
 * Sketchfab has thousands of real ones, already textured, many of them rigged.
 * When the licence allows it, downloading one beats generating one.
 *
 * ── What needs a key and what does not ──────────────────────────────────────
 *
 * Measured against the live API on 2026-09-15:
 *
 *   - **Search is open.** `GET /v3/search?type=models` answers 200 with no
 *     credentials at all, so browsing works before a user has pasted anything.
 *   - **Download needs a token.** `GET /v3/models/{uid}/download` answers 401
 *     without one. The token comes from sketchfab.com/settings/password, and
 *     goes in as `Authorization: Token <key>` — not `Bearer`.
 *
 * ── Attribution is not optional ─────────────────────────────────────────────
 *
 * Nearly everything downloadable on Sketchfab is CC Attribution or
 * CC Attribution-ShareAlike. Both require crediting the author by name with a
 * link, in the thing you ship. So every result carries its author and licence
 * through this module, and `creditsFile()` writes them into the project. A
 * pipeline that silently drops attribution is one that hands the user a licence
 * violation and calls it an asset.
 *
 * Models whose licence forbids the use are filtered out rather than downloaded
 * and hoped about.
 */

export const SKETCHFAB_API = 'https://api.sketchfab.com/v3';

export interface SketchfabModel {
  uid: string;
  name: string;
  /** The author, for the credit line the licence requires. */
  author: string;
  authorUrl: string;
  /** Page on Sketchfab, which is the link the credit line has to point at. */
  pageUrl: string;
  licence: string;
  faceCount: number;
  /** Bytes of the .glb archive, so a 400 MB model is visible before fetching. */
  glbBytes: number;
  thumbnail?: string;
  /** Animations baked into the model. A rigged character usually has some. */
  animations: number;
  downloadable: boolean;
}

export interface SketchfabSearch {
  models: SketchfabModel[];
  error?: string;
}

/**
 * Licences that permit shipping the model in a game, keyed by the label the
 * API returns.
 *
 * Deliberately a list of what is allowed rather than of what is forbidden: a
 * licence this module has never seen should be treated as "do not ship",
 * because the cost of being wrong falls on the user.
 */
const USABLE_LICENCES = new Set([
  'CC Attribution',
  'CC Attribution-ShareAlike',
  'CC Attribution-NoDerivs',
  'CC0 Public Domain',
  'Public Domain',
  'Free Standard',
  'Standard',
]);

/** Licences that allow a look but not a ship. */
const NON_COMMERCIAL = /NonCommercial/i;

export function isUsable(licence: string): boolean {
  if (NON_COMMERCIAL.test(licence)) return false;
  return USABLE_LICENCES.has(licence);
}

/** The credit line the licence asks for, in one sentence. */
export function attribution(model: SketchfabModel): string {
  return `"${model.name}" (${model.pageUrl}) by ${model.author} (${model.authorUrl}), licensed under ${model.licence}.`;
}

/**
 * A CREDITS.md for the project.
 *
 * Written into the build rather than printed in chat: a credit the user has to
 * remember to copy is a credit that does not ship.
 */
export function creditsFile(models: SketchfabModel[]): string {
  if (!models.length) return '';
  return [
    '# Credits',
    '',
    'These models came from Sketchfab. Their licences require that the authors be',
    'credited wherever the game is distributed — keep this file with the build.',
    '',
    ...models.map((m) => `- ${attribution(m)}`),
    '',
  ].join('\n');
}

/** Reads one search result, tolerating fields the API omits. */
export function modelFrom(raw: unknown): SketchfabModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.uid !== 'string' || typeof r.name !== 'string') return null;

  const user = (r.user ?? {}) as Record<string, unknown>;
  const licence = (r.license ?? {}) as Record<string, unknown>;
  const archives = (r.archives ?? {}) as Record<string, unknown>;
  const glb = (archives.glb ?? {}) as Record<string, unknown>;
  const thumbs = ((r.thumbnails ?? {}) as Record<string, unknown>).images;

  // The largest thumbnail under 700px: the list shows them small, and the 1024
  // versions are most of a megabyte each.
  let thumbnail: string | undefined;
  if (Array.isArray(thumbs)) {
    const usable = thumbs
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
      .filter((t) => typeof t.url === 'string' && typeof t.width === 'number' && (t.width as number) <= 700)
      .sort((a, b) => (b.width as number) - (a.width as number));
    thumbnail = usable[0]?.url as string | undefined;
  }

  return {
    uid: r.uid,
    name: r.name,
    author: (user.displayName as string) ?? (user.username as string) ?? 'Unknown',
    authorUrl: (user.profileUrl as string) ?? 'https://sketchfab.com',
    pageUrl: (r.viewerUrl as string) ?? `https://sketchfab.com/3d-models/${r.uid}`,
    licence: (licence.label as string) ?? 'Unknown',
    faceCount: typeof r.faceCount === 'number' ? r.faceCount : 0,
    glbBytes: typeof glb.size === 'number' ? glb.size : 0,
    ...(thumbnail ? { thumbnail } : {}),
    animations: typeof r.animationCount === 'number' ? r.animationCount : 0,
    downloadable: r.isDownloadable === true,
  };
}

export interface SearchOptions {
  /** Cap the face count. A million-triangle scan will not run on a phone. */
  maxFaces?: number;
  /**
   * Cap the download size. Measured: a 6,278-face zombie came back at 60 MB,
   * because the geometry is small and the textures are 4K. Face count alone
   * says nothing about whether a phone can load it.
   */
  maxBytes?: number;
  /** Only models with baked animation — what a character needs. */
  animatedOnly?: boolean;
  count?: number;
  signal?: AbortSignal;
}

/**
 * Searches Sketchfab.
 *
 * No key needed. Filters to models that are downloadable, licensed for use, and
 * small enough to run — all three, because a result that fails any one of them
 * is a result the user cannot actually use and will have to be told about
 * later.
 */
export async function searchModels(query: string, options: SearchOptions = {}): Promise<SketchfabSearch> {
  const params = new URLSearchParams({
    type: 'models',
    q: query,
    downloadable: 'true',
    // Asked for generously, because the licence and face-count filters below
    // throw a lot of them away.
    count: String(Math.min(24, (options.count ?? 8) * 3)),
    sort_by: '-likeCount',
  });
  if (options.animatedOnly) params.set('animated', 'true');

  let response: Response;
  try {
    response = await fetch(`${SKETCHFAB_API}/search?${params}`, {
      headers: { Accept: 'application/json' },
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    return { models: [], error: `Could not reach Sketchfab: ${(err as Error).message}` };
  }

  if (!response.ok) {
    return { models: [], error: sketchfabError(response.status, await response.text().catch(() => '')) };
  }

  const body = (await response.json().catch(() => null)) as { results?: unknown[] } | null;
  const results = Array.isArray(body?.results) ? body.results : [];

  const maxFaces = options.maxFaces ?? 200_000;
  const maxBytes = options.maxBytes ?? 40 * 1024 * 1024;
  const models = results
    .map(modelFrom)
    .filter((m): m is SketchfabModel => m !== null)
    .filter((m) => m.downloadable && isUsable(m.licence))
    // A zero means the API did not report the figure, not that the model is
    // empty, so it is kept rather than filtered out as "too big".
    .filter((m) => m.faceCount === 0 || m.faceCount <= maxFaces)
    .filter((m) => m.glbBytes === 0 || m.glbBytes <= maxBytes)
    .slice(0, options.count ?? 8);

  if (!models.length) {
    return {
      models: [],
      error: results.length
        ? `Sketchfab had ${results.length} results for "${query}", but none were both usably licensed and small enough. Try a simpler search.`
        : `Sketchfab has no downloadable models for "${query}".`,
    };
  }
  return { models };
}

/** Turns a failure into something worth showing. */
export function sketchfabError(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return 'Sketchfab rejected the token. Get one from sketchfab.com/settings/password and paste it in Settings → API Keys.';
  }
  if (status === 404) return 'That model is gone from Sketchfab.';
  if (status === 429) return 'Sketchfab is rate limiting. Waiting a minute clears it.';
  if (status >= 500) return `Sketchfab is having trouble (${status}). Not the key — try again shortly.`;

  let detail = '';
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; error?: unknown };
    detail = typeof parsed.detail === 'string' ? parsed.detail : typeof parsed.error === 'string' ? parsed.error : '';
  } catch {
    // Not JSON.
  }
  return detail ? `Sketchfab: ${detail}.` : `Sketchfab returned ${status}.`;
}

/**
 * The signed URL for a model's .glb archive.
 *
 * Sketchfab answers with short-lived links under keys that have moved around
 * between API revisions, so every plausible spelling is read rather than the
 * one the current docs happen to show. Getting this wrong reads a working
 * response as a failure, and the user is told their token is bad when it is not.
 */
export function downloadUrlFrom(raw: unknown): { url?: string; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Sketchfab sent no download links.' };
  const r = raw as Record<string, unknown>;

  for (const key of ['glb', 'gltf', 'usdz', 'source']) {
    const entry = r[key] as Record<string, unknown> | undefined;
    const url = entry?.url ?? entry?.uri;
    if (typeof url === 'string' && url) return { url };
  }
  return { error: 'Sketchfab returned no .glb for that model.' };
}

/**
 * Downloads a model as bytes.
 *
 * The archive is a zip for `gltf` and a bare file for `glb`, so `glb` is what
 * this asks for — Godot imports it directly and there is nothing to unpack.
 */
export async function fetchModel(
  uid: string,
  token: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ bytes?: Uint8Array; error?: string }> {
  if (!token.trim()) {
    return { error: 'Downloading from Sketchfab needs a token. Settings → API Keys, or use TRELLIS instead.' };
  }

  let links: Response;
  try {
    links = await fetch(`${SKETCHFAB_API}/models/${uid}/download`, {
      // Token, not Bearer. Sketchfab answers 401 to Bearer with a valid token.
      headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    return { error: `Could not reach Sketchfab: ${(err as Error).message}` };
  }
  if (!links.ok) return { error: sketchfabError(links.status, await links.text().catch(() => '')) };

  const { url, error } = downloadUrlFrom(await links.json().catch(() => null));
  if (!url) return { error: error ?? 'Sketchfab sent no usable download link.' };

  let file: Response;
  try {
    // The signed URL is on a CDN and carries its own auth in the query string,
    // so sending the token here as well is what makes it 403.
    file = await fetch(url, { ...(options.signal ? { signal: options.signal } : {}) });
  } catch (err) {
    return { error: `The Sketchfab download link failed: ${(err as Error).message}` };
  }
  if (!file.ok) return { error: `Sketchfab's download link returned ${file.status}.` };

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength < 20) return { error: 'Sketchfab returned an empty file.' };
  return { bytes };
}

/** Whether the bytes really are a binary glTF, rather than an error page. */
export function isGlb(bytes: Uint8Array): boolean {
  return bytes.byteLength > 12 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
}
