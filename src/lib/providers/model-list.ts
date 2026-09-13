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
