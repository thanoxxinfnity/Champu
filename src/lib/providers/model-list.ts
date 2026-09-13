/**
 * Reading a model list out of an arbitrary OpenAI-compatible endpoint.
 *
 * Kept free of imports so it can be tested directly, and because it is pure
 * parsing: no network, no state, no opinions about capabilities.
 */

/**
 * Where an endpoint might publish its model list.
 *
 * Ordered by how likely each is, and deliberately including paths *outside* the
 * chat base: an endpoint whose chat lives at /v1 may list models at /api/v1,
 * which is not reachable by appending to the base at all.
 */
export function modelListCandidates(base: string): Array<{ url: string; label: string }> {
  const trimmed = base.replace(/\/+$/, '');
  const out: Array<{ url: string; label: string }> = [
    { url: `${trimmed}/models`, label: '/models' },
  ];

  try {
    const parsed = new URL(trimmed);
    const origin = parsed.origin;
    const path = parsed.pathname.replace(/\/+$/, '');

    // The same version segment under /api, and the reverse.
    const underApi = path.startsWith('/api') ? null : `${origin}/api${path}/models`;
    const withoutApi = path.startsWith('/api') ? `${origin}${path.slice(4)}/models` : null;
    if (underApi) out.push({ url: underApi, label: `/api${path}/models` });
    if (withoutApi) out.push({ url: withoutApi, label: `${path.slice(4)}/models` });

    // A bare origin fallback for endpoints with no version segment at all.
    if (path) out.push({ url: `${origin}/models`, label: '/models (root)' });
  } catch {
    // A base that will not parse has nothing more to try.
  }

  // De-duplicate while preserving order.
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}

/**
 * Model ids out of whatever shape the endpoint returned.
 *
 * OpenAI uses { data: [{ id }] }. Others use { models: [...] }, a bare array,
 * or wrap the whole thing in a { code, msg, data } envelope with the list
 * nested inside. All of them are real, and all of them are a model list.
 */
export function modelIdsFrom(json: unknown): string[] {
  if (!json) return [];

  const pick = (row: unknown): string | undefined => {
    if (typeof row === 'string') return row;
    if (!row || typeof row !== 'object') return undefined;
    const r = row as Record<string, unknown>;
    for (const key of ['id', 'model', 'name', 'slug']) {
      if (typeof r[key] === 'string' && r[key]) return r[key] as string;
    }
    return undefined;
  };

  const fromArray = (arr: unknown): string[] =>
    Array.isArray(arr) ? arr.map(pick).filter((x): x is string => Boolean(x)) : [];

  if (Array.isArray(json)) return fromArray(json);

  const obj = json as Record<string, unknown>;
  for (const list of [obj.data, obj.models]) {
    const direct = fromArray(list);
    if (direct.length) return direct;
  }

  // { code, msg, data: { models: [...] } } and friends.
  const nested = obj.data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const n = nested as Record<string, unknown>;
    for (const list of [n.models, n.data, n.items, n.list]) {
      const found = fromArray(list);
      if (found.length) return found;
    }
  }

  return [];
}

/**
 * Cleans up a base URL that is nearly right.
 *
 * People paste the URL they found in the docs, which is usually an endpoint
 * rather than a base — `.../v1/models` or `.../v1/chat/completions`. Treating
 * that literally makes the probe ask for `/v1/models/models`, which of course
 * answers nothing, and the error blames the endpoint for the paste.
 */
export function normalizeBase(input: string): string {
  let base = input.trim().replace(/\/+$/, '');
  // Longest first, so /chat/completions is not left as a stray /chat.
  for (const suffix of ['/chat/completions', '/completions', '/models', '/chat']) {
    if (base.toLowerCase().endsWith(suffix)) {
      base = base.slice(0, -suffix.length);
      break;
    }
  }
  return base.replace(/\/+$/, '');
}

/**
 * Bases whose `/chat/completions` might answer.
 *
 * The model list and the chat route do not have to share a prefix. kie.ai
 * serves chat at /v1/chat/completions and lists models at /api/v1/models, so a
 * base derived from one is wrong for the other — and picking the wrong one
 * leaves an endpoint that probes perfectly and then cannot be talked to.
 */
export function chatBaseCandidates(base: string): string[] {
  const trimmed = normalizeBase(base);
  const out = [trimmed];

  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+$/, '');
    if (path.startsWith('/api')) out.push(`${parsed.origin}${path.slice(4)}` || parsed.origin);
    else out.push(`${parsed.origin}/api${path}`);
  } catch {
    // Not a URL; the caller reports that separately.
  }

  const seen = new Set<string>();
  return out.filter((c) => c && !seen.has(c) && (seen.add(c), true));
}


/**
 * Ids that are plainly not chat models.
 *
 * A gateway's model list is everything it can do, not everything it can chat
 * with: kie.ai lists 206 entries of which most are video, image, audio or
 * upscaling. Offering all of them in a chat switcher is how a user ends up
 * picking something that cannot answer — and the failure reads as "the app is
 * broken" rather than "that is a video model".
 *
 * Matched on the id, which in practice carries the modality.
 */
export const NOT_CHAT = new RegExp(
  [
    // Modality stated in the id: "text-to-video", "image-to-image".
    '(text|image|img|audio|speech)[-_]?to[-_]?(video|image|speech|audio|music|3d|model|dialogue)',
    // Media verbs and jobs.
    '\\b(tts|stt|whisper|lipsync|upscale|upscaler|inpaint|outpaint|animate|extend|remix|relight|restyle|denoise|embed|embedding|rerank|moderation)\\b',
    'remove[-_]?bg|background[-_]?removal|from[-_]?audio|crisp[-_]?upscale',
    // Media families, allowing a version suffix — "imagen4" is still Imagen.
    '\\b(video|music|audio|veo|kling|sora|runway|seedance|pika|luma|hailuo|dall[-_]?e|midjourney|imagen|flux|seedream|recraft|ideogram|infinitalk|elevenlabs)\\d*(?:[-_/][\\w.-]*)?\\b',
    // Named products that do not follow either pattern.
    '\\bnano[-_]?banana\\b|\\bqwen[-_/]image\\b|\\bgrok[-_]imagine\\b|\\b4o[-_]image\\b|\\bwan/\\S+',
  ].join('|'),
  'i',
);

/** Keeps the entries that could plausibly hold a conversation. */
export function chatModelsOnly(ids: string[]): string[] {
  const chat = ids.filter((id) => !NOT_CHAT.test(id));
  // If the filter would empty the list, the heuristic is wrong for this
  // endpoint and showing everything beats showing nothing.
  return chat.length ? chat : ids;
}
