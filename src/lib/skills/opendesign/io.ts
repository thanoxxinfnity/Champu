/** Browser side of the pack: static files under /od/, fetched once and kept. */
import type { OdIndex, OdIo } from './types.ts';

const cache = new Map<string, Promise<string | null>>();

async function get(path: string): Promise<string | null> {
  let hit = cache.get(path);
  if (!hit) {
    hit = fetch(`/od/${path}`, { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.text() : null))
      .catch(() => null);
    cache.set(path, hit);
    // A failed fetch is not remembered: the next run may have network.
    void hit.then((v) => { if (v == null) cache.delete(path); });
  }
  return hit;
}

export const browserIo: OdIo = {
  text: get,
  json: async <T,>(path: string): Promise<T | null> => {
    const t = await get(path);
    if (t == null) return null;
    try { return JSON.parse(t) as T; } catch { return null; }
  },
};

export const loadOdIndex = (io: OdIo = browserIo): Promise<OdIndex | null> => io.json<OdIndex>('index.json');
