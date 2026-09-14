'use client';

import { getSetting, setSetting } from '@/lib/db/history';

/**
 * Provider credentials, held on the user's device.
 *
 * Before this existed the only way to give Chomugiri an NVIDIA key was to edit
 * .env.local on the machine running the server — impossible from a phone, and
 * the reason the app could look completely broken on a fresh install: no key
 * meant no NIM models, which meant nothing answered.
 *
 * Two storage backends, because there are two ways Chomugiri runs:
 *
 *   - In the APK the key belongs to the native shell, which already holds it in
 *     encrypted prefs and injects it server-side. The web layer just posts to
 *     /api/shell/keys and never keeps a copy.
 *   - In the browser there is no native shell, so the key lives in IndexedDB
 *     alongside the rest of the workspace and rides along on each API request.
 *     It is sent to Chomugiri's own server and nowhere else.
 */

export interface ApiKeys {
  nim: string;
  pollinations: string;
  /**
   * Tripo AI, for generating 3D models. Optional by design: without it the
   * Godot suite builds geometry in code, which needs no key and cannot fail.
   */
  tripo: string;
  /**
   * Meshy AI. Same job as Tripo, and additionally rigs what it generates —
   * which is why it is tried first when both are present.
   */
  meshy: string;
  /**
   * A self-hosted Microsoft TRELLIS NIM container.
   *
   * A URL rather than a key because there is no hosted TRELLIS worth calling:
   * NVIDIA's only accepts its own sample images. See `suites/godot/trellis.ts`
   * for what it answers to everything else.
   */
  trellisUrl: string;
}

const EMPTY: ApiKeys = { nim: '', pollinations: '', tripo: '', meshy: '', trellisUrl: '' };

export const NIM_KEY_HEADER = 'x-chomugiri-nim-key';
export const POLLINATIONS_KEY_HEADER = 'x-chomugiri-pollinations-token';

/**
 * Read synchronously by every outgoing request, so it is mirrored in memory.
 * `loadKeys()` fills it once at boot.
 */
let cache: ApiKeys = { ...EMPTY };

/** True when running inside the Android shell, which owns the key itself. */
let shellHosted: boolean | null = null;

export function getKeys(): ApiKeys {
  return cache;
}

