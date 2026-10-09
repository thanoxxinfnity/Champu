/** Browser side of the pack: static files under /od/, fetched once and kept. */
import type { OdIndex, OdIo } from './types.ts';

const cache = new Map<string, Promise<string | null>>();

/** Static files under one folder of the app (/od/, /skills/), fetched once and kept. */
export function makeIo(base: string): OdIo {
  const get = (path: string): Promise<string | null> => {
    const key = `${base}${path}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = fetch(key, { signal: AbortSignal.timeout(8000) })
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null);
      cache.set(key, hit);
      // A failed fetch is not remembered: the next run may have network.
      void hit.then((v) => { if (v == null) cache.delete(key); });
    }
    return hit;
  };
  return {
    text: get,
    json: async <T,>(path: string): Promise<T | null> => {
      const t = await get(path);
      if (t == null) return null;
      try { return JSON.parse(t) as T; } catch { return null; }
    },
  };
}

export const browserIo: OdIo = makeIo('/od/');
export const libraryIo: OdIo = makeIo('/skills/');
export const motionIo: OdIo = makeIo('/motion/');

export const loadOdIndex = (io: OdIo = browserIo): Promise<OdIndex | null> => io.json<OdIndex>('index.json');

import type { LibIndex } from '../library/types.ts';
export const loadLibIndex = (): Promise<LibIndex | null> => libraryIo.json<LibIndex>('index.json');
