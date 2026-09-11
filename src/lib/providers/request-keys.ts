import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request provider credentials.
 *
 * Keys used to come only from the server's own environment, which meant the web
 * build had no way for a user to supply one — the app simply refused to work
 * until someone edited .env.local, which is not something a phone can do. A key
 * sent with the request fixes that, and is also the safer shape for a hosted
 * deployment: each user's key serves only their own request, is never written to
 * disk, and is never shared between sessions.
 *
 * The environment still wins as a fallback, so a self-hosted instance with
 * NVIDIA_NIM_API_KEY set keeps working with no client changes.
 *
 * Threaded through async context rather than fifteen function signatures. That
 * is safe here because every consumer resolves its key eagerly — `nimChatConfig`
 * builds its Authorization header before the stream starts — so nothing reads
 * the store from a detached stream callback where the context would be gone.
 */

export interface RequestKeys {
  nim?: string;
  pollinations?: string;
}

const store = new AsyncLocalStorage<RequestKeys>();

/** Headers the client sends. Named so they cannot collide with a proxy's own. */
export const NIM_KEY_HEADER = 'x-chomugiri-nim-key';
export const POLLINATIONS_KEY_HEADER = 'x-chomugiri-pollinations-token';

/** Reads the caller-supplied credentials off an incoming request. */
export function keysFromRequest(req: Request): RequestKeys {
  const nim = req.headers.get(NIM_KEY_HEADER)?.trim();
  const pollinations = req.headers.get(POLLINATIONS_KEY_HEADER)?.trim();
  return { nim: nim || undefined, pollinations: pollinations || undefined };
}

/** Runs `fn` with these credentials visible to the provider adapters. */
export function withRequestKeys<T>(keys: RequestKeys, fn: () => T): T {
  return store.run(keys, fn);
}

/** The caller-supplied credential for this provider, if there is one. */
export function requestKey(provider: keyof RequestKeys): string | undefined {
  return store.getStore()?.[provider]?.trim() || undefined;
}

/**
 * A short, non-reversible tag for the active key.
 *
 * Module-level caches (the NIM catalogue, the working embedding model) are
 * per-process. Once keys vary per request those caches must vary with them, or
 * one user's catalogue is served to the next. This tags the cache without ever
 * putting the key itself in a cache identifier.
 */
export function keyFingerprint(key: string | undefined): string {
  if (!key) return 'env';
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