export async function loadKeys(): Promise<ApiKeys> {
  if (await isShellHosted()) {
    // The shell holds these, so read them back from it rather than from
    // IndexedDB — which in the APK is empty, and was why a Tripo key saved in
    // one session came back blank in the next.
    //
    // The NIM and Pollinations keys are deliberately not returned by the shell:
    // the page never needs to read a credential it only ever posts. The UI
    // shows those as "already configured" from `nimConfigured` instead.
    try {
      const res = await fetch('/api/shell/keys', { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const json = (await res.json()) as { tripoKey?: string; meshyKey?: string; trellisUrl?: string };
        cache = {
          ...EMPTY,
          tripo: json.tripoKey ?? '',
          meshy: json.meshyKey ?? '',
          trellisUrl: json.trellisUrl ?? '',
        };
        return cache;
      }
    } catch {
      // The shell not answering is not a reason to lose the in-memory copy.
      return cache;
    }
  }

  const stored = await getSetting<ApiKeys | null>('apiKeys', null);
  cache = { ...EMPTY, ...(stored ?? {}) };
  return cache;
}

export async function saveKeys(next: Partial<ApiKeys>): Promise<ApiKeys> {
  // Trim here rather than at every call site: a key pasted from a web page
  // almost always arrives with a trailing newline, and the upstream 401s on it.
  // Done by walking the keys rather than naming each field, so adding a
  // credential cannot quietly skip the trim.
  const merged = { ...EMPTY, ...cache, ...next };
  for (const key of Object.keys(merged) as Array<keyof ApiKeys>) {
    merged[key] = String(merged[key] ?? '').trim();
  }
  cache = merged;

  if (await isShellHosted()) {
    // The shell is the system of record; keeping a second copy in IndexedDB
    // would leave a stale key behind after the user clears it natively — and
    // IndexedDB is exactly the storage that did not survive a restart.
    //
    // Every credential goes, not just the two the shell originally knew about.
    // Sending a subset is what left the Tripo key alive in memory and gone
    // after a restart: it worked all session, then the field read empty and the
    // Godot suite quietly dropped back to code-built geometry.
    await postToShell({
      nimKey: cache.nim,
      pollinationsToken: cache.pollinations,
      tripoKey: cache.tripo,
      meshyKey: cache.meshy,
      trellisUrl: cache.trellisUrl,
    });
    return cache;
  }

  await setSetting('apiKeys', cache);
  return cache;
}

/**
 * Deployment credentials, kept wherever the platform can actually hold them.
 *
 * In the APK this is the native secret store; in a browser it is IndexedDB.
 * Split from `saveKeys` because the Vercel token is read back by the page (the
 * deploy call is made from here) while the model keys never are.
 */
export async function saveVercel(token: string, teamId: string): Promise<void> {
  if (await isShellHosted()) {
    await postToShell({ vercelToken: token.trim(), vercelTeamId: teamId.trim() });
    return;
  }
  await setSetting('vercel', { token: token.trim(), teamId: teamId.trim() });
}

export async function loadVercel(): Promise<{ token: string; teamId: string }> {
  if (await isShellHosted()) {
    try {
      const res = await fetch('/api/shell/keys', { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const json = (await res.json()) as { vercelToken?: string; vercelTeamId?: string };
        return { token: json.vercelToken ?? '', teamId: json.vercelTeamId ?? '' };
      }
    } catch {
      // Fall through to the browser copy.
    }
  }
  const stored = await getSetting<{ token: string; teamId: string } | null>('vercel', null);
  return { token: stored?.token ?? '', teamId: stored?.teamId ?? '' };
}

/**
 * Headers carrying whatever the user has saved.
 *
 * Empty inside the Android shell: the key never leaves the native side there, so
 * sending it back through the WebView would be a copy with no purpose.
 */
export function keyHeaders(): Record<string, string> {
  if (shellHosted) return {};
  const h: Record<string, string> = {};
  if (cache.nim) h[NIM_KEY_HEADER] = cache.nim;
  if (cache.pollinations) h[POLLINATIONS_KEY_HEADER] = cache.pollinations;
  return h;
}

/** Merges the credential headers into an existing init, preserving its own. */
export function withKeys(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...keyHeaders() } };
}

/**
 * Probes for the native shell.
 *
 * /api/shell/keys exists only in the Android build — the web server has no such
 * route and answers 404, which is the signal. Cached: the answer cannot change
 * within a session.
 */
export async function isShellHosted(): Promise<boolean> {
  if (shellHosted !== null) return shellHosted;
  try {
    const res = await fetch('/api/shell/keys', { signal: AbortSignal.timeout(4000) });
    shellHosted = res.ok;
  } catch {
    shellHosted = false;
  }
  return shellHosted;
}

/** Whether a NIM key is configured, from whichever side owns it. */
export async function nimConfigured(): Promise<boolean> {
  if (await isShellHosted()) {
    try {
      const res = await fetch('/api/shell/keys', { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return false;
      const json = (await res.json()) as { nimConfigured?: boolean };
      return Boolean(json.nimConfigured);
    } catch {
      return false;
    }
  }
  return Boolean(cache.nim);
}

/** Only the fields passed are written, so a partial save clears nothing else. */
async function postToShell(fields: Record<string, string>): Promise<void> {
  const res = await fetch('/api/shell/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`The app shell refused the credentials (${res.status}).`);
}

/**
 * A key's shape, checked before it is saved.
 *
 * Catching an obviously wrong paste here is worth it: the alternative is a 401
 * from NVIDIA several seconds later that reads as "the app is broken".
 */
export function validateNimKey(key: string): string | null {
  const k = key.trim();
  if (!k) return null;
  if (/\s/.test(k)) return 'That key contains a space — it was probably copied with surrounding text.';
  if (!k.startsWith('nvapi-')) return 'An NVIDIA NIM key starts with "nvapi-". Copy it again from build.nvidia.com.';
  if (k.length < 40) return 'That key looks truncated — NVIDIA keys are much longer.';
  return null;
}

/** Shows enough to recognise a key without revealing it. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 12) return k ? '•'.repeat(k.length) : '';
  return `${k.slice(0, 9)}${'•'.repeat(10)}${k.slice(-4)}`;
}
